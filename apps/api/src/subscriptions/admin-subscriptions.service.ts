import { Injectable } from '@nestjs/common'
import type { Notification, Plan, Prisma, Studio, Subscription, User } from '@prisma/client'
import {
  addCycle,
  addDays,
  CANCEL_REASONS,
  daysLeft,
  deadlineTone,
  fromIst,
  graceEnd,
  istParts,
  type AdminNotificationDto,
  type AdminStatsDto,
  type AdminSubscriptionDetailDto,
  type AdminSubscriptionQuery,
  type AdminSubscriptionRowDto,
  type CancelReason,
  type Paginated,
  type PlanCode,
  type SentNotificationDto,
} from '@weddyzone/shared'
import { CYCLE_MONTHS, type BillingCycle } from '@weddyzone/shared'
import { notFound } from '../common/errors'
import { paginate } from '../common/util'
import { paymentDto } from '../core/payment.service'
import { PlansService, stateOf, statusOf } from '../core/plans.service'
import { SettingsService } from '../core/settings.service'
import { UsageService } from '../core/usage.service'
import { PrismaService } from '../prisma/prisma.service'
import { SubscriptionJobsService } from './jobs.service'

const rowInclude = {
  plan: true,
  studio: { include: { users: { where: { role: 'OWNER' as const }, orderBy: { createdAt: 'asc' as const }, take: 1 } } },
} satisfies Prisma.SubscriptionInclude
type Row = Subscription & { plan: Plan; studio: Studio & { users: User[] } }

const CSV_LIMIT = 10_000

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  // Neutralise spreadsheet formulas (CSV injection) and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** First instant of the IST day of a YYYY-MM-DD string. */
function istDayStart(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return fromIst({ year, month, day })
}

function monthKey(d: Date): string {
  const p = istParts(d)
  return `${p.year}-${String(p.month).padStart(2, '0')}`
}

