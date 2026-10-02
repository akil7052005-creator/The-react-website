import type { CookieOptions, Response } from 'express'
import { config } from '../config'

export const ACCESS_COOKIE = 'wz_at'
export const REFRESH_COOKIE = 'wz_rt'
// The refresh cookie is only ever sent to the auth routes.
export const REFRESH_COOKIE_PATH = '/api/v1/auth'

function base(): CookieOptions {
  const c = config()
  return {
    httpOnly: true,
    sameSite: c.COOKIE_SAMESITE,
    secure: c.COOKIE_SECURE || c.COOKIE_SAMESITE === 'none',
  }
}

export function setAuthCookies(res: Response, tokens: { access: string; refresh: string; refreshMaxAgeMs: number }) {
  const c = config()
  res.cookie(ACCESS_COOKIE, tokens.access, { ...base(), path: '/', maxAge: c.ACCESS_TOKEN_TTL_MINUTES * 60_000 })
  res.cookie(REFRESH_COOKIE, tokens.refresh, {
    ...base(),
    path: REFRESH_COOKIE_PATH,
    maxAge: tokens.refreshMaxAgeMs,
  })
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...base(), path: '/' })
  res.clearCookie(REFRESH_COOKIE, { ...base(), path: REFRESH_COOKIE_PATH })
}
