import { describe, expect, it } from 'vitest'
import { ALBUM_STATUS_LABELS, isSelectionLocked, isSelectionUnshared, SELECTION_STATUS_LABELS } from './enums'
import { createSelectionSchema, galleryPinSchema, selectionAccessSchema, selectionDefaultsSchema } from './schemas/events'
import { DEFAULT_SELECTION_DEFAULTS, resolveSelectionDefaults } from './selection'

describe('selection workflow statuses', () => {
  it('labels the studio workflow', () => {
    expect(SELECTION_STATUS_LABELS).toMatchObject({ DRAFT: 'Draft', UPLOADING: 'Uploading', SENT: 'Shared', IN_PROGRESS: 'In progress', SUBMITTED: 'Submitted', DELIVERED: 'Delivered', EXPIRED: 'Expired' })
    expect(ALBUM_STATUS_LABELS).toMatchObject({ IN_REVIEW: 'In review', CHANGES_REQUESTED: 'Changes requested', APPROVED: 'Approved', PUBLISHED: 'Approved', SENT_TO_PRINT: 'Sent to print' })
  })
  it('knows locked and unshared states', () => {
    expect(['SUBMITTED', 'DELIVERED'].every((s) => isSelectionLocked(s as 'SUBMITTED'))).toBe(true)
    expect(isSelectionLocked('IN_PROGRESS')).toBe(false)
    expect(isSelectionUnshared('UPLOADING')).toBe(true)
    expect(isSelectionUnshared('SENT')).toBe(false)
  })
})

describe('gallery PIN and access', () => {
  it('accepts exactly 4 digits', () => {
    expect(galleryPinSchema.safeParse('0427').success).toBe(true)
    for (const bad of ['123', '12345', 'abcd', '12 4']) expect(galleryPinSchema.safeParse(bad).success).toBe(false)
  })
  it('treats a blank PIN as "remove"', () => {
    expect(selectionAccessSchema.parse({ pin: '' })).toEqual({ pin: null })
    expect(selectionAccessSchema.parse({})).toEqual({})
  })
  it('keeps old create requests valid (access fields optional)', () => {
    const r = createSelectionSchema.safeParse({ eventId: '7f8e0a52-8d0b-4bb8-9a51-2b7b8b1d2b11', quota: 100, deadline: '2999-01-01' })
    expect(r.success).toBe(true)
  })
})

describe('studio selection defaults', () => {
  it('fills in missing or invalid values', () => {
    expect(resolveSelectionDefaults(null)).toEqual(DEFAULT_SELECTION_DEFAULTS)
    expect(resolveSelectionDefaults({ watermark: true, galleryDays: 9999, allowDownload: 'yes' })).toEqual({ ...DEFAULT_SELECTION_DEFAULTS, watermark: true })
    expect(resolveSelectionDefaults({ galleryDays: 7, notesAllowed: false })).toMatchObject({ galleryDays: 7, notesAllowed: false })
  })
  it('validates the form', () => {
    expect(selectionDefaultsSchema.safeParse({ watermark: true, allowDownload: false, galleryDays: 0, notesAllowed: true }).success).toBe(false)
    expect(selectionDefaultsSchema.parse({ watermark: true, allowDownload: false, galleryDays: '45', notesAllowed: true }).galleryDays).toBe(45)
  })
})
