import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import type { NotificationChannel, Plan, Studio, Subscription } from '@prisma/client'
import {
  addDays,
  alertDedupeKey,
  computeStatus,
  daysLeft,
  dueStage,
  fromIst,
  graceEnd,
  istDate,
  istParts,
  type AlertSettings,
  type ReminderStage,
} from '@weddyzone/shared'
import { randomToken } from '../common/util'
import { config } from '../config'
import { PaymentService } from '../core/payment.service'
import { stateOf } from '../core/plans.service'
import { SettingsService } from '../core/settings.service'
import { UsageService } from '../core/usage.service'
import { PrismaService } from '../prisma/prisma.service'
import { AlertsService, type QueuedAlert } from './alerts.service'
import { absoluteUrl, cycleLabel, inr, istDay, plural, renewPath } from './format'
import { SubscriptionLifecycleService } from './lifecycle.service'

type Row = Subscription & { plan: Plan; studio: Studio }

const HOUR = 3_600_000
const GB = 1024 ** 3
const USAGE_ALERT_RATIO = 0.8

export interface JobReport {
  checked: number
  statusChanges: number
  alerts: number
  renewed: number
  digest: boolean
}

/**
 * The hourly subscription job: saves status changes, sends T-7/T-3/T-1 reminders, moves plans
 * into grace at the deadline and to read-only when grace ends, renews test-mode auto-renewals,
 * flags heavy usage, sends win-back coupons and the admin's daily digest. All date maths is in
 * IST. Running it twice (or on two servers at once) sends nothing twice: every alert is claimed
 * by a unique dedupe key first.
 */
