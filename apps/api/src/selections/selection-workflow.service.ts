import { Injectable, Logger } from '@nestjs/common'
import archiver from 'archiver'
import type { Response } from 'express'
import {
  isSelectionLocked,
  resolveSelectionDefaults,
  type SelectionAccessInput,
  type SelectionDefaultsDto,
  type SelectionFolderDto,
  type SelectionOverviewDto,
} from '@weddyzone/shared'
import { badRequest, conflict, notFound } from '../common/errors'
import { selectionStatus } from '../core/mappers'
import { StorageService } from '../infra/storage.service'
import { PrismaService } from '../prisma/prisma.service'
import { hashPin } from './gallery-access'
import { PhotoPreviewService } from './previews.service'
import { logDto, REOPENED_ACTION, REOPENED_AFTER_DOWNLOAD_ACTION, RESET_ACTIONS, writeLog } from './selection-log'
import { GENERAL_FOLDER, SelectionsService } from './selections.service'

export type ResetMode = 'shortlist' | 'reject'
/** Log actions of the two resets; the dashboard's Client Activity lists them too. */
export { REOPENED_ACTION, RESET_ACTIONS }

const cleanZipPart = (v: string) => v.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'photo'

/** Unique entry names inside a ZIP: a second IMG_1.jpg in the same folder becomes "IMG_1 (2).jpg". */
export function zipNames(items: { folder: string | null; name: string }[]) {
  const seen = new Map<string, number>()
  return items.map(({ folder, name }) => {
    const path = (folder ? `${cleanZipPart(folder)}/` : '') + cleanZipPart(name)
    const n = (seen.get(path.toLowerCase()) ?? 0) + 1
    seen.set(path.toLowerCase(), n)
    if (n === 1) return path
    const dot = path.lastIndexOf('.')
    return dot > path.lastIndexOf('/') ? `${path.slice(0, dot)} (${n})${path.slice(dot)}` : `${path} (${n})`
  })
}

/**
 * The event page around a selection: folders, gallery access (PIN, downloads, watermark, notes),
 * unlock / reset / delivered with a change log, ZIP export and the studio's defaults.
 */
@Injectable()
export class SelectionWorkflowService {
  private readonly logger = new Logger(SelectionWorkflowService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly selections: SelectionsService,
    private readonly previews: PhotoPreviewService,
    private readonly storage: StorageService,
  ) {}

  // ---------------------------------------------------------------- overview

