import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import type { PlanCode, Prisma } from '@prisma/client'
import { CYCLE_LABELS, type AdminStudioQuery, type AdminStudioRowDto, type Paginated } from '@weddyzone/shared'
import { badRequest, notFound } from '../common/errors'
import { paginate } from '../common/util'
import { config } from '../config'
import { StorageService } from '../infra/storage.service'
import { PrismaService } from '../prisma/prisma.service'

const DAY = 86_400_000
/** A removed studio can be restored for this long; then it is purged. */
export const RESTORE_DAYS = 30
const EXPIRING_DAYS = 7
const TRIAL_CODES: PlanCode[] = ['STARTER']

const include = {
  users: { where: { role: 'OWNER' as const }, select: { name: true, phone: true, email: true }, take: 1, orderBy: { createdAt: 'asc' as const } },
  subscription: { include: { plan: { select: { code: true, name: true } } } },
} satisfies Prisma.StudioInclude
type Row = Prisma.StudioGetPayload<{ include: typeof include }>

/**
 * Admin → Studios: every registered studio, newest first, with remove / restore. A removed studio
 * is closed at once (no login, customer links closed, no renewals or reminders) and can be restored
 * for 30 days; after that its data and stored previews are deleted. The studio row itself stays,
 * stripped of contact details, only so its tax invoices and payment records remain valid.
 */
