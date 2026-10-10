import { randomInt, randomUUID } from 'node:crypto'
import { HttpStatus, Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import archiver from 'archiver'
import type { Response } from 'express'
import {
  cleanFolderName,
  ERROR_CODES,
  isSelectionLocked,
  isSelectionUnshared,
  resolveSelectionDefaults,
  resolveStoredSettings,
  SEND_VIA_LABELS,
  todayIST,
  type createSelectionSchema,
  type eventDetailsSchema,
  type ListQuery,
  MAX_PREVIEW_BYTES,
  type PublicSelectionDto,
  type SendVia,
  type SelectionDto,
  type StudioSelectionPhotoDto,
  type updateSelectionSchema,
  type UploadLimitsDto,
  videoFolderName,
} from '@weddyzone/shared'
import type { z } from 'zod'
import { AppError, badRequest, conflict, fileInvalid, notFound } from '../common/errors'
import { nextSequence, paginate, randomToken, sha256, skipTake, toDate, toIso } from '../common/util'
import { config } from '../config'
import { FilesService, fileUrls, type UploadedFile } from '../core/files.service'
import { selectionDto, selectionStatus, type SelectionWithRelations } from '../core/mappers'
import { MessagingService } from '../core/messaging.service'
import { NotificationsService } from '../core/notifications.service'
import { PrismaService, type Tx } from '../prisma/prisma.service'
import { accessKey, hashPin, hasAccess, PIN_LOCK_MINUTES, PIN_MAX_FAILURES, pinLocked, pinMatches, pinRequired, wrongPin } from './gallery-access'
import { IMAGE_MIMES, isVideoMime, VIDEO_MIMES } from '../infra/file-sniff'
import { previewKey, StorageService, thumbKey } from '../infra/storage.service'
import { LIGHT_PREVIEW_PX, PhotoPreviewService, PREVIEW_PX, renderUploadCopies, type WatermarkSpec } from './previews.service'
import { writeLog } from './selection-log'
import { fileTooLarge, type originalMeta, renewToUpload, storageFull, UploadLimitsService } from './upload-limits'

const MB = 1024 * 1024
const GB = 1024 ** 3

const include = {
  event: { include: { client: true } },
  members: { orderBy: { createdAt: 'asc' as const } },
  // photoCount = images; videos are counted separately (videoCounts).
  _count: { select: { photos: { where: { deletedAt: null, file: { mimeType: { startsWith: 'image/' } } } }, folders: true } },
} satisfies Prisma.SelectionInclude

const readOnly = (message: string) => new AppError(HttpStatus.CONFLICT, ERROR_CODES.READ_ONLY, message)

/** Picks are final in these states. */
const CLOSED = ['SUBMITTED', 'DELIVERED'] as const
/** A new visit is counted when the client comes back after this long. */
const VISIT_GAP_MS = 30 * 60_000
/** Folder for photos uploaded without one. */
export const GENERAL_FOLDER = 'General'

/** A selection opened for its client (see openGallery), with its resolved settings. */
export type OpenGallery = Awaited<ReturnType<SelectionsService['openGallery']>>

export function formatDeadline(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

@Injectable()
export class SelectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly messaging: MessagingService,
    private readonly notifications: NotificationsService,
    private readonly uploadLimits: UploadLimitsService,
    private readonly previews: PhotoPreviewService,
    private readonly storage: StorageService,
  ) {}

  publicUrl(token: string) {
    return `${config().APP_URL}/s/${token}`
  }

  /** Distinct picked photos per selection and picks per member. */
  async pickCounts(ids: string[]) {
    const picked = new Map<string, number>()
    const members = new Map<string, number>()
    if (ids.length === 0) return { picked, members }
    const rows = await this.prisma.$queryRaw<{ selection_id: string; n: bigint }[]>`
      SELECT selection_id, COUNT(DISTINCT photo_id) AS n FROM photo_picks
      WHERE selection_id = ANY(${ids}::uuid[]) GROUP BY selection_id`
    rows.forEach((r) => picked.set(r.selection_id, Number(r.n)))
    const byMember = await this.prisma.photoPick.groupBy({ by: ['memberId'], where: { selectionId: { in: ids } }, _count: true })
    byMember.forEach((r) => members.set(r.memberId, r._count))
    return { picked, members }
  }

  private async toDtos(rows: SelectionWithRelations[]): Promise<SelectionDto[]> {
    const ids = rows.map((r) => r.id)
    const [{ picked, members }, videos] = await Promise.all([this.pickCounts(ids), this.videoCounts(ids)])
    return rows.map((r) => selectionDto(r, picked.get(r.id) ?? 0, members, videos.get(r.id) ?? 0))
  }

  /** Videos per selection. */
  private async videoCounts(ids: string[]) {
    const out = new Map<string, number>()
    if (!ids.length) return out
    const rows = await this.prisma.photo.groupBy({
      by: ['selectionId'],
      where: { selectionId: { in: ids }, deletedAt: null, file: { mimeType: { startsWith: 'video/' } } },
      _count: true,
    })
    rows.forEach((r) => r.selectionId && out.set(r.selectionId, r._count))
    return out
  }

  async find(studioId: string, id: string) {
    const s = await this.prisma.selection.findFirst({ where: { id, studioId, deletedAt: null }, include })
    if (!s) throw notFound('Selection')
    return s
  }

  async dto(studioId: string, id: string) {
    return (await this.toDtos([await this.find(studioId, id)]))[0]
  }

  async list(studioId: string, q: ListQuery) {
    const today = toDate(todayIST())
    const text = q.search ? { contains: q.search, mode: 'insensitive' as const } : undefined
    let statusWhere: Prisma.SelectionWhereInput = {}
    switch (q.status) {
      case 'EXPIRED':
        statusWhere = { status: { notIn: [...CLOSED] }, deadline: { lt: today } }
        break
      case 'active':
        statusWhere = { status: { notIn: [...CLOSED] }, deadline: { gte: today } }
        break
      case 'SUBMITTED':
      case 'DELIVERED':
        statusWhere = { status: q.status }
        break
      case 'DRAFT':
      case 'UPLOADING':
      case 'SENT':
      case 'IN_PROGRESS':
        statusWhere = { status: q.status, deadline: { gte: today } }
        break
    }
    const where: Prisma.SelectionWhereInput = {
      studioId,
      deletedAt: null,
      ...statusWhere,
      ...(text ? { OR: [{ code: text }, { event: { title: text } }, { event: { client: { name: text } } }] } : {}),
    }
    const sortField = q.sort?.replace('-', '')
    const direction = q.sort?.startsWith('-') ? 'desc' : 'asc'
    // Sortable columns of the Photo Selection table; anything else = newest first.
    const sorts: Record<string, Prisma.SelectionOrderByWithRelationInput> = {
      deadline: { deadline: direction },
      code: { code: direction },
      created: { createdAt: direction },
      project: { event: { client: { name: direction } } },
      photos: { photos: { _count: direction } },
      status: { status: direction },
    }
    const orderBy: Prisma.SelectionOrderByWithRelationInput = (sortField && sorts[sortField]) || { createdAt: 'desc' }
    const [rows, total] = await Promise.all([
      this.prisma.selection.findMany({ where, include, orderBy, ...skipTake(q) }),
      this.prisma.selection.count({ where }),
    ])
    return paginate(await this.toDtos(rows), total, q)
  }

  async summary(studioId: string) {
    const today = toDate(todayIST())
    const [selections, photos, videos, active, completed, submitted, picked] = await Promise.all([
      this.prisma.selection.count({ where: { studioId, deletedAt: null } }),
      this.prisma.photo.count({ where: { ...{ deletedAt: null, file: { mimeType: { startsWith: 'image/' } } }, selection: { studioId, deletedAt: null } } }),
      this.prisma.photo.count({ where: { deletedAt: null, file: { mimeType: { startsWith: 'video/' } }, selection: { studioId, deletedAt: null } } }),
      this.prisma.selection.count({ where: { studioId, deletedAt: null, status: { notIn: [...CLOSED] }, deadline: { gte: today } } }),
      this.prisma.selection.count({ where: { studioId, deletedAt: null, status: { in: [...CLOSED] } } }),
      this.prisma.selection.findMany({
        where: { studioId, deletedAt: null, status: { in: [...CLOSED] }, submittedAt: { not: null } },
        select: { createdAt: true, submittedAt: true },
      }),
      this.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM (SELECT DISTINCT p.selection_id, p.photo_id FROM photo_picks p
        JOIN selections s ON s.id = p.selection_id WHERE s.studio_id = ${studioId}::uuid AND s.deleted_at IS NULL) t`,
    ])
    const avg =
      submitted.length === 0
        ? null
        : submitted.reduce((s, r) => s + (r.submittedAt!.getTime() - r.createdAt.getTime()), 0) / submitted.length / 86_400_000
    return {
      selections,
      photos,
      active,
      completed,
      picked: Number(picked[0]?.n ?? 0),
      avgTurnaroundDays: avg === null ? null : Math.round(avg * 10) / 10,
      videos,
    }
  }

  async create(studioId: string, body: z.output<typeof createSelectionSchema>) {
    const event = await this.prisma.event.findFirst({ where: { id: body.eventId, studioId, deletedAt: null }, include: { client: true } })
    if (!event) throw badRequest('Event not found', { eventId: 'Select one of your events' })
    // Gallery access: what the form sent, else the studio's defaults.
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { selectionDefaults: true } })
    const defaults = resolveSelectionDefaults(studio.selectionDefaults)
    const id = randomUUID()
    const created = await this.prisma.$transaction(async (tx) => {
      const members = body.members.length ? body.members : [{ name: event.client.name, phone: event.client.phone }]
      const row = await tx.selection.create({
        data: {
          id,
          studioId,
          code: await this.newCode(tx),
          eventId: event.id,
          quota: body.quota,
          deadline: toDate(body.deadline),
          publicToken: randomToken(18),
          pinHash: body.pin ? hashPin(id, body.pin) : null,
          allowDownload: body.allowDownload ?? defaults.allowDownload,
          watermark: body.watermark ?? defaults.watermark,
          notesAllowed: body.notesAllowed ?? defaults.notesAllowed,
          members: { create: members.map((m) => ({ name: m.name, phone: m.phone ?? null })) },
        },
      })
      await writeLog(tx, row.id, 'STUDIO', 'Created', `Limit ${body.quota} photos · gallery open until ${formatDeadline(body.deadline)}`)
      return row
    })
    if (event.status === 'UPCOMING' || event.status === 'IN_PROGRESS') {
      await this.prisma.event.update({ where: { id: event.id }, data: { status: 'AWAITING_SELECTION' } })
    }
    return this.dto(studioId, created.id)
  }

  async update(studioId: string, id: string, body: z.output<typeof updateSelectionSchema>) {
    const s = await this.find(studioId, id)
    if (isSelectionLocked(s.status)) throw readOnly('This selection was already submitted by the client. Unlock it first to make changes.')
    const [dto] = await this.toDtos([s])
    if (body.quota < dto.pickedCount) {
      throw badRequest('Quota is below the photos already picked', {
        quota: `The client has already picked ${dto.pickedCount} photos — the quota must be at least that`,
      })
    }
    if (body.deadline !== toIso(s.deadline) && body.deadline < todayIST()) {
      throw badRequest('Deadline cannot be in the past', { deadline: 'Deadline cannot be in the past' })
    }
    await this.prisma.selection.update({ where: { id }, data: { quota: body.quota, deadline: toDate(body.deadline) } })
    const changes = [
      body.quota !== s.quota ? `limit ${s.quota} → ${body.quota}` : null,
      body.deadline !== toIso(s.deadline) ? `gallery expiry ${formatDeadline(toIso(s.deadline))} → ${formatDeadline(body.deadline)}` : null,
    ].filter(Boolean)
    if (changes.length) await writeLog(this.prisma, id, 'STUDIO', 'Settings changed', changes.join(' · '))
    return this.dto(studioId, id)
  }

  /** A random 6-digit code no other selection has: the reference the customer gets with the link. */
  private async newCode(db: Tx | PrismaService) {
    for (let i = 0; i < 25; i++) {
      const code = String(randomInt(100_000, 1_000_000))
      if (!(await db.selection.findFirst({ where: { code }, select: { id: true } }))) return code
    }
    throw new Error('Could not find a free selection code')
  }

  /**
   * "Event Details": customer, event name and selection limit in one step. The customer is reused
   * when the studio already has a client with that phone and name; the event is dated today; the
   * gallery stays open for the studio's default number of days. Starts as Pending (Draft).
   */
  async createFromDetails(studioId: string, body: z.output<typeof eventDetailsSchema>) {
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { selectionDefaults: true } })
    const defaults = resolveSelectionDefaults(studio.selectionDefaults)
    const today = todayIST()
    const deadline = toIso(new Date(toDate(today).getTime() + defaults.galleryDays * 86_400_000))
    const id = randomUUID()
    await this.prisma.$transaction(async (tx) => {
      const client =
        (await tx.client.findFirst({
          where: { studioId, deletedAt: null, phone: body.customerPhone, name: { equals: body.customerName, mode: 'insensitive' } },
          orderBy: { createdAt: 'asc' },
        })) ?? (await tx.client.create({ data: { studioId, name: body.customerName, phone: body.customerPhone } }))
      const seq = await nextSequence(tx, studioId, 'EVT', 1001)
      const event = await tx.event.create({
        data: { studioId, code: `EVT-${seq}`, clientId: client.id, title: body.eventName, type: 'OTHER', date: toDate(today), venue: '', city: '', status: 'AWAITING_SELECTION' },
      })
      await tx.selection.create({
        data: {
          id,
          studioId,
          code: await this.newCode(tx),
          eventId: event.id,
          quota: body.quota,
          deadline: toDate(deadline),
          publicToken: randomToken(18),
          allowDownload: defaults.allowDownload,
          watermark: defaults.watermark,
          notesAllowed: defaults.notesAllowed,
          members: { create: [{ name: client.name, phone: client.phone }] },
          // Remember the expiry choice so the settings page shows it (when it is one of its options).
          ...([7, 15, 30, 60, 90].includes(defaults.galleryDays) ? { settings: { galleryExpiryDays: defaults.galleryDays } } : {}),
        },
      })
      await writeLog(tx, id, 'STUDIO', 'Created', `Limit ${body.quota} photos · gallery open until ${formatDeadline(deadline)}`)
    })
    return this.dto(studioId, id)
  }

  /** Manage: the customer's name and phone, the event name and the selection limit. */
  async updateDetails(studioId: string, id: string, body: z.output<typeof eventDetailsSchema>) {
    const s = await this.find(studioId, id)
    if (body.quota !== s.quota) {
      if (isSelectionLocked(s.status)) throw readOnly('The client already submitted. Unlock the selection to change the limit.')
      const [dto] = await this.toDtos([s])
      if (body.quota < dto.pickedCount) {
        throw badRequest('Limit is below the photos already picked', { quota: `The client has already picked ${dto.pickedCount} photos — the limit must be at least that` })
      }
    }
    const changes = [
      body.customerName !== s.event.client.name ? `customer ${s.event.client.name} → ${body.customerName}` : null,
      body.customerPhone !== s.event.client.phone ? 'phone changed' : null,
      body.eventName !== s.event.title ? `event ${s.event.title} → ${body.eventName}` : null,
      body.quota !== s.quota ? `limit ${s.quota} → ${body.quota}` : null,
    ].filter(Boolean)
    if (!changes.length) return this.dto(studioId, id)
    await this.prisma.$transaction(async (tx) => {
      await tx.client.update({ where: { id: s.event.clientId }, data: { name: body.customerName, phone: body.customerPhone } })
      await tx.event.update({ where: { id: s.eventId }, data: { title: body.eventName } })
      await tx.selection.update({ where: { id }, data: { quota: body.quota } })
      await writeLog(tx, id, 'STUDIO', 'Details changed', changes.join(' · '))
    })
    return this.dto(studioId, id)
  }

  /**
   * Deletes the selection with its photos (their files stop counting as storage). Its event goes too
   * when nothing else uses it (no other selection, invoice or album).
   */
  async remove(studioId: string, id: string) {
    const s = await this.find(studioId, id)
    const now = new Date()
    await this.prisma.$transaction(async (tx) => {
      const photos = await tx.photo.findMany({ where: { selectionId: id, deletedAt: null }, select: { fileId: true, previewFileId: true, originalFileId: true, thumbFileId: true } })
      const fileIds = photos.flatMap((p) => [p.fileId, p.previewFileId, p.originalFileId, p.thumbFileId].filter((f): f is string => !!f))
      await tx.photo.updateMany({ where: { selectionId: id, deletedAt: null }, data: { deletedAt: now } })
      if (fileIds.length) await tx.storedFile.updateMany({ where: { id: { in: fileIds } }, data: { deletedAt: now } })
      await tx.selection.update({ where: { id }, data: { deletedAt: now } })
      const stillUsed =
        (await tx.selection.count({ where: { eventId: s.eventId, deletedAt: null } })) +
        (await tx.invoice.count({ where: { eventId: s.eventId, deletedAt: null } })) +
        (await tx.album.count({ where: { eventId: s.eventId, deletedAt: null } }))
      if (!stillUsed) await tx.event.update({ where: { id: s.eventId }, data: { deletedAt: now } })
    })
  }

  async photos(studioId: string, id: string): Promise<StudioSelectionPhotoDto[]> {
    await this.find(studioId, id)
    const photos = await this.prisma.photo.findMany({
      where: { selectionId: id, deletedAt: null },
      include: { file: true, picks: { include: { member: true } }, comments: { include: { member: true }, orderBy: { createdAt: 'asc' } } },
      orderBy: { position: 'asc' },
    })
    return photos.map((p) => ({
      id: p.id,
      url: fileUrls.studio(p.fileId),
      originalName: p.originalName ?? p.file.originalName,
      size: p.file.size,
      position: p.position,
      folder: p.folder,
      folderId: p.folderId,
      previewUrl: `/api/v1/selections/${id}/photos/${p.id}/preview`,
      media: isVideoMime(p.file.mimeType) ? ('video' as const) : ('image' as const),
      mimeType: p.file.mimeType,
      compressed: p.compressed,
      originalSize: p.originalSize,
      originalWidth: p.originalWidth,
      originalHeight: p.originalHeight,
      relativePath: p.relativePath,
      sha256: p.sha256,
      thumbUrl: p.thumbFileId ? fileUrls.studio(p.thumbFileId) : null,
      pickedBy: p.picks.map((k) => k.member.name),
      comments: p.comments.map((c) => ({ memberName: c.member.name, text: c.text, createdAt: c.createdAt.toISOString() })),
    }))
  }

  /**
   * Adds one photo or video sent through the API (small files; the uploader sends photos straight to
   * storage through /uploads instead). A photo is never kept as sent: the server makes the same 2048 px
   * preview and 400 px thumbnail the browser would, and only those are stored. Photos over 2 MB are
   * refused. With `limits` the studio's plan decides video size and storage, and a read-only plan is
   * refused. `folder` is the folder the file came from, if any.
   */
  async addPhoto(
    studioId: string,
    id: string,
    file: UploadedFile | undefined,
    opts: { limits?: UploadLimitsDto; folder?: string | null; folderId?: string | null; original?: ReturnType<typeof originalMeta> } = {},
  ) {
    const s = await this.find(studioId, id)
    if (isSelectionLocked(s.status)) throw readOnly('This selection was submitted — photos can no longer be added.')
    const { limits } = opts
    if (limits?.readOnly) throw renewToUpload(limits)
    if (limits && file && file.size > limits.maxPhotoMb * MB) throw fileTooLarge(limits)
    // Photos (JPEG, PNG, WebP) and event videos (MP4, MOV); HEIC is converted to JPEG in the browser.
    const mimes = [...IMAGE_MIMES, ...VIDEO_MIMES]
    const overrides = limits
      ? { maxBytes: limits.maxPhotoMb * MB, label: `JPEG, PNG, WebP, MP4 or MOV up to ${limits.maxPhotoMb} MB`, checkStorage: false, mimes }
      : { mimes }
    const { checksum, type } = await this.files.validate(studioId, 'PHOTO', file, 'file', overrides)
    const media = isVideoMime(type.mime) ? 'video' : 'photo'
    if (media === 'photo' && file!.size > MAX_PREVIEW_BYTES) {
      throw fileInvalid(`${file!.originalname} is larger than 2 MB — use Upload Folder, which makes the preview on your computer`)
    }
    // A photo becomes its preview + thumbnail before anything is stored (the bytes sent are dropped).
    const photoId = randomUUID()
    const copies = media === 'photo' ? await renderUploadCopies(file!.buffer) : null
    // The uploader sends several files at once (a whole folder, say). Locking the selection row makes
    // uploads to one selection take turns between the duplicate check and the insert, so the same
    // photo arriving twice in parallel is still caught, and positions never collide.
    const { photo, stored } = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM selections WHERE id = ${id}::uuid FOR UPDATE`
        const dup = await tx.photo.findFirst({
          where: { selectionId: id, deletedAt: null, OR: [{ sha256: checksum }, { file: { checksum } }] },
          include: { file: true },
        })
        if (dup) {
          throw conflict(`${file!.originalname} is already in this selection (same file as ${dup.originalName ?? dup.file.originalName})`, {
            file: 'Duplicate photo — already uploaded',
          })
        }
        const size = copies ? copies.preview.length + copies.thumb.length : file!.size
        // Storage is counted inside the lock too, so parallel uploads can't overshoot the plan together.
        if (limits && limits.storageGb !== null) {
          const used = await this.uploadLimits.storageUsed(studioId, tx)
          if (used + size > limits.storageGb * GB) throw storageFull(used, limits)
        }
        const last = await tx.photo.findFirst({ where: { selectionId: id }, orderBy: { position: 'desc' } })
        const folderId = await this.resolveFolder(tx, id, media, opts.folderId, opts.folder)
        // The original's name and size: from the browser when it sent them, else the file itself.
        const o = opts.original
        const name = o?.originalName ?? file!.originalname.slice(0, 255)
        let stored
        let thumbId: string | null = null
        if (copies) {
          const keys = { preview: previewKey(s.eventId, photoId, 'webp'), thumb: thumbKey(s.eventId, photoId, 'webp') }
          await this.storage.saveAt(keys.preview, copies.preview, 'image/webp')
          await this.storage.saveAt(keys.thumb, copies.thumb, 'image/webp')
          stored = await tx.storedFile.create({
            data: { studioId, kind: 'PHOTO', storageKey: keys.preview, originalName: name.slice(0, 200), mimeType: 'image/webp', size: copies.preview.length, checksum },
          })
          thumbId = (
            await tx.storedFile.create({
              data: { studioId, kind: 'PHOTO', storageKey: keys.thumb, originalName: name.slice(0, 200), mimeType: 'image/webp', size: copies.thumb.length, checksum: `thumb:${checksum}` },
            })
          ).id
        } else {
          stored = await this.files.store(studioId, 'PHOTO', file, 'file', tx, overrides)
        }
        const photo = await tx.photo.create({
          data: {
            id: photoId,
            studioId,
            eventId: s.eventId,
            selectionId: id,
            fileId: stored.id,
            thumbFileId: thumbId,
            position: (last?.position ?? -1) + 1,
            folder: opts.folder ?? null,
            folderId,
            compressed: !!copies,
            originalName: name,
            originalSize: o?.originalSize ?? file!.size,
            originalWidth: o?.originalWidth ?? copies?.width ?? null,
            originalHeight: o?.originalHeight ?? copies?.height ?? null,
            sha256: copies ? checksum : null,
            format: copies ? 'webp' : null,
          },
        })
        // The first photo moves a new selection from Draft to Uploading (until it is shared).
        await tx.selection.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'UPLOADING' } })
        return { photo, stored }
      },
      { timeout: 30_000, maxWait: 30_000 },
    )
    if (!isVideoMime(stored.mimeType)) this.previews.queue(photo.id, this.watermarkFor(s, await this.studioName(studioId)))
    return {
      id: photo.id,
      url: fileUrls.studio(stored.id),
      originalName: photo.originalName ?? stored.originalName,
      size: stored.size,
      position: photo.position,
      folder: photo.folder,
      folderId: photo.folderId,
      compressed: photo.compressed,
      originalSize: photo.originalSize,
      originalWidth: photo.originalWidth,
      originalHeight: photo.originalHeight,
    }
  }

  /** The studio's grid shows the same preview the client sees (fast to load), not the original. */
  async studioPreview(studioId: string, id: string, photoId: string) {
    const s = await this.find(studioId, id)
    const photo = await this.prisma.photo.findFirst({ where: { id: photoId, selectionId: id, deletedAt: null }, include: { file: true } })
    if (!photo) throw notFound('Photo')
    if (isVideoMime(photo.file.mimeType)) return photo.file
    return (await this.previews.previewFor(photo.id, this.watermarkFor(s, await this.studioName(studioId)))) ?? photo.file
  }

  /** The watermark to stamp for this event, or null when it is off. */
  watermarkFor(s: { watermark: boolean; settings: unknown }, studioName: string): WatermarkSpec | null {
    if (!s.watermark) return null
    const w = resolveStoredSettings(s.settings).watermark
    return { logoFileId: w.logoFileId, text: studioName, position: w.position, sizePct: w.sizePct, spacingPct: w.spacingPct, opacityPct: w.opacityPct }
  }

  async studioName(studioId: string) {
    return (await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { name: true } })).name
  }

  /**
   * The folder a new photo goes in: the one chosen on the page, else the top folder it was uploaded
   * from ("Haldi/Close-ups" → Haldi, made if new), else General. Runs under the selection lock.
   */
  async resolveFolder(tx: Tx, selectionId: string, media: 'photo' | 'video', folderId?: string | null, path?: string | null) {
    if (folderId) {
      const f = await tx.selectionFolder.findFirst({ where: { id: folderId, selectionId } })
      if (!f) throw badRequest('Folder not found', { folderId: 'Choose one of this selection’s folders' })
      if (f.type !== media) {
        throw fileInvalid(f.type === 'video' ? `${f.name} is a video folder — it takes MP4, MOV or WebM videos only` : `${f.name} is a photo folder — it takes JPEG, PNG or WebP photos only`, 'file')
      }
      return f.id
    }
    // By upload path: photos go to the top folder's name (or General), videos to a video folder of it.
    const base = cleanFolderName(path?.split('/')[0] ?? '') || (media === 'video' ? 'Videos' : GENERAL_FOLDER)
    const name = media === 'video' && base !== 'Videos' ? videoFolderName(base) : base
    const existing = await tx.selectionFolder.findFirst({ where: { selectionId, type: media, name: { equals: name, mode: 'insensitive' } } })
    if (existing) return existing.id
    const position = await tx.selectionFolder.count({ where: { selectionId } })
    return (await tx.selectionFolder.create({ data: { selectionId, name, position, type: media } })).id
  }

  async removePhoto(studioId: string, id: string, photoId: string) {
    const s = await this.find(studioId, id)
    if (isSelectionLocked(s.status)) throw readOnly('This selection was submitted — photos can no longer be removed.')
    const photo = await this.prisma.photo.findFirst({ where: { id: photoId, selectionId: id, deletedAt: null } })
    if (!photo) throw notFound('Photo')
    await this.prisma.$transaction([
      this.prisma.photoPick.deleteMany({ where: { photoId } }),
      this.prisma.photo.update({ where: { id: photoId }, data: { deletedAt: new Date() } }),
      this.prisma.storedFile.update({ where: { id: photo.fileId }, data: { deletedAt: new Date() } }),
      // Its thumbnail (and any original kept by an older version) go with it.
      ...[photo.thumbFileId, photo.originalFileId].filter((f): f is string => !!f).map((fid) => this.prisma.storedFile.update({ where: { id: fid }, data: { deletedAt: new Date() } })),
    ])
  }

  private messageVars(s: SelectionWithRelations, picked: number) {
    return {
      eventTitle: s.event.title,
      quota: s.quota,
      picked,
      deadline: formatDeadline(toIso(s.deadline)),
      link: this.publicUrl(s.publicToken),
      code: s.code,
    }
  }

  async previewMessage(studioId: string, id: string, kind: 'invite' | 'reminder') {
    const s = await this.find(studioId, id)
    const [dto] = await this.toDtos([s])
    return this.messaging.preview(studioId, {
      templateKey: kind === 'invite' ? 'SELECTION_INVITE' : 'SELECTION_REMINDER',
      toName: s.event.client.name,
      toPhone: s.event.client.phone,
      vars: this.messageVars(s, dto.pickedCount),
    })
  }

  /** Who a reminder goes to and its template values (for the automatic reminders). */
  async reminderMessage(studioId: string, id: string) {
    const s = await this.find(studioId, id)
    const [dto] = await this.toDtos([s])
    return { toName: s.event.client.name, toPhone: s.event.client.phone, vars: this.messageVars(s, dto.pickedCount) }
  }

  /** Sends the selection link (invite) or a reminder through the messaging service. */
  async send(studioId: string, id: string, kind: 'invite' | 'reminder', opts: { actor?: 'STUDIO' | 'SYSTEM'; detail?: string } = {}) {
    const s = await this.find(studioId, id)
    const status = selectionStatus(s)
    if (isSelectionLocked(status)) throw readOnly('The client already submitted this selection.')
    if (status === 'EXPIRED') throw readOnly('The gallery has expired. Extend the expiry date before sending.')
    if (s._count.photos === 0) throw badRequest('Upload photos before sharing the selection with your client.')
    const [dto] = await this.toDtos([s])
    const result = await this.messaging.send(studioId, {
      templateKey: kind === 'invite' ? 'SELECTION_INVITE' : 'SELECTION_REMINDER',
      toName: s.event.client.name,
      toPhone: s.event.client.phone,
      vars: this.messageVars(s, dto.pickedCount),
      ref: { type: 'selection', id: s.id },
    })
    await this.prisma.selection.update({
      where: { id },
      data: {
        ...(isSelectionUnshared(s.status) ? { status: 'SENT', sharedAt: new Date() } : {}),
        ...(kind === 'reminder' ? { lastRemindedAt: new Date() } : {}),
      },
    })
    await writeLog(this.prisma, id, opts.actor ?? 'STUDIO', kind === 'invite' ? 'Shared on WhatsApp' : 'Reminder sent', opts.detail ?? `To ${s.event.client.name}`)
    return result
  }

  /** Copying the link counts as sharing it. */
  async markShared(studioId: string, id: string) {
    const s = await this.find(studioId, id)
    if (isSelectionUnshared(s.status)) {
      await this.prisma.selection.update({ where: { id }, data: { status: 'SENT', sharedAt: new Date() } })
      await writeLog(this.prisma, id, 'STUDIO', 'Shared', 'Link copied')
    }
    return this.dto(studioId, id)
  }

  /** Picked filenames for Lightroom: CSV (with who picked) or TXT (comma list to paste into a filter). */
  async export(studioId: string, id: string, format: 'csv' | 'txt') {
    const s = await this.find(studioId, id)
    const photos = await this.prisma.photo.findMany({
      where: { selectionId: id, deletedAt: null, picks: { some: {} } },
      include: { file: true, picks: { include: { member: true } }, comments: true },
      orderBy: { position: 'asc' },
    })
    const name = `${s.code}-${s.event.title.replace(/[^\w]+/g, '-')}`.replace(/-+$/, '')
    if (format === 'txt') {
      const stems = photos.map((p) => (p.originalName ?? p.file.originalName).replace(/\.[^.]+$/, ''))
      return { filename: `${name}-lightroom.txt`, contentType: 'text/plain; charset=utf-8', body: stems.join(', ') + '\n' }
    }
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const lines = [
      'filename,picked_by,comments',
      ...photos.map((p) =>
        [p.originalName ?? p.file.originalName, p.picks.map((k) => k.member.name).join('; '), p.comments.map((c) => c.text).join(' | ')].map(esc).join(','),
      ),
    ]
    return { filename: `${name}-picks.csv`, contentType: 'text/csv; charset=utf-8', body: lines.join('\n') + '\n' }
  }

  // ---------------------------------------------------------------- public (token) side

  /**
   * The selection behind a public link. With a PIN set, `key` must be the access key handed out
   * by enterPin, otherwise PIN_REQUIRED (with what the PIN screen shows).
   */
  private async byToken(token: string, key: string | null | undefined) {
    const s = await this.openGallery({ publicToken: token })
    if (!hasAccess(s, key)) {
      throw pinRequired({
        pinRequired: true,
        code: s.code,
        studio: { name: s.studio.name, logoUrl: s.studio.logoFileId ? fileUrls.public(s.studio.logoFileId) : null, phone: s.studio.phone },
        eventTitle: s.event.title,
        clientName: s.event.client.name,
      })
    }
    return s
  }

  /**
   * A selection the client may open (the /s link or the customer portal): Allow Client View is on
   * and the gallery hasn't expired. A submitted selection still opens, view-only.
   */
  async openGallery(where: { publicToken: string } | { id: string }) {
    const s = await this.prisma.selection.findFirst({
      where: { ...where, deletedAt: null },
      include: { ...include, studio: { select: { name: true, logoFileId: true, phone: true, instagramHandle: true } } },
    })
    if (!s) throw notFound('Selection')
    const studio = { name: s.studio.name, logoUrl: s.studio.logoFileId ? fileUrls.public(s.studio.logoFileId) : null, phone: s.studio.phone }
    const settings = resolveStoredSettings(s.settings)
    if (!settings.allowClientView) {
      throw new AppError(HttpStatus.FORBIDDEN, ERROR_CODES.GALLERY_CLOSED, `This gallery isn't open right now. Please contact ${s.studio.name}.`, undefined, { studio, eventTitle: s.event.title })
    }
    if (selectionStatus(s) === 'EXPIRED') {
      throw new AppError(HttpStatus.GONE, ERROR_CODES.GALLERY_EXPIRED, `This gallery has expired. Please contact ${s.studio.name} to reopen it.`, undefined, { studio, eventTitle: s.event.title })
    }
    return Object.assign(s, { stored: settings })
  }

  /** Checks a gallery PIN. Wrong PINs are counted per selection; too many lock the gallery for a while. */
  async enterPin(token: string, pin: string) {
    const s = await this.prisma.selection.findFirst({ where: { publicToken: token, deletedAt: null } })
    if (!s) throw notFound('Selection')
    if (!s.pinHash) return { key: null }
    if (s.pinLockedUntil && s.pinLockedUntil > new Date()) throw pinLocked(s.pinLockedUntil)
    if (pinMatches(s.id, s.pinHash, pin)) {
      if (s.pinFailures) await this.prisma.selection.update({ where: { id: s.id }, data: { pinFailures: 0, pinLockedUntil: null } })
      return { key: accessKey(s.id, s.pinHash) }
    }
    const failures = s.pinFailures + 1
    if (failures >= PIN_MAX_FAILURES) {
      const until = new Date(Date.now() + PIN_LOCK_MINUTES * 60_000)
      await this.prisma.selection.update({ where: { id: s.id }, data: { pinFailures: 0, pinLockedUntil: until } })
      await writeLog(this.prisma, s.id, 'SYSTEM', 'Gallery locked', `${PIN_MAX_FAILURES} wrong PINs — locked for ${PIN_LOCK_MINUTES} minutes`)
      throw pinLocked(until)
    }
    await this.prisma.selection.update({ where: { id: s.id }, data: { pinFailures: failures } })
    throw wrongPin(PIN_MAX_FAILURES - failures)
  }

  /** Counts a visit (once per VISIT_GAP_MS) and keeps "last client visit" fresh. */
  async recordVisit(s: { id: string; lastClientVisitAt: Date | null }) {
    const now = new Date()
    const isNew = !s.lastClientVisitAt || now.getTime() - s.lastClientVisitAt.getTime() > VISIT_GAP_MS
    await this.prisma.selection.update({ where: { id: s.id }, data: { lastClientVisitAt: now, ...(isNew ? { clientVisits: { increment: 1 } } : {}) } })
    if (isNew) await writeLog(this.prisma, s.id, 'CLIENT', 'Opened the gallery')
  }

  async publicView(token: string, key?: string | null): Promise<PublicSelectionDto> {
    const s = await this.byToken(token, key)
    const status = selectionStatus(s)
    const [photos, folders] = await Promise.all([
      this.prisma.photo.findMany({
        where: { selectionId: s.id, deletedAt: null, file: { mimeType: { startsWith: 'image/' } } },
        include: { file: true, picks: { include: { member: true } }, comments: { include: { member: true }, orderBy: { createdAt: 'asc' } } },
        orderBy: { position: 'asc' },
      }),
      this.prisma.selectionFolder.findMany({ where: { selectionId: s.id }, orderBy: [{ position: 'asc' }, { name: 'asc' }] }),
    ])
    const { picked, members } = await this.pickCounts([s.id])
    await this.recordVisit(s)
    const k = s.pinHash && key ? `?k=${encodeURIComponent(key)}` : ''
    const perFolder = new Map<string, number>()
    photos.forEach((p) => p.folderId && perFolder.set(p.folderId, (perFolder.get(p.folderId) ?? 0) + 1))
    return {
      code: s.code,
      studio: { name: s.studio.name, logoUrl: s.studio.logoFileId ? fileUrls.public(s.studio.logoFileId) : null, phone: s.studio.phone },
      eventTitle: s.event.title,
      clientName: s.event.client.name,
      quota: s.quota,
      deadline: toIso(s.deadline),
      status,
      readOnly: isSelectionLocked(status) || status === 'EXPIRED',
      pickedCount: picked.get(s.id) ?? 0,
      members: s.members.map((m) => ({ id: m.id, name: m.name, phone: null, pickCount: members.get(m.id) ?? 0 })),
      photos: photos.map((p) => ({
        id: p.id,
        url: fileUrls.selectionPhoto(token, p.id) + k,
        originalName: p.originalName ?? p.file.originalName,
        size: p.file.size,
        position: p.position,
        folderId: p.folderId,
        downloadUrl: s.allowDownload ? `${fileUrls.selectionPhoto(token, p.id)}/download${k}` : null,
        pickedBy: p.picks.map((k) => k.memberId),
        comments: p.comments.map((c) => ({ memberId: c.memberId, memberName: c.member.name, text: c.text, createdAt: c.createdAt.toISOString() })),
      })),
      folders: folders.filter((f) => perFolder.get(f.id)).map((f) => ({ id: f.id, name: f.name, photoCount: perFolder.get(f.id) ?? 0 })),
      notesAllowed: s.notesAllowed,
      allowDownload: s.allowDownload,
      favoritesEnabled: s.stored.favoriteOption,
      downloadAllFolder: s.allowDownload && s.stored.downloadAllFolder,
      instagram: s.stored.instagramFollow && s.studio.instagramHandle ? { handle: s.studio.instagramHandle } : null,
    }
  }

  /**
   * What the client's browser gets for a photo: the preview (resized, watermarked when set), never
   * the original. `download` gives the original, only when the studio allows downloads.
   */
  async publicPhotoFile(token: string, photoId: string, key?: string | null) {
    const s = await this.byToken(token, key)
    const photo = await this.prisma.photo.findFirst({ where: { id: photoId, selectionId: s.id, deletedAt: null, file: { mimeType: { startsWith: 'image/' } } }, include: { file: true } })
    if (!photo) throw notFound('Photo')
    const preview = await this.previews.previewFor(photo.id, this.watermarkFor(s, s.studio.name), this.previewPx(s))
    if (!preview) throw notFound('Photo')
    return preview
  }

  /**
   * A client download: the original (Original Quality add-on) or a 1600 px copy, watermarked when
   * the event's watermark is on. Only with Download On.
   */
  async publicDownload(token: string, photoId: string, key?: string | null) {
    return this.downloadFrom(await this.byToken(token, key), photoId)
  }

  /**
   * A download from an opened gallery. Videos only with the Video Download option; they are sent
   * as they are (no watermark on video).
   */
  async downloadFrom(s: OpenGallery, photoId: string, opts: { videos?: boolean } = {}) {
    if (!s.allowDownload) throw new AppError(HttpStatus.FORBIDDEN, ERROR_CODES.FORBIDDEN, 'Downloads are turned off for this gallery.')
    const photo = await this.prisma.photo.findFirst({
      where: { id: photoId, selectionId: s.id, deletedAt: null, ...(opts.videos ? {} : { file: { mimeType: { startsWith: 'image/' } } }) },
      include: { file: true },
    })
    if (!photo) throw notFound('Photo')
    if (isVideoMime(photo.file.mimeType)) {
      if (!s.stored.videoDownload) throw new AppError(HttpStatus.FORBIDDEN, ERROR_CODES.FORBIDDEN, 'Video downloads are turned off for this gallery.')
      return { file: photo.file, buffer: null }
    }
    // Customers only ever get the preview (watermarked when the event says so), never an original.
    const watermark = this.watermarkFor(s, s.studio.name)
    const buffer = await this.previews.downloadFor(photo.file, watermark)
    if (!buffer) throw notFound('Photo')
    return { file: photo.file, buffer, name: photo.file.originalName.replace(/\.[^.]+$/, '') + '.jpg' }
  }

  /** "Download All Folder": a folder's photos as a ZIP, each prepared like a single download. */
  async publicFolderZip(token: string, folderId: string, key: string | null | undefined, res: Response) {
    return this.folderZipFrom(await this.byToken(token, key), folderId, res)
  }

  async folderZipFrom(s: OpenGallery, folderId: string, res: Response) {
    if (!s.allowDownload || !s.stored.downloadAllFolder) throw new AppError(HttpStatus.FORBIDDEN, ERROR_CODES.FORBIDDEN, 'Folder downloads are turned off for this gallery.')
    const folder = await this.prisma.selectionFolder.findFirst({ where: { id: folderId, selectionId: s.id } })
    if (!folder) throw notFound('Folder')
    const photos = await this.prisma.photo.findMany({
      where: { selectionId: s.id, folderId, deletedAt: null, file: { mimeType: { startsWith: 'image/' } } },
      include: { file: true },
      orderBy: { position: 'asc' },
    })
    if (!photos.length) throw badRequest('This folder has no photos.')
    const watermark = this.watermarkFor(s, s.studio.name)
    const safe = folder.name.replace(/[^\w-]+/g, '-').replace(/-+/g, '-') || 'photos'
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.zip"`)
    const zip = archiver('zip', { store: true })
    zip.on('error', () => res.destroy())
    zip.pipe(res)
    const used = new Set<string>()
    for (const p of photos) {
      const buffer = await this.previews.downloadFor(p.file, watermark)
      let name = buffer ? p.file.originalName.replace(/\.[^.]+$/, '') + '.jpg' : p.file.originalName
      for (let n = 2; used.has(name.toLowerCase()); n++) name = name.replace(/(\.[^.]+)?$/, ` (${n})$1`)
      used.add(name.toLowerCase())
      if (buffer) zip.append(buffer, { name })
      else {
        const stream = await this.storage.open(p.file.storageKey)
        if (stream) {
          const done = new Promise<void>((resolve) => zip.once('entry', () => resolve()))
          zip.append(stream, { name })
          await done
        }
      }
    }
    await zip.finalize()
  }

  assertWritable(s: { status: SelectionWithRelations['status']; deadline: Date }) {
    const status = selectionStatus(s)
    if (isSelectionLocked(status)) throw readOnly('This selection has been submitted and is now read-only.')
    if (status === 'EXPIRED') throw readOnly('This gallery has expired. Please contact your photographer.')
  }

  private assertMember(s: { members: { id: string }[] }, memberId: string) {
    if (!s.members.some((m) => m.id === memberId)) throw badRequest('Choose who is picking first', { memberId: 'Unknown family member' })
  }

  /**
   * Heart / un-heart a photo for one family member. The selection row is locked
   * so two people picking at the same moment cannot exceed the quota.
   */
  async setPick(token: string, body: { photoId: string; memberId: string; picked: boolean }, key?: string | null) {
    const s = await this.byToken(token, key)
    this.assertWritable(s)
    if (!s.stored.favoriteOption) throw readOnly('Picking is turned off for this gallery.')
    this.assertMember(s, body.memberId)
    const result = await this.prisma.$transaction(async (tx: Tx) => {
      await tx.$queryRaw`SELECT id FROM selections WHERE id = ${s.id}::uuid FOR UPDATE`
      const photo = await tx.photo.findFirst({ where: { id: body.photoId, selectionId: s.id, deletedAt: null, file: { mimeType: { startsWith: 'image/' } } } })
      if (!photo) throw notFound('Photo')
      const existing = await tx.photoPick.findUnique({ where: { photoId_memberId: { photoId: photo.id, memberId: body.memberId } } })
      if (body.picked && !existing) {
        const alreadyPickedByFamily = (await tx.photoPick.count({ where: { photoId: photo.id } })) > 0
        const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`
          SELECT COUNT(DISTINCT photo_id) AS n FROM photo_picks WHERE selection_id = ${s.id}::uuid`
        if (!alreadyPickedByFamily && Number(n) >= s.quota) {
          throw new AppError(
            HttpStatus.CONFLICT,
            ERROR_CODES.QUOTA_LOCKED,
            `You've picked all ${s.quota} photos in your package. Remove a photo to choose another.`,
            undefined,
            { quota: s.quota },
          )
        }
        await tx.photoPick.create({ data: { selectionId: s.id, photoId: photo.id, memberId: body.memberId } })
      } else if (!body.picked && existing) {
        await tx.photoPick.delete({ where: { id: existing.id } })
      }
      const firstPick = body.picked && (isSelectionUnshared(s.status) || s.status === 'SENT')
      await tx.selection.update({ where: { id: s.id }, data: { lastClientVisitAt: new Date(), ...(firstPick ? { status: 'IN_PROGRESS' } : {}) } })
      if (firstPick) await writeLog(tx, s.id, 'CLIENT', 'Started picking')
      const [{ n: after }] = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(DISTINCT photo_id) AS n FROM photo_picks WHERE selection_id = ${s.id}::uuid`
      const pickedBy = (await tx.photoPick.findMany({ where: { photoId: photo.id }, select: { memberId: true }, orderBy: { createdAt: 'asc' } })).map((p) => p.memberId)
      return { firstPick, pickedCount: Number(after), pickedBy }
    })
    if (result.firstPick) {
      const member = s.members.find((m) => m.id === body.memberId)
      await this.notifications.notify(s.studioId, {
        type: 'SELECTION_PICK',
        title: member?.name ?? s.event.client.name,
        body: `started picking photos for ${s.event.title}`,
        link: `/photo-selection/${s.id}`,
        icon: 'images',
      })
    }
    return { pickedCount: result.pickedCount, quota: s.quota, photoId: body.photoId, pickedBy: result.pickedBy }
  }

  async comment(token: string, body: { photoId: string; memberId: string; text: string }, key?: string | null) {
    const s = await this.byToken(token, key)
    this.assertWritable(s)
    if (!s.notesAllowed) throw readOnly('Notes are turned off for this gallery.')
    this.assertMember(s, body.memberId)
    const photo = await this.prisma.photo.findFirst({ where: { id: body.photoId, selectionId: s.id, deletedAt: null } })
    if (!photo) throw notFound('Photo')
    const c = await this.prisma.photoComment.create({
      data: { selectionId: s.id, photoId: photo.id, memberId: body.memberId, text: body.text },
      include: { member: true },
    })
    return { memberId: c.memberId, memberName: c.member.name, text: c.text, createdAt: c.createdAt.toISOString() }
  }

  async submit(token: string, memberId: string, key?: string | null) {
    const s = await this.byToken(token, key)
    this.assertWritable(s)
    this.assertMember(s, memberId)
    await this.submitFrom(s, s.members.find((m) => m.id === memberId)?.name)
    return this.publicView(token, key)
  }

  /**
   * Locks the selection as submitted (shown as "Selected"), logs it and tells the studio:
   * "{customer} submitted {n} photos for {event}". Changes after this get 409 until the studio
   * resets or unlocks it.
   */
  async submitFrom(s: OpenGallery, memberName?: string) {
    this.assertWritable(s)
    const count = await this.prisma.$transaction(async (tx) => {
      // Under the row lock, so two submits (or a submit racing a pick) can't both go through.
      await tx.$queryRaw`SELECT id FROM selections WHERE id = ${s.id}::uuid FOR UPDATE`
      const fresh = await tx.selection.findUniqueOrThrow({ where: { id: s.id }, select: { status: true } })
      if (isSelectionLocked(fresh.status)) throw readOnly('This selection has been submitted and is now read-only.')
      const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT COUNT(DISTINCT photo_id) AS n FROM photo_picks WHERE selection_id = ${s.id}::uuid`
      if (Number(n) === 0) throw badRequest('Pick at least one photo before submitting.')
      await tx.selection.update({ where: { id: s.id }, data: { status: 'SUBMITTED', submittedAt: new Date(), reopenedAt: null } })
      await tx.event.updateMany({ where: { id: s.eventId, status: 'AWAITING_SELECTION' }, data: { status: 'IN_PROGRESS' } })
      return Number(n)
    })
    await writeLog(this.prisma, s.id, 'CLIENT', 'Submitted', `${count} of ${s.quota} photos${memberName ? ` · by ${memberName}` : ''}`)
    await this.notifications.notify(s.studioId, {
      type: 'SELECTION_SUBMITTED',
      title: s.event.client.name,
      body: `submitted ${count} photo${count === 1 ? '' : 's'} for ${s.event.title}`,
      link: `/photo-selection/${s.id}`,
      icon: 'check2-circle',
    })
    return count
  }

  /**
   * Studio side: the Send/Share card that was used (copy link, QR, SMS, WhatsApp). The first share
   * moves the selection to Shared; every share is logged in Client Activity.
   */
  async markSent(studioId: string, id: string, via: SendVia) {
    const s = await this.find(studioId, id)
    const now = new Date()
    const first = isSelectionUnshared(s.status)
    await this.prisma.selection.update({
      where: { id },
      data: { lastSentAt: now, sentVia: via, ...(first ? { status: 'SENT', sharedAt: now } : {}) },
    })
    await writeLog(this.prisma, id, 'STUDIO', first ? 'Shared' : SEND_VIA_LABELS[via], `${first ? `${SEND_VIA_LABELS[via]} · ` : ''}to ${s.event.client.name}`)
    return this.dto(studioId, id)
  }

  /** Client preview size: full size, or lighter when "Show photos in high quality" is off. */
  previewPx(s: OpenGallery) {
    return s.stored.highQuality ? PREVIEW_PX : LIGHT_PREVIEW_PX
  }

  /** Older selections have SEL-… codes, which the customer app can't take: give one a 6-digit code. */
  async renewCode(studioId: string, id: string) {
    const s = await this.find(studioId, id)
    if (/^\d{6}$/.test(s.code)) return this.dto(studioId, id)
    const code = await this.newCode(this.prisma)
    await this.prisma.selection.update({ where: { id }, data: { code } })
    await writeLog(this.prisma, id, 'STUDIO', 'New code', `${s.code} → ${code}`)
    return this.dto(studioId, id)
  }
}