@Injectable()
export class AdminSubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
    private readonly settings: SettingsService,
    private readonly usage: UsageService,
    private readonly jobs: SubscriptionJobsService,
  ) {}

  private where(q: Pick<AdminSubscriptionQuery, 'tab'> & Partial<AdminSubscriptionQuery>, now = new Date()): Prisma.SubscriptionWhereInput {
    const and: Prisma.SubscriptionWhereInput[] = []
    switch (q.tab) {
      case 'expiring':
        and.push({ currentPeriodEnd: { gte: now, lte: addDays(now, 7) }, status: { notIn: ['CANCELLED'] }, cancelAtPeriodEnd: false })
        break
      case 'grace':
        and.push({ status: 'GRACE' })
        break
      case 'expired':
        and.push({ status: 'EXPIRED' })
        break
      case 'cancelled':
        and.push({ OR: [{ status: 'CANCELLED' }, { cancelAtPeriodEnd: true }] })
        break
      case 'failed':
        and.push({ status: 'PAYMENT_FAILED' })
        break
      case 'attention':
        // In grace, payment failed, or the deadline is within 7 days (and the plan isn't ending on purpose).
        and.push({
          OR: [
            { status: { in: ['GRACE', 'PAYMENT_FAILED'] } },
            { currentPeriodEnd: { gte: now, lte: addDays(now, 7) }, status: { notIn: ['CANCELLED'] }, cancelAtPeriodEnd: false },
          ],
        })
        break
    }
    if (q.planId) and.push({ planId: q.planId })
    if (q.status) and.push({ status: q.status })
    if (q.cycle) and.push({ cycle: q.cycle })
    if (q.expiresFrom) and.push({ currentPeriodEnd: { gte: istDayStart(q.expiresFrom) } })
    if (q.expiresTo) and.push({ currentPeriodEnd: { lt: addDays(istDayStart(q.expiresTo), 1) } })
    if (q.search) {
      const text = { contains: q.search, mode: 'insensitive' as const }
      const digits = q.search.replace(/\D/g, '')
      and.push({
        studio: {
          OR: [
            { name: text },
            { email: text },
            { users: { some: { OR: [{ email: text }, { name: text }] } } },
            ...(digits.length >= 4 ? [{ phone: { contains: digits } }, { users: { some: { phone: { contains: digits } } } }] : []),
          ],
        },
      })
    }
    return and.length ? { AND: and } : {}
  }

  private orderBy(sort: AdminSubscriptionQuery['sort']): Prisma.SubscriptionOrderByWithRelationInput[] {
    const dir = sort.startsWith('-') ? 'desc' : 'asc'
    switch (sort.replace('-', '')) {
      case 'createdAt':
        return [{ createdAt: dir }]
      case 'amount':
        return [{ amountPaid: dir }, { currentPeriodEnd: 'asc' }]
      case 'studio':
        return [{ studio: { name: dir } }]
      default:
        return [{ currentPeriodEnd: dir }, { createdAt: 'asc' }]
    }
  }

  private async rowDto(s: Row, now = new Date()): Promise<AdminSubscriptionRowDto> {
    const settings = await this.settings.alerts()
    const status = statusOf(s, settings, now)
    const left = daysLeft(s.currentPeriodEnd, now)
    const owner = s.studio.users[0]
    return {
      id: s.id,
      studio: { id: s.studio.id, name: s.studio.name, slug: s.studio.slug },
      owner: { name: owner?.name ?? '', email: owner?.email ?? s.studio.email ?? '', phone: s.studio.phone ?? owner?.phone ?? null },
      plan: { id: s.plan.id, code: s.plan.code, name: s.plan.name },
      cycle: s.cycle,
      // Admin amounts exclude GST (one convention across the admin area).
      amountPaise: s.amountPaid - s.gstAmount,
      startDate: s.currentPeriodStart.toISOString(),
      endDate: s.currentPeriodEnd.toISOString(),
      // In grace before the job has saved it: when grace will end with the current setting.
      graceEndsAt: (s.graceEndsAt ?? (status === 'GRACE' ? graceEnd(stateOf(s), settings) : null))?.toISOString() ?? null,
      daysLeft: left,
      tone: deadlineTone(status, left),
      status,
      isTrial: s.isTrial,
      autoRenew: s.autoRenew,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      createdAt: s.createdAt.toISOString(),
    }
  }

  async list(q: AdminSubscriptionQuery): Promise<Paginated<AdminSubscriptionRowDto>> {
    await this.jobs.refreshStatuses()
    const where = this.where(q)
    const [rows, total] = await Promise.all([
      this.prisma.subscription.findMany({ where, include: rowInclude, orderBy: this.orderBy(q.sort), skip: (q.page - 1) * q.limit, take: q.limit }),
      this.prisma.subscription.count({ where }),
    ])
    const now = new Date()
    return paginate(await Promise.all(rows.map((r) => this.rowDto(r, now))), total, q)
  }

  async csv(q: AdminSubscriptionQuery): Promise<string> {
    await this.jobs.refreshStatuses()
    const rows = await this.prisma.subscription.findMany({ where: this.where(q), include: rowInclude, orderBy: this.orderBy(q.sort), take: CSV_LIMIT })
    const now = new Date()
    const dtos = await Promise.all(rows.map((r) => this.rowDto(r, now)))
    const header = ['Studio', 'Owner', 'Email', 'Phone', 'Plan', 'Cycle', 'Amount (INR, excl. GST)', 'Start', 'Deadline', 'Days left', 'Status', 'Grace ends (IST)', 'Trial', 'Auto-renew', 'Cancels at period end']
    const date = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso))
    const dateTime = (iso: string) => {
      const p = istParts(new Date(iso))
      return `${date(iso)} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
    }
    const lines = dtos.map((d) =>
      [d.studio.name, d.owner.name, d.owner.email, d.owner.phone, d.plan.name, d.cycle, (d.amountPaise / 100).toFixed(2), date(d.startDate), date(d.endDate), d.daysLeft, d.status, d.graceEndsAt ? dateTime(d.graceEndsAt) : '', d.isTrial ? 'yes' : 'no', d.autoRenew ? 'yes' : 'no', d.cancelAtPeriodEnd ? 'yes' : 'no']
        .map(csvCell)
        .join(','),
    )
    // BOM so Excel opens ₹ names and non-ASCII studio names correctly.
    return `﻿${[header.join(','), ...lines].join('\r\n')}\r\n`
  }

  async detail(id: string): Promise<AdminSubscriptionDetailDto> {
    const s = await this.prisma.subscription.findUnique({ where: { id }, include: rowInclude })
    if (!s) throw notFound('Subscription')
    const [events, payments, notifications, usage] = await Promise.all([
      this.prisma.subscriptionEvent.findMany({ where: { subscriptionId: id }, include: { actor: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.payment.findMany({ where: { studioId: s.studioId, purpose: 'SUBSCRIPTION' }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.notification.findMany({
        where: { OR: [{ subscriptionId: id }, { studioId: s.studioId, type: { startsWith: 'SUBSCRIPTION' } }] },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.usage.usage(s.studioId),
    ])
    return {
      ...(await this.rowDto(s)),
      studioProfile: {
        city: s.studio.city,
        stateCode: s.studio.stateCode,
        gstin: s.studio.gstin,
        email: s.studio.email,
        phone: s.studio.phone,
        createdAt: s.studio.createdAt.toISOString(),
      },
      gatewaySubscriptionId: s.gatewaySubscriptionId,
      cancelReason: s.cancelReason,
      cancelDetails: s.cancelDetails,
      usage,
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        fromPlan: e.fromPlan,
        toPlan: e.toPlan,
        amountPaise: e.amount,
        actorName: e.actor?.name ?? null,
        note: e.note,
        createdAt: e.createdAt.toISOString(),
      })),
      payments: payments.map(paymentDto),
      notifications: notifications.map(sentDto),
    }
  }

  async stats(now = new Date()): Promise<AdminStatsDto> {
    await this.jobs.refreshStatuses(now)
    const p = istParts(now)
    const monthStart = fromIst({ year: p.year, month: p.month, day: 1 })
    const trendStart = fromIst({ year: p.month === 12 ? p.year : p.year - 1, month: (p.month % 12) + 1, day: 1 })
    const live: Prisma.SubscriptionWhereInput = { status: { in: ['ACTIVE', 'EXPIRING_SOON', 'PAYMENT_FAILED', 'GRACE'] } }

    const [plans, subs, trials, newThisMonth, expiringIn7Days, expiredThisMonth, failedPayments, inGrace, paid, events, reasons, paymentFailed, needsAttention, adminCancelled] = await Promise.all([
      this.plans.listAll(),
      this.prisma.subscription.findMany({ where: { ...live, isTrial: false }, include: { plan: true } }),
      this.prisma.subscription.count({ where: { status: 'TRIAL' } }),
      this.prisma.subscriptionEvent.count({ where: { type: 'CREATED', amount: { not: null }, createdAt: { gte: monthStart } } }),
      this.prisma.subscription.count({ where: { currentPeriodEnd: { gte: now, lte: addDays(now, 7) }, status: { notIn: ['CANCELLED'] }, cancelAtPeriodEnd: false } }),
      this.prisma.subscriptionEvent.count({ where: { type: 'EXPIRED', createdAt: { gte: monthStart } } }),
      this.prisma.payment.count({ where: { purpose: 'SUBSCRIPTION', status: 'FAILED', createdAt: { gte: monthStart } } }),
      this.prisma.subscription.count({ where: { status: 'GRACE' } }),
      this.prisma.payment.findMany({
        // Payments from before periods were recorded have none: their period is derived below.
        where: { purpose: 'SUBSCRIPTION', status: 'SUCCESS', OR: [{ periodEnd: { gte: trendStart } }, { periodEnd: null, createdAt: { gte: addDays(trendStart, -366) } }] },
        select: { id: true, subscriptionId: true, amount: true, gst: true, cycle: true, periodStart: true, periodEnd: true, paidAt: true, createdAt: true },
      }),
      this.prisma.subscriptionEvent.findMany({
        where: { createdAt: { gte: trendStart }, OR: [{ type: 'CREATED', amount: { not: null } }, { type: { in: ['EXPIRED', 'CANCELLED'] } }] },
        select: { type: true, createdAt: true },
      }),
      this.prisma.subscription.groupBy({ by: ['cancelReason'], where: { cancelReason: { not: null } }, _count: { _all: true } }),
      this.prisma.subscription.count({ where: { status: 'PAYMENT_FAILED' } }),
      this.prisma.subscription.count({ where: this.where({ tab: 'attention' }, now) }),
      // Cancelled by an admin (not at period end): their revenue stops at the cancellation.
      this.prisma.subscription.findMany({ where: { status: 'CANCELLED', cancelAtPeriodEnd: false, cancelledAt: { not: null } }, select: { id: true, cancelledAt: true } }),
    ])

    // Month by month: MRR as of each month's end (or now), from the periods payments paid for.
    const months: { key: string; at: Date }[] = []
    for (let i = 11; i >= 0; i--) {
      const idx = p.year * 12 + (p.month - 1) - i
      const y = Math.floor(idx / 12)
      const m = (idx % 12) + 1
      const nextIdx = idx + 1
      const end = i === 0 ? now : new Date(fromIst({ year: Math.floor(nextIdx / 12), month: (nextIdx % 12) + 1, day: 1 }).getTime() - 1)
      months.push({ key: `${y}-${String(m).padStart(2, '0')}`, at: end })
    }
    const mrrAt = mrrCalculator(paid, new Map(adminCancelled.map((c) => [c.id, c.cancelledAt!])))
    // The card and the trend's current month are the same number: MRR now.
    const mrr = mrrAt(now)
    const mrrTrend = months.map(({ key, at }) => ({ month: key, mrrPaise: mrrAt(at) }))
    const newVsChurned = months.map(({ key }) => ({
      month: key,
      new: events.filter((e) => e.type === 'CREATED' && monthKey(e.createdAt) === key).length,
      churned: events.filter((e) => e.type !== 'CREATED' && monthKey(e.createdAt) === key).length,
    }))

    const reasonCounts = new Map(reasons.map((r) => [r.cancelReason, r._count._all]))
    return {
      activeByPlan: plans.map((pl) => ({ code: pl.code as PlanCode, name: pl.name, count: subs.filter((s) => s.planId === pl.id).length })),
      trials,
      mrrPaise: mrr,
      arrPaise: mrr * 12,
      newThisMonth,
      expiringIn7Days,
      expiredThisMonth,
      failedPayments,
      inGrace,
      paymentFailed,
      needsAttention,
      mrrTrend,
      newVsChurned,
      cancelReasons: CANCEL_REASONS.map((reason) => ({ reason: reason as CancelReason, count: reasonCounts.get(reason) ?? 0 })),
    }
  }

  // ------------------------------------------------------------------ admin alert feed

  async notifications(page: number, limit: number, unreadOnly: boolean) {
    const where: Prisma.NotificationWhereInput = { recipientType: 'ADMIN', channel: 'IN_APP', ...(unreadOnly ? { readAt: null } : {}) }
    const [rows, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { recipientType: 'ADMIN', channel: 'IN_APP', readAt: null } }),
    ])
    return { ...paginate(rows.map(adminNotificationDto), total, { page, limit }), unreadCount }
  }

  async markRead(id: string) {
    await this.prisma.notification.updateMany({ where: { id, recipientType: 'ADMIN', readAt: null }, data: { readAt: new Date() } })
  }

  async markAllRead() {
    await this.prisma.notification.updateMany({ where: { recipientType: 'ADMIN', channel: 'IN_APP', readAt: null }, data: { readAt: new Date() } })
  }
}

interface PaidPeriod {
  id: string
  subscriptionId: string | null
  amount: number
  gst: number
  cycle: BillingCycle | null
  periodStart: Date | null
  periodEnd: Date | null
  paidAt: Date | null
  createdAt: Date
}

/**
 * MRR (paise, excl. GST) at any instant: for each subscription, the paid billing period covering
 * that instant (the latest one if a plan change made two overlap), as a monthly amount (yearly ÷ 12).
 * Subscriptions an admin cancelled stop counting at the cancellation. The dashboard card and every
 * point of the trend come from this one function.
 */
export function mrrCalculator(payments: PaidPeriod[], cancelledAt: Map<string, Date>) {
  const periods = payments.map((x) => {
    const start = x.periodStart ?? x.paidAt ?? x.createdAt
    return { key: x.subscriptionId ?? x.id, sub: x.subscriptionId, start, end: x.periodEnd ?? addCycle(start, x.cycle ?? 'MONTHLY'), monthly: (x.amount - x.gst) / CYCLE_MONTHS[x.cycle ?? 'MONTHLY'] }
  })
  return (at: Date): number => {
    const current = new Map<string, (typeof periods)[number]>()
    for (const p of periods) {
      if (p.start > at || p.end <= at) continue
      const cancelled = p.sub ? cancelledAt.get(p.sub) : undefined
      if (cancelled && cancelled <= at) continue
      const seen = current.get(p.key)
      if (!seen || p.start > seen.start) current.set(p.key, p)
    }
    return Math.round([...current.values()].reduce((sum, p) => sum + p.monthly, 0))
  }
}

function adminNotificationDto(n: Notification): AdminNotificationDto {
  return { id: n.id, type: n.type, title: n.title, message: n.body, link: n.link, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() }
}

function sentDto(n: Notification): SentNotificationDto {
  return {
    id: n.id,
    recipientType: n.recipientType,
    channel: n.channel,
    type: n.type,
    title: n.title,
    message: n.body,
    sentAt: n.sentAt?.toISOString() ?? null,
    error: n.error,
    createdAt: n.createdAt.toISOString(),
  }
}
