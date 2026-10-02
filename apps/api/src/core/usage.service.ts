import { Injectable } from '@nestjs/common'
import type { UsageItem } from '@weddyzone/shared'
import { HttpStatus } from '@nestjs/common'
import { ERROR_CODES } from '@weddyzone/shared'
import { AppError, planLimit } from '../common/errors'
import { startOfMonthUtc } from '../common/util'
import { PrismaService, type Tx } from '../prisma/prisma.service'
import { PlansService } from './plans.service'

const GB = 1024 ** 3

export const subscriptionReadOnly = (planName: string, status: string) =>
  new AppError(
    HttpStatus.PAYMENT_REQUIRED,
    ERROR_CODES.SUBSCRIPTION_READ_ONLY,
    status === 'CANCELLED'
      ? `Your ${planName} plan has ended, so your studio is read-only. Choose a plan to add new events and uploads.`
      : `Your ${planName} plan has expired, so your studio is read-only. Renew to add new events and uploads.`,
    undefined,
    { status, renewLink: '/subscriptions' },
  )

/** Checks plan quotas (events, albums, storage, credits) before anything is created. */
@Injectable()
export class UsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
  ) {}

  private async counts(studioId: string, db: Tx | PrismaService = this.prisma) {
    const monthStart = startOfMonthUtc()
    const [eventsThisMonth, albums, storage, spent, studio] = await Promise.all([
      db.event.count({ where: { studioId, deletedAt: null, createdAt: { gte: monthStart } } }),
      db.album.count({ where: { studioId, deletedAt: null } }),
      db.storedFile.aggregate({ where: { studioId, deletedAt: null }, _sum: { size: true } }),
      db.creditLedger.aggregate({
        where: { studioId, reason: 'MESSAGE', createdAt: { gte: monthStart } },
        _sum: { delta: true },
      }),
      db.studio.findUniqueOrThrow({ where: { id: studioId }, select: { creditBalance: true } }),
    ])
    return {
      eventsThisMonth,
      albums,
      storageBytes: storage._sum.size ?? 0,
      creditsSpent: Math.abs(spent._sum.delta ?? 0),
      creditBalance: studio.creditBalance,
    }
  }

  async usage(studioId: string): Promise<UsageItem[]> {
    const { plan } = await this.plans.effective(studioId)
    const limits = this.plans.limits(plan)
    const c = await this.counts(studioId)
    return [
      { key: 'events', label: 'Events this month', used: c.eventsThisMonth, limit: limits.eventsPerMonth, unit: '' },
      { key: 'albums', label: 'Digital albums', used: c.albums, limit: limits.albums, unit: '' },
      {
        key: 'storage',
        label: 'Storage',
        used: Math.round((c.storageBytes / GB) * 100) / 100,
        limit: limits.storageGb,
        unit: 'GB',
      },
      {
        // Credits are a prepaid balance, not a plan limit: no limit, and what's left is `remaining`.
        key: 'credits',
        label: 'WhatsApp credits used this month',
        used: c.creditsSpent,
        limit: null,
        remaining: c.creditBalance,
        unit: '',
      },
    ]
  }

  /**
   * Expired and cancelled studios are read-only: no new events, albums or photo uploads. Nothing is
   * deleted, and their clients can still open delivered albums and selections.
   */
  async assertWritable(studioId: string, db: Tx | PrismaService = this.prisma) {
    const eff = await this.plans.effective(studioId, db)
    if (eff.readOnly) throw subscriptionReadOnly(eff.plan.name, eff.status)
    return eff
  }

  async assertCanCreateEvent(studioId: string, db: Tx | PrismaService = this.prisma) {
    const { plan } = await this.assertWritable(studioId, db)
    const limit = this.plans.limits(plan).eventsPerMonth
    if (limit === null) return
    const { eventsThisMonth } = await this.counts(studioId, db)
    if (eventsThisMonth >= limit) {
      throw planLimit(`Your ${plan.name} plan allows ${limit} events per month. Upgrade to add more.`, {
        resource: 'events',
        limit,
        used: eventsThisMonth,
        plan: plan.code,
      })
    }
  }

  async assertCanCreateAlbum(studioId: string, db: Tx | PrismaService = this.prisma) {
    const { plan } = await this.assertWritable(studioId, db)
    const limit = this.plans.limits(plan).albums
    if (limit === null) return
    const { albums } = await this.counts(studioId, db)
    if (albums >= limit) {
      throw planLimit(`Your ${plan.name} plan allows ${limit} digital albums. Upgrade to create more.`, {
        resource: 'albums',
        limit,
        used: albums,
        plan: plan.code,
      })
    }
  }

  /** `writes`: photo and banner uploads are blocked when read-only; logos and support attachments are not. */
  async assertStorage(studioId: string, addBytes: number, writes = true) {
    const { plan } = writes ? await this.assertWritable(studioId) : await this.plans.effective(studioId)
    const limitGb = this.plans.limits(plan).storageGb
    if (limitGb === null) return
    const { storageBytes } = await this.counts(studioId)
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
