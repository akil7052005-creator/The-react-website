import { HttpStatus, Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { StoredFile } from '@prisma/client'
import {
  CODE_LOCK_MINUTES,
  CODE_MAX_FAILURES,
  ERROR_CODES,
  eventStatusOf,
  isSelectionLocked,
  isSelectionUnshared,
  NO_EXPIRY_DATE,
  todayIST,
  type ClientFolderDto,
  type ClientItemResult,
  type ClientItemsPage,
  type ClientLinkDto,
  type ClientSelectedDto,
  type ClientSelectionDto,
  type ClientVerifyResult,
  type clientItemPatchSchema,
  type MediaItem,
} from '@weddyzone/shared'
import type { Request, Response } from 'express'
import type { z } from 'zod'
import { AppError, notFound } from '../common/errors'
import { toDate, toIso } from '../common/util'
import { config } from '../config'
import { FilesService, fileUrls } from '../core/files.service'
import { selectionStatus } from '../core/mappers'
import { NotificationsService } from '../core/notifications.service'
import { isVideoMime } from '../infra/file-sniff'
import { StorageService } from '../infra/storage.service'
import { PrismaService, type Tx } from '../prisma/prisma.service'
import { accessKey, pinRequired } from './gallery-access'
import { PhotoPreviewService } from './previews.service'
import { writeLog } from './selection-log'
import { SelectionsService, type OpenGallery } from './selections.service'

// The customer portal (/selection/auth → /selection/:id). The customer enters the 6-digit code (and
// the PIN, when the gallery has one) and gets a short-lived token for that one selection. Every
// request re-checks Allow Client View and the expiry, so turning the gallery off takes effect at
// once. 403 (not 401) when the token is bad: a 401 makes the web app try to refresh a studio login.

const AUDIENCE = 'selection-client'
const TOKEN_TTL_S = 12 * 60 * 60
/** Items per page in a folder. */
export const CLIENT_PAGE_SIZE = 60

const secret = () => `client-selection:${config().JWT_ACCESS_SECRET}`
const readOnly = (message: string) => new AppError(HttpStatus.CONFLICT, ERROR_CODES.READ_ONLY, message)
const codeLocked = (until: Date) => {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000))
  return new AppError(HttpStatus.TOO_MANY_REQUESTS, ERROR_CODES.PIN_LOCKED, `Too many wrong codes. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, undefined, {
    retryAt: until.toISOString(),
  })
}
const clientAuth = (message = 'Enter your access code to continue.') => new AppError(HttpStatus.FORBIDDEN, ERROR_CODES.CLIENT_AUTH, message)

/** Photos can be picked when client selection is on; videos only with video selection too. */
const canSelect = (s: OpenGallery, video: boolean) => s.stored.allowSelection && (!video || s.stored.videoSelection)

/** The token or ?t= from a request (images and videos can't send headers). */
export function clientTokenFrom(req: Request) {
  const h = req.headers['x-client-token']
  if (typeof h === 'string' && h) return h
  const q = req.query?.t
  return typeof q === 'string' && q ? q : null
}

@Injectable()
export class ClientSelectionService {
  private readonly jwt = new JwtService()

  constructor(
    private readonly prisma: PrismaService,
    private readonly selections: SelectionsService,
    private readonly previews: PhotoPreviewService,
    private readonly storage: StorageService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Changing or removing the PIN ends every session handed out before. */
  private pinState(s: { id: string; pinHash: string | null }) {
    return s.pinHash ? accessKey(s.id, s.pinHash) : ''
  }

  /** The verification screen of a share link: whose gallery it is, and whether it is locked. */
  async linkInfo(shareToken: string): Promise<ClientLinkDto> {
    const s = await this.selections.openGallery({ publicToken: shareToken })
    const locked = s.codeLockedUntil && s.codeLockedUntil > new Date() ? s.codeLockedUntil.toISOString() : null
    return { studio: { name: s.studio.name, logoUrl: s.studio.logoFileId ? fileUrls.public(s.studio.logoFileId) : null }, eventName: s.event.title, lockedUntil: locked }
  }

  /**
   * The code entered on a share link must be that selection's. Wrong codes are counted per
   * selection: CODE_MAX_FAILURES of them lock the link for CODE_LOCK_MINUTES.
   */
  private async checkLinkCode(shareToken: string, code: string) {
    const s = await this.prisma.selection.findFirst({ where: { publicToken: shareToken, deletedAt: null, studio: { removedAt: null } }, select: { id: true, code: true, codeFailures: true, codeLockedUntil: true } })
    if (!s) throw new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'This link is not valid. Please ask your photographer for a new one.')
    if (s.codeLockedUntil && s.codeLockedUntil > new Date()) throw codeLocked(s.codeLockedUntil)
    if (s.code === code) {
      if (s.codeFailures || s.codeLockedUntil) await this.prisma.selection.update({ where: { id: s.id }, data: { codeFailures: 0, codeLockedUntil: null } })
      return s.id
    }
    const failures = s.codeFailures + 1
    if (failures >= CODE_MAX_FAILURES) {
      const until = new Date(Date.now() + CODE_LOCK_MINUTES * 60_000)
      await this.prisma.selection.update({ where: { id: s.id }, data: { codeFailures: 0, codeLockedUntil: until } })
      await writeLog(this.prisma, s.id, 'SYSTEM', 'Link locked', `${CODE_MAX_FAILURES} wrong codes — locked for ${CODE_LOCK_MINUTES} minutes`)
      throw codeLocked(until)
    }
    await this.prisma.selection.update({ where: { id: s.id }, data: { codeFailures: failures } })
    const left = CODE_MAX_FAILURES - failures
    throw new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, `Invalid code. ${left} ${left === 1 ? 'try' : 'tries'} left.`, { code: 'Invalid code' }, { left })
  }

  async verify(code: string, pin?: string, shareToken?: string): Promise<ClientVerifyResult> {
    let id: string
    if (shareToken) {
      id = await this.checkLinkCode(shareToken, code)
    } else {
      // Codes are unique; two matches would be old data, and then neither is safe to open.
      const rows = await this.prisma.selection.findMany({ where: { code, deletedAt: null, studio: { removedAt: null } }, select: { id: true }, take: 2 })
      if (rows.length !== 1) throw new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Invalid code', { code: 'Invalid code' })
      id = rows[0].id
    }
    const s = await this.selections.openGallery({ id })
    if (s.pinHash) {
      if (!pin) throw pinRequired({ pinRequired: true })
      await this.selections.enterPin(s.publicToken, pin)
    }
    const token = await this.jwt.signAsync({ sid: s.id, pk: this.pinState(s) }, { secret: secret(), audience: AUDIENCE, expiresIn: TOKEN_TTL_S })
    return {
      token,
      selectionId: s.id,
      submitted: isSelectionLocked(selectionStatus(s)),
      expiresAt: new Date(Date.now() + TOKEN_TTL_S * 1000).toISOString(),
    }
  }

  /** The selection behind a token, if the token is for it and the gallery is open. */
  async open(id: string, token: string | null): Promise<OpenGallery> {
    if (!token) throw clientAuth()
    let payload: { sid?: string; pk?: string }
    try {
      payload = await this.jwt.verifyAsync(token, { secret: secret(), audience: AUDIENCE })
    } catch {
      throw clientAuth('Your session has ended. Enter your access code again.')
    }
    if (payload.sid !== id) throw clientAuth()
    const s = await this.selections.openGallery({ id })
    if (payload.pk !== this.pinState(s)) throw clientAuth('The gallery PIN changed. Enter your access code again.')
    return s
  }

  // ---------------------------------------------------------------- reads

  private base(id: string) {
    return `/api/v1/public/selection/${id}`
  }

  private item(
    s: OpenGallery,
    p: { id: string; folderId: string | null; clientFavorite: boolean; file: Pick<StoredFile, 'mimeType'> },
    selected: boolean,
    note: string | null,
  ): MediaItem {
    const video = isVideoMime(p.file.mimeType)
    const url = `${this.base(s.id)}/items/${p.id}/file`
    const canDownload = s.allowDownload && (!video || s.stored.videoDownload)
    return {
      id: p.id,
      folderId: p.folderId,
      type: video ? 'video' : 'photo',
      url,
      thumbUrl: url,
      width: null,
      height: null,
      selected,
      selectable: canSelect(s, video),
      favorite: p.clientFavorite,
      note,
      downloadUrl: canDownload ? `${this.base(s.id)}/items/${p.id}/download` : null,
    }
  }

  /** Photo ids picked (by anyone) in the selection. */
  private async pickedIds(selectionId: string, db: Tx | PrismaService = this.prisma) {
    const rows = await db.photoPick.findMany({ where: { selectionId, photo: { deletedAt: null } }, select: { photoId: true }, distinct: ['photoId'] })
    return new Set(rows.map((r) => r.photoId))
  }

  async view(id: string, token: string | null): Promise<ClientSelectionDto> {
    const s = await this.open(id, token)
    const status = selectionStatus(s)
    const today = toDate(todayIST())
    const [items, folders, picked, banners] = await Promise.all([
      this.prisma.photo.findMany({
        where: { selectionId: s.id, deletedAt: null },
        select: { id: true, folderId: true, clientFavorite: true, file: { select: { mimeType: true } } },
        orderBy: { position: 'asc' },
      }),
      this.prisma.selectionFolder.findMany({ where: { selectionId: s.id }, orderBy: [{ position: 'asc' }, { name: 'asc' }] }),
      this.pickedIds(s.id),
      this.prisma.banner.findMany({
        where: {
          studioId: s.studioId,
          deletedAt: null,
          active: true,
          placement: 'GALLERY_HERO',
          AND: [{ OR: [{ startDate: null }, { startDate: { lte: today } }] }, { OR: [{ endDate: null }, { endDate: { gte: today } }] }],
        },
        orderBy: { position: 'asc' },
        take: 8,
      }),
    ])
    await this.selections.recordVisit(s)
    const videos = items.filter((p) => isVideoMime(p.file.mimeType)).length
    const zipOn = s.allowDownload && s.stored.downloadAllFolder
    // Albums with nothing in them are left out of the customer's gallery.
    const folderDtos: ClientFolderDto[] = folders.flatMap((f) => {
      const inFolder = items.filter((p) => p.folderId === f.id)
      const first = inFolder[0]
      if (!first) return []
      return {
        id: f.id,
        name: f.name,
        type: f.type === 'video' ? 'video' : 'photo',
        total: inFolder.length,
        selected: inFolder.filter((p) => picked.has(p.id)).length,
        cover: { type: isVideoMime(first.file.mimeType) ? 'video' : 'photo', url: `${this.base(s.id)}/items/${first.id}/file` },
        zipUrl: zipOn && f.type !== 'video' ? `${this.base(s.id)}/folders/${f.id}/zip` : null,
      }
    })
    const deadline = toIso(s.deadline)
    return {
      id: s.id,
      code: s.code,
      eventName: s.event.title,
      customerName: s.event.client.name,
      studio: { name: s.studio.name, logoUrl: s.studio.logoFileId ? fileUrls.public(s.studio.logoFileId) : null },
      selectionLimit: s.stored.limitOn ? s.quota : null,
      status: eventStatusOf(status),
      submittedAt: s.submittedAt?.toISOString() ?? null,
      readOnly: isSelectionLocked(status),
      expiresOn: deadline >= NO_EXPIRY_DATE ? null : deadline,
      counts: {
        photos: items.length - videos,
        videos,
        favorites: items.filter((p) => p.clientFavorite).length,
        selected: items.filter((p) => picked.has(p.id)).length,
        folders: folderDtos.length,
      },
      folders: folderDtos,
      permissions: { select: s.stored.allowSelection, favorites: s.stored.favoriteOption && s.planFavourites, notes: s.notesAllowed, download: s.allowDownload, downloadAllFolder: zipOn },
      // Trial and Pro pick with a heart (no favourites); VIP picks with a tick and favourites with a heart.
      pickIcon: s.planFavourites ? ('tick' as const) : ('heart' as const),
      // A banner's button text isn't a caption, so banners show their title only.
      showcase: banners.map((b) => ({ imageUrl: fileUrls.public(b.imageFileId), title: b.title, subtitle: null })),
    }
  }

  async items(id: string, token: string | null, folderId: string, page: number): Promise<ClientItemsPage> {
    const s = await this.open(id, token)
    const folder = await this.prisma.selectionFolder.findFirst({ where: { id: folderId, selectionId: s.id }, select: { id: true } })
    if (!folder) throw notFound('Folder')
    const where = { selectionId: s.id, folderId, deletedAt: null }
    const [rows, total] = await Promise.all([
      this.prisma.photo.findMany({
        where,
        select: {
          id: true,
          folderId: true,
          clientFavorite: true,
          file: { select: { mimeType: true } },
          picks: { select: { id: true }, take: 1 },
          comments: { select: { text: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { position: 'asc' },
        skip: (page - 1) * CLIENT_PAGE_SIZE,
        take: CLIENT_PAGE_SIZE,
      }),
      this.prisma.photo.count({ where }),
    ])
    return {
      items: rows.map((p) => this.item(s, p, p.picks.length > 0, p.comments[0]?.text ?? null)),
      total,
      page,
      hasMore: page * CLIENT_PAGE_SIZE < total,
    }
  }

  /** The Selection tab: every picked photo or video, grouped by album in album order. */
  async selected(id: string, token: string | null): Promise<ClientSelectedDto> {
    const s = await this.open(id, token)
    const [rows, folders] = await Promise.all([
      this.prisma.photo.findMany({
        where: { selectionId: s.id, deletedAt: null, picks: { some: {} } },
        select: { id: true, folderId: true, clientFavorite: true, file: { select: { mimeType: true } }, comments: { select: { text: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
        orderBy: { position: 'asc' },
      }),
      this.prisma.selectionFolder.findMany({ where: { selectionId: s.id }, orderBy: [{ position: 'asc' }, { name: 'asc' }], select: { id: true, name: true } }),
    ])
    const order: { folderId: string | null; folderName: string }[] = [...folders.map((f) => ({ folderId: f.id as string | null, folderName: f.name })), { folderId: null, folderName: 'Other' }]
    const groups = order
      .map((g) => ({ ...g, items: rows.filter((p) => p.folderId === g.folderId).map((p) => this.item(s, p, true, p.comments[0]?.text ?? null)) }))
      .filter((g) => g.items.length > 0)
    return { groups, total: rows.length }
  }

  // ---------------------------------------------------------------- changes

  /** The family member the portal picks as: the customer (made if the selection has none). */
  private async clientMember(s: OpenGallery, tx: Tx) {
    if (s.members[0]) return s.members[0]
    return tx.selectionMember.create({ data: { selectionId: s.id, name: s.event.client.name, phone: s.event.client.phone } })
  }

  /**
   * Select / favourite / note one item, saved straight away. The selection row is locked so two
   * devices can't select past the limit together, or change it while it is being submitted.
   */
  async patchItem(id: string, token: string | null, itemId: string, body: z.output<typeof clientItemPatchSchema>): Promise<ClientItemResult> {
    const s = await this.open(id, token)
    this.selections.assertWritable(s)
    if (body.favorite !== undefined && !(s.stored.favoriteOption && s.planFavourites)) throw readOnly('Favourites are turned off for this gallery.')
    if (body.note !== undefined && !s.notesAllowed) throw readOnly('Notes are turned off for this gallery.')
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM selections WHERE id = ${s.id}::uuid FOR UPDATE`
      const fresh = await tx.selection.findUniqueOrThrow({ where: { id: s.id }, select: { status: true } })
      if (isSelectionLocked(fresh.status)) throw readOnly('This selection has been submitted and is now read-only.')
      const photo = await tx.photo.findFirst({ where: { id: itemId, selectionId: s.id, deletedAt: null }, include: { file: { select: { mimeType: true } } } })
      if (!photo) throw notFound('Photo')
      const member = await this.clientMember(s, tx)
      let firstPick = false
      if (body.selected !== undefined) {
        const already = (await tx.photoPick.count({ where: { photoId: photo.id } })) > 0
        if (body.selected && !already) {
          if (!s.stored.allowSelection) throw readOnly('Selecting photos is turned off for this gallery.')
          if (!canSelect(s, isVideoMime(photo.file.mimeType))) throw readOnly('Videos can be watched but not selected.')
          const picked = await this.pickedIds(s.id, tx)
          if (s.stored.limitOn && picked.size >= s.quota) {
            throw new AppError(HttpStatus.CONFLICT, ERROR_CODES.QUOTA_LOCKED, `You can select up to ${s.quota} photos`, undefined, { quota: s.quota })
          }
          await tx.photoPick.create({ data: { selectionId: s.id, photoId: photo.id, memberId: member.id } })
          firstPick = isSelectionUnshared(fresh.status) || fresh.status === 'SENT'
          if (firstPick) {
            await tx.selection.update({ where: { id: s.id }, data: { status: 'IN_PROGRESS' } })
            await writeLog(tx, s.id, 'CLIENT', 'Started picking')
          }
        } else if (!body.selected && already) {
          await tx.photoPick.deleteMany({ where: { photoId: photo.id } })
        }
      }
      if (body.favorite !== undefined && body.favorite !== photo.clientFavorite) {
        await tx.photo.update({ where: { id: photo.id }, data: { clientFavorite: body.favorite } })
      }
      let note: string | null | undefined
      if (body.note !== undefined) {
        // One note per photo from the customer: the new one replaces theirs.
        await tx.photoComment.deleteMany({ where: { photoId: photo.id, memberId: member.id } })
        note = body.note ? body.note : null
        if (note) await tx.photoComment.create({ data: { selectionId: s.id, photoId: photo.id, memberId: member.id, text: note } })
      }
      note ??= (await tx.photoComment.findFirst({ where: { photoId: photo.id }, orderBy: { createdAt: 'desc' } }))?.text ?? null
      await tx.selection.update({ where: { id: s.id }, data: { lastClientVisitAt: new Date() } })
      const picked = await this.pickedIds(s.id, tx)
      const favorites = await tx.photo.count({ where: { selectionId: s.id, deletedAt: null, clientFavorite: true } })
      const folderSelected = photo.folderId
        ? (await tx.photo.findMany({ where: { selectionId: s.id, folderId: photo.folderId, deletedAt: null }, select: { id: true } })).filter((p) => picked.has(p.id)).length
        : 0
      const updated = { ...photo, clientFavorite: body.favorite ?? photo.clientFavorite }
      return {
        firstPick,
        out: {
          item: this.item(s, updated, picked.has(photo.id), note),
          counts: { selected: picked.size, favorites },
          folder: photo.folderId ? { id: photo.folderId, selected: folderSelected } : null,
        },
      }
    })
    if (result.firstPick) {
      await this.notifications.notify(s.studioId, {
        type: 'SELECTION_PICK',
        title: s.event.client.name,
        body: `started picking photos for ${s.event.title}`,
        link: `/photo-selection/${s.id}`,
        icon: 'images',
      })
    }
    return result.out
  }

  async submit(id: string, token: string | null) {
    const s = await this.open(id, token)
    await this.selections.submitFrom(s)
    return this.view(id, token)
  }

  // ---------------------------------------------------------------- files

  /** A photo's client preview (resized, watermarked when on), or a video (with byte ranges, so it can seek). */
  async sendFile(id: string, token: string | null, itemId: string, req: Request, res: Response) {
    const s = await this.open(id, token)
    const photo = await this.prisma.photo.findFirst({ where: { id: itemId, selectionId: s.id, deletedAt: null }, include: { file: true } })
    if (!photo) throw notFound('Photo')
    if (isVideoMime(photo.file.mimeType)) return this.sendVideo(req, res, photo.file)
    const preview = await this.previews.previewFor(photo.id, this.selections.watermarkFor(s, s.studio.name), this.selections.previewPx(s))
    if (!preview) throw notFound('Photo')
    await this.files.send(res, preview)
  }

  async download(id: string, token: string | null, itemId: string, res: Response) {
    const s = await this.open(id, token)
    const out = await this.selections.downloadFrom(s, itemId, { videos: true })
    if (!out.buffer) return this.files.send(res, out.file, { download: true })
    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Content-Length', String(out.buffer.length))
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Disposition', `attachment; filename="${(out.name ?? 'photo.jpg').replace(/[^\w.\- ]/g, '_')}"`)
    res.end(out.buffer)
  }

  async folderZip(id: string, token: string | null, folderId: string, res: Response) {
    const s = await this.open(id, token)
    return this.selections.folderZipFrom(s, folderId, res)
  }

  private async sendVideo(req: Request, res: Response, file: StoredFile) {
    if (file.deletedAt) throw notFound('File')
    const size = file.size
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''))
    let range: { start: number; end: number } | undefined
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
      const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
      if (start >= size || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${size}`)
        return res.end()
      }
      range = { start, end }
    }
    const stream = await this.storage.open(file.storageKey, range)
    if (!stream) throw notFound('File')
    res.setHeader('Content-Type', file.mimeType)
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.setHeader('Content-Disposition', 'inline')
    if (range) {
      res.status(206)
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
      res.setHeader('Content-Length', String(range.end - range.start + 1))
    } else {
      res.setHeader('Content-Length', String(size))
    }
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  }
}
