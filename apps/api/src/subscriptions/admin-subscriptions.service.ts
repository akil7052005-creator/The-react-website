import { Injectable } from '@nestjs/common'
import type { Notification, Plan, Prisma, Studio, Subscription, User } from '@prisma/client'
import {
  addCycle,
  addDays,
  CANCEL_REASONS,
  daysLeft,
  deadlineTone,
  fromIst,
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
import { notFound } from '../common/errors'
import { paginate } from '../common/util'
import { paymentDto } from '../core/payment.service'
import { PlansService, statusOf } from '../core/plans.service'
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

  private where(q: AdminSubscriptionQuery, now = new Date()): Prisma.SubscriptionWhereInput {
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
      amountPaise: s.amountPaid,
      startDate: s.currentPeriodStart.toISOString(),
      endDate: s.currentPeriodEnd.toISOString(),
      graceEndsAt: s.graceEndsAt?.toISOString() ?? null,
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
    const header = ['Studio', 'Owner', 'Email', 'Phone', 'Plan', 'Cycle', 'Amount (INR, incl. GST)', 'Start', 'Deadline', 'Days left', 'Status', 'Trial', 'Auto-renew', 'Cancels at period end']
    const date = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso))
    const lines = dtos.map((d) =>
      [d.studio.name, d.owner.name, d.owner.email, d.owner.phone, d.plan.name, d.cycle, (d.amountPaise / 100).toFixed(2), date(d.startDate), date(d.endDate), d.daysLeft, d.status, d.isTrial ? 'yes' : 'no', d.autoRenew ? 'yes' : 'no', d.cancelAtPeriodEnd ? 'yes' : 'no']
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

    const [plans, subs, trials, newThisMonth, expiringIn7Days, expiredThisMonth, failedPayments, inGrace, paid, events, reasons] = await Promise.all([
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
        select: { amount: true, gst: true, cycle: true, periodStart: true, periodEnd: true, paidAt: true, createdAt: true },
      }),
      this.prisma.subscriptionEvent.findMany({
        where: { createdAt: { gte: trendStart }, OR: [{ type: 'CREATED', amount: { not: null } }, { type: { in: ['EXPIRED', 'CANCELLED'] } }] },
        select: { type: true, createdAt: true },
      }),
      this.prisma.subscription.groupBy({ by: ['cancelReason'], where: { cancelReason: { not: null } }, _count: { _all: true } }),
    ])

    const monthlyOf = (s: Subscription & { plan: Plan }) => {
      const base = s.amountPaid > 0 ? s.amountPaid - s.gstAmount : s.cycle === 'YEARLY' ? s.plan.yearlyPrice : (s.plan.monthlyPrice ?? s.plan.yearlyPrice / 12)
      return s.cycle === 'YEARLY' ? base / 12 : base
    }
    const mrr = Math.round(subs.reduce((sum, s) => sum + monthlyOf(s), 0))

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
    const periods = paid.map((x) => {
      const start = x.periodStart ?? x.paidAt ?? x.createdAt
      return { ...x, start, end: x.periodEnd ?? addCycle(start, x.cycle ?? 'MONTHLY') }
    })
    const mrrTrend = months.map(({ key, at }) => ({
      month: key,
      mrrPaise: Math.round(
        periods.filter((x) => x.start <= at && x.end > at).reduce((sum, x) => sum + (x.amount - x.gst) / (x.cycle === 'YEARLY' ? 12 : 1), 0),
      ),
    }))
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
