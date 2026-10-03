import { createHmac, timingSafeEqual } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { ERROR_CODES } from '@weddyzone/shared'
import { AppError } from '../common/errors'
import { config } from '../config'

// A selection can have a 4-digit PIN. The client enters it once and gets an access key: an HMAC of
// the selection and its PIN hash, so changing or removing the PIN invalidates every key handed out.
// The key travels in the X-Gallery-Key header (API calls) or ?k= (photo URLs, which <img> can't
// add headers to). 403, not 401: a 401 makes the web app try to refresh a studio login.

/** Wrong PINs allowed before the gallery locks for PIN_LOCK_MINUTES. */
export const PIN_MAX_FAILURES = 5
export const PIN_LOCK_MINUTES = 15

const secret = () => `gallery-pin:${config().JWT_REFRESH_SECRET}`
const hmac = (data: string) => createHmac('sha256', secret()).update(data).digest('base64url')

/** Stored PIN hash, salted with the selection id. A 4-digit PIN is only as strong as the lockout. */
export const hashPin = (selectionId: string, pin: string) => hmac(`pin:${selectionId}:${pin}`)

export function pinMatches(selectionId: string, pinHash: string, pin: string) {
  return safeEqual(hashPin(selectionId, pin), pinHash)
}

/** The access key the client keeps after entering the right PIN. */
export const accessKey = (selectionId: string, pinHash: string) => hmac(`key:${selectionId}:${pinHash}`).slice(0, 32)

export function hasAccess(s: { id: string; pinHash: string | null }, key: string | undefined | null) {
  if (!s.pinHash) return true
  return !!key && safeEqual(accessKey(s.id, s.pinHash), key)
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export const pinRequired = (details: Record<string, unknown>) =>
  new AppError(HttpStatus.FORBIDDEN, ERROR_CODES.PIN_REQUIRED, 'Enter the 4-digit PIN from your photographer.', undefined, details)

export const wrongPin = (left: number) =>
  new AppError(HttpStatus.FORBIDDEN, ERROR_CODES.PIN_REQUIRED, left > 0 ? `Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Wrong PIN.', { pin: 'Wrong PIN' }, { left })

export const pinLocked = (until: Date) => {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000))
  return new AppError(HttpStatus.TOO_MANY_REQUESTS, ERROR_CODES.PIN_LOCKED, `Too many wrong PINs. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, undefined, {
    retryAt: until.toISOString(),
  })
}

/** The key from a request: header first, then ?k=. */
export function keyFrom(req: { headers: Record<string, unknown>; query?: Record<string, unknown> }) {
  const h = req.headers['x-gallery-key']
  if (typeof h === 'string' && h) return h
  const q = req.query?.k
  return typeof q === 'string' && q ? q : null
}
