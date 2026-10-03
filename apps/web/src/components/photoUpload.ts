// Pure logic for the photo uploader (no React): what is a photo, which folder a file came from,
// what fits in a batch under the plan, the skip summary and upload retries. Unit-tested.

import type { UploadLimitsDto } from '@weddyzone/shared'

export const ACCEPT = ['image/jpeg', 'image/png', 'image/webp']

const TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

/** For the photo picker: the MIME types plus the extensions, so .JFIF and friends are offered too. */
export const PICKER_ACCEPT = [...ACCEPT, ...Object.keys(TYPE_BY_EXTENSION).map((ext) => `.${ext}`)].join(',')

const extOf = (name: string) => (name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '')

/**
 * The photo type of a file, or null when it isn't a JPEG, PNG or WebP. Uses the browser's type when
 * it is one of those; otherwise the extension (browsers sometimes give files from Windows folders,
 * e.g. .JFIF or .JPE, no type or a generic one). The server checks the real content either way.
 */
export function photoType(file: Pick<File, 'name' | 'type'>): string | null {
  if (ACCEPT.includes(file.type)) return file.type
  return TYPE_BY_EXTENSION[extOf(file.name)] ?? null
}

/** System clutter that comes along with folders: .DS_Store and other dotfiles, Thumbs.db, desktop.ini. */
export function isJunk(name: string): boolean {
  const n = name.toLowerCase()
  return n.startsWith('.') || n === 'thumbs.db' || n === 'desktop.ini'
}

/**
 * The folder part of a path: "Haldi/Close-ups/IMG_1.jpg" → "Haldi/Close-ups", "/Haldi/IMG_1.jpg"
 * (a dropped entry's fullPath) → "Haldi", "IMG_1.jpg" → null.
 */
export function folderOf(path: string | undefined | null): string | null {
  if (!path) return null
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.length > 1 ? parts.slice(0, -1).join('/') : null
}

export interface Candidate {
  file: File
  folder: string | null
}

/** Folder order: by folder path, then file name, the way a file browser lists them. */
export function sortByPath<T extends { folder: string | null; file: { name: string } }>(list: T[]): T[] {
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  return [...list].sort((a, b) => cmp(a.folder ?? '', b.folder ?? '') || cmp(a.file.name, b.file.name))
}

export interface Triage {
  /** Photos that may be uploaded. */
  photos: Candidate[]
  /** Picked one by one: shown as error rows ("Only JPEG…", "Larger than…"). */
  rejected: { candidate: Candidate; error: string }[]
  /** From folders: skipped quietly, reported once in the summary. */
  skippedLarge: number
  skippedNotPhoto: number
  /** e.g. [".HEIC", ".CR2"] — a few examples for the summary. */
  notPhotoExamples: string[]
}

export const tooLargeMessage = (l: Pick<UploadLimitsDto, 'maxPhotoMb' | 'planName'>) => `Larger than ${l.maxPhotoMb} MB on your ${l.planName} plan`
export const NOT_A_PHOTO = 'Only JPEG, PNG or WebP images'

/**
 * Sorts a pick or drop into photos to upload and the rest. From a folder, junk is dropped without a
 * word and non-photos / oversize photos are counted for the summary; picked one by one, they become
 * error rows so the studio sees why.
 */
export function triage(candidates: Candidate[], limits: Pick<UploadLimitsDto, 'maxPhotoMb' | 'planName'>, fromFolder: boolean): Triage {
  const out: Triage = { photos: [], rejected: [], skippedLarge: 0, skippedNotPhoto: 0, notPhotoExamples: [] }
  const maxBytes = limits.maxPhotoMb * 1024 * 1024
  for (const c of candidates) {
    if (fromFolder && isJunk(c.file.name)) continue
    if (!photoType(c.file)) {
      if (!fromFolder) {
        out.rejected.push({ candidate: c, error: NOT_A_PHOTO })
        continue
      }
      out.skippedNotPhoto++
      const ext = extOf(c.file.name)
      const label = ext ? `.${ext.toUpperCase()}` : c.file.name
      if (out.notPhotoExamples.length < 3 && !out.notPhotoExamples.includes(label)) out.notPhotoExamples.push(label)
    } else if (c.file.size > maxBytes) {
      if (fromFolder) out.skippedLarge++
      else out.rejected.push({ candidate: c, error: tooLargeMessage(limits) })
    } else {
      out.photos.push(c)
    }
  }
  return out
}

