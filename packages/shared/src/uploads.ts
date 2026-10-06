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
