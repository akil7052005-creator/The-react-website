import { Injectable } from '@nestjs/common'
import type { AlbumStatus, Prisma } from '@prisma/client'
import {
  ALBUM_STATUSES,
  type AlbumDetailDto,
  type AlbumFeedbackDto,
  type AlbumPageDto,
  type createAlbumSchema,
  type ListQuery,
  type PublicAlbumDto,
  type updateAlbumSchema,
} from '@weddyzone/shared'
import type { z } from 'zod'
import { badRequest, notFound } from '../common/errors'
import { nextSequence, paginate, randomToken, skipTake } from '../common/util'
import { config } from '../config'
import { fileUrls } from '../core/files.service'
import { albumDto } from '../core/mappers'
import { MessagingService } from '../core/messaging.service'
import { NotificationsService } from '../core/notifications.service'
import { UsageService } from '../core/usage.service'
import { PrismaService } from '../prisma/prisma.service'

const HUES = [345, 25, 300, 160, 210, 45, 190, 10]

const listInclude = {
  event: true,
  _count: { select: { pages: true } },
  feedback: { where: { kind: 'COMMENT' as const, resolvedAt: null }, select: { id: true } },
  pages: { take: 1, orderBy: { position: 'asc' as const }, include: { photo: true } },
} satisfies Prisma.AlbumInclude

type ListAlbum = Prisma.AlbumGetPayload<{ include: typeof listInclude }>