@Injectable()
export class SubscriptionJobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('SubscriptionJob')
  private timers: NodeJS.Timeout[] = []
  private running = false
  private lastRefresh = 0

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly payments: PaymentService,
    private readonly alerts: AlertsService,
    private readonly lifecycle: SubscriptionLifecycleService,
    private readonly usage: UsageService,
  ) {}

  onApplicationBootstrap() {
    const c = config()
    if (!c.JOBS_ENABLED || c.NODE_ENV === 'test') return
    // First run a minute after start, then at one minute past every hour.
    const first = setTimeout(() => void this.tick(), 60_000)
    const msToNextHour = HOUR - (Date.now() % HOUR) + 60_000
    const align = setTimeout(() => {
      void this.tick()
      const every = setInterval(() => void this.tick(), HOUR)
      every.unref()
      this.timers.push(every)
    }, msToNextHour)
    first.unref()
    align.unref()
    this.timers.push(first, align)
    this.logger.log('Hourly subscription job scheduled')
  }

  onModuleDestroy() {
    this.timers.forEach((t) => clearTimeout(t))
  }

  private async tick() {
    if (this.running) return
    this.running = true
    try {
      const r = await this.run()
      if (r.alerts || r.statusChanges || r.renewed || r.digest) this.logger.log(`Checked ${r.checked}: ${r.statusChanges} status changes, ${r.alerts} alerts, ${r.renewed} renewals${r.digest ? ', digest sent' : ''}`)
    } catch (e) {
      this.logger.error(`Subscription job failed: ${(e as Error).stack ?? e}`)
    } finally {
      this.running = false
    }
  }

  /** One full pass. `now` is injectable so tests can walk a subscription through its life. */
  async run(now = new Date()): Promise<JobReport> {
    const settings = await this.settings.alerts()
    const report: JobReport = { checked: 0, statusChanges: 0, alerts: 0, renewed: 0, digest: false }

    // Everything near or past its deadline (60 days back covers grace and win-back).
    const horizon = addDays(now, Math.max(...settings.reminderDays) + 1)
    const rows = await this.prisma.subscription.findMany({
      where: { studio: { removedAt: null }, currentPeriodEnd: { lte: horizon, gte: addDays(now, -Math.max(60, (settings.winbackAfterDays ?? 0) + settings.graceDays + 7)) } },
      include: { plan: true, studio: true },
    })
    report.checked = rows.length
    for (const row of rows) {
      try {
        await this.processOne(row, now, settings, report)
      } catch (e) {
        this.logger.error(`Subscription ${row.id}: ${(e as Error).message}`)
      }
    }
    report.statusChanges += await this.refreshStatuses(now, true)
    report.alerts += await this.usageAlerts(now)
    if (await this.digestDue(now, settings)) report.digest = await this.sendDigest(now)
    return report
  }

  private async processOne(row: Row, now: Date, settings: AlertSettings, report: JobReport) {
    const state = stateOf(row)
    // Test mode: the mock gateway "charges" auto-renewals at the deadline, through the webhook path.
    if (now >= row.currentPeriodEnd && row.autoRenew && row.gatewaySubscriptionId && !row.cancelAtPeriodEnd && row.status !== 'CANCELLED') {
      const simulated = this.payments.simulatedRenewal(row.gatewaySubscriptionId, row.amountPaid || row.plan.yearlyPrice)
      if (simulated) {
        // Deterministic id: two job runs for the same deadline renew once.
        const r = await this.lifecycle.processWebhook(`evt_mock_renew_${row.id}_${row.currentPeriodEnd.getTime()}`, simulated)
        if (r.handled === 'renewed') report.renewed++
        return
      }
    }

    const stage = dueStage(state, now, settings)
    let queued: QueuedAlert[] = []
    if (stage) queued = await this.stageAlerts(row, stage, now, settings)
    // The status may already read CANCELLED (saved by a status refresh); the dedupe key keeps this once.
    else if (now >= row.currentPeriodEnd && row.cancelAtPeriodEnd) queued = await this.endedAlerts(row)
    if (now >= row.currentPeriodEnd) queued.push(...(await this.winback(row, now, settings)))
    report.alerts += queued.filter((q) => q.row.channel === 'IN_APP').length
    await this.alerts.dispatch(queued)
  }

  private studioWhatsApp(row: Row, template: 'PLAN_EXPIRY_REMINDER' | 'PLAN_EXPIRED_GRACE' | 'PLAN_READ_ONLY', settings: AlertSettings) {
    const link = absoluteUrl(renewPath(row.plan.code, row.cycle))
    const base = { studioName: row.studio.name, planName: row.plan.name, link }
    if (template === 'PLAN_EXPIRY_REMINDER') return { template, vars: { ...base, date: istDay(row.currentPeriodEnd) } }
    if (template === 'PLAN_EXPIRED_GRACE') return { template, vars: { ...base, date: istDay(row.currentPeriodEnd), graceDays: String(settings.graceDays) } }
    return { template, vars: base }
  }

  /** Alerts (and the status change) for the stage that is due. All in one transaction per subscription. */
  private async stageAlerts(row: Row, stage: ReminderStage, now: Date, settings: AlertSettings): Promise<QueuedAlert[]> {
    const dedupe = alertDedupeKey('expiry', row.id, row.currentPeriodEnd, stage.label)
    const plan = `${row.plan.name}${row.isTrial ? ' trial' : ''}`
    const renew = renewPath(row.plan.code, row.cycle)
    const date = istDay(row.currentPeriodEnd)
    const adminLink = `/admin/subscriptions/${row.id}`
    const owner = row.studio.name

    return this.prisma.$transaction(async (tx) => {
      const queued: QueuedAlert[] = []
      const studio = (channels: NotificationChannel[], title: string, message: string, whatsapp?: ReturnType<SubscriptionJobsService['studioWhatsApp']>) =>
        this.alerts.queue(
          {
            to: { type: 'STUDIO', studioId: row.studioId },
            channels,
            dedupe,
            type: stage.kind === 'BEFORE' ? 'SUBSCRIPTION_REMINDER' : stage.kind === 'DEADLINE' ? 'SUBSCRIPTION_GRACE' : 'SUBSCRIPTION_EXPIRED',
            title,
            message,
            link: renew,
            icon: stage.kind === 'BEFORE' ? 'alarm' : 'exclamation-triangle',
            subscriptionId: row.id,
            email: { subject: `${title} · Wedmanage`, text: `Hi ${owner},\n\n${message}\n\nRenew in one click: ${absoluteUrl(renew)}\n\nYour photos, albums and client galleries are never deleted when a plan ends.` },
            whatsapp,
          },
          tx,
        )
      const admin = (title: string, message: string) =>
        this.alerts.queue(
          { to: { type: 'ADMIN' }, channels: ['IN_APP', 'EMAIL'], dedupe, type: stage.kind === 'GRACE_END' ? 'SUBSCRIPTION_EXPIRED' : 'SUBSCRIPTION_REMINDER', title, message, link: adminLink, icon: 'alarm', subscriptionId: row.id },
          tx,
        )

      if (stage.kind === 'BEFORE') {
        const left = daysLeft(row.currentPeriodEnd, now)
        const when = left <= 0 ? 'today' : left === 1 ? 'tomorrow' : `in ${plural(left, 'day')}`
        const sorted = [...settings.reminderDays].sort((a, b) => b - a)
        // First reminder (T-7): every channel. Last (T-1): every channel + admin. Others (T-3): in-app + WhatsApp.
        const channels: NotificationChannel[] = stage.days === sorted[0] || stage.days === sorted[sorted.length - 1] ? ['IN_APP', 'EMAIL', 'WHATSAPP'] : ['IN_APP', 'WHATSAPP']
        queued.push(...(await studio(channels, `Your ${plan} expires ${when}`, `Your ${plan} expires on ${date}. Renew to keep creating events and uploading without a break.`, this.studioWhatsApp(row, 'PLAN_EXPIRY_REMINDER', settings))))
        if (stage.days === sorted[sorted.length - 1]) {
          queued.push(...(await admin(`${owner}: ${plan} expires ${when}`, `${row.plan.name} (${cycleLabel(row.cycle)}) · deadline ${date}${row.studio.phone ? ` · ${row.studio.phone}` : ''}`)))
        }
      } else if (stage.kind === 'DEADLINE') {
        const ends = graceEnd(stateOf(row), settings)
        await tx.subscription.update({ where: { id: row.id }, data: { status: 'GRACE', graceEndsAt: row.graceEndsAt ?? ends } })
        const q = await studio(
          ['IN_APP', 'EMAIL', 'WHATSAPP'],
          'Plan expired',
          `Your ${plan} expired on ${date}. Your galleries stay view-only and new uploads are paused: renew within ${plural(settings.graceDays, 'day')} (by ${istDay(ends)}), or your galleries close for customers.`,
          this.studioWhatsApp(row, 'PLAN_EXPIRED_GRACE', settings),
        )
        queued.push(...q, ...(await admin(`${owner}: ${plan} expired`, `In grace until ${istDay(ends)} · ${row.plan.name} (${cycleLabel(row.cycle)})${row.studio.phone ? ` · ${row.studio.phone}` : ''}`)))
        if (q.length) await this.lifecycle.event(tx, row.id, 'GRACE_STARTED', { fromPlan: row.plan.name, note: `Deadline ${date} passed; grace until ${istDay(ends)}` })
      } else {
        await tx.subscription.update({ where: { id: row.id }, data: { status: 'EXPIRED', graceEndsAt: row.graceEndsAt ?? graceEnd(stateOf(row), settings) } })
        const q = await studio(
          ['IN_APP', 'EMAIL', 'WHATSAPP'],
          'Account is now read-only',
          `Your ${plan} has expired and your studio is now read-only: you can't add events or upload photos. Your clients can still view delivered albums and selections. Renew any time to continue.`,
          this.studioWhatsApp(row, 'PLAN_READ_ONLY', settings),
        )
        queued.push(...q, ...(await admin(`${owner} is now read-only`, `${plan} expired ${date}; grace ended. ${row.studio.phone ?? ''}`.trim())))
        if (q.length) await this.lifecycle.event(tx, row.id, 'EXPIRED', { fromPlan: row.plan.name, note: 'Grace period ended; studio is read-only' })
      }
      return queued
    })
  }

  /** A plan the studio cancelled has reached its end date. */
  private async endedAlerts(row: Row): Promise<QueuedAlert[]> {
    return this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({ where: { id: row.id }, data: { status: 'CANCELLED' } })
      const dedupe = alertDedupeKey('ended', row.id, row.currentPeriodEnd, 'END')
      const q = await this.alerts.queue(
        {
          to: { type: 'STUDIO', studioId: row.studioId },
          channels: ['IN_APP', 'EMAIL'],
          dedupe,
          type: 'SUBSCRIPTION_CANCELLED',
          title: 'Your plan has ended',
          message: `Your cancelled ${row.plan.name} plan ended on ${istDay(row.currentPeriodEnd)}. Your studio is read-only; nothing has been deleted. Choose a plan any time to continue.`,
          link: '/subscriptions',
          icon: 'x-octagon',
          subscriptionId: row.id,
        },
        tx,
      )
      const a = await this.alerts.queue(
        { to: { type: 'ADMIN' }, channels: ['IN_APP'], dedupe, type: 'SUBSCRIPTION_CANCELLED', title: `${row.studio.name}: cancelled plan ended`, message: `${row.plan.name} ended ${istDay(row.currentPeriodEnd)}`, link: `/admin/subscriptions/${row.id}`, icon: 'x-octagon', subscriptionId: row.id },
        tx,
      )
      return [...q, ...a]
    })
  }

  /** Win-back: a one-time coupon some days after a plan expires or a cancelled plan ends. */
  private async winback(row: Row, now: Date, settings: AlertSettings): Promise<QueuedAlert[]> {
    if (settings.winbackAfterDays === null) return []
    const status = computeStatus(stateOf(row), now, settings)
    if (status !== 'EXPIRED' && status !== 'CANCELLED') return []
    const endedAt = status === 'EXPIRED' ? graceEnd(stateOf(row), settings) : row.currentPeriodEnd
    if (now < addDays(endedAt, settings.winbackAfterDays)) return []
    const dedupe = alertDedupeKey('winback', row.id, row.currentPeriodEnd, `D+${settings.winbackAfterDays}`)
    return this.prisma.$transaction(async (tx) => {
      const code = `WB-${randomToken(6).replace(/[^A-Za-z0-9]/g, 'X').toUpperCase()}`
      const expiresAt = addDays(now, 14)
      const link = `${renewPath(row.plan.code, row.cycle)}&coupon=${code}`
      const queued = await this.alerts.queue(
        {
          to: { type: 'STUDIO', studioId: row.studioId },
          channels: ['IN_APP', 'EMAIL', 'WHATSAPP'],
          dedupe,
          type: 'WINBACK_COUPON',
          title: `${settings.winbackPercentOff}% off to come back`,
          message: `We miss you! Use code ${code} for ${settings.winbackPercentOff}% off your next plan, valid until ${istDay(expiresAt)}.`,
          link,
          icon: 'gift',
          subscriptionId: row.id,
          whatsapp: { template: 'PLAN_WINBACK', vars: { studioName: row.studio.name, percent: String(settings.winbackPercentOff), code, date: istDay(expiresAt), link: absoluteUrl(link) } },
        },
        tx,
      )
      // Only the run that claimed the alert creates the coupon.
      if (queued.length) await tx.coupon.create({ data: { code, subscriptionId: row.id, percentOff: settings.winbackPercentOff, expiresAt } })
      return queued
    })
  }

  /**
   * Saves statuses that changed with the passage of time (no alerts: those come from the stages).
   * Admin lists call this too (at most once a minute) so filters by status are never stale.
   */
  async refreshStatuses(now = new Date(), force = false): Promise<number> {
    if (!force && Date.now() - this.lastRefresh < 60_000) return 0
    this.lastRefresh = Date.now()
    const settings = await this.settings.alerts()
    const rows = await this.prisma.subscription.findMany({ where: { status: { not: 'CANCELLED' } } })
    let changed = 0
    for (const row of rows) {
      const status = computeStatus(stateOf(row), now, settings)
      if (status === row.status) continue
      const ok = await this.prisma.subscription.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data: { status } })
      changed += ok.count
    }
    return changed
  }

  /** Admin alert when a studio passes 80% of its events or uploads in this 30-day window: an upsell lead. */
  private async usageAlerts(now: Date): Promise<number> {
    const settings = await this.settings.alerts()
    const subs = await this.prisma.subscription.findMany({ where: { studio: { removedAt: null } }, include: { plan: true, studio: true } })
    const live = subs.filter((s) => !['EXPIRED', 'CANCELLED'].includes(computeStatus(stateOf(s), now, settings)))
    let sent = 0
    for (const s of live) {
      const m = await this.usage.meter(s.studioId)
      const window = m.windowStart.slice(0, 10)
      const checks: { key: string; used: number; limit: number | null; label: string; text: string }[] = [
        { key: 'events', used: m.events.used, limit: m.events.limit, label: m.lifetime ? 'trial events' : 'events this month', text: `${m.events.used} of ${m.events.limit}` },
        {
          key: 'uploads',
          used: m.uploads.usedBytes / GB,
          limit: m.uploads.limitBytes === null ? null : m.uploads.limitBytes / GB,
          label: m.lifetime ? 'trial uploads' : 'uploads this month',
          text: `${(m.uploads.usedBytes / GB).toFixed(1)} of ${m.uploads.limitBytes === null ? '' : Math.round(m.uploads.limitBytes / GB)} GB`,
        },
      ]
      for (const c of checks) {
        if (c.limit === null || c.limit === 0 || c.used < c.limit * USAGE_ALERT_RATIO) continue
        const pct = Math.round((c.used / c.limit) * 100)
        const q = await this.alerts.send({
          to: { type: 'ADMIN' },
          channels: ['IN_APP'],
          dedupe: `usage:${s.studioId}:${c.key}:${s.planId}:${window}`,
          type: 'USAGE_HIGH',
          title: `${s.studio.name} used ${pct}% of ${c.label}`,
          message: `${c.text} on ${s.plan.name} · upsell opportunity`,
          link: `/admin/subscriptions/${s.id}`,
          icon: 'graph-up-arrow',
          subscriptionId: s.id,
        })
        sent += q.length
      }
    }
    return sent
  }

  // ------------------------------------------------------------------ daily digest

  private async digestDue(now: Date, settings: AlertSettings): Promise<boolean> {
    const [h, m] = settings.digestTime.split(':').map(Number)
    const p = istParts(now)
    if (p.hour * 60 + p.minute < h * 60 + m) return false
    const sent = await this.prisma.notification.findUnique({ where: { dedupeKey: `digest:${istDate(now)}:ADMIN:EMAIL` } })
    return !sent
  }

  /** The admin's morning email: what expires this week, what expired, sold and failed yesterday. */
  async sendDigest(now = new Date()): Promise<boolean> {
    const settings = await this.settings.alerts()
    const today = istDate(now)
    const p = istParts(now)
    const todayStart = fromIst({ year: p.year, month: p.month, day: p.day })
    const yesterdayStart = addDays(todayStart, -1)
    const yesterday = { gte: yesterdayStart, lt: todayStart }

    const [expiring, expired, sold, failed] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { currentPeriodEnd: { gte: now, lte: addDays(todayStart, 8) }, status: { not: 'CANCELLED' } },
        include: { plan: true, studio: true },
        orderBy: { currentPeriodEnd: 'asc' },
      }),
      this.prisma.subscriptionEvent.findMany({ where: { type: { in: ['EXPIRED', 'GRACE_STARTED'] }, createdAt: yesterday }, include: { subscription: { include: { plan: true, studio: true } } } }),
      this.prisma.payment.findMany({ where: { purpose: 'SUBSCRIPTION', status: 'SUCCESS', paidAt: yesterday }, include: { studio: true, plan: true } }),
      this.prisma.payment.findMany({ where: { purpose: 'SUBSCRIPTION', status: 'FAILED', createdAt: yesterday }, include: { studio: true, plan: true } }),
    ])
    const expiringSoon = expiring.filter((s) => daysLeft(s.currentPeriodEnd, now) <= 7)
    const revenue = sold.reduce((sum, p) => sum + p.amount, 0)
    const line = (s: string) => `  • ${s}`
    const text = [
      `Wedmanage daily digest — ${istDay(now)}`,
      '',
      `Expiring in the next 7 days (${expiringSoon.length})`,
      ...(expiringSoon.length
        ? expiringSoon.map((s) => {
            const left = daysLeft(s.currentPeriodEnd, now)
            return line(`${s.studio.name} · ${s.plan.name}${s.isTrial ? ' trial' : ''} (${cycleLabel(s.cycle)}) · deadline ${istDay(s.currentPeriodEnd)} · ${left <= 0 ? 'today' : plural(left, 'day') + ' left'} · ${s.studio.phone ?? 'no phone'}`)
          })
        : [line('None')]),
      '',
      `Expired yesterday (${expired.length})`,
      ...(expired.length ? expired.map((e) => line(`${e.subscription.studio.name} · ${e.subscription.plan.name} · ${e.type === 'EXPIRED' ? 'now read-only' : `in grace (${settings.graceDays} days)`} · ${e.subscription.studio.phone ?? 'no phone'}`)) : [line('None')]),
      '',
      `New subscriptions and renewals yesterday (${sold.length}) · revenue ${inr(revenue)} incl. GST`,
      ...(sold.length ? sold.map((p) => line(`${p.studio.name} · ${p.description} · ${inr(p.amount)}`)) : [line('None')]),
      '',
      `Failed payments yesterday (${failed.length})`,
      ...(failed.length ? failed.map((p) => line(`${p.studio.name} · ${p.description} · ${inr(p.amount)} · ${p.failureReason ?? 'declined'}`)) : [line('None')]),
      '',
      absoluteUrl('/admin/subscriptions?tab=expiring'),
    ].join('\n')

    const queued = await this.alerts.send({
      to: { type: 'ADMIN' },
      channels: ['EMAIL', 'IN_APP'],
      dedupe: `digest:${today}`,
      type: 'ADMIN_DIGEST',
      title: `Daily digest · ${istDay(now)}`,
      message: `${expiringSoon.length} expiring this week · ${expired.length} expired yesterday · ${sold.length} paid (${inr(revenue)}) · ${failed.length} failed`,
      link: '/admin',
      icon: 'envelope-paper',
      email: { subject: `Wedmanage digest ${istDay(now)}: ${expiringSoon.length} expiring, ${sold.length} new, ${failed.length} failed`, text },
    })
    return queued.length > 0
  }
}
