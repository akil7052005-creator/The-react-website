import { describe, expect, it } from 'vitest'
import { PLAN_UPLOAD_LIMITS, resolveUploadLimits, STARTER_UPLOAD_LIMITS, uploadAccess } from './uploads'

describe('plan upload limits', () => {
  it('has the agreed values per plan', () => {
    expect(PLAN_UPLOAD_LIMITS).toEqual({
      STARTER: { maxPhotoMb: 25, maxFilesPerUpload: 300, uploadConcurrency: 3 },
      PRO: { maxPhotoMb: 50, maxFilesPerUpload: 1000, uploadConcurrency: 4 },
      STUDIO: { maxPhotoMb: 80, maxFilesPerUpload: 3000, uploadConcurrency: 5 },
      ALL_ACCESS: { maxPhotoMb: 100, maxFilesPerUpload: 5000, uploadConcurrency: 6 },
    })
  })

  it("reads a plan's own values", () => {
    expect(resolveUploadLimits({ maxPhotoMb: 50, maxFilesPerUpload: 1000, uploadConcurrency: 4 })).toEqual(PLAN_UPLOAD_LIMITS.PRO)
  })

  it('uses the Starter value for any missing field', () => {
    expect(resolveUploadLimits({})).toEqual(STARTER_UPLOAD_LIMITS)
    expect(resolveUploadLimits(null)).toEqual(STARTER_UPLOAD_LIMITS)
    expect(resolveUploadLimits({ maxPhotoMb: 80 })).toEqual({ maxPhotoMb: 80, maxFilesPerUpload: 300, uploadConcurrency: 3 })
  })

  it('ignores invalid values (hand-edited JSON) instead of trusting them', () => {
    expect(resolveUploadLimits({ maxPhotoMb: 0, maxFilesPerUpload: -5, uploadConcurrency: 2.5 })).toEqual(STARTER_UPLOAD_LIMITS)
    expect(resolveUploadLimits({ maxPhotoMb: '50', uploadConcurrency: 99 })).toEqual(STARTER_UPLOAD_LIMITS)
    expect(resolveUploadLimits({ maxPhotoMb: 500 }).maxPhotoMb).toBe(25) // above the 100 MB hard cap
  })
})

describe('upload access by subscription status', () => {
  it('allows active, trial, expiring and failed-payment plans', () => {
    for (const s of ['ACTIVE', 'TRIAL', 'EXPIRING_SOON', 'PAYMENT_FAILED'] as const) expect(uploadAccess(s)).toBe('allowed')
  })
  it('allows uploads in grace, with a warning', () => {
    expect(uploadAccess('GRACE')).toBe('grace')
  })
  it('blocks expired-past-grace and cancelled plans', () => {
    expect(uploadAccess('EXPIRED')).toBe('blocked')
    expect(uploadAccess('CANCELLED')).toBe('blocked')
  })
})
