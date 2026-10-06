// Pure logic for "Upload Folder" (no React): which files count, reading a picked folder, and the
// checks that keep duplicate or empty folders out. Unit-tested.

import { cleanFolderName, videoFolderName } from '@weddyzone/shared'
import { isJunk } from '../photoUpload'
import { COPY_FOLDER_PREFIX } from './localCopy'

export type Media = 'image' | 'video'

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']
/** Camera RAW files: uploaded as a compressed copy of their embedded preview. */
const RAW_EXT = ['cr2', 'cr3', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'dng', 'raf', 'orf', 'rw2', 'pef', 'srw', 'x3f', '3fr', 'iiq', 'erf', 'kdc', 'mrw']
const VIDEO_EXT = ['mp4', 'mov', 'webm']

const extOf = (name: string) => (name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '')

/** Photos (JPG, JPEG, PNG, WebP, HEIC, camera RAW) and videos (MP4, MOV, WebM); null for anything else. */
export function mediaOf(name: string): Media | null {
  if (isJunk(name)) return null
  const ext = extOf(name)
  if (IMAGE_EXT.includes(ext) || RAW_EXT.includes(ext)) return 'image'
  if (VIDEO_EXT.includes(ext)) return 'video'
  return null
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

/** Keeps only photos and videos and labels the folder. */
export function toRow(folder: PickedFolder, key: string): FolderRow {
  const files = folder.files.filter((f) => mediaOf(f.name))
  const videos = files.filter((f) => mediaOf(f.name) === 'video').length
  const images = files.length - videos
  return { key, name: folder.name, files, images, videos, label: images === 0 && videos > 0 ? 'Video' : 'Photo' }
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
 * the list or already exists in this event (same name, any case), or it holds no photos/videos.
 */
export function rejectReason(row: FolderRow, listed: string[], existing: string[]): { message: string; name: string } | null {
  const names = [row.name, ...targetsOf(row).map((t) => t.name)]
  const taken = names.find((n) => listed.some((l) => same(l, n)) || existing.some((e) => same(e, n)))
  if (taken) return { message: 'A folder with this name already exists', name: taken }
  if (row.files.length === 0) return { message: 'This folder has no photos or videos', name: row.name }
  return null
}

const relativePath = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name

/**
 * The folder a file came from, as picked: "Wedding 2024/Haldi" for Wedding 2024/Haldi/IMG_1.jpg.
 * Saved with the photo, so the original can be found again on this computer (Download Selected).
 */
export function folderPathOf(f: File): string | null {
  const parts = relativePath(f).split('/')
  return parts.length > 1 ? parts.slice(0, -1).join('/') : null
}

/** A "Selected - …" folder that Download Selected made (our own output), at any depth of the path. */
const isOutputFolder = (dirs: string[]) => dirs.some((d) => d.trim().startsWith(COPY_FOLDER_PREFIX))

/**
 * Files from <input webkitdirectory>, one album per subfolder of the picked folder (anything deeper
 * goes into that subfolder's album). Files directly in the picked folder form an album named after it.
 * Album names are the folders' exact names (ends trimmed, at most FOLDER_NAME_MAX characters).
 * "Selected - …" folders and folders without photos or videos are skipped.
 */
export function groupInputFiles(files: ArrayLike<File>): PickedFolder[] {
  const byAlbum = new Map<string, File[]>()
  for (const f of Array.from(files)) {
    const parts = relativePath(f).split('/')
    if (isOutputFolder(parts.slice(0, -1)) || !mediaOf(f.name)) continue
    const folder = parts.length > 2 ? parts[1] : parts.length === 2 ? parts[0] : ''
    // Only loose files (not from a picked folder) have no folder name to use.
    const album = cleanFolderName(folder) || 'Photos'
    byAlbum.set(album, [...(byAlbum.get(album) ?? []), f])
  }
  return [...byAlbum].map(([name, list]) => ({ name, files: list }))
}
