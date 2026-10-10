// Pure logic for "Upload Folder" (no React): which files count, reading a picked folder, and the
// checks that keep duplicate or empty folders out. Unit-tested.

import { cleanFolderName, videoFolderName } from '@weddyzone/shared'
import { isJunk } from '../photoUpload'
import { COPY_FOLDER_PREFIX } from './localCopy'

export type Media = 'image' | 'video'

const IMAGE_EXT = ['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'webp', 'heic', 'heif']
/** Camera RAW files: their preview is made from the JPEG embedded in them. */
const RAW_EXT = ['cr2', 'cr3', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'dng', 'raf', 'orf', 'rw2', 'pef', 'srw', 'x3f', '3fr', 'iiq', 'erf', 'kdc', 'mrw']

const extOf = (name: string) => (name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '')

/**
 * Photos (JPG, PNG, WebP, HEIC, camera RAW); null for anything else. Only photos are uploaded
 * from a folder (as a preview + thumbnail); videos and other files are skipped.
 */
export function mediaOf(name: string): Media | null {
  if (isJunk(name)) return null
  const ext = extOf(name)
  return IMAGE_EXT.includes(ext) || RAW_EXT.includes(ext) ? 'image' : null
}

export const isHeic = (name: string) => ['heic', 'heif'].includes(extOf(name))
export const isRaw = (name: string) => RAW_EXT.includes(extOf(name))

export interface PickedFolder {
  name: string
  files: File[]
}

export interface FolderRow extends PickedFolder {
  key: string
  images: number
  videos: number
  /** "Photo", or "Video" when it holds only videos. */
  label: 'Photo' | 'Video'
}

/** Keeps only photos and labels the folder. */
export function toRow(folder: PickedFolder, key: string): FolderRow {
  const files = folder.files.filter((f) => mediaOf(f.name))
  return { key, name: folder.name, files, images: files.length, videos: 0, label: 'Photo' }
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * The event folders a picked folder becomes: a photo folder with its name for the photos, and a
 * video folder for the videos (named the same, or "<name> Videos" when it also has photos).
 */
export function targetsOf(row: Pick<FolderRow, 'name' | 'images' | 'videos'>): { name: string; type: 'photo' | 'video' }[] {
  const out: { name: string; type: 'photo' | 'video' }[] = []
  if (row.images) out.push({ name: row.name, type: 'photo' })
  if (row.videos) out.push({ name: row.images ? videoFolderName(row.name) : row.name, type: 'video' })
  return out
}

/**
 * Why a picked folder can't be added, or null when it can: a folder it would create is already in
 * the list or already exists in this event (same name, any case), or it holds no photos.
 */
export function rejectReason(row: FolderRow, listed: string[], existing: string[]): { message: string; name: string } | null {
  const names = [row.name, ...targetsOf(row).map((t) => t.name)]
  const taken = names.find((n) => listed.some((l) => same(l, n)) || existing.some((e) => same(e, n)))
  if (taken) return { message: 'A folder with this name already exists', name: taken }
  if (row.files.length === 0) return { message: 'This folder has no photos', name: row.name }
  return null
}

const relativePathOf = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
export { relativePathOf }

/**
 * The folder a file came from, as picked: "Wedding 2024/Haldi" for Wedding 2024/Haldi/IMG_1.jpg.
 * Saved with the photo, so the original can be found again on this computer (Download Selected).
 */
export function folderPathOf(f: File): string | null {
  const parts = relativePathOf(f).split('/')
  return parts.length > 1 ? parts.slice(0, -1).join('/') : null
}

/** A "Selected - …" folder that Download Selected made (our own output), at any depth of the path. */
const isOutputFolder = (dirs: string[]) => dirs.some((d) => d.trim().startsWith(COPY_FOLDER_PREFIX))
/** Hidden and system folders: .git, .thumbnails, __MACOSX, $RECYCLE.BIN, System Volume Information. */
const SYSTEM_DIRS = ['__macosx', '$recycle.bin', 'system volume information', '@eadir']
const isHiddenFolder = (dirs: string[]) => dirs.some((d) => d.startsWith('.') || SYSTEM_DIRS.includes(d.trim().toLowerCase()))

/** Files in a picked folder that aren't uploaded, with the reason (hidden/system files aren't listed). */
export interface SkippedFile {
  name: string
  reason: string
}

/**
 * Files from <input webkitdirectory>, one album per subfolder of the picked folder (anything deeper
 * goes into that subfolder's album). Files directly in the picked folder form an album named after it.
 * Album names are the folders' exact names (ends trimmed, at most FOLDER_NAME_MAX characters).
 * Only photos count: "Selected - …" folders, hidden and system files and folders, and folders
 * without photos are skipped.
 */
export function groupInputFiles(files: ArrayLike<File>): PickedFolder[] {
  return scanInputFiles(files).folders
}

/** groupInputFiles, plus the files left out because they aren't photos (videos, documents…). */
export function scanInputFiles(files: ArrayLike<File>): { folders: PickedFolder[]; skipped: SkippedFile[] } {
  const byAlbum = new Map<string, File[]>()
  const skipped: SkippedFile[] = []
  for (const f of Array.from(files)) {
    const parts = relativePathOf(f).split('/')
    const dirs = parts.slice(0, -1)
    if (isOutputFolder(dirs) || isHiddenFolder(dirs) || isJunk(f.name)) continue
    if (!mediaOf(f.name)) {
      skipped.push({ name: relativePathOf(f), reason: 'Not a photo' })
      continue
    }
    const folder = parts.length > 2 ? parts[1] : parts.length === 2 ? parts[0] : ''
    // Only loose files (not from a picked folder) have no folder name to use.
    const album = cleanFolderName(folder) || 'Photos'
    const list = byAlbum.get(album)
    if (list) list.push(f)
    else byAlbum.set(album, [f])
  }
  return { folders: [...byAlbum].map(([name, list]) => ({ name, files: list })), skipped }
}
