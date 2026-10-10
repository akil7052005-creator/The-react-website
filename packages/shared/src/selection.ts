// Photo Selection helpers shared by the API and the web app.

import type { SelectionEffectiveStatus } from './enums'
import type { SelectionDefaultsDto } from './types'

/** Used until the studio saves its own defaults. */
export const DEFAULT_SELECTION_DEFAULTS: SelectionDefaultsDto = {
  watermark: false,
  allowDownload: false,
  galleryDays: 30,
  notesAllowed: false,
}

/** The studio's saved defaults (stored as JSON), with anything missing or invalid filled in. */
export function resolveSelectionDefaults(raw: unknown): SelectionDefaultsDto {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const bool = (k: keyof SelectionDefaultsDto) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : (DEFAULT_SELECTION_DEFAULTS[k] as boolean))
  const days = Number(r.galleryDays)
  return {
    watermark: bool('watermark'),
    allowDownload: bool('allowDownload'),
    notesAllowed: bool('notesAllowed'),
    galleryDays: Number.isInteger(days) && days >= 1 && days <= 365 ? days : DEFAULT_SELECTION_DEFAULTS.galleryDays,
  }
}

/** The usual wedding folders, offered when creating a folder. */
export const SUGGESTED_FOLDERS = ['Haldi', 'Mehendi', 'Wedding', 'Reception'] as const

/** "124 / 150 picked". */
export const pickedLabel = (picked: number, quota: number) => `${picked} / ${quota} picked`

// ---------------------------------------------------------------- folders

/** A photo folder takes images (JPEG, PNG, WebP); a video folder takes videos (MP4, MOV, WebM). */
export const FOLDER_TYPES = ['photo', 'video'] as const
export type FolderType = (typeof FOLDER_TYPES)[number]

/**
 * The copy customers see and pick from: at most CUSTOMER_COPY_PX on the long side, JPEG quality
 * CUSTOMER_COPY_QUALITY (standard tables, so "82" means 82). About 250–350 KB for a camera photo.
 */
export const CUSTOMER_COPY_PX = 2048
export const CUSTOMER_COPY_QUALITY = 82

/** Longest folder/album name: the Windows and macOS folder-name limit. */
export const FOLDER_NAME_MAX = 255

/**
 * A folder name as the studio named it: spaces trimmed at the ends only, everything else (dots,
 * dashes, brackets, non-English letters) kept, cut to FOLDER_NAME_MAX without splitting a character.
 */
export function cleanFolderName(raw: string, max = FOLDER_NAME_MAX): string {
  const v = raw.trim()
  if (v.length <= max) return v
  let out = ''
  for (const ch of v) {
    if (out.length + ch.length > max) break
    out += ch
  }
  return out.trimEnd()
}

/** The video folder made beside a photo folder: "<name> Videos", the name shortened so the suffix fits. */
export const videoFolderName = (name: string) => `${cleanFolderName(name, FOLDER_NAME_MAX - ' Videos'.length)} Videos`

// ---------------------------------------------------------------- event settings

export const WATERMARK_POSITIONS = ['top-left', 'top-center', 'top-right', 'center', 'bottom-left', 'bottom-center', 'bottom-right'] as const
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number]
export const WATERMARK_POSITION_LABELS: Record<WatermarkPosition, string> = {
  'top-left': 'Top Left',
  'top-center': 'Top Center',
  'top-right': 'Top Right',
  center: 'Center',
  'bottom-left': 'Bottom Left',
  'bottom-center': 'Bottom Center',
  'bottom-right': 'Bottom Right',
}

/** Gallery Expiry choices, in days from now; null = no expiry. */
export const GALLERY_EXPIRY_OPTIONS = [null, 7, 15, 30, 60, 90] as const
/** Stored as the gallery's expiry date when "No expiry" is chosen. */
export const NO_EXPIRY_DATE = '9999-12-31'

export interface WatermarkSettings {
  /** The uploaded logo (PNG), or null: the studio name is used as text. */
  logoUrl: string | null
  position: WatermarkPosition
  /** Logo width as % of the photo's width. */
  sizePct: number
  /** Gap from the nearest edges as % of the photo's width / height. */
  spacingPct: number
  opacityPct: number
  /** Put the watermark on client previews and downloads. */
  enabled: boolean
}

