// The upload engine (no React): for each photo, make its preview + thumbnail, ask the API for two
// signed links, PUT both straight to storage, then confirm with /uploads/complete. A few photos at
// a time; each PUT retried up to 3 times (after 1 s, 3 s, 9 s) with a fresh link when the old one
// expired; paused while offline and resumed when the connection is back. Unit-tested with fakes.

import type { UploadCompleteDto, UploadSign, UploadSignDto } from '@weddyzone/shared'
import type { Copies } from './copies'
import { Undecodable } from './copies'

/** Waits before the 1st, 2nd and 3rd retry of a failed upload. */
export const PUT_RETRY_DELAYS_MS = [1000, 3000, 9000]

export interface QueueItem {
  /** fileKey (path|size|lastModified): the resume store's id for the file. */
  key: string
  file: File
  /** Path under the picked folder, file name included. */
  relativePath: string
  folderId?: string | null
  /** Photo id from an earlier, unfinished attempt (resume). */
  photoId?: string
}

export type ItemResult = { key: string; outcome: 'uploaded'; photoId: string } | { key: string; outcome: 'skipped'; reason: string } | { key: string; outcome: 'failed'; error: string }

/** What the queue needs from the outside world (real ones in the dialog, fakes in tests). */
export interface QueueDeps {
  copies(file: File): Promise<Copies>
  sign(body: UploadSign): Promise<UploadSignDto>
  complete(body: UploadSign & { photoId: string }): Promise<UploadCompleteDto>
  /** PUTs a blob to a signed link; rejects with { status } on failure (0 = network). */
  put(url: string, blob: Blob, headers: Record<string, string>): Promise<void>
  sleep?: (ms: number) => Promise<void>
  isOnline?: () => boolean
  /** Resolves when the browser is back online. */
  waitOnline?: () => Promise<void>
  now?: () => number
}

export interface QueueProgress {
  done: number
  uploaded: number
  skipped: number
  failed: number
  total: number
  /** Seconds left at the current pace, once a few photos are done. */
  etaSeconds: number | null
  paused: boolean
  offline: boolean
}

export interface QueueOptions {
  selectionId: string
  items: QueueItem[]
  concurrency: number
  deps: QueueDeps
  onProgress?: (p: QueueProgress) => void
  onItem?: (r: ItemResult) => void
  /** A photo id was given to a file (saved so a resume reuses it). */
  onSigned?: (key: string, photoId: string) => void
}

/** Thrown for problems that stop the whole upload (plan limit, read-only, signed out). */
export class StopUpload extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'StopUpload'
  }
}

interface HttpLike {
  status?: number
  code?: string
  message?: string
  details?: Record<string, unknown>
  fields?: Record<string, string>
}

const statusOf = (e: unknown) => (e as HttpLike | null)?.status
/** Network errors, server errors and rate limits are worth retrying. */
const retryable = (e: unknown) => {
  const s = statusOf(e)
  return s === undefined || s === 0 || s === 408 || s === 429 || s >= 500
}
/** The signed link expired or was refused: sign again. */
const expired = (e: unknown) => statusOf(e) === 403

/** Formats "~6 min left" / "~40 s left". */
export function etaLabel(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return ''
  if (seconds < 60) return `~${Math.max(5, Math.round(seconds / 5) * 5)} s left`
  if (seconds < 3600) return `~${Math.round(seconds / 60)} min left`
  const h = Math.floor(seconds / 3600)
  return `~${h} h ${Math.round((seconds - h * 3600) / 60)} min left`
}

export class UploadQueue {
  private next = 0
  private cancelled = false
  private stopped: StopUpload | null = null
  private gate: { promise: Promise<void>; open: () => void } | null = null
  private offline = false
  private readonly started: number
  private progress: QueueProgress
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number

  constructor(private readonly o: QueueOptions) {
    this.sleep = o.deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.now = o.deps.now ?? (() => Date.now())
    this.started = this.now()
    this.progress = { done: 0, uploaded: 0, skipped: 0, failed: 0, total: o.items.length, etaSeconds: null, paused: false, offline: false }
  }

  get state(): QueueProgress {
    return { ...this.progress }
  }

  pause() {
    if (this.gate) return
    let open = () => {}
    const promise = new Promise<void>((resolve) => (open = resolve))
    this.gate = { promise, open }
    this.emit({ paused: true })
  }

  resume() {
    const g = this.gate
    this.gate = null
    g?.open()
    this.emit({ paused: false })
  }

  cancel() {
    this.cancelled = true
    this.resume()
  }

  /** The browser went offline / came back: pause and resume on its own. */
  setOnline(online: boolean) {
    if (!online && !this.offline) {
      this.offline = true
      this.pause()
      this.emit({ offline: true })
    } else if (online && this.offline) {
      this.offline = false
      this.emit({ offline: false })
      this.resume()
    }
  }

  private emit(p: Partial<QueueProgress>) {
    this.progress = { ...this.progress, ...p }
    this.o.onProgress?.(this.state)
  }

  private finish(r: ItemResult) {
    const p = this.progress
    const done = p.done + 1
    const elapsed = (this.now() - this.started) / 1000
    // Pace from what's done so far; shown once a few photos are in.
    const eta = done >= 3 && elapsed > 0 ? ((p.total - done) * elapsed) / done : null
    this.emit({
      done,
      uploaded: p.uploaded + (r.outcome === 'uploaded' ? 1 : 0),
      skipped: p.skipped + (r.outcome === 'skipped' ? 1 : 0),
      failed: p.failed + (r.outcome === 'failed' ? 1 : 0),
      etaSeconds: eta,
    })
    this.o.onItem?.(r)
  }

