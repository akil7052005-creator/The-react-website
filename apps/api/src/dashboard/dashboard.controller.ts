import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Banner, StoredFile } from '@prisma/client'
import { todayIST, type BannerDto, type BannerStatus, type DashboardDto } from '@weddyzone/shared'
import { StudioId } from '../auth/auth.decorators'
import { daysBetween, startOfMonthUtc, toDate, toIso } from '../common/util'
import { AlbumsService } from '../albums/albums.service'
import { fileUrls } from '../core/files.service'
import { eventDto } from '../core/mappers'
import { NotificationsService } from '../core/notifications.service'
import { PrismaService } from '../prisma/prisma.service'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Active" | "Scheduled" | "Expired" | "Draft", derived from the flag and date window. */
export function bannerStatus(b: Pick<Banner, 'active' | 'startDate' | 'endDate'>, today = todayIST()): BannerStatus {
  if (!b.active) return 'Draft'
  if (b.startDate && toIso(b.startDate) > today) return 'Scheduled'
  if (b.endDate && toIso(b.endDate) < today) return 'Expired'
  return 'Active'
}

export function bannerDto(b: Banner & { image: StoredFile }): BannerDto {
  return {
    id: b.id,
    title: b.title,
    placement: b.placement,
    ctaText: b.ctaText,
    ctaUrl: b.ctaUrl,
    imageUrl: fileUrls.public(b.imageFileId),
    startDate: toIso(b.startDate),
    endDate: toIso(b.endDate),
    active: b.active,
    position: b.position,
    status: bannerStatus(b),
  }
}

function trend(thisMonth: number, lastMonth: number) {
  if (lastMonth === 0) return thisMonth > 0 ? 100 : 0
  return Math.round(((thisMonth - lastMonth) / lastMonth) * 100)
}

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly albums: AlbumsService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  async get(@StudioId() studioId: string): Promise<DashboardDto> {
    const today = todayIST()
    const monthStart = startOfMonthUtc()
    const lastMonthStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 1, 1))
    const live = { studioId, deletedAt: null }
    const createdCounts = async (model: 'event' | 'selection' | 'album') => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delegate = this.prisma[model] as any
      const [total, thisMonth, lastMonth] = await Promise.all([
        delegate.count({ where: live }),
        delegate.count({ where: { ...live, createdAt: { gte: monthStart } } }),
        delegate.count({ where: { ...live, createdAt: { gte: lastMonthStart, lt: monthStart } } }),
      ])
      return { value: total as number, trend: trend(thisMonth, lastMonth) }
    }

    // Booking chart: 5 months back to 2 months ahead, by event date.
    const chartStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 5, 1))
    const chartEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 3, 1))

    const [totalEvents, photoSelections, digitalAlbums, upcomingEvents, activeSelections, publishedAlbums, next, recent, activity, chartEvents, openSelections, workAlbums, recentAlbums, banner, completedSelections] =
      await Promise.all([
        createdCounts('event'),
        createdCounts('selection'),
        createdCounts('album'),
        this.prisma.event.count({ where: { ...live, date: { gte: toDate(today) }, status: { notIn: ['CANCELLED', 'DELIVERED'] } } }),
        this.prisma.selection.count({ where: { ...live, status: { not: 'SUBMITTED' }, deadline: { gte: toDate(today) } } }),
        this.prisma.album.count({ where: { ...live, status: 'PUBLISHED' } }),
        this.prisma.event.findFirst({
          where: { ...live, date: { gte: toDate(today) }, status: { notIn: ['CANCELLED', 'DELIVERED'] } },
          include: { client: true },
          orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        }),
        this.prisma.event.findMany({ where: live, include: { client: true }, orderBy: { createdAt: 'desc' }, take: 6 }),
        this.prisma.notification.findMany({ where: { studioId }, orderBy: { createdAt: 'desc' }, take: 5 }),
        this.prisma.event.findMany({ where: { ...live, date: { gte: chartStart, lt: chartEnd } }, select: { date: true } }),
        this.prisma.selection.findMany({
          where: { ...live, status: { not: 'SUBMITTED' }, deadline: { gte: toDate(today) } },
          include: { event: true },
          orderBy: { deadline: 'asc' },
          take: 3,
        }),
        this.prisma.album.findMany({ where: { ...live, status: { in: ['DRAFT', 'IN_REVIEW'] } }, orderBy: { updatedAt: 'desc' }, take: 2 }),
        this.prisma.album.findMany({
          where: live,
          include: {
            event: true,
            _count: { select: { pages: true } },
            feedback: { where: { kind: 'COMMENT', resolvedAt: null }, select: { id: true } },
            pages: { take: 1, orderBy: { position: 'asc' }, include: { photo: true } },
          },
          orderBy: { updatedAt: 'desc' },
          take: 4,
        }),
        this.prisma.banner.findFirst({
          where: {
            ...live,
            active: true,
            placement: 'GALLERY_HERO',
            AND: [
              { OR: [{ startDate: null }, { startDate: { lte: toDate(today) } }] },
              { OR: [{ endDate: null }, { endDate: { gte: toDate(today) } }] },
            ],
          },
          include: { image: true },
          orderBy: { position: 'asc' },
        }),
        this.prisma.selection.count({ where: { ...live, status: 'SUBMITTED' } }),
      ])

    const monthly = Array.from({ length: 8 }, (_, i) => {
      const d = new Date(Date.UTC(chartStart.getUTCFullYear(), chartStart.getUTCMonth() + i, 1))
      return { key: d.getUTCFullYear() * 12 + d.getUTCMonth(), month: MONTHS[d.getUTCMonth()], count: 0 }
    })
    for (const e of chartEvents) {
      const bucket = monthly.find((m) => m.key === e.date.getUTCFullYear() * 12 + e.date.getUTCMonth())
      if (bucket) bucket.count++
    }

    // Deliverables pipeline: live selections (picked / quota) and albums in progress.
    const picked = openSelections.length
      ? await this.prisma.$queryRaw<{ selection_id: string; n: bigint }[]>`
          SELECT selection_id, COUNT(DISTINCT photo_id) AS n FROM photo_picks
          WHERE selection_id = ANY(${openSelections.map((s) => s.id)}::uuid[]) GROUP BY selection_id`
      : []
    const pipeline = [
      ...openSelections.map((s) => {
        const n = Number(picked.find((p) => p.selection_id === s.id)?.n ?? 0)
        return { name: `${s.event.title} — Selection`, progress: Math.min(100, Math.round((n / s.quota) * 100)), link: '/photo-selection' }
      }),
      ...workAlbums.map((a) => ({
        name: `${a.title} — Album ${a.status === 'IN_REVIEW' ? 'review' : 'design'}`,
        progress: a.status === 'IN_REVIEW' ? 75 : 40,
        link: `/digital-album?album=${a.id}`,
      })),
    ].slice(0, 4)

    return {
      stats: { totalEvents, photoSelections, digitalAlbums, upcomingEvents, activeSelections, publishedAlbums, completedSelections },
      nextAssignment: next ? { ...eventDto(next), daysLeft: daysBetween(today, toIso(next.date)) } : null,
      recentEvents: recent.map(eventDto),
      activity: activity.map((n) => this.notifications.toDto(n)),
      monthlyEvents: monthly.map(({ month, count }) => ({ month, count })),
      pipeline,
      recentAlbums: recentAlbums.map((a) => this.albums.toDto(a)),
      activeBanner: banner ? bannerDto(banner) : null,
    }
  }
}