/** Per-event Photo Selection settings. */
export interface EventSettings {
  allowClientView: boolean
  downloadOn: boolean
  /** Client can download a whole folder as a ZIP (only with downloadOn). */
  downloadAllFolder: boolean
  /** Client must follow the studio on Instagram first (needs the studio's handle). */
  instagramFollow: boolean
  /** Client can heart photos. */
  favoriteOption: boolean
  photoNotes: boolean
  /** The chosen expiry option in days (null = no expiry), or 'custom' for a date set elsewhere. */
  galleryExpiry: number | null | 'custom'
  /** YYYY-MM-DD, or null with no expiry. */
  galleryExpiresOn: string | null
  videoDownload: boolean
  /** The client can pick photos (off: they can only look). */
  allowSelection: boolean
  /** Client previews at full size (2048 px); off: lighter 1280 px previews. */
  highQuality: boolean
  /** Picks are capped at selectionLimit; off: no cap. */
  limitOn: boolean
  selectionLimit: number
  /** Videos can be picked too (they always play). */
  videoSelection: boolean
  watermark: WatermarkSettings
  /** What the studio's plan includes: favourites on VIP only; Trial galleries stay open at most galleryDaysMax days. */
  addons: { videoDownload: boolean; favourites: boolean; galleryDaysMax: number | null }
}

export const DEFAULT_WATERMARK: Omit<WatermarkSettings, 'logoUrl' | 'enabled'> = { position: 'bottom-right', sizePct: 20, spacingPct: 2, opacityPct: 80 }

/** Settings kept in the selection's JSON column, with defaults filled in. */
export interface StoredEventSettings {
  allowClientView: boolean
  downloadAllFolder: boolean
  instagramFollow: boolean
  favoriteOption: boolean
  videoDownload: boolean
  allowSelection: boolean
  highQuality: boolean
  limitOn: boolean
  videoSelection: boolean
  galleryExpiryDays?: number | null
  watermark: { logoFileId: string | null; position: WatermarkPosition; sizePct: number; spacingPct: number; opacityPct: number }
}

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

export function resolveStoredSettings(raw: unknown): StoredEventSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const w = (r.watermark && typeof r.watermark === 'object' ? r.watermark : {}) as Record<string, unknown>
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  return {
    allowClientView: bool(r.allowClientView, true),
    downloadAllFolder: bool(r.downloadAllFolder, false),
    instagramFollow: bool(r.instagramFollow, false),
    favoriteOption: bool(r.favoriteOption, true),
    videoDownload: bool(r.videoDownload, false),
    allowSelection: bool(r.allowSelection, true),
    highQuality: bool(r.highQuality, true),
    limitOn: bool(r.limitOn, true),
    videoSelection: bool(r.videoSelection, false),
    ...(r.galleryExpiryDays === null || typeof r.galleryExpiryDays === 'number' ? { galleryExpiryDays: r.galleryExpiryDays as number | null } : {}),
    watermark: {
      logoFileId: typeof w.logoFileId === 'string' ? w.logoFileId : null,
      position: (WATERMARK_POSITIONS as readonly string[]).includes(w.position as string) ? (w.position as WatermarkPosition) : DEFAULT_WATERMARK.position,
      sizePct: clamp(w.sizePct, 5, 50, DEFAULT_WATERMARK.sizePct),
      spacingPct: clamp(w.spacingPct, 0, 20, DEFAULT_WATERMARK.spacingPct),
      opacityPct: clamp(w.opacityPct, 10, 100, DEFAULT_WATERMARK.opacityPct),
    },
  }
}

/**
 * Where the watermark goes on a photo, in pixels: `sizePct` of the photo's width wide (keeping the
 * mark's aspect ratio), `spacingPct` of the width/height away from the nearest edges. The server
 * and the live preview both use this, so they match.
 */
export function watermarkBox(
  photo: { width: number; height: number },
  mark: { width: number; height: number },
  s: Pick<WatermarkSettings, 'position' | 'sizePct' | 'spacingPct'>,
) {
  const width = Math.max(1, Math.round((photo.width * s.sizePct) / 100))
  const height = Math.max(1, Math.round((width * mark.height) / Math.max(1, mark.width)))
  const padX = Math.round((photo.width * s.spacingPct) / 100)
  const padY = Math.round((photo.height * s.spacingPct) / 100)
  const [v, h] = s.position === 'center' ? ['center', 'center'] : s.position.split('-')
  const left = h === 'left' ? padX : h === 'right' ? photo.width - width - padX : Math.round((photo.width - width) / 2)
  const top = v === 'top' ? padY : v === 'bottom' ? photo.height - height - padY : Math.round((photo.height - height) / 2)
  return { left: Math.max(0, left), top: Math.max(0, top), width: Math.min(width, photo.width), height: Math.min(height, photo.height) }
}

