// A small pool of Web Workers that make previews: 2–4 on a computer, 1–2 on a phone (each decode of a
// 24 MP photo takes a lot of memory). Falls back to the main thread where workers or OffscreenCanvas
// aren't available. HEIC photos (iPhone) are turned into a JPEG first, since Chrome and Edge can't
// decode them; their fingerprint is still taken from the original file.

import { makeCopies, Undecodable, type Copies } from './copies'
import type { CopiesRequest, CopiesResponse } from './copies.worker'

const extOf = (name: string) => (name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '')
const RAW_EXT = ['cr2', 'cr3', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'dng', 'raf', 'orf', 'rw2', 'pef', 'srw', 'x3f', '3fr', 'iiq', 'erf', 'kdc', 'mrw']
export const isRaw = (name: string) => RAW_EXT.includes(extOf(name))
export const isHeic = (name: string) => ['heic', 'heif'].includes(extOf(name))

/** A phone or tablet: fewer workers and fewer uploads at once. */
export function isMobileDevice() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (typeof window !== 'undefined' && window.matchMedia?.('(pointer:coarse)').matches && window.innerWidth < 900)
}

/** Workers in the pool: 1–2 on phones, 2–4 on computers (half the cores). */
export function workerCount(mobile = isMobileDevice(), cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4) {
  return mobile ? (cores >= 6 ? 2 : 1) : Math.min(4, Math.max(2, Math.floor(cores / 2)))
}

/** Photos uploaded at the same time: 4 on a computer, 2 on a phone. */
export const uploadConcurrency = (mobile = isMobileDevice()) => (mobile ? 2 : 4)

const workersAvailable = () => typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'

let pool: { worker: Worker; busy: boolean }[] | null = null
const waiting: (() => void)[] = []
const pending = new Map<number, (r: CopiesResponse) => void>()
let seq = 0

function getPool() {
  if (!pool) {
    pool = Array.from({ length: workerCount() }, () => {
      const worker = new Worker(new URL('./copies.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<CopiesResponse>) => {
        pending.get(e.data.id)?.(e.data)
        pending.delete(e.data.id)
      }
      return { worker, busy: false }
    })
  }
  return pool
}

async function inWorker(req: Omit<CopiesRequest, 'id'>): Promise<Copies> {
  const workers = getPool()
  let slot = workers.find((w) => !w.busy)
  while (!slot) {
    await new Promise<void>((r) => waiting.push(r))
    slot = workers.find((w) => !w.busy)
  }
  slot.busy = true
  try {
    const id = ++seq
    const res = await new Promise<CopiesResponse>((resolve) => {
      pending.set(id, resolve)
      slot.worker.postMessage({ id, ...req } satisfies CopiesRequest)
    })
    if (res.ok) return res
    throw res.undecodable ? new Undecodable() : new Error(res.error)
  } finally {
    slot.busy = false
    waiting.shift()?.()
  }
}

const run = (req: Omit<CopiesRequest, 'id'>) => (workersAvailable() ? inWorker(req) : makeCopies(req.file, { raw: req.raw, data: req.data }))

async function heicToJpeg(file: File): Promise<Blob> {
  const { default: heic2any } = await import('heic2any')
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 })
  return Array.isArray(out) ? out[0] : out
}

/** The preview, thumbnail and fingerprint of `file`. Throws Undecodable for a photo that can't be read. */
export async function copiesOf(file: File): Promise<Copies> {
  try {
    return await run({ file, raw: isRaw(file.name) })
  } catch (e) {
    if (!(e instanceof Undecodable) || !isHeic(file.name)) throw e
    return run({ file: await heicToJpeg(file), raw: false, data: await file.arrayBuffer() })
  }
}

/** Stops the workers (the upload dialog closed). */
export function stopCopyPool() {
  for (const w of pool ?? []) w.worker.terminate()
  pool = null
}