  /** Waits while paused or offline. */
  private async hold() {
    while (this.gate && !this.cancelled) await this.gate.promise
    if (this.o.deps.isOnline && !this.o.deps.isOnline() && !this.cancelled) {
      this.setOnline(false)
      await (this.o.deps.waitOnline?.() ?? Promise.resolve())
      this.setOnline(true)
    }
  }

  /** PUTs one copy, retrying 3 times; a refused (expired) link is replaced by a fresh one. */
  private async putWithRetry(blob: Blob, link: { url: string; headers: Record<string, string> }, fresh: () => Promise<{ url: string; headers: Record<string, string> }>) {
    let current = link
    for (let attempt = 0; ; attempt++) {
      await this.hold()
      if (this.cancelled) throw new StopUpload('cancelled')
      try {
        await this.o.deps.put(current.url, blob, current.headers)
        return
      } catch (e) {
        if (attempt >= PUT_RETRY_DELAYS_MS.length) throw e
        if (expired(e)) current = await fresh()
        else if (!retryable(e)) throw e
        await this.sleep(PUT_RETRY_DELAYS_MS[attempt])
      }
    }
  }

  private async one(item: QueueItem): Promise<ItemResult> {
    let copies: Copies
    try {
      copies = await this.o.deps.copies(item.file)
    } catch (e) {
      if (e instanceof Undecodable) return { key: item.key, outcome: 'skipped', reason: 'This photo could not be read' }
      return { key: item.key, outcome: 'failed', error: (e as Error).message || 'Could not make the preview' }
    }
    const body: UploadSign = {
      selectionId: this.o.selectionId,
      photoId: item.photoId,
      folderId: item.folderId ?? null,
      relativePath: item.relativePath,
      originalName: item.file.name,
      originalSize: item.file.size,
      originalWidth: copies.originalWidth,
      originalHeight: copies.originalHeight,
      lastModified: item.file.lastModified || null,
      sha256: copies.sha256,
      format: copies.format,
      previewSize: copies.preview.size,
      thumbSize: copies.thumb.size,
    }
    const signed = await this.call(() => this.o.deps.sign(body))
    if (signed.duplicate) return { key: item.key, outcome: 'skipped', reason: 'Already uploaded' }
    body.photoId = signed.photoId
    this.o.onSigned?.(item.key, signed.photoId)
    let links = signed
    const fresh = async (which: 'preview' | 'thumb') => {
      const again = await this.call(() => this.o.deps.sign(body))
      if (again.duplicate) throw new StopUpload('duplicate')
      links = again
      return again[which]
    }
    try {
      await this.putWithRetry(copies.preview, links.preview, () => fresh('preview'))
      await this.putWithRetry(copies.thumb, links.thumb, () => fresh('thumb'))
    } catch (e) {
      if (e instanceof StopUpload && e.message === 'duplicate') return { key: item.key, outcome: 'skipped', reason: 'Already uploaded' }
      throw e
    }
    const complete = () => this.call(() => this.o.deps.complete({ ...body, photoId: signed.photoId }))
    let done: UploadCompleteDto
    try {
      done = await complete()
    } catch (e) {
      // The server didn't find one of the copies (lost on the way): upload it again, once.
      const missing = (e as HttpLike).details?.missing
      if ((e as HttpLike).code !== 'CONFLICT' || (missing !== 'preview' && missing !== 'thumb')) throw e
      await this.putWithRetry(missing === 'preview' ? copies.preview : copies.thumb, await fresh(missing), () => fresh(missing))
      done = await complete()
    }
    return { key: item.key, outcome: 'uploaded', photoId: done.id }
  }

  /** An API call: retried like a PUT; plan limits and other refusals stop the whole upload. */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.hold()
      if (this.cancelled) throw new StopUpload('cancelled')
      try {
        return await fn()
      } catch (e) {
        const err = e as HttpLike
        if (err.code === 'PLAN_LIMIT' || err.code === 'READ_ONLY' || err.status === 401 || err.status === 402) {
          throw new StopUpload(err.message || 'Upload stopped', err.code, err.details)
        }
        if (attempt >= PUT_RETRY_DELAYS_MS.length || !retryable(e)) throw e
        await this.sleep(PUT_RETRY_DELAYS_MS[attempt])
      }
    }
  }

  private async worker() {
    while (this.next < this.o.items.length && !this.cancelled && !this.stopped) {
      await this.hold()
      // Another worker may have taken the last photo while this one waited.
      if (this.cancelled || this.stopped || this.next >= this.o.items.length) return
      const item = this.o.items[this.next++]
      try {
        this.finish(await this.one(item))
      } catch (e) {
        if (e instanceof StopUpload) {
          if (e.message !== 'cancelled') this.stopped ??= e
          return
        }
        const err = e as HttpLike
        this.finish({ key: item.key, outcome: 'failed', error: err.fields?.file ?? err.message ?? 'Upload failed' })
      }
    }
  }

  /** Runs to the end (or until cancelled / stopped). Resolves with why it stopped early, if it did. */
  async run(): Promise<{ cancelled: boolean; stopped: StopUpload | null }> {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(this.o.concurrency, this.o.items.length)) }, () => this.worker()))
    return { cancelled: this.cancelled, stopped: this.stopped }
  }
}