export interface Fit<T> {
  queued: T[]
  /** Over the plan's photos-per-upload cap (not queued). */
  overCap: number
  /** Under the cap but past the storage left (not queued). */
  noRoom: number
}

/**
 * What goes into this batch: at most `maxFilesPerUpload`, and only as many (in order) as fit in the
 * storage left. `storageLeftBytes` null = unlimited.
 */
export function fitBatch<T extends { file: { size: number } }>(photos: T[], limits: Pick<UploadLimitsDto, 'maxFilesPerUpload' | 'storageLeftBytes'>): Fit<T> {
  const capped = photos.slice(0, limits.maxFilesPerUpload)
  const overCap = photos.length - capped.length
  if (limits.storageLeftBytes === null) return { queued: capped, overCap, noRoom: 0 }
  let used = 0
  let k = 0
  while (k < capped.length && used + capped[k].file.size <= limits.storageLeftBytes) used += capped[k++].file.size
  return { queued: capped.slice(0, k), overCap, noRoom: capped.length - k }
}

/** "'Haldi'", or "3 folders", for the summary. */
export function folderLabel(candidates: { folder: string | null }[]): string {
  const tops = [...new Set(candidates.map((c) => c.folder?.split('/')[0]).filter((f): f is string => !!f))]
  if (tops.length === 1) return `'${tops[0]}'`
  return tops.length ? `${tops.length} folders` : 'the folder'
}

/** "Added 248 photos from 'Haldi' · skipped 12 (5 over 50 MB on Pro, 7 not JPEG/PNG/WebP e.g. .HEIC, .CR2)". */
export function folderSummary(added: number, from: string, t: Pick<Triage, 'skippedLarge' | 'skippedNotPhoto' | 'notPhotoExamples'>, limits: Pick<UploadLimitsDto, 'maxPhotoMb' | 'planName'>): string {
  const head = `Added ${added} photo${added === 1 ? '' : 's'} from ${from}`
  const skipped = t.skippedLarge + t.skippedNotPhoto
  if (!skipped) return head
  const parts: string[] = []
  if (t.skippedLarge) parts.push(`${t.skippedLarge} over ${limits.maxPhotoMb} MB on ${limits.planName}`)
  if (t.skippedNotPhoto) parts.push(`${t.skippedNotPhoto} not JPEG/PNG/WebP${t.notPhotoExamples.length ? ` e.g. ${t.notPhotoExamples.join(', ')}` : ''}`)
  return `${head} · skipped ${skipped} (${parts.join(', ')})`
}

// ---------------------------------------------------------------- retries

/** Waits before the 1st and 2nd automatic retry. */
export const RETRY_DELAYS_MS = [2000, 5000]

/**
 * Retried: network failures, server errors and "too many requests" (429). Never: other 4xx
 * (PLAN_LIMIT, too large, duplicates…), which would fail the same way again.
 */
export function isRetryable(e: unknown): boolean {
  const err = e as { status?: number; code?: string } | null
  if (!err || typeof err.status !== 'number') return false
  if (err.code === 'PLAN_LIMIT') return false
  return err.status === 0 || err.status === 429 || err.status >= 500
}

/** Runs `attempt`, retrying retryable failures after 2 s and then 5 s. */
export async function withRetries<T>(attempt: () => Promise<T>, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)), onRetry?: (n: number) => void): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await attempt()
    } catch (e) {
      if (i >= RETRY_DELAYS_MS.length || !isRetryable(e)) throw e
      onRetry?.(i + 1)
      await sleep(RETRY_DELAYS_MS[i])
    }
  }
}
