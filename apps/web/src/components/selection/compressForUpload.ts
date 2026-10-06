// The upload copy of a photo for client selection: compressed in a Web Worker (1600 px, JPEG 82%),
// with the original's name, size and pixel size kept as metadata. The original never leaves the
// studio's computer; "Copy from my computer" copies it later.

import type { CompressRequest, CompressResponse } from './compress.worker'
import { compressImage, Undecodable, type Compressed } from './imageCompress'
import { isHeic, isRaw } from './folderUpload'

export interface UploadCopy {
  /** What is uploaded: a JPEG named "<original name without extension>.jpg", or the original. */
  file: File
  compressed: boolean
  originalName: string
  originalSize: number
  originalWidth: number | null
  originalHeight: number | null
}

/** Photos compressed at once (each decode of a 24 MP photo takes a lot of memory). */
const WORKERS = 2

let pool: { worker: Worker; busy: boolean }[] | null = null
const waiting: (() => void)[] = []
const pending = new Map<number, (r: CompressResponse) => void>()
let seq = 0

function workersAvailable() {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
}

function getPool() {
  if (!pool) {
    pool = Array.from({ length: WORKERS }, () => {
      const worker = new Worker(new URL('./compress.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<CompressResponse>) => {
        pending.get(e.data.id)?.(e.data)
        pending.delete(e.data.id)
      }
      return { worker, busy: false }
    })
  }
  return pool
}

async function inWorker(file: Blob, raw: boolean): Promise<Compressed> {
  const workers = getPool()
  let slot = workers.find((w) => !w.busy)
  while (!slot) {
    await new Promise<void>((r) => waiting.push(r))
    slot = workers.find((w) => !w.busy)
  }
  slot.busy = true
  try {
    const id = ++seq
    const res = await new Promise<CompressResponse>((resolve) => {
      pending.set(id, resolve)
      slot.worker.postMessage({ id, file, raw } satisfies CompressRequest)
    })
    if (res.ok) return res
    throw res.undecodable ? new Undecodable() : new Error(res.error)
  } finally {
    slot.busy = false
    waiting.shift()?.()
  }
}

const compress = (file: Blob, raw: boolean) => (workersAvailable() ? inWorker(file, raw) : compressImage(file, { raw }))

const stem = (name: string) => name.replace(/\.[^.]+$/, '') || name

/** HEIC (iPhone) photos: Chrome and Edge can't decode them, so heic2any turns them into a JPEG first. */
async function heicToJpeg(file: File): Promise<Blob> {
  const { default: heic2any } = await import('heic2any')
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 })
  return Array.isArray(out) ? out[0] : out
}

/**
 * The compressed upload copy of `file`. Throws Undecodable for a file that can't be read (a RAW
 * without a usable preview, a damaged photo): the caller skips it and lists it.
 */
export async function compressForUpload(file: File): Promise<UploadCopy> {
  const raw = isRaw(file.name)
  let out: Compressed
  try {
    out = await compress(file, raw)
  } catch (e) {
    if (!(e instanceof Undecodable) || !isHeic(file.name)) throw e
    out = await compress(await heicToJpeg(file), false)
  }
  const meta = { originalName: file.name, originalSize: file.size, originalWidth: out.originalWidth, originalHeight: out.originalHeight }
  // Every photo goes up as the same 80–85% JPEG (even a small one), so the gallery is consistent.
  return { file: new File([out.blob], `${stem(file.name)}.jpg`, { type: 'image/jpeg' }), compressed: true, ...meta }
}

/** "1.2 GB", "96 MB", "480 KB". */
export function formatBytes(n: number) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}
