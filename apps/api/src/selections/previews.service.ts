import { createHash } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import type { StoredFile } from '@prisma/client'
import { CUSTOMER_COPY_PX, CUSTOMER_COPY_QUALITY, watermarkBox, type WatermarkPosition } from '@weddyzone/shared'
import sharp from 'sharp'
import type { Readable } from 'stream'
import { sha256 } from '../common/util'
import { StorageService } from '../infra/storage.service'
import { PrismaService } from '../prisma/prisma.service'

// Client galleries never get the original file. They get a preview: at most PREVIEW_PX on the long
// side, JPEG, and with the event's watermark when it is on (the uploaded logo, or the studio name
// as text, placed by the event's position, size, spacing and opacity). The preview is made once
// (right after upload, or on first view) and stored; the stored name carries a hash of the
// watermark, so a changed watermark makes a new preview.

export const PREVIEW_PX = CUSTOMER_COPY_PX
/** Previews when the event's "Show photos in high quality" is off. */
export const LIGHT_PREVIEW_PX = 1280
/**
 * JPEG settings for client images: quality 82 with the standard (IJG) tables, so it is a true 82,
 * plus mozjpeg's lossless size savings (trellis quantisation, optimised scans) — about 20% smaller.
 */
const jpegFor = (quality: number) => ({ quality, progressive: true, mozjpeg: true, quantisationTable: 0 })
/** Bumped when the encoding changes, so previews made the old way are remade on next view. */
const ENCODING = 'm1'
/** Previews made at once. Decoding a 100 MB photo takes a lot of memory. */
const CONCURRENCY = 2

sharp.cache(false)
sharp.concurrency(1)

/** What to stamp on a photo. */
export interface WatermarkSpec {
  /** The event's logo (a PNG), or null to write `text`. */
  logoFileId: string | null
  text: string
  position: WatermarkPosition
  sizePct: number
  spacingPct: number
  opacityPct: number
}

export const watermarkHash = (w: WatermarkSpec | null) =>
  w ? createHash('sha1').update(JSON.stringify([w.logoFileId, w.text, w.position, w.sizePct, w.spacingPct, w.opacityPct])).digest('hex').slice(0, 10) : 'none'

/** Watermark, size and encoding of a preview: a preview made any other way is stale and made again. */
const previewTag = (w: WatermarkSpec | null, px: number) => `${watermarkHash(w)}-${px}-${ENCODING}`
/** Stored name of a preview: says which watermark and size it carries, so a stale one is noticed. */
const previewName = (w: WatermarkSpec | null, px: number, original: string) => `preview-${previewTag(w, px)}:${original}`.slice(0, 200)
export const isPreviewFor = (file: Pick<StoredFile, 'originalName'>, w: WatermarkSpec | null, px = PREVIEW_PX) => file.originalName.startsWith(`preview-${previewTag(w, px)}:`)

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!)
}

