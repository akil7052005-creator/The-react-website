// Turning one photo into the upload copy for client selection: at most COMPRESS_EDGE px on the long
// side (1600), JPEG quality COMPRESS_QUALITY (82%). Shared by the Web Worker (compress.worker.ts) and
// the main-thread fallback; uses OffscreenCanvas where there is one, else a <canvas>.

import { CUSTOMER_COPY_PX, CUSTOMER_COPY_QUALITY } from '@weddyzone/shared'
import { jpegCandidates } from './rawPreview'

export const COMPRESS_EDGE = CUSTOMER_COPY_PX
/** JPEG quality of the copy the customer selects from: 82%, always within COMPRESS_QUALITY_MIN–MAX. */
export const COMPRESS_QUALITY = CUSTOMER_COPY_QUALITY / 100
export const COMPRESS_QUALITY_MIN = 0.8
export const COMPRESS_QUALITY_MAX = 0.85
/** Above this, a very detailed photo is re-encoded once at COMPRESS_QUALITY_MIN; never lower. */
export const COMPRESS_MAX_BYTES = 1024 * 1024

/** A requested quality, held to the 80–85% range. */
export const clampQuality = (q: number) => Math.min(COMPRESS_QUALITY_MAX, Math.max(COMPRESS_QUALITY_MIN, q))

export interface Compressed {
  blob: Blob
  width: number
  height: number
  /** The original's pixel size, or null when only an embedded preview could be read (RAW). */
  originalWidth: number | null
  originalHeight: number | null
  fromPreview: boolean
}

/** The file couldn't be read as an image (and had no usable embedded preview). */
export class Undecodable extends Error {
  constructor() {
    super('This file could not be read as a photo')
    this.name = 'Undecodable'
  }
}

async function decode(blob: Blob): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch {
    return null
  }
}

/** The biggest JPEG preview inside a RAW file that decodes, or null. */
async function embeddedPreview(file: Blob): Promise<ImageBitmap | null> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let best: ImageBitmap | null = null
  for (const [s, e] of jpegCandidates(bytes)) {
    const bmp = await decode(new Blob([bytes.subarray(s, e)], { type: 'image/jpeg' }))
    if (!bmp) continue
    if (!best || bmp.width * bmp.height > best.width * best.height) {
      best?.close()
      best = bmp
    } else bmp.close()
    // A preview this big is the camera's full-size one: stop looking.
    if (Math.max(best.width, best.height) >= 1600) break
  }
  return best
}

async function encode(bmp: ImageBitmap, width: number, height: number, quality: number): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff' // transparent PNGs become white, not black
    ctx.fillRect(0, 0, width, height)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bmp, 0, 0, width, height)
    return canvas.convertToBlob({ type: 'image/jpeg', quality })
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, width, height)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Undecodable())), 'image/jpeg', quality))
}

/** The pixel size that fits `maxEdge` on the long side (never enlarged). */
export function fitWithin(width: number, height: number, maxEdge = COMPRESS_EDGE) {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Decodes the photo (or a RAW file's embedded preview), resizes and encodes it as JPEG. */
export async function compressImage(file: Blob, opts: { raw: boolean; maxEdge?: number; quality?: number }): Promise<Compressed> {
  let bmp = await decode(file)
  let fromPreview = false
  if (!bmp && opts.raw) {
    bmp = await embeddedPreview(file)
    fromPreview = !!bmp
  }
  if (!bmp) throw new Undecodable()
  try {
    const size = fitWithin(bmp.width, bmp.height, opts.maxEdge ?? COMPRESS_EDGE)
    const quality = clampQuality(opts.quality ?? COMPRESS_QUALITY)
    let blob = await encode(bmp, size.width, size.height, quality)
    if (blob.size > COMPRESS_MAX_BYTES && quality > COMPRESS_QUALITY_MIN) blob = await encode(bmp, size.width, size.height, COMPRESS_QUALITY_MIN)
    return { blob, ...size, originalWidth: fromPreview ? null : bmp.width, originalHeight: fromPreview ? null : bmp.height, fromPreview }
  } finally {
    bmp.close()
  }
}
