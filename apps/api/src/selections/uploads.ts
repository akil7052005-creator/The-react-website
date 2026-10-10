import { randomUUID } from 'node:crypto'
import { Body, Controller, HttpCode, HttpStatus, Injectable, Param, Post, Put, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import {
  ERROR_CODES,
  isSelectionLocked,
  MAX_PREVIEW_BYTES,
  uploadCompleteSchema,
  uploadSignSchema,
  type UploadComplete,
  type UploadCompleteDto,
  type UploadSign,
  type UploadSignDto,
} from '@weddyzone/shared'
import type { Request } from 'express'
import { Public, StudioId } from '../auth/auth.decorators'
import { AppError, badRequest, fileInvalid } from '../common/errors'
import { zod } from '../common/zod'
import { config } from '../config'
import { previewKey, readLocalUploadToken, StorageService, thumbKey } from '../infra/storage.service'
import { UsageService } from '../core/usage.service'
import { PrismaService } from '../prisma/prisma.service'
import { PhotoPreviewService } from './previews.service'
import { SelectionsService } from './selections.service'
import { renewToUpload, UploadLimitsService } from './upload-limits'

// Photo uploads, previews only. The browser makes a 2048 px preview and a 400 px thumbnail of each
// photo and asks /uploads/sign for two signed links; it PUTs both straight to storage (R2), then
// calls /uploads/complete. Only then, after the server has checked both objects exist with the
// sizes declared (and no more than 2 MB), is the photo recorded and counted. The original never
// leaves the studio's computer: only its name, path, size, pixel size and SHA-256 are kept.

const readOnly = (message: string) => new AppError(HttpStatus.CONFLICT, ERROR_CODES.READ_ONLY, message)

const MIME = { webp: 'image/webp', jpeg: 'image/jpeg' } as const
const EXT = { webp: 'webp', jpeg: 'jpg' } as const

/** "Wedding/Haldi/IMG_1.jpg" → "Wedding/Haldi" (null for a loose file), each name at most 255 characters. */
export function folderOfPath(relativePath: string): string | null {
  const parts = relativePath.replace(/\\/g, '/').split('/').map((p) => p.trim()).filter((p) => p && p !== '.')
  if (parts.some((p) => p === '..' || p.length > 255)) throw badRequest('Invalid folder path', { relativePath: 'Invalid folder path' })
  return parts.length > 1 ? parts.slice(0, -1).join('/') : null
}

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly selections: SelectionsService,
    private readonly limits: UploadLimitsService,
    private readonly previews: PhotoPreviewService,
    private readonly usage: UsageService,
  ) {}

  /** The selection, writable, on a plan that may upload. */
  private async writable(studioId: string, selectionId: string) {
    const s = await this.selections.find(studioId, selectionId)
    if (isSelectionLocked(s.status)) throw readOnly('This selection was submitted — photos can no longer be added.')
    const limits = await this.limits.forStudio(studioId)
    if (limits.readOnly) throw renewToUpload(limits)
    return s
  }

  private async checkFolder(selectionId: string, folderId: string | null | undefined) {
    if (!folderId) return
    const f = await this.prisma.selectionFolder.findFirst({ where: { id: folderId, selectionId } })
    if (!f) throw badRequest('Folder not found', { folderId: 'Choose one of this selection’s folders' })
    if (f.type !== 'photo') throw fileInvalid(`${f.name} is a video folder — photos go in a photo folder`)
  }

  /** The photo already in this event with the same path and fingerprint, if any. */
  private duplicateOf(selectionId: string, b: Pick<UploadSign, 'sha256' | 'relativePath'>) {
    return this.prisma.photo.findFirst({ where: { selectionId, deletedAt: null, sha256: b.sha256, relativePath: b.relativePath }, select: { id: true } })
  }

  async sign(studioId: string, b: UploadSign): Promise<UploadSignDto> {
    const s = await this.writable(studioId, b.selectionId)
    folderOfPath(b.relativePath)
    await this.checkFolder(s.id, b.folderId)
    const dup = await this.duplicateOf(s.id, b)
    if (dup) return { duplicate: true, photoId: dup.id }
    await this.usage.assertCanUpload(studioId, s.id, b.originalSize)
    const photoId = b.photoId ?? randomUUID()
    // A resumed upload may ask again for a photo that was completed meanwhile.
    const done = await this.prisma.photo.findFirst({ where: { id: photoId }, select: { id: true, selectionId: true } })
    if (done) {
      if (done.selectionId !== s.id) throw badRequest('This upload belongs to another selection')
      return { duplicate: true, photoId }
    }
    const [preview, thumb] = await Promise.all([
      this.storage.signPut(previewKey(s.eventId, photoId, EXT[b.format]), MIME[b.format], b.previewSize),
      this.storage.signPut(thumbKey(s.eventId, photoId, EXT[b.format]), MIME[b.format], b.thumbSize),
    ])
    return { duplicate: false, photoId, preview, thumb }
  }

  /**
   * Records the photo once both copies are in storage with the declared sizes. A copy that is
   * missing is reported (the browser uploads it again); one that is too large or the wrong size is
   * deleted and refused.
   */
  async complete(studioId: string, b: UploadComplete): Promise<UploadCompleteDto> {
    const existing = await this.prisma.photo.findFirst({ where: { id: b.photoId }, select: { id: true, selectionId: true } })
    if (existing) {
      if (existing.selectionId !== b.selectionId) throw badRequest('This upload belongs to another selection')
      return { id: existing.id, existing: true }
    }
    const s = await this.writable(studioId, b.selectionId)
    const folder = folderOfPath(b.relativePath)
    await this.checkFolder(s.id, b.folderId)
    const keys = { preview: previewKey(s.eventId, b.photoId, EXT[b.format]), thumb: thumbKey(s.eventId, b.photoId, EXT[b.format]) }
    const declared = { preview: b.previewSize, thumb: b.thumbSize }
    for (const which of ['preview', 'thumb'] as const) {
      const size = await this.storage.size(keys[which])
      if (size === null) throw new AppError(HttpStatus.CONFLICT, ERROR_CODES.CONFLICT, `The ${which === 'preview' ? 'preview' : 'thumbnail'} hasn't finished uploading`, { file: 'Upload incomplete' }, { missing: which })
      if (size > MAX_PREVIEW_BYTES || size !== declared[which]) {
        await Promise.all([this.storage.remove(keys.preview), this.storage.remove(keys.thumb)])
        throw fileInvalid(size > MAX_PREVIEW_BYTES ? 'Larger than 2 MB — only previews are stored online' : 'The upload changed on the way — try again')
      }
    }

    const mimeType = MIME[b.format]
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM selections WHERE id = ${s.id}::uuid FOR UPDATE`
        const dup = await tx.photo.findFirst({ where: { selectionId: s.id, deletedAt: null, sha256: b.sha256, relativePath: b.relativePath }, select: { id: true } })
        if (dup) return { id: dup.id, existing: true, orphan: true }
        await this.usage.assertCanUpload(studioId, s.id, b.originalSize, tx)
        const last = await tx.photo.findFirst({ where: { selectionId: s.id }, orderBy: { position: 'desc' } })
        const folderId = await this.selections.resolveFolder(tx, s.id, 'photo', b.folderId, folder)
        const name = b.originalName.slice(0, 200)
        const preview = await tx.storedFile.create({ data: { studioId, kind: 'PHOTO', storageKey: keys.preview, originalName: name, mimeType, size: b.previewSize, checksum: b.sha256 } })
        const thumb = await tx.storedFile.create({ data: { studioId, kind: 'PHOTO', storageKey: keys.thumb, originalName: name, mimeType, size: b.thumbSize, checksum: `thumb:${b.sha256}` } })
        await tx.photo.create({
          data: {
            id: b.photoId,
            studioId,
            eventId: s.eventId,
            selectionId: s.id,
            fileId: preview.id,
            thumbFileId: thumb.id,
            position: (last?.position ?? -1) + 1,
            folder,
            folderId,
            compressed: true,
            originalName: b.originalName,
            originalSize: b.originalSize <= 2_147_483_647 ? b.originalSize : null,
            originalWidth: b.originalWidth ?? null,
            originalHeight: b.originalHeight ?? null,
            relativePath: b.relativePath,
            lastModified: b.lastModified ? new Date(b.lastModified) : null,
            sha256: b.sha256,
            format: b.format,
          },
        })
        // The first photo moves a new selection from Draft to Uploading (until it is shared).
        await tx.selection.updateMany({ where: { id: s.id, status: 'DRAFT' }, data: { status: 'UPLOADING' } })
        return { id: b.photoId, existing: false, orphan: false }
      },
      { timeout: 30_000, maxWait: 30_000 },
    )
    // Uploaded twice in parallel: this copy lost the race, its objects aren't used.
    if (result.orphan) await Promise.all([this.storage.remove(keys.preview), this.storage.remove(keys.thumb)])
    else this.previews.queue(result.id, this.selections.watermarkFor(s, await this.selections.studioName(studioId)))
    return { id: result.id, existing: result.existing }
  }

  /** Development / tests only: the browser's PUT for a local signed link. */
  async putLocal(token: string, req: Request) {
    const t = readLocalUploadToken(token)
    if (!t) throw new AppError(HttpStatus.FORBIDDEN, ERROR_CODES.FORBIDDEN, 'Upload link expired or invalid')
    const chunks: Buffer[] = []
    let size = 0
    for await (const c of req as AsyncIterable<Buffer>) {
      size += c.length
      if (size > t.size || size > MAX_PREVIEW_BYTES) throw fileInvalid('Larger than the signed size')
      chunks.push(c)
    }
    if (size !== t.size) throw fileInvalid('Smaller than the signed size')
    await this.storage.saveAt(t.key, Buffer.concat(chunks), t.contentType)
  }
}

@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /** Two signed links (preview + thumbnail) for one photo, valid 15 minutes; or "duplicate". */
  @Throttle({ default: { limit: config().RATE_LIMIT_UPLOADS_PER_MIN, ttl: 60_000 } })
  @Post('sign')
  @HttpCode(200)
  sign(@StudioId() studioId: string, @Body(zod(uploadSignSchema)) body: UploadSign) {
    return this.uploads.sign(studioId, body)
  }

  /** Both copies are uploaded: checks them and records the photo. */
  @Throttle({ default: { limit: config().RATE_LIMIT_UPLOADS_PER_MIN, ttl: 60_000 } })
  @Post('complete')
  @HttpCode(200)
  complete(@StudioId() studioId: string, @Body(zod(uploadCompleteSchema)) body: UploadComplete) {
    return this.uploads.complete(studioId, body)
  }

  /** Local storage only (no bucket configured): stands in for the bucket's signed PUT. */
  @Public()
  @Throttle({ default: { limit: config().RATE_LIMIT_UPLOADS_PER_MIN * 2, ttl: 60_000 } })
  @Put('local/:token')
  @HttpCode(200)
  async putLocal(@Param('token') token: string, @Req() req: Request) {
    if (config().S3_BUCKET) throw new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Not found')
    await this.uploads.putLocal(token, req)
    return { ok: true }
  }
}