/** The text mark: an SVG sized to the box, the studio name filling its width. */
function textMark(text: string, width: number, height: number, opacity: number) {
  const label = escapeXml(text.slice(0, 40))
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <text x="50%" y="72%" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700"
        font-size="${Math.round(height * 0.72)}" textLength="${Math.round(width * 0.96)}" lengthAdjust="spacingAndGlyphs"
        fill="#ffffff" fill-opacity="${opacity}" stroke="#000000" stroke-opacity="${opacity * 0.35}" stroke-width="1">${label}</text>
    </svg>`,
  )
}

/** Text proportions: about 0.6 of the font size per character, 1.3 tall. */
const textAspect = (text: string) => ({ width: Math.max(4, text.slice(0, 40).length) * 0.6, height: 1.3 })

/** The logo, resized to `width`, with its alpha scaled by `opacity`. */
async function logoMark(logo: Buffer, width: number, opacity: number) {
  const { data, info } = await sharp(logo).resize({ width }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i] * opacity)
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()
}

/**
 * Stamps the watermark onto an already-decoded image. `logo` is the logo's bytes when the spec
 * has one. Returns a sharp pipeline for the caller to encode.
 */
export async function applyWatermark(img: { data: Buffer; width: number; height: number }, w: WatermarkSpec, logo: Buffer | null) {
  const opacity = Math.min(1, Math.max(0.1, w.opacityPct / 100))
  let mark: Buffer
  let box: ReturnType<typeof watermarkBox>
  if (logo) {
    const meta = await sharp(logo).metadata()
    box = watermarkBox(img, { width: meta.width ?? 1, height: meta.height ?? 1 }, w)
    mark = await logoMark(logo, box.width, opacity)
    const m = await sharp(mark).metadata()
    box = { ...box, height: m.height ?? box.height }
  } else {
    box = watermarkBox(img, textAspect(w.text), w)
    mark = textMark(w.text, box.width, box.height, opacity)
  }
  return sharp(img.data).composite([{ input: mark, left: box.left, top: box.top }])
}

/** Resized (and maybe watermarked) JPEG of an image. `maxPx` null keeps the full size. */
export async function renderImage(input: Buffer, w: WatermarkSpec | null, logo: Buffer | null, maxPx: number | null = PREVIEW_PX) {
  let base = sharp(input, { failOn: 'none', limitInputPixels: 300_000_000 }).rotate()
  if (maxPx) base = base.resize({ width: maxPx, height: maxPx, fit: 'inside', withoutEnlargement: true })
  const resized = await base.toBuffer({ resolveWithObject: true })
  const img = w ? await applyWatermark({ data: resized.data, width: resized.info.width, height: resized.info.height }, w, logo) : sharp(resized.data)
  return img.jpeg(jpegFor(maxPx ? CUSTOMER_COPY_QUALITY : 92)).toBuffer()
}

export async function readAll(stream: Readable) {
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

  /** The bytes of a stored file (e.g. the logo), or null. */
  async bytes(fileId: string | null): Promise<Buffer | null> {
    if (!fileId) return null
    const f = await this.prisma.storedFile.findUnique({ where: { id: fileId } })
    if (!f || f.deletedAt) return null
    const stream = await this.storage.open(f.storageKey)
    return stream ? readAll(stream) : null
  }

  /**
   * The preview for a photo, made now if missing or stale. null when the original can't be read as
   * an image (callers then refuse).
   */
  async previewFor(photoId: string, watermark: WatermarkSpec | null, px = PREVIEW_PX): Promise<StoredFile | null> {
    const key = `${photoId}:${previewTag(watermark, px)}`
    let p = this.inFlight.get(key)
    if (!p) {
      p = this.make(photoId, watermark, px).finally(() => this.inFlight.delete(key))
      this.inFlight.set(key, p)
    }
    return p
  }

  /**
   * What a client download gets: the original (or a 1600 px copy without the Original Quality
   * add-on), watermarked when the event says so. Rendered on request, not stored.
   */
  async downloadFor(file: StoredFile, watermark: WatermarkSpec | null, original: boolean): Promise<Buffer | null> {
    return this.slot(async () => {
      const stream = await this.storage.open(file.storageKey)
      if (!stream) return null
      const input = await readAll(stream)
      if (!watermark && original) return input
      return renderImage(input, watermark, await this.bytes(watermark?.logoFileId ?? null), original ? null : PREVIEW_PX)
    })
  }

  private async make(photoId: string, watermark: WatermarkSpec | null, px: number): Promise<StoredFile | null> {
    const photo = await this.prisma.photo.findUnique({ where: { id: photoId }, include: { file: true, preview: true } })
    if (!photo || photo.file.deletedAt) return null
    if (photo.preview && !photo.preview.deletedAt && isPreviewFor(photo.preview, watermark, px)) return photo.preview
    return this.slot(async () => {
      try {
        const stream = await this.storage.open(photo.file.storageKey)
        if (!stream) return null
        const out = await renderImage(await readAll(stream), watermark, await this.bytes(watermark?.logoFileId ?? null), px)
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
                  originalName: previewName(watermark, px, photo.file.originalName),
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
  queue(photoId: string, watermark: WatermarkSpec | null) {
    void this.previewFor(photoId, watermark).catch(() => undefined)
  }

  /** The watermark changed: drop the stored previews of a selection so they are made again. */
  async clear(selectionId: string) {
    const photos = await this.prisma.photo.findMany({ where: { selectionId, previewFileId: { not: null } }, select: { id: true, previewFileId: true } })
    if (!photos.length) return
    await this.prisma.$transaction([
      this.prisma.storedFile.updateMany({ where: { id: { in: photos.map((p) => p.previewFileId!) } }, data: { deletedAt: new Date() } }),
      this.prisma.photo.updateMany({ where: { id: { in: photos.map((p) => p.id) } }, data: { previewFileId: null } }),
    ])
  }
}