// ---------------------------------------------------------------- customer portal (/selection/*)

/** What the studio and the customer see: Pending until the customer submits, then Selected. (EventStatus is taken by the event lifecycle.) */
export type SelectionEventStatus = 'Pending' | 'Selected'
export const eventStatusOf = (status: SelectionEffectiveStatus): SelectionEventStatus => (status === 'SUBMITTED' || status === 'DELIVERED' ? 'Selected' : 'Pending')

/**
 * How the studio shared the selection: a Send/Share card (link, qr, sms, whatsapp), or an older
 * Send Options card (android, ios, web, all).
 */
export const SEND_VIA = ['link', 'qr', 'sms', 'whatsapp', 'android', 'ios', 'web', 'all'] as const
export type SendVia = (typeof SEND_VIA)[number]
export const SEND_VIA_LABELS: Record<SendVia, string> = {
  link: 'Copied the link',
  qr: 'Shared the QR code',
  sms: 'Sent by SMS',
  whatsapp: 'Sent on WhatsApp',
  android: 'Sent on WhatsApp (Android link)',
  ios: 'Sent on WhatsApp (iOS link)',
  web: 'Sent on WhatsApp (web link)',
  all: 'Sent on WhatsApp (all links)',
}

/** The customer's own link: /select/<share token>. */
export const selectPath = (shareToken: string) => `/select/${shareToken}`

/** Wrong customer codes on a share link before it locks, and for how long. */
export const CODE_MAX_FAILURES = 5
export const CODE_LOCK_MINUTES = 10

/** The customer code: six digits. */
export const CLIENT_CODE_RE = /^\d{6}$/

/** One photo or video in the customer portal. URLs need the client token appended (?t=). */
export interface MediaItem {
  id: string
  folderId: string | null
  type: 'photo' | 'video'
  /** Photo: the watermarked preview. Video: the video itself. */
  url: string
  thumbUrl: string
  width: number | null
  height: number | null
  selected: boolean
  /** Can be picked: photos when selection is on; videos only when video selection is on too. */
  selectable: boolean
  favorite: boolean
  note: string | null
  /** Only when the studio allows downloads. */
  downloadUrl: string | null
}

/** The Selection tab: the customer's picks, grouped by album. */
export interface ClientSelectedDto {
  groups: { folderId: string | null; folderName: string; items: MediaItem[] }[]
  total: number
}

/** What the verification screen of a share link shows before the code is entered. */
export interface ClientLinkDto {
  studio: { name: string; logoUrl: string | null }
  eventName: string
  /** The link is locked after too many wrong codes, until then. */
  lockedUntil: string | null
}

export interface ClientFolderDto {
  id: string
  name: string
  type: FolderType
  total: number
  selected: number
  cover: { type: 'photo' | 'video'; url: string } | null
  /** "Download All Folder", when allowed. */
  zipUrl: string | null
}

export interface ClientShowcaseCard {
  imageUrl: string
  title: string
  subtitle: string | null
}

export interface ClientSelectionDto {
  id: string
  code: string
  eventName: string
  customerName: string
  studio: { name: string; logoUrl: string | null }
  /** null: no limit. */
  selectionLimit: number | null
  status: SelectionEventStatus
  submittedAt: string | null
  /** Submitted: the customer can look but not change anything. */
  readOnly: boolean
  /** Last day the gallery is open (YYYY-MM-DD), or null for no expiry. */
  expiresOn: string | null
  counts: { photos: number; videos: number; favorites: number; selected: number; folders: number }
  folders: ClientFolderDto[]
  permissions: { select: boolean; favorites: boolean; notes: boolean; download: boolean; downloadAllFolder: boolean }
  /** The pick button's icon: a heart on Trial and Pro (no favourites there), a tick on VIP (the heart favourites). */
  pickIcon: 'heart' | 'tick'
  /** The studio's Gallery Banners; the web app fills in its own when there are fewer than three. */
  showcase: ClientShowcaseCard[]
}

export interface ClientItemsPage {
  items: MediaItem[]
  total: number
  page: number
  hasMore: boolean
}

export interface ClientVerifyResult {
  token: string
  selectionId: string
  /** Already submitted: the gallery opens view-only. */
  submitted: boolean
  expiresAt: string
}

export interface ClientItemResult {
  item: MediaItem
  counts: { selected: number; favorites: number }
  folder: { id: string; selected: number } | null
}
