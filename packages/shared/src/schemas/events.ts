import { z } from 'zod'
import { ALBUM_STATUSES, EVENT_STATUSES, EVENT_TYPES } from '../enums'
import { dateSchema, optionalText, phoneSchema, requiredText, todayIST } from '../validators'
import { requiredId, uuidSchema } from './common'

const guestsSchema = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z.coerce
    .number({ error: 'Enter a number' })
    .int('Guests must be a whole number')
    .min(0, 'Guests cannot be negative')
    .max(100_000, 'That is a lot of guests — max 100,000')
    .optional(),
)

const eventFields = {
  clientId: requiredId('a client'),
  title: requiredText('Event title', 120, 3),
  type: z.enum(EVENT_TYPES, { error: 'Select an event type' }),
  date: dateSchema,
  venue: requiredText('Venue', 120, 2),
  city: requiredText('City', 60),
  guests: guestsSchema,
  notes: optionalText(1000),
}

export const createEventSchema = z
  .object(eventFields)
  .refine((v) => v.date >= todayIST(), { path: ['date'], message: 'Event date cannot be in the past' })
export type CreateEventInput = z.input<typeof createEventSchema>

export const updateEventSchema = z.object({
  ...eventFields,
  status: z.enum(EVENT_STATUSES, { error: 'Select a status' }),
})
export type UpdateEventInput = z.input<typeof updateEventSchema>

export const selectionMemberSchema = z.object({
  name: requiredText('Member name', 60),
  phone: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), phoneSchema.optional()),
})

const quotaSchema = z.coerce
  .number({ error: 'Enter the selection quota' })
  .int('Quota must be a whole number')
  .min(1, 'Quota must be at least 1 photo')
  .max(10_000, 'Quota can be at most 10,000 photos')

/** A 4-digit gallery PIN. Blank or null removes it. */
export const galleryPinSchema = z.string().trim().regex(/^\d{4}$/, 'The PIN must be 4 digits')
const optionalPin = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), galleryPinSchema.nullable().optional())

export const createSelectionSchema = z.object({
  eventId: requiredId('an event'),
  quota: quotaSchema,
  deadline: dateSchema.refine((v) => v >= todayIST(), 'Deadline cannot be in the past'),
  members: z.array(selectionMemberSchema).max(10, 'Up to 10 family members').default([]),
  // Optional: left out, the studio defaults apply.
  pin: optionalPin,
  allowDownload: z.boolean().optional(),
  watermark: z.boolean().optional(),
  notesAllowed: z.boolean().optional(),
})
export type CreateSelectionInput = z.input<typeof createSelectionSchema>

export const updateSelectionSchema = z.object({
  quota: quotaSchema,
  deadline: dateSchema,
})
export type UpdateSelectionInput = z.input<typeof updateSelectionSchema>

/** Gallery access: PIN, client downloads, watermark on previews, notes per photo. */
export const selectionAccessSchema = z.object({
  pin: optionalPin,
  allowDownload: z.boolean().optional(),
  watermark: z.boolean().optional(),
  notesAllowed: z.boolean().optional(),
})
export type SelectionAccessInput = z.input<typeof selectionAccessSchema>

export const selectionFolderSchema = z.object({ name: requiredText('Folder name', 60) })
export const unlockSelectionSchema = z.object({ reason: optionalText(200) })
export const selectionPinSchema = z.object({ pin: galleryPinSchema })

export const selectionDefaultsSchema = z.object({
  watermark: z.boolean(),
  allowDownload: z.boolean(),
  galleryDays: z.coerce.number({ error: 'Enter the number of days' }).int('Whole days only').min(1, 'At least 1 day').max(365, 'At most 365 days'),
  notesAllowed: z.boolean(),
})
export type SelectionDefaultsInput = z.input<typeof selectionDefaultsSchema>

// Public selection page (no login). memberId identifies which family member is picking.
export const pickSchema = z.object({ photoId: uuidSchema, memberId: uuidSchema })
export const commentSchema = z.object({
  photoId: uuidSchema,
  memberId: uuidSchema,
  text: requiredText('Comment', 500),
})
export const submitSelectionSchema = z.object({ memberId: uuidSchema })

export const createAlbumSchema = z.object({
  eventId: requiredId('an event'),
  title: requiredText('Album title', 80, 2),
  subtitle: optionalText(120),
  location: optionalText(80),
  photoIds: z
    .array(uuidSchema)
    .min(2, 'Choose at least 2 photos (one spread)')
    .max(400, 'An album can have at most 400 pages')
    .refine((ids) => new Set(ids).size === ids.length, 'Each photo can only be used once'),
})
export type CreateAlbumInput = z.input<typeof createAlbumSchema>

export const updateAlbumSchema = z.object({
  title: requiredText('Album title', 80, 2),
  subtitle: optionalText(120),
  location: optionalText(80),
})

export const albumPagesSchema = z.object({
  photoIds: createAlbumSchema.shape.photoIds,
})

export const albumStatusSchema = z.object({ status: z.enum(ALBUM_STATUSES) })

export const albumFeedbackSchema = z.object({
  spreadIndex: z.coerce.number().int().min(0).max(500),
  authorName: requiredText('Your name', 60),
  message: requiredText('Feedback', 1000),
})
export type AlbumFeedbackInput = z.input<typeof albumFeedbackSchema>

export const albumApprovalSchema = z.object({
  spreadIndex: z.coerce.number().int().min(0).max(500),
  authorName: requiredText('Your name', 60),
  approved: z.boolean(),
})

export const shareSchema = z.object({
  kind: z.enum(['album', 'selection']),
  id: uuidSchema,
})
export type ShareInput = z.input<typeof shareSchema>
