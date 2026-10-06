export * from './enums'
export * from './gst'
export * from './money'
export * from './states'
export * from './validators'
export * from './types'
export * from './subscriptions'
export * from './uploads'
export * from './selection'
export * from './schemas/common'
export * from './schemas/auth'
export * from './schemas/studio'
export * from './schemas/events'
export * from './schemas/billing'
export * from './schemas/business'
export * from './schemas/subscriptions'

export const ERROR_CODES = {
  VALIDATION: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PLAN_LIMIT: 'PLAN_LIMIT',
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
  QUOTA_LOCKED: 'QUOTA_LOCKED',
  READ_ONLY: 'READ_ONLY',
  RATE_LIMITED: 'RATE_LIMITED',
  FILE_INVALID: 'FILE_INVALID',
  EMAIL_FAILED: 'EMAIL_FAILED',
  OTP_REQUIRED: 'OTP_REQUIRED',
  SUBSCRIPTION_READ_ONLY: 'SUBSCRIPTION_READ_ONLY',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  PIN_REQUIRED: 'PIN_REQUIRED',
  PIN_LOCKED: 'PIN_LOCKED',
  GALLERY_CLOSED: 'GALLERY_CLOSED',
  GALLERY_EXPIRED: 'GALLERY_EXPIRED',
  /** The customer portal token is missing, expired or for another event: enter the code again. */
  CLIENT_AUTH: 'CLIENT_AUTH_REQUIRED',
  INTERNAL: 'INTERNAL_ERROR',
} as const
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]
