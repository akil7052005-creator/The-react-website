// The two copies stored online for each photo, made in the browser: a 2048 px preview (WebP 80%,
// or JPEG 82% where the browser can't encode WebP) and a 400 px thumbnail (WebP 70% / JPEG 72%).
// Camera rotation is applied; re-encoding drops EXIF and GPS. Also the SHA-256 of the original,
// which never leaves the computer. Shared by the Web Worker (copies.worker.ts) and the main-thread
// fallback; uses OffscreenCanvas where there is one, else a <canvas>.

import { PREVIEW_EDGE_PX, PREVIEW_JPEG_QUALITY, PREVIEW_WEBP_QUALITY, THUMB_EDGE_PX, THUMB_JPEG_QUALITY, THUMB_WEBP_QUALITY } from '@weddyzone/shared'
import { jpegCandidates } from '../rawPreview'

export interface Copies {
  preview: Blob
  thumb: Blob
  /** What the browser could encode: both copies use the same format. */
  format: 'webp' | 'jpeg'
  /** The original's pixel size, or null when only a RAW file's embedded preview could be read. */
  originalWidth: number | null
  originalHeight: number | null
  /** SHA-256 (hex) of the original file. */
  sha256: string
}

/** The file couldn't be read as an image (and had no usable embedded preview). */
export class Undecodable extends Error {
  constructor() {
    super('This photo could not be read')
    this.name = 'Undecodable'
  }
}

/** The pixel size that fits `maxEdge` on the long side (never enlarged). */
export function fitWithin(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function decode(blob: Blob): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch {
    return null
  }
}

/** The biggest JPEG preview inside a RAW file that decodes, or null. */
async function embeddedPreview(bytes: Uint8Array): Promise<ImageBitmap | null> {
  let best: ImageBitmap | null = null
  for (const [s, e] of jpegCandidates(bytes)) {
    const bmp = await decode(new Blob([bytes.slice(s, e)], { type: 'image/jpeg' }))
    if (!bmp) continue
    if (!best || bmp.width * bmp.height > best.width * best.height) {
      best?.close()
      best = bmp
    } else bmp.close()
    // A preview this big is the camera's full-size one: stop looking.
    if (Math.max(best.width, best.height) >= PREVIEW_EDGE_PX) break
  }
  return best
}

type Canvas = OffscreenCanvas | HTMLCanvasElement

function draw(bmp: ImageBitmap, width: number, height: number): Canvas {
  const canvas: Canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height })
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  ctx.fillStyle = '#fff' // transparent PNGs become white, not black
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, width, height)
  return canvas
}

function toBlob(canvas: Canvas, type: string, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality })
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Undecodable())), type, quality))
}

/**
 * One copy: WebP when the browser really encodes it (the blob's type says so: Safari quietly
 * returns PNG), else JPEG. `want` forces a format so both copies match.
 */
async function encode(bmp: ImageBitmap, maxEdge: number, q: { webp: number; jpeg: number }, want?: 'webp' | 'jpeg') {
  const size = fitWithin(bmp.width, bmp.height, maxEdge)
  const canvas = draw(bmp, size.width, size.height)
  if (want !== 'jpeg') {
    const webp = await toBlob(canvas, 'image/webp', q.webp)
    if (webp.type === 'image/webp') return { blob: webp, format: 'webp' as const }
  }
  return { blob: await toBlob(canvas, 'image/jpeg', q.jpeg), format: 'jpeg' as const }
}

/**
 * The preview, thumbnail and fingerprint of one photo. `raw` tries the RAW file's embedded preview
 * when the browser can't decode the file itself. Throws Undecodable for a file that can't be read.
 */
export async function makeCopies(file: Blob, opts: { raw: boolean; data?: ArrayBuffer }): Promise<Copies> {
  const data = opts.data ?? (await file.arrayBuffer())
  const sha256 = await sha256Hex(data)
  let bmp = await decode(file)
  let fromPreview = false
  if (!bmp && opts.raw) {
    bmp = await embeddedPreview(new Uint8Array(data))
    fromPreview = !!bmp
  }
  if (!bmp) throw new Undecodable()
  try {
    const preview = await encode(bmp, PREVIEW_EDGE_PX, { webp: PREVIEW_WEBP_QUALITY, jpeg: PREVIEW_JPEG_QUALITY })
    const thumb = await encode(bmp, THUMB_EDGE_PX, { webp: THUMB_WEBP_QUALITY, jpeg: THUMB_JPEG_QUALITY }, preview.format)
    return {
      preview: preview.blob,
      thumb: thumb.blob,
      format: preview.format,
      originalWidth: fromPreview ? null : bmp.width,
      originalHeight: fromPreview ? null : bmp.height,
      sha256,
    }
  } finally {
    bmp.close()
  }
}
