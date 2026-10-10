import { HttpStatus, Injectable } from '@nestjs/common'
import { ERROR_CODES, LIMIT_WARN_RATIO, quotaOf, usageWindow, type PlanQuota, type UsageItem, type UsageMeterDto } from '@weddyzone/shared'
import { AppError, planLimit } from '../common/errors'
import { startOfMonthUtc } from '../common/util'
import { PrismaService, type Tx } from '../prisma/prisma.service'
import { PlansService, type EffectiveSubscription } from './plans.service'

const GB = 1024 ** 3

export const subscriptionReadOnly = (planName: string, status: string) =>
  new AppError(
    HttpStatus.PAYMENT_REQUIRED,
    ERROR_CODES.SUBSCRIPTION_READ_ONLY,
    status === 'CANCELLED'
      ? `Your ${planName} plan has ended, so your studio is read-only. Choose a plan to add new events and uploads.`
      : status === 'GRACE'
        ? `Your ${planName} plan has ended. Galleries stay view-only for 7 days: renew to add new events and uploads.`
        : `Your ${planName} plan has expired, so your studio is read-only. Renew to add new events and uploads.`,
    undefined,
    { status, renewLink: '/subscriptions' },
  )

/** The usage window a studio is in, and what its plan allows. */
export interface UsageWindow {
  eff: EffectiveSubscription
  quota: PlanQuota
  /** Trial: limits are for the whole trial, not per 30 days. */
  lifetime: boolean
  start: Date
  resetsOn: Date
}

const fmtGb = (bytes: number) => {
  const gb = bytes / GB
  return gb >= 10 ? `${Math.round(gb)}` : `${Math.round(gb * 10) / 10}`
}

/**
 * Plan quotas, checked on the server before anything is created: events (customer photo
 * selections) per 30-day window, photos per event and uploads per window (in original file size),
 * plus albums and WhatsApp credits. Whichever limit is reached first applies. Nothing that already
 * exists is ever removed because of a limit.
 */
