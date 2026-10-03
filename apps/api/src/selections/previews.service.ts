import { Injectable, Logger } from '@nestjs/common'
import type { StoredFile } from '@prisma/client'
import sharp from 'sharp'
import type { Readable } from 'stream'
import { sha256 } from '../common/util'
import { StorageService } from '../infra/storage.service'
import { PrismaService } from '../prisma/prisma.service'

// Client galleries never get the original file. They get a preview: at most PREVIEW_PX on the long
// side, JPEG, and with the studio's name tiled across it when the selection has a watermark. The
// preview is made once (right after upload, or on first view for older photos) and stored; changing
// the watermark setting clears the stored previews so they are made again.

export const PREVIEW_PX = 2048
/** Previews made at once. Decoding a 100 MB photo takes a lot of memory. */
const CONCURRENCY = 2

sharp.cache(false)
sharp.concurrency(1)

/** Stored name of a preview: says whether it carries the watermark, so a stale one is noticed. */
const previewName = (watermark: boolean, original: string) => `${watermark ? 'preview-wm' : 'preview'}:${original}`.slice(0, 200)
export const isPreviewFor = (file: Pick<StoredFile, 'originalName'>, watermark: boolean) => file.originalName.startsWith(watermark ? 'preview-wm:' : 'preview:')

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!)
}

/** A diagonal, repeating "© Studio" pattern the size of the image. */
export function watermarkSvg(width: number, height: number, text: string) {
  const size = Math.max(18, Math.round(Math.min(width, height) / 18))
  const label = escapeXml(`© ${text}`.slice(0, 60))
  const stepX = Math.round(size * Math.max(8, label.length * 0.7))
  const stepY = size * 5
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs><pattern id="p" width="${stepX}" height="${stepY}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
        <text x="0" y="${size}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="700"
          fill="#ffffff" fill-opacity="0.38" stroke="#000000" stroke-opacity="0.18" stroke-width="1">${label}</text>
      </pattern></defs>
      <rect width="100%" height="100%" fill="url(#p)"/>
    </svg>`,
  )
}

/** Resized (and maybe watermarked) JPEG of an image. */
export async function renderPreview(input: Buffer, watermark: string | null) {
  const resized = await sharp(input, { failOn: 'none', limitInputPixels: 300_000_000 })
    .rotate()
    .resize({ width: PREVIEW_PX, height: PREVIEW_PX, fit: 'inside', withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true })
  let img = sharp(resized.data)
  if (watermark) img = img.composite([{ input: watermarkSvg(resized.info.width, resized.info.height, watermark), top: 0, left: 0 }])
  return img.jpeg({ quality: 82, progressive: true }).toBuffer()
}

async function readAll(stream: Readable) {
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
  return Buffer.concat(chunks)
}

@Injectable()
export class PhotoPreviewService {
  private readonly logger = new Logger(PhotoPreviewService.name)
  private running = 0
  private readonly waiting: (() => void)[] = []
  /** One render per photo + watermark at a time, shared by everyone asking. */
  private readonly inFlight = new Map<string, Promise<StoredFile | null>>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= CONCURRENCY) await new Promise<void>((r) => this.waiting.push(r))
    this.running++
    try {
      return await fn()
    } finally {
      this.running--
      this.waiting.shift()?.()
    }
  }

  /**
   * The preview for a photo, made now if missing or stale. null when the original can't be read as
   * an image (callers then refuse, or fall back to the original when no watermark is needed).
   */
  async previewFor(photoId: string, watermark: string | null): Promise<StoredFile | null> {
    const key = `${photoId}:${watermark ?? ''}`
    let p = this.inFlight.get(key)
    if (!p) {
      p = this.make(photoId, watermark).finally(() => this.inFlight.delete(key))
      this.inFlight.set(key, p)
    }
    return p
  }

  private async make(photoId: string, watermark: string | null): Promise<StoredFile | null> {
    const photo = await this.prisma.photo.findUnique({ where: { id: photoId }, include: { file: true, preview: true } })
    if (!photo || photo.file.deletedAt) return null
    if (photo.preview && !photo.preview.deletedAt && isPreviewFor(photo.preview, !!watermark)) return photo.preview
    return this.slot(async () => {
      try {
        const stream = await this.storage.open(photo.file.storageKey)
        if (!stream) return null
        const out = await renderPreview(await readAll(stream), watermark)
        const storageKey = await this.storage.save(out, 'jpg', 'image/jpeg')
        // File row and link in one statement: an unlinked preview would count as studio storage.
        const updated = await this.prisma.$transaction(async (tx) => {
          if (photo.previewFileId) await tx.storedFile.update({ where: { id: photo.previewFileId }, data: { deletedAt: new Date() } })
          return tx.photo.update({
            where: { id: photo.id },
            data: {
              preview: {
                create: {
                  studio: { connect: { id: photo.file.studioId } },
                  kind: 'PHOTO',
                  storageKey,
                  originalName: previewName(!!watermark, photo.file.originalName),
                  mimeType: 'image/jpeg',
                  size: out.length,
                  checksum: sha256(out),
                },
              },
            },
            include: { preview: true },
          })
        })
        return updated.preview
      } catch (e) {
        this.logger.warn(`Preview failed for photo ${photo.id}: ${(e as Error).message}`)
        return null
      }
    })
  }

  /** Makes the preview in the background right after an upload, so the client never waits. */
  queue(photoId: string, watermark: string | null) {
    void this.previewFor(photoId, watermark).catch(() => undefined)
  }

  /** The watermark setting changed: drop the stored previews of a selection so they are made again. */
  async clear(selectionId: string) {
    const photos = await this.prisma.photo.findMany({ where: { selectionId, previewFileId: { not: null } }, select: { id: true, previewFileId: true } })
    if (!photos.length) return
    await this.prisma.$transaction([
      this.prisma.storedFile.updateMany({ where: { id: { in: photos.map((p) => p.previewFileId!) } }, data: { deletedAt: new Date() } }),
      this.prisma.photo.updateMany({ where: { id: { in: photos.map((p) => p.id) } }, data: { previewFileId: null } }),
    ])
  }
}
