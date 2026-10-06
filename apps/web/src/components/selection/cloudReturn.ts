// "Download Selected → Download from cloud": the customer picked from the 80–85% copies; this returns
// the full-quality originals kept in the cloud for those picks. Each original is checked against the
// SHA-256 recorded when it was kept, then saved into a "Selected - …" folder (one subfolder per album)
// inside the folder the studio picks — no ZIP. Browsers without a folder picker get one file at a time.

import type { DirEntryHandle, SelectedPhoto } from './localCopy'

/** A pick with where its original is kept (null: not kept in the cloud). */
export interface CloudPick extends SelectedPhoto {
  originalUrl: string | null
  originalChecksum: string | null
}

export interface ReturnResult {
  saved: number
  /** Saved and matching the recorded SHA-256 byte for byte. */
  verified: number
  /** Picks whose original isn't in the cloud (use Copy from my computer for these). */
  notInCloud: CloudPick[]
  /** Download failed, or the bytes didn't match after a retry. */
  failed: CloudPick[]
}

/** A folder or file name Windows and macOS both accept; the full name otherwise. */
export const safeName = (s: string) =>
  [...s]
    .map((c) => (c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? '-' : c))
    .join('')
    .replace(/-{2,}/g, '-')
    .replace(/[. ]+$/, '')
    .trim() || 'Untitled'

async function sha256Hex(data: ArrayBuffer): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The original's bytes, verified: fetched again once if they don't hash to the recorded checksum.
 * `verified` is false only when the browser can't hash (plain http) — the bytes are still the original.
 */
export async function fetchVerified(url: string, checksum: string | null, get: (url: string) => Promise<ArrayBuffer>) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const data = await get(url)
    const sha = await sha256Hex(data)
    if (!checksum || sha === null) return { data, verified: false }
    if (sha === checksum.toLowerCase()) return { data, verified: true }
  }
  throw new Error('The downloaded original does not match the one uploaded')
}

/** "IMG_1.jpg", then "IMG_1 (2).jpg" for a second file of that name in the same album. */
export function uniqueName(name: string, taken: Set<string>) {
  let out = name
  for (let n = 2; taken.has(out.toLowerCase()); n++) out = name.replace(/(\.[^.]*)?$/, (ext) => ` (${n})${ext}`)
  taken.add(out.toLowerCase())
  return out
}

/**
 * Saves each pick's original into `folderName` inside `root`, one subfolder per album, under its
 * original file name. `save` (no folder picker) is called per file instead when `root` is null.
 */
export async function returnOriginals(
  picks: CloudPick[],
  opts: {
    root: DirEntryHandle | null
    folderName: string
    get: (url: string) => Promise<ArrayBuffer>
    save?: (data: ArrayBuffer, name: string) => void
    onProgress?: (done: number, total: number) => void
    signal?: { cancelled: boolean }
  },
): Promise<ReturnResult> {
  const result: ReturnResult = { saved: 0, verified: 0, notInCloud: [], failed: [] }
  const target = opts.root ? await opts.root.getDirectoryHandle(opts.folderName, { create: true }) : null
  const albums = new Map<string, Promise<DirEntryHandle>>()
  const names = new Map<string, Set<string>>()
  const total = picks.length
  let done = 0
  for (const p of picks) {
    if (opts.signal?.cancelled) break
    if (!p.originalUrl) {
      result.notInCloud.push(p)
    } else {
      try {
        const { data, verified } = await fetchVerified(p.originalUrl, p.originalChecksum, opts.get)
        const album = safeName(p.album ?? 'Other')
        const taken = names.get(album) ?? new Set<string>()
        names.set(album, taken)
        const name = uniqueName(safeName(p.originalName), taken)
        if (target) {
          let dir = albums.get(album)
          if (!dir) {
            dir = target.getDirectoryHandle(album, { create: true })
            albums.set(album, dir)
          }
          const out = await (await dir).getFileHandle(name, { create: true })
          const w = await out.createWritable()
          await w.write(new Blob([data]))
          await w.close()
        } else {
          opts.save?.(data, `${album} - ${name}`)
        }
        result.saved++
        if (verified) result.verified++
      } catch {
        result.failed.push(p)
      }
    }
    opts.onProgress?.(++done, total)
  }
  return result
}
