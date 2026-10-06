// "Download Selected → Copy from my computer": the studio picks the folder that holds the original photos;
// the client's picks are found there by their original file name and copied into a new
// "Selected - <Customer> - <Event> - <date>" folder inside it. The originals are only read, never
// moved or changed. Uses the browser's File System Access API (Chrome and Edge on a computer).

// ---------------------------------------------------------------- File System Access types

export interface FileEntryHandle {
  kind: 'file'
  name: string
  getFile(): Promise<File>
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>
}
export interface DirEntryHandle {
  kind: 'directory'
  name: string
  values(): AsyncIterable<DirEntryHandle | FileEntryHandle>
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirEntryHandle>
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileEntryHandle>
  queryPermission?(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}
type WithPicker = Window & { showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<DirEntryHandle> }

/** The folder picker with write access exists (desktop Chrome / Edge). Phones and tablets are left out. */
export function canCopyLocally() {
  if (typeof window === 'undefined' || typeof (window as WithPicker).showDirectoryPicker !== 'function') return false
  return !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}

/** Thrown when the person cancels the picker or doesn't allow editing the folder. */
export class PermissionNeeded extends Error {
  constructor() {
    super('Permission needed to copy selected photos')
    this.name = 'PermissionNeeded'
  }
}

/**
 * Opens the browser's folder picker asking to edit the folder. The browser shows its own
 * "allow to edit files" prompt; cancelling or refusing it ends in PermissionNeeded.
 */
export async function pickOriginalsFolder(): Promise<DirEntryHandle> {
  let dir: DirEntryHandle
  try {
    dir = await (window as WithPicker).showDirectoryPicker!({ mode: 'readwrite' })
  } catch (e) {
    const name = (e as Error).name
    if (name === 'AbortError' || name === 'NotAllowedError' || name === 'SecurityError') throw new PermissionNeeded()
    throw e
  }
  // Some browsers grant read first; ask for write explicitly when it isn't granted yet.
  if (dir.queryPermission && (await dir.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    const state = await dir.requestPermission?.({ mode: 'readwrite' }).catch(() => 'denied' as const)
    if (state !== 'granted') throw new PermissionNeeded()
  }
  return dir
}

// ---------------------------------------------------------------- scanning and matching

/** A file found in the picked folder: its folders below the picked folder, the handle and (for likely matches) its size. */
export interface FoundFile<H = FileEntryHandle> {
  name: string
  dirs: string[]
  handle: H
  size?: number
}

/** Earlier copies are skipped, so their files never count as originals. */
export const COPY_FOLDER_PREFIX = 'Selected - '

/**
 * Every file under the picked folder, subfolders included. Files named in `wanted` (lower case)
 * also get their byte size, to tell apart originals that share a name.
 */
export async function scanFolder(root: DirEntryHandle, onFound?: (n: number) => void, wanted?: Set<string>): Promise<FoundFile[]> {
  const out: FoundFile[] = []
  const walk = async (dir: DirEntryHandle, dirs: string[]) => {
    for await (const entry of dir.values()) {
      if (entry.kind === 'file') {
        const size = wanted?.has(entry.name.toLowerCase()) ? (await entry.getFile()).size : undefined
        out.push({ name: entry.name, dirs, handle: entry, size })
        if (out.length % 200 === 0) onFound?.(out.length)
      } else if (!entry.name.startsWith(COPY_FOLDER_PREFIX)) {
        await walk(entry, [...dirs, entry.name])
      }
    }
  }
  await walk(root, [])
  onFound?.(out.length)
  return out
}

/** A selected photo as the studio API describes it. */
export interface SelectedPhoto {
  id: string
  originalName: string
  /** The folder path it was uploaded from, e.g. "Wedding 2024/Haldi". */
  folder: string | null
  /** The album it is in. */
  album: string | null
  /** The original file's byte size, when known. */
  size?: number | null
}

const lower = (s: string) => s.trim().toLowerCase()
const base = (name: string) => name.replace(/\.[^.]+$/, '')

/** Names to look for: the original name, and for an iPhone photo (uploaded as JPEG) its HEIC/HEIF original. */
function namesFor(p: SelectedPhoto) {
  const names = [lower(p.originalName)]
  if (/\.jpe?g$/i.test(p.originalName)) names.push(`${lower(base(p.originalName))}.heic`, `${lower(base(p.originalName))}.heif`)
  return names
}

const endsWith = (a: string[], b: string[]) => b.length <= a.length && b.every((x, i) => a[a.length - b.length + i] === x)

/**
 * The found file sits at the photo's uploaded folder path. The studio may pick the uploaded folder
 * itself or a folder above it, so either path may be the other's tail.
 */
function samePath(want: string[], have: string[]) {
  if (!want.length) return have.length === 0
  if (!have.length) return want.length === 1
  return endsWith(have, want) || endsWith(want, have)
}

/**
 * How well a found file fits the photo: the same folder path first, then the same byte size as
 * the original, then trailing folders in common and the album name.
 */
function fit(found: FoundFile<unknown>, p: SelectedPhoto) {
  const want = (p.folder ?? '').split('/').filter(Boolean).map(lower)
  const have = found.dirs.map(lower)
  let n = 0
  while (n < want.length && n < have.length && want[want.length - 1 - n] === have[have.length - 1 - n]) n++
  const path = p.folder !== null && samePath(want, have) ? 1000 : 0
  const size = p.size && found.size === p.size ? 500 : 0
  return path + size + n * 2 + (p.album && have.includes(lower(p.album)) ? 1 : 0)
}

/** Lower-case names a scan should report sizes for: every name a selected photo could have. */
export const wantedNames = (photos: SelectedPhoto[]) => new Set(photos.flatMap(namesFor))

/**
 * Finds each selected photo's original among the scanned files: by folder path + original file
 * name first, then by file name only (any case). When several files fit, the one with the same
 * byte size as the original wins.
 */
export function matchSelected<H>(photos: SelectedPhoto[], files: FoundFile<H>[]) {
  const byName = new Map<string, FoundFile<H>[]>()
  for (const f of files) byName.set(lower(f.name), [...(byName.get(lower(f.name)) ?? []), f])
  const matched: { photo: SelectedPhoto; file: FoundFile<H> }[] = []
  const missing: SelectedPhoto[] = []
  for (const p of photos) {
    const candidates = namesFor(p).flatMap((n) => byName.get(n) ?? [])
    if (!candidates.length) {
      missing.push(p)
      continue
    }
    let best = candidates[0]
    let bestFit = fit(best, p)
    for (const c of candidates.slice(1)) {
      const s = fit(c, p)
      if (s > bestFit) [best, bestFit] = [c, s]
    }
    matched.push({ photo: p, file: best })
  }
  return { matched, missing }
}

// ---------------------------------------------------------------- copying

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'Untitled'

/** "Selected - Priya & Arjun - Wedding - 2026-10-04". */
export function copyFolderName(customer: string, event: string, date = new Date()) {
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return `${COPY_FOLDER_PREFIX}${safe(customer)} - ${safe(event)} - ${day}`.slice(0, 200)
}

/**
 * Copies the matched files into `folderName` inside the picked folder, keeping their subfolders.
 * Returns how many were copied and the ones that failed.
 */
export async function copyMatches(
  root: DirEntryHandle,
  folderName: string,
  matched: { photo: SelectedPhoto; file: FoundFile }[],
  onProgress: (done: number) => void,
  signal?: { cancelled: boolean },
) {
  const target = await root.getDirectoryHandle(folderName, { create: true })
  const dirs = new Map<string, Promise<DirEntryHandle>>()
  const dirFor = (path: string[]): Promise<DirEntryHandle> => {
    const key = path.join('/')
    let d = dirs.get(key)
    if (!d) {
      d = path.length === 0 ? Promise.resolve(target) : dirFor(path.slice(0, -1)).then((parent) => parent.getDirectoryHandle(path[path.length - 1], { create: true }))
      dirs.set(key, d)
    }
    return d
  }
  let copied = 0
  const failed: SelectedPhoto[] = []
  for (const m of matched) {
    if (signal?.cancelled) break
    try {
      const dir = await dirFor(m.file.dirs)
      const out = await dir.getFileHandle(m.file.name, { create: true })
      const w = await out.createWritable()
      await w.write(await m.file.handle.getFile())
      await w.close()
      copied++
    } catch {
      failed.push(m.photo)
    }
    onProgress(copied + failed.length)
  }
  return { copied, failed }
}

/** The "Download missing list (.txt)" contents. */
export function missingListText(event: string, missing: SelectedPhoto[]) {
  return [`Selected photos not found on this computer — ${event}`, '', ...missing.map((p) => (p.folder ? `${p.folder}/${p.originalName}` : p.originalName))].join('\r\n')
}

/** Saves text as a file in the browser's downloads. */
export function saveText(fileName: string, text: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
