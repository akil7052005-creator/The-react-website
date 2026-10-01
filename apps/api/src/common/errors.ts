import { HttpStatus } from '@nestjs/common'
import { ERROR_CODES } from '@weddyzone/shared'

/** The one error type services throw. The filter turns it into { error: { code, message, fields? } }. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export const notFound = (what: string) => new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, `${what} not found`)

export const conflict = (message: string, fields?: Record<string, string>) =>
  new AppError(HttpStatus.CONFLICT, ERROR_CODES.CONFLICT, message, fields)

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new AppError(HttpStatus.BAD_REQUEST, ERROR_CODES.VALIDATION, message, fields)

export const forbidden = (message = 'You do not have access to this resource') =>
  new AppError(HttpStatus.FORBIDDEN, ERROR_CODES.FORBIDDEN, message)

export const unauthenticated = (message = 'Please log in to continue', code: string = ERROR_CODES.UNAUTHENTICATED) =>
  new AppError(HttpStatus.UNAUTHORIZED, code, message)

export const planLimit = (message: string, details: Record<string, unknown>) =>
  new AppError(HttpStatus.PAYMENT_REQUIRED, ERROR_CODES.PLAN_LIMIT, message, undefined, details)

export const insufficientCredits = (needed: number, balance: number) =>
  new AppError(
    HttpStatus.PAYMENT_REQUIRED,
    ERROR_CODES.INSUFFICIENT_CREDITS,
    `Not enough WhatsApp credits: this needs ${needed}, you have ${balance}. Top up to continue.`,
    undefined,
    { needed, balance },
  )

export const fileInvalid = (message: string, field = 'file') =>
  new AppError(HttpStatus.UNPROCESSABLE_ENTITY, ERROR_CODES.FILE_INVALID, message, { [field]: message })
