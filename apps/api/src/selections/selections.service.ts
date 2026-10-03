import { randomUUID } from 'node:crypto'
import { HttpStatus, Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import {
  ERROR_CODES,
  isSelectionLocked,
  isSelectionUnshared,
  resolveSelectionDefaults,
  todayIST,
  type createSelectionSchema,
  type ListQuery,
  type PublicSelectionDto,
  type SelectionDto,
  type StudioSelectionPhotoDto,
  type updateSelectionSchema,
  type UploadLimitsDto,
} from '@weddyzone/shared'
import type { z } from 'zod'
import { AppError, badRequest, conflict, notFound } from '../common/errors'
import { nextSequence, paginate, randomToken, skipTake, toDate, toIso } from '../common/util'
import { config } from '../config'
import { FilesService, fileUrls, type UploadedFile } from '../core/files.service'
import { selectionDto, selectionStatus, type SelectionWithRelations } from '../core/mappers'
import { MessagingService } from '../core/messaging.service'
import { NotificationsService } from '../core/notifications.service'
import { PrismaService, type Tx } from '../prisma/prisma.service'
import { accessKey, hashPin, hasAccess, PIN_LOCK_MINUTES, PIN_MAX_FAILURES, pinLocked, pinMatches, pinRequired, wrongPin } from './gallery-access'
import { PhotoPreviewService } from './previews.service'
import { writeLog } from './selection-log'
import { fileTooLarge, renewToUpload, storageFull, UploadLimitsService } from './upload-limits'

const MB = 1024 * 1024
const GB = 1024 ** 3

const include = {
  event: { include: { client: true } },
  members: { orderBy: { createdAt: 'asc' as const } },
  _count: { select: { photos: { where: { deletedAt: null } } } },
} satisfies Prisma.SelectionInclude

const readOnly = (message: string) => new AppError(HttpStatus.CONFLICT, ERROR_CODES.READ_ONLY, message)

/** Picks are final in these states. */
const CLOSED = ['SUBMITTED', 'DELIVERED'] as const
/** A new visit is counted when the client comes back after this long. */
const VISIT_GAP_MS = 30 * 60_000
/** Folder for photos uploaded without one. */
export const GENERAL_FOLDER = 'General'

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
  ) {}

  publicUrl(token: string) {
    return `${config().APP_URL}/s/${token}`
  }

  /** Distinct picked photos per selection and picks per member. */
  private async pickCounts(ids: string[]) {
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
    const { picked, members } = await this.pickCounts(rows.map((r) => r.id))
    return rows.map((r) => selectionDto(r, picked.get(r.id) ?? 0, members))
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
    const [selections, photos, active, completed, submitted, picked] = await Promise.all([
      this.prisma.selection.count({ where: { studioId, deletedAt: null } }),
      this.prisma.photo.count({ where: { deletedAt: null, selection: { studioId, deletedAt: null } } }),
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
      const seq = await nextSequence(tx, studioId, 'SEL', 101)
      const members = body.members.length ? body.members : [{ name: event.client.name, phone: event.client.phone }]
      const row = await tx.selection.create({
        data: {
          id,
          studioId,
          code: `SEL-${seq}`,
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

  async remove(studioId: string, id: string) {
    await this.find(studioId, id)
    await this.prisma.selection.update({ where: { id }, data: { deletedAt: new Date() } })
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
      originalName: p.file.originalName,
      size: p.file.size,
      position: p.position,
      folder: p.folder,
      folderId: p.folderId,
      previewUrl: `/api/v1/selections/${id}/photos/${p.id}/preview`,
      pickedBy: p.picks.map((k) => k.member.name),
      comments: p.comments.map((c) => ({ memberName: c.member.name, text: c.text, createdAt: c.createdAt.toISOString() })),
    }))
  }

  /**
   * Adds one photo. With `limits` (the upload route always passes them) the studio's plan decides
   * the largest photo, storage is checked under the selection lock, and a read-only plan is refused.
   * `folder` is the folder the photo came from, if any.
   */
  async addPhoto(
    studioId: string,
    id: string,
    file: UploadedFile | undefined,
    opts: { limits?: UploadLimitsDto; folder?: string | null; folderId?: string | null } = {},
  ) {
    const s = await this.find(studioId, id)
    if (isSelectionLocked(s.status)) throw readOnly('This selection was submitted — photos can no longer be added.')
    const { limits } = opts
    if (limits?.readOnly) throw renewToUpload(limits)
    if (limits && file && file.size > limits.maxPhotoMb * MB) throw fileTooLarge(limits)
    const overrides = limits ? { maxBytes: limits.maxPhotoMb * MB, label: `JPEG, PNG or WebP up to ${limits.maxPhotoMb} MB`, checkStorage: false } : {}
    const { checksum } = await this.files.validate(studioId, 'PHOTO', file, 'file', overrides)
    // The uploader sends several files at once (a whole folder, say). Locking the selection row makes
    // uploads to one selection take turns between the duplicate check and the insert, so the same
    // photo arriving twice in parallel is still caught, and positions never collide.
    const { photo, stored } = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM selections WHERE id = ${id}::uuid FOR UPDATE`
        const dup = await tx.photo.findFirst({
          where: { selectionId: id, deletedAt: null, file: { checksum } },
          include: { file: true },
        })
        if (dup) {
          throw conflict(`${file!.originalname} is already in this selection (same file as ${dup.file.originalName})`, {
            file: 'Duplicate photo — already uploaded',
          })
        }
        // Storage is counted inside the lock too, so parallel uploads can't overshoot the plan together.
        if (limits && limits.storageGb !== null) {
          const used = await this.uploadLimits.storageUsed(studioId, tx)
          if (used + file!.size > limits.storageGb * GB) throw storageFull(used, limits)
        }
        const last = await tx.photo.findFirst({ where: { selectionId: id }, orderBy: { position: 'desc' } })
        const folderId = await this.resolveFolder(tx, id, opts.folderId, opts.folder)
        const stored = await this.files.store(studioId, 'PHOTO', file, 'file', tx, overrides)
        const photo = await tx.photo.create({
          data: { studioId, eventId: s.eventId, selectionId: id, fileId: stored.id, position: (last?.position ?? -1) + 1, folder: opts.folder ?? null, folderId },
        })
        // The first photo moves a new selection from Draft to Uploading (until it is shared).
        await tx.selection.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'UPLOADING' } })
        return { photo, stored }
      },
      { timeout: 30_000, maxWait: 30_000 },
    )
    this.previews.queue(photo.id, s.watermark ? await this.studioName(studioId) : null)
    return {
      id: photo.id,
      url: fileUrls.studio(stored.id),
      originalName: stored.originalName,
      size: stored.size,
      position: photo.position,
      folder: photo.folder,
      folderId: photo.folderId,
    }
  }

  /** The studio's grid shows the same preview the client sees (fast to load), not the original. */
  async studioPreview(studioId: string, id: string, photoId: string) {
    const s = await this.find(studioId, id)
    const photo = await this.prisma.photo.findFirst({ where: { id: photoId, selectionId: id, deletedAt: null }, include: { file: true } })
    if (!photo) throw notFound('Photo')
    return (await this.previews.previewFor(photo.id, s.watermark ? await this.studioName(studioId) : null)) ?? photo.file
  }

  private async studioName(studioId: string) {
    return (await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { name: true } })).name
  }

  /**
   * The folder a new photo goes in: the one chosen on the page, else the top folder it was uploaded
   * from ("Haldi/Close-ups" → Haldi, made if new), else General. Runs under the selection lock.
   */
  private async resolveFolder(tx: Tx, selectionId: string, folderId?: string | null, path?: string | null) {
    if (folderId) {
      const f = await tx.selectionFolder.findFirst({ where: { id: folderId, selectionId } })
      if (!f) throw badRequest('Folder not found', { folderId: 'Choose one of this selection’s folders' })
      return f.id
    }
    const name = (path?.split('/')[0] ?? '').trim().slice(0, 60) || GENERAL_FOLDER
    const existing = await tx.selectionFolder.findFirst({ where: { selectionId, name: { equals: name, mode: 'insensitive' } } })
    if (existing) return existing.id
    const position = await tx.selectionFolder.count({ where: { selectionId } })
    return (await tx.selectionFolder.create({ data: { selectionId, name, position } })).id
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
    ])
  }

  private messageVars(s: SelectionWithRelations, picked: number) {
    return {
      eventTitle: s.event.title,
      quota: s.quota,
      picked,
      deadline: formatDeadline(toIso(s.deadline)),
      link: this.publicUrl(s.publicToken),
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
      const stems = photos.map((p) => p.file.originalName.replace(/\.[^.]+$/, ''))
      return { filename: `${name}-lightroom.txt`, contentType: 'text/plain; charset=utf-8', body: stems.join(', ') + '\n' }
    }
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const lines = [
      'filename,picked_by,comments',
      ...photos.map((p) =>
        [p.file.originalName, p.picks.map((k) => k.member.name).join('; '), p.comments.map((c) => c.text).join(' | ')].map(esc).join(','),
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
    const s = await this.prisma.selection.findFirst({
      where: { publicToken: token, deletedAt: null },
      include: { ...include, studio: { select: { name: true, logoFileId: true, phone: true } } },
    })
    if (!s) throw notFound('Selection')
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
  private async recordVisit(s: { id: string; lastClientVisitAt: Date | null }) {
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
        where: { selectionId: s.id, deletedAt: null },
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
        originalName: p.file.originalName,
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
    }
  }

  /**
   * What the client's browser gets for a photo: the preview (resized, watermarked when set), never
   * the original. `download` gives the original, only when the studio allows downloads.
   */
  async publicPhotoFile(token: string, photoId: string, key?: string | null, opts: { download?: boolean } = {}) {
    const s = await this.byToken(token, key)
    const photo = await this.prisma.photo.findFirst({ where: { id: photoId, selectionId: s.id, deletedAt: null }, include: { file: true } })
    if (!photo) throw notFound('Photo')
    if (opts.download) {
      if (!s.allowDownload) throw new AppError(HttpStatus.FORBIDDEN, ERROR_CODES.FORBIDDEN, 'Downloads are turned off for this gallery.')
      return photo.file
    }
    const preview = await this.previews.previewFor(photo.id, s.watermark ? s.studio.name : null)
    if (!preview) throw notFound('Photo')
    return preview
  }

  private assertWritable(s: { status: SelectionWithRelations['status']; deadline: Date }) {
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
    this.assertMember(s, body.memberId)
    const result = await this.prisma.$transaction(async (tx: Tx) => {
      await tx.$queryRaw`SELECT id FROM selections WHERE id = ${s.id}::uuid FOR UPDATE`
      const photo = await tx.photo.findFirst({ where: { id: body.photoId, selectionId: s.id, deletedAt: null } })
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
      const pickedBy = (await tx.photoPick.findMany({ where: { photoId: photo.id }, select: { memberId: true } })).map((p) => p.memberId)
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
    const { picked } = await this.pickCounts([s.id])
    const count = picked.get(s.id) ?? 0
    if (count === 0) throw badRequest('Pick at least one photo before submitting.')
    await this.prisma.$transaction([
      this.prisma.selection.update({ where: { id: s.id }, data: { status: 'SUBMITTED', submittedAt: new Date() } }),
      this.prisma.event.updateMany({ where: { id: s.eventId, status: 'AWAITING_SELECTION' }, data: { status: 'IN_PROGRESS' } }),
    ])
    const member = s.members.find((m) => m.id === memberId)
    await writeLog(this.prisma, s.id, 'CLIENT', 'Submitted', `${count} of ${s.quota} photos${member ? ` · by ${member.name}` : ''}`)
    await this.notifications.notify(s.studioId, {
      type: 'SELECTION_SUBMITTED',
      title: member?.name ?? s.event.client.name,
      body: `submitted ${count} of ${s.quota} photos for ${s.event.title}`,
      link: `/photo-selection/${s.id}`,
      icon: 'check2-circle',
    })
    return this.publicView(token, key)
  }
}