@Injectable()
export class AdminStudiosService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AdminStudiosService.name)
  private timers: NodeJS.Timeout[] = []

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  onApplicationBootstrap() {
    if (!config().JOBS_ENABLED) return
    this.timers.push(setTimeout(() => void this.tick(), 10 * 60_000), setInterval(() => void this.tick(), 6 * 3_600_000))
  }

  onModuleDestroy() {
    this.timers.forEach((t) => clearTimeout(t))
  }

  private async tick() {
    try {
      const n = await this.purgeDue()
      if (n) this.logger.log(`Purged ${n} removed studio(s)`)
    } catch (e) {
      this.logger.error(`Studio purge failed: ${(e as Error).message}`)
    }
  }

  private where(q: AdminStudioQuery): Prisma.StudioWhereInput {
    const and: Prisma.StudioWhereInput[] = [{ purgedAt: null }]
    if (q.search) {
      const s = q.search
      and.push({
        OR: [
          { name: { contains: s, mode: 'insensitive' } },
          { email: { contains: s, mode: 'insensitive' } },
          { phone: { contains: s } },
          { users: { some: { OR: [{ email: { contains: s, mode: 'insensitive' } }, { phone: { contains: s } }, { name: { contains: s, mode: 'insensitive' } }] } } },
        ],
      })
    }
    switch (q.plan) {
      case 'TRIAL':
        and.push({ removedAt: null, subscription: { OR: [{ isTrial: true }, { plan: { code: { in: TRIAL_CODES } } }] } })
        break
      case 'PRO':
        and.push({ removedAt: null, subscription: { isTrial: false, plan: { code: 'PRO' } } })
        break
      case 'VIP':
        and.push({ removedAt: null, subscription: { isTrial: false, plan: { code: 'ALL_ACCESS' } } })
        break
      case 'NONE':
        and.push({ removedAt: null, subscription: null })
        break
      case 'REMOVED':
        and.push({ removedAt: { not: null } })
        break
    }
    return { AND: and }
  }

  async list(q: AdminStudioQuery): Promise<Paginated<AdminStudioRowDto>> {
    const where = this.where(q)
    const [rows, total] = await Promise.all([
      this.prisma.studio.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit }),
      this.prisma.studio.count({ where }),
    ])
    const removers = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.removedById).filter((x): x is string => !!x) } }, select: { id: true, name: true } })
    const now = Date.now()
    return paginate(
      rows.map((r) => this.dto(r, now, removers.find((u) => u.id === r.removedById)?.name ?? null)),
      total,
      q,
    )
  }

  private dto(r: Row, now: number, removedBy: string | null): AdminStudioRowDto {
    const owner = r.users[0] ?? null
    const sub = r.subscription
    const trial = !!sub && (sub.isTrial || TRIAL_CODES.includes(sub.plan.code))
    const end = sub ? sub.currentPeriodEnd.getTime() : null
    const daysLeft = end === null ? null : Math.ceil((end - now) / DAY)
    const status: AdminStudioRowDto['status'] = !sub || daysLeft === null ? 'NONE' : daysLeft < 0 || sub.status === 'EXPIRED' ? 'EXPIRED' : daysLeft <= EXPIRING_DAYS ? 'EXPIRING' : 'ACTIVE'
    return {
      id: r.id,
      name: r.name,
      owner: owner ? { name: owner.name, phone: owner.phone ?? r.phone } : null,
      email: owner?.email ?? r.email,
      plan: sub ? (trial ? 'Trial' : sub.plan.name) : null,
      period: sub && !trial ? CYCLE_LABELS[sub.cycle] : null,
      startDate: sub ? sub.currentPeriodStart.toISOString() : null,
      expiryDate: sub ? sub.currentPeriodEnd.toISOString() : null,
      daysLeft,
      status,
      createdAt: r.createdAt.toISOString(),
      removed: r.removedAt ? { at: r.removedAt.toISOString(), by: removedBy, purgeAt: new Date(r.removedAt.getTime() + RESTORE_DAYS * DAY).toISOString() } : null,
    }
  }

  /** Closes a studio at once. Returns its name for the audit log. */
  async remove(id: string, actor: { userId: string; studioId: string | null }, confirmName: string) {
    const studio = await this.prisma.studio.findFirst({ where: { id, purgedAt: null } })
    if (!studio) throw notFound('Studio')
    if (actor.studioId === id) throw badRequest("You can't remove your own account")
    if (studio.removedAt) throw badRequest('This studio is already removed')
    if (confirmName.trim().toLowerCase() !== studio.name.trim().toLowerCase()) {
      throw badRequest('The name does not match', { confirmName: `Type "${studio.name}" exactly to confirm` })
    }
    const now = new Date()
    await this.prisma.$transaction([
      this.prisma.studio.update({ where: { id }, data: { removedAt: now, removedById: actor.userId } }),
      // Signs everyone in the studio out (the short-lived access token can't be refreshed).
      this.prisma.refreshToken.updateMany({ where: { user: { studioId: id }, revokedAt: null }, data: { revokedAt: now } }),
    ])
    return studio
  }

  async restore(id: string) {
    const studio = await this.prisma.studio.findFirst({ where: { id, purgedAt: null } })
    if (!studio) throw notFound('Studio')
    if (!studio.removedAt) throw badRequest('This studio is not removed')
    await this.prisma.studio.update({ where: { id }, data: { removedAt: null, removedById: null } })
    return studio
  }

  /** Purges every studio removed more than 30 days ago. */
  async purgeDue(now = new Date()): Promise<number> {
    const due = await this.prisma.studio.findMany({ where: { removedAt: { lte: new Date(now.getTime() - RESTORE_DAYS * DAY) }, purgedAt: null }, select: { id: true } })
    for (const s of due) await this.purge(s.id)
    return due.length
  }

  /**
   * Deletes a studio's users, customers, events, selections, photos, albums, activity and stored
   * files. Kept for tax/GST law: its subscription, payments and invoices (with the customers and
   * the studio row they point to, the studio stripped of contact details).
   */
  async purge(studioId: string) {
    const files = await this.prisma.storedFile.findMany({ where: { studioId }, select: { id: true, storageKey: true } })
    const invoiceClients = (await this.prisma.invoice.findMany({ where: { studioId }, select: { clientId: true } })).map((i) => i.clientId)
    const users = (await this.prisma.user.findMany({ where: { studioId }, select: { id: true } })).map((u) => u.id)
    const byStudio = { where: { studioId } }
    await this.prisma.$transaction([
      this.prisma.album.deleteMany(byStudio),
      this.prisma.photo.deleteMany(byStudio),
      this.prisma.selection.deleteMany(byStudio),
      this.prisma.invoice.updateMany({ where: { studioId }, data: { eventId: null } }),
      this.prisma.event.deleteMany(byStudio),
      this.prisma.client.deleteMany({ where: { studioId, id: { notIn: invoiceClients } } }),
      this.prisma.banner.deleteMany(byStudio),
      this.prisma.ticket.deleteMany(byStudio),
      this.prisma.lead.deleteMany(byStudio),
      this.prisma.websiteSettings.deleteMany(byStudio),
      this.prisma.walletTxn.deleteMany(byStudio),
      this.prisma.whatsAppMessage.deleteMany(byStudio),
      this.prisma.creditLedger.deleteMany(byStudio),
      this.prisma.notification.deleteMany(byStudio),
      this.prisma.usageAddon.deleteMany(byStudio),
      this.prisma.referral.deleteMany({ where: { OR: [{ referrerStudioId: studioId }, { referredStudioId: studioId }] } }),
      this.prisma.counter.deleteMany(byStudio),
      this.prisma.subscriptionEvent.updateMany({ where: { actorId: { in: users } }, data: { actorId: null } }),
      this.prisma.ticketMessage.deleteMany({ where: { authorUserId: { in: users } } }),
      this.prisma.user.deleteMany({ where: { id: { in: users } } }),
      this.prisma.studio.update({
        where: { id: studioId },
        data: { logoFileId: null, email: null, phone: null, bio: null, website: null, instagramHandle: null, selectionDefaults: undefined, purgedAt: new Date() },
      }),
      this.prisma.storedFile.deleteMany({ where: { id: { in: files.map((f) => f.id) } } }),
    ])
    // Stored previews / thumbnails / logos: after the rows are gone, so a failure only leaves an orphan object.
    for (const f of files) {
      try {
        await this.storage.remove(f.storageKey)
      } catch (e) {
        this.logger.warn(`Could not delete ${f.storageKey}: ${(e as Error).message}`)
      }
    }
  }
}