@Injectable()
export class AlbumsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly messaging: MessagingService,
    private readonly notifications: NotificationsService,
  ) {}

  publicUrl(token: string) {
    return `${config().APP_URL}/a/${token}`
  }

  toDto(a: ListAlbum) {
    const first = a.pages[0]
    return albumDto(a, first ? fileUrls.studio(first.photo.fileId) : null)
  }

  async find(studioId: string, id: string) {
    const a = await this.prisma.album.findFirst({ where: { id, studioId, deletedAt: null }, include: listInclude })
    if (!a) throw notFound('Album')
    return a
  }

  async list(studioId: string, q: ListQuery) {
    const text = q.search ? { contains: q.search, mode: 'insensitive' as const } : undefined
    const where: Prisma.AlbumWhereInput = {
      studioId,
      deletedAt: null,
      ...(q.status && (ALBUM_STATUSES as readonly string[]).includes(q.status) ? { status: q.status as AlbumStatus } : {}),
      ...(text ? { OR: [{ title: text }, { code: text }, { subtitle: text }, { event: { title: text } }] } : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.album.findMany({ where, include: listInclude, orderBy: { updatedAt: 'desc' }, ...skipTake(q) }),
      this.prisma.album.count({ where }),
    ])
    return paginate(rows.map((a) => this.toDto(a)), total, q)
  }

  async summary(studioId: string) {
    const groups = await this.prisma.album.groupBy({ by: ['status'], where: { studioId, deletedAt: null }, _count: true })
    const count = (s: AlbumStatus) => groups.find((g) => g.status === s)?._count ?? 0
    return {
      all: groups.reduce((s, g) => s + g._count, 0),
      PUBLISHED: count('PUBLISHED'),
      IN_REVIEW: count('IN_REVIEW'),
      DRAFT: count('DRAFT'),
    }
  }

  private pageDtos(pages: { id: string; position: number; caption: string | null; photoId: string; photo: { fileId: string } }[], url: (p: { photoId: string; fileId: string }) => string): AlbumPageDto[] {
    return pages.map((p) => ({ id: p.id, position: p.position, caption: p.caption, photoId: p.photoId, url: url({ photoId: p.photoId, fileId: p.photo.fileId }) }))
  }

  private feedbackDto(f: { id: string; spreadIndex: number; kind: 'COMMENT' | 'APPROVAL'; authorName: string; message: string | null; resolvedAt: Date | null; createdAt: Date }): AlbumFeedbackDto {
    return {
      id: f.id,
      spreadIndex: f.spreadIndex,
      kind: f.kind,
      authorName: f.authorName,
      message: f.message,
      resolvedAt: f.resolvedAt?.toISOString() ?? null,
      createdAt: f.createdAt.toISOString(),
    }
  }

  async detail(studioId: string, id: string): Promise<AlbumDetailDto> {
    const a = await this.find(studioId, id)
    const [pages, feedback] = await Promise.all([
      this.prisma.albumPage.findMany({ where: { albumId: id }, include: { photo: true }, orderBy: { position: 'asc' } }),
      this.prisma.albumFeedback.findMany({ where: { albumId: id }, orderBy: { createdAt: 'asc' } }),
    ])
    return {
      ...this.toDto(a),
      pages: this.pageDtos(pages, (p) => fileUrls.studio(p.fileId)),
      feedback: feedback.map((f) => this.feedbackDto(f)),
    }
  }

  /** Photos of an event that can go into an album (picked ones first). */
  async eventPhotos(studioId: string, eventId: string) {
    const event = await this.prisma.event.findFirst({ where: { id: eventId, studioId, deletedAt: null } })
    if (!event) throw notFound('Event')
    const photos = await this.prisma.photo.findMany({
      where: { eventId, deletedAt: null },
      include: { file: true, _count: { select: { picks: true } } },
      orderBy: [{ selectionId: 'asc' }, { position: 'asc' }],
    })
    return photos
      .map((p) => ({
        id: p.id,
        url: fileUrls.studio(p.fileId),
        originalName: p.originalName ?? p.file.originalName,
        size: p.file.size,
        position: p.position,
        picked: p._count.picks > 0,
      }))
      .sort((a, b) => Number(b.picked) - Number(a.picked))
  }

  private async assertEventPhotos(eventId: string, photoIds: string[]) {
    const found = await this.prisma.photo.count({ where: { id: { in: photoIds }, eventId, deletedAt: null } })
    if (found !== photoIds.length) {
      throw badRequest('Some photos do not belong to this event', { photoIds: 'Choose photos from the selected event only' })
    }
  }

  async create(studioId: string, body: z.output<typeof createAlbumSchema>) {
    const event = await this.prisma.event.findFirst({ where: { id: body.eventId, studioId, deletedAt: null } })
    if (!event) throw badRequest('Event not found', { eventId: 'Select one of your events' })
    await this.assertEventPhotos(event.id, body.photoIds)
    const album = await this.prisma.$transaction(async (tx) => {
      await this.usage.assertCanCreateAlbum(studioId, tx)
      const seq = await nextSequence(tx, studioId, 'ALB', 1)
      return tx.album.create({
        data: {
          studioId,
          code: `ALB-${seq}`,
          eventId: event.id,
          title: body.title,
          subtitle: body.subtitle ?? null,
          location: body.location ?? event.city,
          hue: HUES[seq % HUES.length],
          publicToken: randomToken(18),
          coverPhotoId: body.photoIds[0],
          pages: { create: body.photoIds.map((photoId, position) => ({ photoId, position })) },
        },
      })
    })
    return this.toDto(await this.find(studioId, album.id))
  }

  async update(studioId: string, id: string, body: z.output<typeof updateAlbumSchema>) {
    await this.find(studioId, id)
    await this.prisma.album.update({
      where: { id },
      data: { title: body.title, subtitle: body.subtitle ?? null, location: body.location ?? null },
    })
    return this.toDto(await this.find(studioId, id))
  }

  async setPages(studioId: string, id: string, photoIds: string[]) {
    const a = await this.find(studioId, id)
    await this.assertEventPhotos(a.eventId, photoIds)
    const old = await this.prisma.albumPage.findMany({ where: { albumId: id } })
    const captions = new Map(old.map((p) => [p.photoId, p.caption]))
    await this.prisma.$transaction([
      this.prisma.albumPage.deleteMany({ where: { albumId: id } }),
      this.prisma.albumPage.createMany({
        data: photoIds.map((photoId, position) => ({ albumId: id, photoId, position, caption: captions.get(photoId) ?? null })),
      }),
      this.prisma.album.update({ where: { id }, data: { coverPhotoId: photoIds[0], updatedAt: new Date() } }),
    ])
    return this.detail(studioId, id)
  }

  async setStatus(studioId: string, id: string, status: AlbumStatus) {
    const a = await this.find(studioId, id)
    await this.prisma.album.update({
      where: { id },
      data: { status, publishedAt: status === 'PUBLISHED' ? (a.publishedAt ?? new Date()) : a.publishedAt },
    })
    return this.toDto(await this.find(studioId, id))
  }

  async remove(studioId: string, id: string) {
    await this.find(studioId, id)
    await this.prisma.album.update({ where: { id }, data: { deletedAt: new Date() } })
  }

  /** Sharing a draft moves it to In Review, since the client can now see it. */
  private async shareable(studioId: string, id: string) {
    const a = await this.find(studioId, id)
    if (a._count.pages < 2) throw badRequest('Add at least 2 pages before sharing the album.')
    if (a.status === 'DRAFT') await this.prisma.album.update({ where: { id }, data: { status: 'IN_REVIEW' } })
    return a
  }

  async markShared(studioId: string, id: string) {
    await this.shareable(studioId, id)
    return this.toDto(await this.find(studioId, id))
  }

  async share(studioId: string, id: string) {
    const a = await this.shareable(studioId, id)
    const event = await this.prisma.event.findUniqueOrThrow({ where: { id: a.eventId }, include: { client: true } })
    return this.messaging.send(studioId, {
      templateKey: 'ALBUM_SHARE',
      toName: event.client.name,
      toPhone: event.client.phone,
      vars: { albumTitle: a.title, eventTitle: event.title, link: this.publicUrl(a.publicToken) },
      ref: { type: 'album', id: a.id },
    })
  }

  async resolveFeedback(studioId: string, id: string, feedbackId: string, resolved: boolean) {
    await this.find(studioId, id)
    const f = await this.prisma.albumFeedback.findFirst({ where: { id: feedbackId, albumId: id } })
    if (!f) throw notFound('Feedback')
    const updated = await this.prisma.albumFeedback.update({ where: { id: feedbackId }, data: { resolvedAt: resolved ? new Date() : null } })
    return this.feedbackDto(updated)
  }

  // ---------------------------------------------------------------- public (token) side

  private async byToken(token: string) {
    const a = await this.prisma.album.findFirst({
      where: { publicToken: token, deletedAt: null },
      include: { studio: { select: { name: true, logoFileId: true } } },
    })
    // Drafts are private to the studio even if someone has the link.
    if (!a || a.status === 'DRAFT') throw notFound('Album')
    return a
  }

  async publicView(token: string): Promise<PublicAlbumDto> {
    const a = await this.byToken(token)
    const [pages, feedback] = await Promise.all([
      this.prisma.albumPage.findMany({ where: { albumId: a.id }, include: { photo: true }, orderBy: { position: 'asc' } }),
      this.prisma.albumFeedback.findMany({ where: { albumId: a.id }, orderBy: { createdAt: 'asc' } }),
    ])
    return {
      code: a.code,
      title: a.title,
      subtitle: a.subtitle,
      location: a.location,
      status: a.status,
      studio: { name: a.studio.name, logoUrl: a.studio.logoFileId ? fileUrls.public(a.studio.logoFileId) : null },
      pages: this.pageDtos(pages, (p) => fileUrls.albumPhoto(token, p.photoId)),
      feedback: feedback.map((f) => this.feedbackDto(f)),
    }
  }

  async publicPhotoFile(token: string, photoId: string) {
    const a = await this.byToken(token)
    const page = await this.prisma.albumPage.findFirst({ where: { albumId: a.id, photoId }, include: { photo: { include: { file: true } } } })
    if (!page) throw notFound('Photo')
    return page.photo.file
  }

  private async assertSpread(albumId: string, spreadIndex: number) {
    const pages = await this.prisma.albumPage.count({ where: { albumId } })
    if (spreadIndex >= Math.ceil(pages / 2)) throw badRequest('That spread does not exist', { spreadIndex: 'Unknown spread' })
  }

  async addFeedback(token: string, body: { spreadIndex: number; authorName: string; message: string }) {
    const a = await this.byToken(token)
    await this.assertSpread(a.id, body.spreadIndex)
    const f = await this.prisma.albumFeedback.create({
      data: { albumId: a.id, spreadIndex: body.spreadIndex, authorName: body.authorName, message: body.message },
    })
    await this.prisma.album.update({ where: { id: a.id }, data: { updatedAt: new Date() } })
    await this.notifications.notify(a.studioId, {
      type: 'ALBUM_FEEDBACK',
      title: body.authorName,
      body: `left feedback on spread ${body.spreadIndex + 1} of ${a.title}`,
      link: `/digital-album?album=${a.id}`,
      icon: 'chat-square-quote',
    })
    return this.feedbackDto(f)
  }

  async setApproval(token: string, body: { spreadIndex: number; authorName: string; approved: boolean }) {
    const a = await this.byToken(token)
    await this.assertSpread(a.id, body.spreadIndex)
    if (body.approved) {
      const exists = await this.prisma.albumFeedback.findFirst({ where: { albumId: a.id, spreadIndex: body.spreadIndex, kind: 'APPROVAL' } })
      if (!exists) {
        await this.prisma.albumFeedback.create({
          data: { albumId: a.id, spreadIndex: body.spreadIndex, kind: 'APPROVAL', authorName: body.authorName },
        })
      }
    } else {
      await this.prisma.albumFeedback.deleteMany({ where: { albumId: a.id, spreadIndex: body.spreadIndex, kind: 'APPROVAL' } })
    }
    return this.publicView(token)
  }
}
