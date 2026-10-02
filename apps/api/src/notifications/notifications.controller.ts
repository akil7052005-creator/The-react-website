import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { ApiQuery, ApiTags } from '@nestjs/swagger'
import type { SearchResultDto } from '@weddyzone/shared'
import { z } from 'zod'
import { StudioId } from '../auth/auth.decorators'
import { NotificationsService } from '../core/notifications.service'
import { zod } from '../common/zod'
import { PrismaService } from '../prisma/prisma.service'

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  @ApiQuery({ name: 'limit', required: false })
  async list(@StudioId() studioId: string, @Query(zod(z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) }))) q: { limit: number }) {
    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({ where: { studioId, channel: 'IN_APP' }, orderBy: { createdAt: 'desc' }, take: q.limit }),
      this.prisma.notification.count({ where: { studioId, channel: 'IN_APP', readAt: null } }),
    ])
    return { data: rows.map((n) => this.notifications.toDto(n)), unreadCount }
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@StudioId() studioId: string) {
    await this.prisma.notification.updateMany({ where: { studioId, channel: 'IN_APP', readAt: null }, data: { readAt: new Date() } })
    return { ok: true }
  }

  @Post(':id/read')
  @HttpCode(200)
  async readOne(@StudioId() studioId: string, @Param('id', ParseUUIDPipe) id: string) {
    // updateMany with studioId: another studio's notification id simply matches nothing.
    await this.prisma.notification.updateMany({ where: { id, studioId, readAt: null }, data: { readAt: new Date() } })
    return { ok: true }
  }
}

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly prisma: PrismaService) {}

  /** Global search across clients, events, albums and invoices (5 of each, newest first). */
  @Get()
  @ApiQuery({ name: 'q', required: true })
  async search(@StudioId() studioId: string, @Query(zod(z.object({ q: z.string().trim().min(2).max(100) }))) { q }: { q: string }): Promise<SearchResultDto[]> {
    const text = { contains: q, mode: 'insensitive' as const }
    const digits = q.replace(/\D/g, '')
    const [clients, events, albums, invoices] = await Promise.all([
      this.prisma.client.findMany({
        where: { studioId, deletedAt: null, OR: [{ name: text }, { email: text }, ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : [])] },
        take: 5,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.event.findMany({
        where: { studioId, deletedAt: null, OR: [{ title: text }, { code: text }, { venue: text }, { city: text }, { client: { name: text } }] },
        take: 5,
        orderBy: { date: 'desc' },
      }),
      this.prisma.album.findMany({
        where: { studioId, deletedAt: null, OR: [{ title: text }, { code: text }, { subtitle: text }] },
        take: 5,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.invoice.findMany({
        where: { studioId, deletedAt: null, OR: [{ number: text }, { client: { name: text } }] },
        include: { client: true },
        take: 5,
        orderBy: { issueDate: 'desc' },
      }),
    ])
    return [
      ...events.map((e) => ({ type: 'event' as const, id: e.id, title: e.title, subtitle: `${e.code} · ${e.city} · ${e.date.toISOString().slice(0, 10)}`, link: `/?event=${e.id}` })),
      ...clients.map((c) => ({ type: 'client' as const, id: c.id, title: c.name, subtitle: `${c.phone}${c.city ? ` · ${c.city}` : ''}`, link: `/?client=${c.id}` })),
      ...albums.map((a) => ({ type: 'album' as const, id: a.id, title: a.title, subtitle: `${a.code}${a.subtitle ? ` · ${a.subtitle}` : ''}`, link: `/digital-album?album=${a.id}` })),
      ...invoices.map((i) => ({ type: 'invoice' as const, id: i.id, title: i.number, subtitle: i.client.name, link: `/billing?invoice=${i.id}` })),
    ]
  }
}
