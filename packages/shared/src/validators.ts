import { z } from 'zod'

export const PHONE_REGEX = /^[6-9]\d{9}$/
export const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
export const PAN_REGEX = /^[A-Z]{5}\d{4}[A-Z]$/
export const PINCODE_REGEX = /^[1-9]\d{5}$/
export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

// Accepts "98765 43210", "+91 98765-43210", "09876543210" and returns the bare 10 digits.
export function normalizePhoneDigits(input: string): string {
  let digits = input.replace(/[^\d]/g, '')
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return digits
}

/** Indian mobile number. Output is stored as +91XXXXXXXXXX. */
export const phoneSchema = z
  .string({ error: 'Mobile number is required' })
  .trim()
  .min(1, 'Mobile number is required')
  .transform(normalizePhoneDigits)
  .refine((d) => PHONE_REGEX.test(d), 'Enter a valid 10-digit Indian mobile number')
  .transform((d) => `+91${d}`)

export const emailSchema = z
  .string({ error: 'Email is required' })
  .trim()
  .min(1, 'Email is required')
  .max(254, 'Email is too long')
  .toLowerCase()
  .pipe(z.email('Enter a valid email address'))

export const passwordSchema = z
  .string({ error: 'Password is required' })
  .min(1, 'Password is required')
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain a letter and a number')

export const panSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => PAN_REGEX.test(v), 'Enter a valid PAN (e.g. ABCDE1234F)')

export const pincodeSchema = z
  .string()
  .trim()
  .refine((v) => PINCODE_REGEX.test(v), 'Enter a valid 6-digit PIN code')

export const gstinFormatSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => GSTIN_REGEX.test(v), 'Enter a valid 15-character GSTIN')

/** True when the GSTIN's first two digits equal the state code. */
export function gstinMatchesState(gstin: string, stateCode: string): boolean {
  return gstin.slice(0, 2) === stateCode
}

export function isValidDateString(v: string): boolean {
  if (!DATE_REGEX.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

export const dateSchema = z
  .string({ error: 'Date is required' })
  .trim()
  .min(1, 'Date is required')
  .refine(isValidDateString, 'Enter a valid date')

/** Today's date (YYYY-MM-DD) in India, where every studio operates. */
export function todayIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now)
}

export function hasMaxTwoDecimals(n: number): boolean {
  return Math.abs(Math.round(n * 100) - n * 100) < 1e-6
}

/** Rupee amount typed by a user: > 0 and at most 2 decimal places. */
export const amountSchema = z.coerce
  .number({ error: 'Enter an amount' })
  .refine((n) => Number.isFinite(n), 'Enter an amount')
  .refine((n) => n > 0, 'Amount must be greater than 0')
  .refine(hasMaxTwoDecimals, 'Use at most 2 decimal places')
  .refine((n) => n <= 10_000_000, 'Amount is too large')

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .optional()
    .transform((v) => (v ? v : undefined))

export const requiredText = (label: string, max: number, min = 1) => {
  // Empty → "is required" (checked first), too short → "at least N characters".
  const base = z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
  return (min > 1 ? base.min(min, `${label} must be at least ${min} characters`) : base).max(
    max,
    `${label} must be at most ${max} characters`,
  )
}

/** An empty string from a form becomes undefined; anything else is validated by `schema`. */
export function emptyToUndefined<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional())
}

const YOUTUBE_RE = /^https:\/\/(www\.)?(youtube\.com\/(watch\?v=|embed\/|shorts\/)|youtu\.be\/)[\w-]{6,}/
const VIMEO_RE = /^https:\/\/(www\.|player\.)?vimeo\.com\/(video\/)?\d+/

export function isVideoUrl(v: string): boolean {
  return YOUTUBE_RE.test(v) || VIMEO_RE.test(v)
}

export const urlSchema = z
  .string()
  .trim()
  .max(500, 'URL is too long')
  .refine((v) => /^https?:\/\/[^\s.]+\.[^\s]+$/.test(v), 'Enter a valid URL starting with http:// or https://')

export const DOMAIN_REGEX = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