@Injectable()
export class UsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
  ) {}

  /** The current window: 30 days from the plan's start date (the whole trial on Trial). */
  async window(studioId: string, db: Tx | PrismaService = this.prisma, now = new Date()): Promise<UsageWindow> {
    const eff = await this.plans.effective(studioId, db)
    const quota = quotaOf(eff.plan.limits)
    const s = eff.subscription
    const lifetime = s.isTrial || quota.eventsTotal !== null || quota.uploadGbTotal !== null
    if (lifetime) return { eff, quota, lifetime, start: new Date(0), resetsOn: s.currentPeriodEnd }
    const w = usageWindow(s.usageAnchor ?? s.currentPeriodStart, now)
    return { eff, quota, lifetime, ...w }
  }

  /** Events created in the window (deleted ones count too: an event is counted when it's created). */
  private eventsUsed(studioId: string, start: Date, db: Tx | PrismaService) {
    return db.selection.count({ where: { studioId, createdAt: { gte: start } } })
  }

  /** Original bytes uploaded in the window. */
  private async uploadedBytes(studioId: string, start: Date, db: Tx | PrismaService) {
    const r = await db.photo.aggregate({ where: { studioId, createdAt: { gte: start } }, _sum: { originalSize: true } })
    return r._sum.originalSize ?? 0
  }

  private async addonEvents(studioId: string, start: Date, db: Tx | PrismaService) {
    const r = await db.usageAddon.aggregate({ where: { studioId, windowStart: start }, _sum: { events: true } })
    return r._sum.events ?? 0
  }

  /** The event cap for this window, or null for none. */
  private eventLimit(w: UsageWindow, addon: number) {
    const base = w.lifetime ? w.quota.eventsTotal : (w.quota.eventsPerMonth ?? w.quota.fairUseEventsPerMonth)
    return base === null ? null : base + addon
  }

  private uploadLimitBytes(w: UsageWindow) {
    const gb = w.lifetime ? (w.quota.uploadGbTotal ?? w.quota.uploadGbPerMonth) : w.quota.uploadGbPerMonth
    return gb === null ? null : Math.round(gb * GB)
  }

  /** Grace, expired and cancelled studios can view but add no events or uploads. */
  private assertOpen(w: Pick<UsageWindow, 'eff'>) {
    if (w.eff.readOnly || w.eff.status === 'GRACE') throw subscriptionReadOnly(w.eff.plan.name, w.eff.status)
  }

  /** GET /me/usage: the dashboard meter ("Events 7/10 · Uploads 320 GB of 500 GB · resets on …"). */
  async meter(studioId: string): Promise<UsageMeterDto> {
    const w = await this.window(studioId)
    const [used, bytes, addon] = await Promise.all([this.eventsUsed(studioId, w.start, this.prisma), this.uploadedBytes(studioId, w.start, this.prisma), this.addonEvents(studioId, w.start, this.prisma)])
    const limit = this.eventLimit(w, addon)
    const limitBytes = this.uploadLimitBytes(w)
    const warn = (limit !== null && limit > 0 && used >= limit * LIMIT_WARN_RATIO) || (limitBytes !== null && limitBytes > 0 && bytes >= limitBytes * LIMIT_WARN_RATIO)
    return {
      planCode: w.eff.plan.code,
      planName: w.eff.plan.name,
      isTrial: w.eff.subscription.isTrial,
      lifetime: w.lifetime,
      events: { used, limit, addon },
      uploads: { usedBytes: bytes, limitBytes },
      photosPerEvent: w.quota.photosPerEvent,
      windowStart: w.start.toISOString(),
      resetsOn: w.resetsOn.toISOString(),
      addon: !w.lifetime && w.quota.addonEvents && w.quota.addonEventsPricePaise !== null ? { events: w.quota.addonEvents, pricePaise: w.quota.addonEventsPricePaise } : null,
      favourites: w.quota.favourites,
      blocked: w.eff.readOnly || w.eff.status === 'GRACE',
      warn,
    }
  }

  /** My Subscription → usage rows. */
  async usage(studioId: string): Promise<UsageItem[]> {
    const m = await this.meter(studioId)
    const [albums, studio, spent] = await Promise.all([
      this.prisma.album.count({ where: { studioId, deletedAt: null } }),
      this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { creditBalance: true } }),
      this.prisma.creditLedger.aggregate({ where: { studioId, reason: 'MESSAGE', createdAt: { gte: startOfMonthUtc() } }, _sum: { delta: true } }),
    ])
    const { plan } = await this.plans.effective(studioId)
    const limits = this.plans.limits(plan)
    return [
      { key: 'events', label: m.lifetime ? 'Customer events (trial)' : 'Events this month', used: m.events.used, limit: m.events.limit, unit: '' },
      {
        key: 'storage',
        label: m.lifetime ? 'Uploads (trial)' : 'Uploads this month',
        used: Math.round((m.uploads.usedBytes / GB) * 100) / 100,
        limit: m.uploads.limitBytes === null ? null : Math.round((m.uploads.limitBytes / GB) * 100) / 100,
        unit: 'GB',
      },
      { key: 'albums', label: 'Digital albums', used: albums, limit: limits.albums, unit: '' },
      // Credits are a prepaid balance, not a plan limit: no limit, and what's left is `remaining`.
      { key: 'credits', label: 'WhatsApp credits used this month', used: Math.abs(spent._sum.delta ?? 0), limit: null, remaining: studio.creditBalance, unit: '' },
    ]
  }

  /**
   * Expired and cancelled studios are read-only: no new events, albums or photo uploads. Nothing is
   * deleted.
   */
  async assertWritable(studioId: string, db: Tx | PrismaService = this.prisma) {
    const eff = await this.plans.effective(studioId, db)
    if (eff.readOnly) throw subscriptionReadOnly(eff.plan.name, eff.status)
    return eff
  }

  /** A new event (customer photo selection): within the plan's events for this window. */
  async assertCanCreateEvent(studioId: string, db: Tx | PrismaService = this.prisma) {
    const w = await this.window(studioId, db)
    this.assertOpen(w)
    const addon = await this.addonEvents(studioId, w.start, db)
    const limit = this.eventLimit(w, addon)
    if (limit === null) return w
    const used = await this.eventsUsed(studioId, w.start, db)
    if (used >= limit) {
      const plan = w.eff.plan
      const canAddon = !w.lifetime && !!w.quota.addonEvents && w.quota.addonEventsPricePaise !== null
      const message = w.lifetime
        ? `Your ${plan.name} includes ${limit} customer events. Upgrade to add more.`
        : w.quota.eventsPerMonth === null
          ? `You've reached the fair-use limit of ${limit} events this month on ${plan.name}. It resets on ${istDay(w.resetsOn)}.`
          : `You've used all ${limit} events this month on ${plan.name}. Upgrade${canAddon ? ` or buy +${w.quota.addonEvents} events` : ''} to add more. Resets on ${istDay(w.resetsOn)}.`
      throw planLimit(message, {
        resource: 'events',
        limit,
        used,
        plan: plan.code,
        resetsOn: w.resetsOn.toISOString(),
        addon: canAddon ? { events: w.quota.addonEvents, pricePaise: w.quota.addonEventsPricePaise } : null,
      })
    }
    return w
  }

  /**
   * Adding `count` photos of `originalBytes` (original size, in total) to an event: within photos
   * per event and the window's uploads.
   */
  async assertCanUpload(studioId: string, selectionId: string, originalBytes: number, db: Tx | PrismaService = this.prisma, count = 1) {
    const w = await this.window(studioId, db)
    this.assertOpen(w)
    const plan = w.eff.plan
    if (w.quota.photosPerEvent !== null) {
      const inEvent = await db.photo.count({ where: { selectionId, deletedAt: null, file: { mimeType: { startsWith: 'image/' } } } })
      if (inEvent + count > w.quota.photosPerEvent) {
        throw planLimit(`This event has ${inEvent.toLocaleString('en-IN')} photos: ${plan.name} allows ${w.quota.photosPerEvent.toLocaleString('en-IN')} per event. Upgrade for more photos per event.`, {
          resource: 'photos',
          limit: w.quota.photosPerEvent,
          used: inEvent,
          plan: plan.code,
        })
      }
    }
    const limitBytes = this.uploadLimitBytes(w)
    if (limitBytes !== null) {
      const used = await this.uploadedBytes(studioId, w.start, db)
      if (used + originalBytes > limitBytes) {
        throw planLimit(
          w.lifetime
            ? `Your ${plan.name} includes about ${fmtGb(limitBytes)} GB of uploads and ${fmtGb(used)} GB is used. Upgrade to upload more.`
            : `You've uploaded ${fmtGb(used)} GB of ${fmtGb(limitBytes)} GB this month on ${plan.name}. Upgrade for more, or wait until ${istDay(w.resetsOn)}.`,
          { resource: 'uploads', limit: Math.round(limitBytes / GB), used: Math.round((used / GB) * 10) / 10, plan: plan.code, resetsOn: w.resetsOn.toISOString() },
        )
      }
    }
    return w
  }

  /** The studio's plan and quota (for customer pages: favourites, closed galleries). */
  async planOf(studioId: string, db: Tx | PrismaService = this.prisma) {
    const eff = await this.plans.effective(studioId, db)
    return { eff, quota: quotaOf(eff.plan.limits) }
  }

  /** The most days a customer gallery may stay open on this plan (Trial: 7), or null. */
  async galleryDaysCap(studioId: string, db: Tx | PrismaService = this.prisma) {
    return quotaOf((await this.plans.effective(studioId, db)).plan.limits).galleryDays
  }

  async assertCanCreateAlbum(studioId: string, db: Tx | PrismaService = this.prisma) {
    const { plan } = await this.assertWritable(studioId, db)
    const limit = this.plans.limits(plan).albums
    if (limit === null) return
    const albums = await db.album.count({ where: { studioId, deletedAt: null } })
    if (albums >= limit) {
      throw planLimit(`Your ${plan.name} plan allows ${limit} digital albums. Upgrade to create more.`, {
        resource: 'albums',
        limit,
        used: albums,
        plan: plan.code,
      })
    }
  }

  /**
   * `writes`: photo and banner uploads are blocked when read-only; logos and support attachments are
   * not. Plans without a storage cap (Trial / Pro / VIP limit uploads per window instead) pass.
   */
  async assertStorage(studioId: string, addBytes: number, writes = true) {
    const { plan } = writes ? await this.assertWritable(studioId) : await this.plans.effective(studioId)
    const limitGb = this.plans.limits(plan).storageGb
    if (limitGb === null || limitGb === undefined) return
    const r = await this.prisma.storedFile.aggregate({ where: { studioId, deletedAt: null, photoPreview: { is: null } }, _sum: { size: true } })
    const storageBytes = r._sum.size ?? 0
    if (storageBytes + addBytes > limitGb * GB) {
      throw planLimit(`You have used your ${limitGb} GB of storage on the ${plan.name} plan. Upgrade for more space.`, {
        resource: 'storage',
        limit: limitGb,
        used: Math.round((storageBytes / GB) * 100) / 100,
        plan: plan.code,
      })
    }
  }
}

/** "8 Nov 2026" in IST. */
function istDay(d: Date) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }).format(d)
}
