import { Throttle } from '@nestjs/throttler'
import { config } from '../config'

/** Strict limit for login/signup/password endpoints (per IP, per minute). */
export const AuthThrottle = () => Throttle({ default: { limit: config().RATE_LIMIT_AUTH_PER_MIN, ttl: 60_000 } })

/** Limit for unauthenticated public pages (selection, album, website, leads). */
export const PublicThrottle = () => Throttle({ default: { limit: config().RATE_LIMIT_PUBLIC_PER_MIN, ttl: 60_000 } })
