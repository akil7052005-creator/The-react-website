import { z } from 'zod'
// Photo upload limits, set per subscription plan. Used by the API (enforcement) and the uploader
// (help text, queue size, concurrency). Each plan's `limits` JSON carries the three fields; a plan
// without them gets the Starter values.

import type { PlanCode } from './enums'
import { isReadOnlyStatus, type SubscriptionStatus } from './subscriptions'

export interface PlanUploadLimits {
  /** Largest photo accepted, in MB. */
  maxPhotoMb: number
  /** Most photos queued from one pick or drop. */
  maxFilesPerUpload: number
  /** Photos uploaded at the same time. */
  uploadConcurrency: number
}

export const PLAN_UPLOAD_LIMITS: Record<PlanCode, PlanUploadLimits> = {
  STARTER: { maxPhotoMb: 25, maxFilesPerUpload: 300, uploadConcurrency: 3 },
  PRO: { maxPhotoMb: 50, maxFilesPerUpload: 1000, uploadConcurrency: 4 },
  STUDIO: { maxPhotoMb: 80, maxFilesPerUpload: 3000, uploadConcurrency: 5 },
  ALL_ACCESS: { maxPhotoMb: 100, maxFilesPerUpload: 5000, uploadConcurrency: 6 },
}

/** The default for any field a plan doesn't set. */
export const STARTER_UPLOAD_LIMITS = PLAN_UPLOAD_LIMITS.STARTER

/** The highest per-photo size any plan allows (the hard cap the server and proxies must accept). */
export const MAX_PLAN_PHOTO_MB = 100

/** A plan's upload limits from its `limits` JSON; anything missing or invalid falls back to Starter. */
export function resolveUploadLimits(limits: Partial<Record<keyof PlanUploadLimits, unknown>> | null | undefined): PlanUploadLimits {
  const pick = (key: keyof PlanUploadLimits, max: number) => {
    const v = limits?.[key]
    return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max ? v : STARTER_UPLOAD_LIMITS[key]
  }
  return {
    maxPhotoMb: pick('maxPhotoMb', MAX_PLAN_PHOTO_MB),
    maxFilesPerUpload: pick('maxFilesPerUpload', 10_000),
    uploadConcurrency: pick('uploadConcurrency', 8),
  }
}

/**
 * Whether a studio may upload, from its subscription status: active, trial, expiring soon or a
 * failed payment → yes; in grace → yes, with a warning; expired past grace or cancelled → no.
 */
export function uploadAccess(status: SubscriptionStatus): 'allowed' | 'grace' | 'blocked' {
  if (isReadOnlyStatus(status)) return 'blocked'
  return status === 'GRACE' ? 'grace' : 'allowed'
}

/** GET /me/upload-limits */
export interface UploadLimitsDto extends PlanUploadLimits {
  planCode: PlanCode
  planName: string
  /** null = unlimited storage. */
  storageGb: number | null
  storageUsedBytes: number
  /** null = unlimited storage. */
  storageLeftBytes: number | null
  /** Expired past grace or cancelled: uploads are refused. */
  readOnly: boolean
  status: SubscriptionStatus
  /** Set while the plan is in grace: uploads work until then. */
  graceEndsAt: string | null
  /** One-click renewal page for this plan. */
  renewLink: string
}

// ---------------------------------------------------------------- previews only
//
// Original photos never leave the studio's computer. The browser makes a 2048 px preview and a
// 400 px thumbnail (WebP, or JPEG where the browser can't encode WebP), uploads both straight to
// storage with signed links, and records the original's name, path, size and SHA-256 so Download
// Selected can find the exact file again on that computer.

export const PREVIEW_EDGE_PX = 2048
export const THUMB_EDGE_PX = 400
export const PREVIEW_WEBP_QUALITY = 0.8
export const PREVIEW_JPEG_QUALITY = 0.82
export const THUMB_WEBP_QUALITY = 0.7
export const THUMB_JPEG_QUALITY = 0.72
/** The largest preview or thumbnail storage accepts. */
export const MAX_PREVIEW_BYTES = 2 * 1024 * 1024
/** About what one photo takes online (preview + thumbnail), for the "about 420 MB online" estimate. */
export const ONLINE_BYTES_PER_PHOTO = 350 * 1024

const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/i, 'Invalid fingerprint').transform((s) => s.toLowerCase())
const optionalPx = z.number().int().positive().max(100_000).nullish()

/** POST /uploads/sign: what the browser knows about one photo before it uploads the two copies. */
export const uploadSignSchema = z.object({
  selectionId: z.string().uuid(),
  /** Sent again when resuming: the same photo gets fresh links for the same keys. */
  photoId: z.string().uuid().optional(),
  folderId: z.string().uuid().nullish(),
  /** Path under the picked folder, file name included ("Wedding/Haldi/IMG_1.jpg"). */
  relativePath: z.string().trim().min(1).max(4096),
  originalName: z.string().trim().min(1).max(255),
  originalSize: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  originalWidth: optionalPx,
  originalHeight: optionalPx,
  /** File's last-modified time, ms since 1970. */
  lastModified: z.number().int().nonnegative().nullish(),
  sha256: sha256Hex,
  format: z.enum(['webp', 'jpeg']),
  previewSize: z.number().int().positive().max(MAX_PREVIEW_BYTES, 'Preview larger than 2 MB'),
  thumbSize: z.number().int().positive().max(MAX_PREVIEW_BYTES, 'Thumbnail larger than 2 MB'),
})
export type UploadSign = z.infer<typeof uploadSignSchema>

/** POST /uploads/complete: both copies are uploaded; the server checks them and records the photo. */
export const uploadCompleteSchema = uploadSignSchema.extend({ photoId: z.string().uuid() })
export type UploadComplete = z.infer<typeof uploadCompleteSchema>

export interface SignedPutDto {
  key: string
  url: string
  headers: Record<string, string>
  expiresAt: string
}

export type UploadSignDto =
  | { duplicate: false; photoId: string; preview: SignedPutDto; thumb: SignedPutDto }
  /** The same file (same path and fingerprint) is already in this event: skipped. */
  | { duplicate: true; photoId: string }

/** POST /uploads/complete */
export interface UploadCompleteDto {
  id: string
  /** Already recorded (a retried complete): nothing changed. */
  existing: boolean
}