  async overview(studioId: string, id: string): Promise<SelectionOverviewDto> {
    const selection = await this.selections.dto(studioId, id)
    const [folders, noteCount, log] = await Promise.all([
      this.folders(studioId, id),
      this.prisma.photoComment.count({ where: { selectionId: id, photo: { deletedAt: null } } }),
      this.prisma.selectionLog.findMany({ where: { selectionId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ])
    return { selection, folders, noteCount, log: log.map(logDto) }
  }

  // ---------------------------------------------------------------- folders

  async folders(studioId: string, id: string): Promise<SelectionFolderDto[]> {
    await this.selections.find(studioId, id)
    const [folders, photos, videos, picked] = await Promise.all([
      this.prisma.selectionFolder.findMany({ where: { selectionId: id }, orderBy: [{ position: 'asc' }, { name: 'asc' }] }),
      this.prisma.photo.groupBy({ by: ['folderId'], where: { selectionId: id, deletedAt: null, file: { mimeType: { startsWith: 'image/' } } }, _count: true }),
      this.prisma.photo.groupBy({ by: ['folderId'], where: { selectionId: id, deletedAt: null, file: { mimeType: { startsWith: 'video/' } } }, _count: true }),
      this.prisma.$queryRaw<{ folder_id: string | null; n: bigint }[]>`
        SELECT p.folder_id, COUNT(DISTINCT k.photo_id) AS n FROM photo_picks k
        JOIN photos p ON p.id = k.photo_id AND p.deleted_at IS NULL
        WHERE k.selection_id = ${id}::uuid GROUP BY p.folder_id`,
    ])
    const count = new Map(photos.map((r) => [r.folderId, r._count]))
    const videoCount = new Map(videos.map((r) => [r.folderId, r._count]))
    const picks = new Map(picked.map((r) => [r.folder_id, Number(r.n)]))
    return folders.map((f) => ({
      id: f.id,
      name: f.name,
      position: f.position,
      photoCount: count.get(f.id) ?? 0,
      pickedCount: picks.get(f.id) ?? 0,
      videoCount: videoCount.get(f.id) ?? 0,
      type: f.type === 'video' ? ('video' as const) : ('photo' as const),
    }))
  }

  private async assertFolderName(selectionId: string, name: string, exceptId?: string) {
    const clash = await this.prisma.selectionFolder.findFirst({
      where: { selectionId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    })
    if (clash) throw conflict('A folder with this name already exists', { name: 'A folder with this name already exists' })
  }

  async createFolder(studioId: string, id: string, name: string, type: 'photo' | 'video' = 'photo'): Promise<SelectionFolderDto> {
    await this.selections.find(studioId, id)
    await this.assertFolderName(id, name)
    const position = await this.prisma.selectionFolder.count({ where: { selectionId: id } })
    const f = await this.prisma.selectionFolder.create({ data: { selectionId: id, name, position, type } })
    return { id: f.id, name: f.name, position: f.position, photoCount: 0, pickedCount: 0, videoCount: 0, type }
  }

  async renameFolder(studioId: string, id: string, folderId: string, name: string) {
    await this.selections.find(studioId, id)
    const f = await this.prisma.selectionFolder.findFirst({ where: { id: folderId, selectionId: id } })
    if (!f) throw notFound('Folder')
    await this.assertFolderName(id, name, folderId)
    await this.prisma.selectionFolder.update({ where: { id: folderId }, data: { name } })
    return (await this.folders(studioId, id)).find((x) => x.id === folderId)!
  }

  /** Deletes a folder. Its photos are kept and move to General. */
  async deleteFolder(studioId: string, id: string, folderId: string) {
    await this.selections.find(studioId, id)
    const f = await this.prisma.selectionFolder.findFirst({ where: { id: folderId, selectionId: id } })
    if (!f) throw notFound('Folder')
    const moved = await this.prisma.photo.count({ where: { folderId, deletedAt: null } })
    if (f.name === GENERAL_FOLDER && moved > 0) throw badRequest('Move the photos out of General before deleting it.')
    await this.prisma.$transaction(async (tx) => {
      if (moved > 0) {
        const general =
          (await tx.selectionFolder.findFirst({ where: { selectionId: id, name: GENERAL_FOLDER } })) ??
          (await tx.selectionFolder.create({
            data: { selectionId: id, name: GENERAL_FOLDER, position: await tx.selectionFolder.count({ where: { selectionId: id } }) },
          }))
        await tx.photo.updateMany({ where: { folderId }, data: { folderId: general.id } })
      }
      await tx.selectionFolder.delete({ where: { id: folderId } })
    })
    return { ok: true, moved }
  }

  async movePhotos(studioId: string, id: string, photoIds: string[], folderId: string) {
    await this.selections.find(studioId, id)
    const f = await this.prisma.selectionFolder.findFirst({ where: { id: folderId, selectionId: id } })
    if (!f) throw notFound('Folder')
    const r = await this.prisma.photo.updateMany({ where: { id: { in: photoIds }, selectionId: id, deletedAt: null }, data: { folderId } })
    return { moved: r.count }
  }

  // ---------------------------------------------------------------- access

  async updateAccess(studioId: string, id: string, body: Omit<SelectionAccessInput, 'pin'> & { pin?: string | null }) {
    const s = await this.selections.find(studioId, id)
    const data: Record<string, unknown> = {}
    const changes: string[] = []
    if (body.pin !== undefined) {
      data.pinHash = body.pin ? hashPin(id, body.pin) : null
      data.pinFailures = 0
      data.pinLockedUntil = null
      changes.push(body.pin ? (s.pinHash ? 'PIN changed' : 'PIN set') : 'PIN removed')
    }
    for (const [k, on, off] of [
      ['allowDownload', 'downloads on', 'downloads off'],
      ['watermark', 'watermark on', 'watermark off'],
      ['notesAllowed', 'notes on', 'notes off'],
    ] as const) {
      const v = body[k]
      if (v !== undefined && v !== s[k]) {
        data[k] = v
        changes.push(v ? on : off)
      }
    }
    if (!changes.length) return this.selections.dto(studioId, id)
    await this.prisma.selection.update({ where: { id }, data })
    if (data.watermark !== undefined) await this.previews.clear(id)
    await writeLog(this.prisma, id, 'STUDIO', 'Gallery access changed', changes.join(' · '))
    return this.selections.dto(studioId, id)
  }

  // ---------------------------------------------------------------- unlock / reset / delivered

  /** Reopens a submitted selection so the client can change picks (shown as Pending). Logged with the reason. */
  async unlock(studioId: string, id: string, reason?: string | null) {
    const s = await this.selections.find(studioId, id)
    if (s.status !== 'SUBMITTED') throw badRequest('Only a submitted selection can be unlocked.')
    if (selectionStatus({ ...s, status: 'IN_PROGRESS' }) === 'EXPIRED') {
      throw badRequest('The gallery expiry has passed. Extend it before unlocking.', { deadline: 'Extend the gallery expiry' })
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.selection.update({ where: { id }, data: { status: 'IN_PROGRESS', submittedAt: null, reopenedAt: new Date() } })
      await writeLog(tx, id, 'STUDIO', 'Unlocked', reason || null)
    })
    return this.selections.dto(studioId, id)
  }

  /**
   * Reset Selection, two ways, both reopening the selection for the client (shown as Pending until
   * they submit again):
   * - shortlist: the client's picks stay, so they can change them and submit again;
   * - reject: every pick is cleared (the photos and notes are kept).
   * A Downloaded (delivered) selection reopens the same way as a Selected one; it is no longer
   * marked downloaded, and its event goes back to awaiting selection. Logged so it shows in Client Activity.
   */
  async resetPicks(studioId: string, id: string, mode: ResetMode = 'reject') {
    const s = await this.selections.find(studioId, id)
    const delivered = s.status === 'DELIVERED'
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM selections WHERE id = ${id}::uuid FOR UPDATE`
      const kept = mode === 'shortlist' ? (await this.selections.pickCounts([id])).picked.get(id) ?? 0 : 0
      const cleared = mode === 'reject' ? (await tx.photoPick.deleteMany({ where: { selectionId: id } })).count : 0
      const reopen =
        s.status === 'IN_PROGRESS' || s.status === 'SUBMITTED' || delivered
          ? { status: 'SENT' as const, submittedAt: null, ...(delivered ? { deliveredAt: null } : {}) }
          : {}
      await tx.selection.update({ where: { id }, data: { ...reopen, reopenedAt: new Date() } })
      // Mark delivered moved the event to DELIVERED: back to waiting for the client's selection.
      if (delivered) await tx.event.updateMany({ where: { id: s.eventId, status: 'DELIVERED' }, data: { status: 'AWAITING_SELECTION' } })
      const n = (k: number) => `${k} photo${k === 1 ? '' : 's'}`
      // After a download the earlier "Delivered" / "Downloaded ZIP" entries stay in the log; this one
      // also says when it had been downloaded.
      const downloaded = delivered && s.deliveredAt ? ` · downloaded ${s.deliveredAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}` : ''
      await writeLog(
        tx,
        id,
        'STUDIO',
        delivered ? REOPENED_AFTER_DOWNLOAD_ACTION : REOPENED_ACTION,
        (mode === 'shortlist' ? `Shortlist · ${n(kept)} kept · status Pending` : `Reject all · ${n(cleared)} cleared · status Pending`) + downloaded,
      )
      return { cleared, kept }
    })
    return { ...result, mode, selection: await this.selections.dto(studioId, id) }
  }

  /** Shown as "Downloaded": set after the studio copies or downloads the picks. Repeating it is harmless. */
  async markDelivered(studioId: string, id: string) {
    const s = await this.selections.find(studioId, id)
    if (s.status === 'DELIVERED') return this.selections.dto(studioId, id)
    if (s.status !== 'SUBMITTED') throw badRequest('Mark as delivered after the client has submitted.')
    await this.prisma.$transaction(async (tx) => {
      await tx.selection.update({ where: { id }, data: { status: 'DELIVERED', deliveredAt: new Date() } })
      await tx.event.updateMany({ where: { id: s.eventId, status: { in: ['IN_PROGRESS', 'AWAITING_SELECTION'] } }, data: { status: 'DELIVERED' } })
      await writeLog(tx, id, 'STUDIO', 'Delivered')
    })
    return this.selections.dto(studioId, id)
  }

  // ---------------------------------------------------------------- studio defaults

  async defaults(studioId: string): Promise<SelectionDefaultsDto> {
    const s = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { selectionDefaults: true } })
    return resolveSelectionDefaults(s.selectionDefaults)
  }

  async saveDefaults(studioId: string, body: SelectionDefaultsDto): Promise<SelectionDefaultsDto> {
    const value = resolveSelectionDefaults(body)
    await this.prisma.studio.update({ where: { id: studioId }, data: { selectionDefaults: { ...value } } })
    return value
  }

  // ---------------------------------------------------------------- ZIP export

  /**
   * Streams the original photos as a ZIP, one folder per selection folder. scope 'picked' = the
   * client's picks only. Files are read one at a time, so memory stays flat for big galleries.
   */
  async streamZip(studioId: string, id: string, scope: 'picked' | 'all', folderId: string | undefined, res: Response) {
    const s = await this.selections.find(studioId, id)
    const photos = await this.prisma.photo.findMany({
      where: { selectionId: id, deletedAt: null, ...(folderId ? { folderId } : {}), ...(scope === 'picked' ? { picks: { some: {} } } : {}) },
      include: { file: true, folderRef: true },
      orderBy: { position: 'asc' },
    })
    if (!photos.length) throw badRequest(scope === 'picked' ? 'No picked photos to download yet.' : 'No photos to download.')
    // Previews carry the original's name; give each the extension of what it really is (WebP / JPEG).
    const asStored = (f: { originalName: string; mimeType: string }) => (f.mimeType === 'image/webp' ? f.originalName.replace(/\.[^.]+$/, '') + '.webp' : f.originalName)
    const names = zipNames(photos.map((p) => ({ folder: p.folderRef?.name ?? null, name: asStored(p.file) })))
    const base = (scope === 'picked' ? `${s.event.title}-selected` : `${s.code}-${s.event.title}`)
      .replace(/[^\w-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${base || 'selected'}.zip"`)
    res.setHeader('Cache-Control', 'no-store')
    // The ZIP is streamed (no Content-Length); the files' total lets the browser show progress.
    res.setHeader('X-Total-Bytes', String(photos.reduce((n, p) => n + p.file.size, 0)))
    res.setHeader('Access-Control-Expose-Headers', 'X-Total-Bytes, Content-Disposition')
    // Previews are already compressed: store them as they are (fast, same size).
    const zip = archiver('zip', { store: true })
    zip.on('warning', (e) => this.logger.warn(`ZIP ${s.code}: ${e.message}`))
    zip.on('error', (e) => {
      this.logger.error(`ZIP ${s.code} failed: ${e.message}`)
      res.destroy(e)
    })
    zip.pipe(res)
    for (let i = 0; i < photos.length; i++) {
      const stream = await this.storage.open(photos[i].file.storageKey)
      if (!stream) continue
      // Wait for this entry before opening the next file: one open file at a time.
      const done = new Promise<void>((resolve, reject) => {
        zip.once('entry', () => resolve())
        stream.once('error', reject)
      })
      zip.append(stream, { name: names[i], date: photos[i].createdAt })
      await done
    }
    await zip.finalize()
    await writeLog(this.prisma, id, 'STUDIO', 'Downloaded ZIP', `${photos.length} ${scope === 'picked' ? 'picked ' : ''}photo${photos.length === 1 ? '' : 's'}`)
  }
}
