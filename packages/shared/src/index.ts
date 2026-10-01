export * from './enums'
export * from './gst'
export * from './money'
export * from './states'
export * from './validators'
export * from './types'
export * from './schemas/common'
export * from './schemas/auth'
export * from './schemas/studio'
export * from './schemas/events'
export * from './schemas/billing'
export * from './schemas/business'

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
  INTERNAL: 'INTERNAL_ERROR',
} as const
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]
