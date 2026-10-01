import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common'
import { ThrottlerException } from '@nestjs/throttler'
import { Prisma } from '@prisma/client'
import type { ApiErrorBody } from '@weddyzone/shared'
import { ERROR_CODES } from '@weddyzone/shared'
import type { Response } from 'express'
import { ZodError } from 'zod'
import { AppError } from './errors'

const STATUS_CODES: Record<number, string> = {
  400: ERROR_CODES.VALIDATION,
  401: ERROR_CODES.UNAUTHENTICATED,
  403: ERROR_CODES.FORBIDDEN,
  404: ERROR_CODES.NOT_FOUND,
  409: ERROR_CODES.CONFLICT,
  413: ERROR_CODES.FILE_INVALID,
  429: ERROR_CODES.RATE_LIMITED,
}

export function zodFields(err: ZodError): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const issue of err.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_'
    if (!fields[key]) fields[key] = issue.message
  }
  return fields
}

interface Normalized {
  status: number
  body: ApiErrorBody & { error: { details?: Record<string, unknown> } }
}

export function normalizeError(exception: unknown): Normalized {
  const make = (status: number, code: string, message: string, fields?: Record<string, string>, details?: Record<string, unknown>) => ({
    status,
    body: { error: { code, message, ...(fields ? { fields } : {}), ...(details ? { details } : {}) } },
  })

  if (exception instanceof AppError) {
    return make(exception.status, exception.code, exception.message, exception.fields, exception.details)
  }
  if (exception instanceof ZodError) {
    const fields = zodFields(exception)
    const first = Object.values(fields)[0] ?? 'Invalid input'
    return make(HttpStatus.BAD_REQUEST, ERROR_CODES.VALIDATION, `Please fix the highlighted fields: ${first}`, fields)
  }
  if (exception instanceof ThrottlerException) {
    return make(HttpStatus.TOO_MANY_REQUESTS, ERROR_CODES.RATE_LIMITED, 'Too many requests. Please wait a minute and try again.')
  }
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    if (exception.code === 'P2002') return make(HttpStatus.CONFLICT, ERROR_CODES.CONFLICT, 'This record already exists')
    if (exception.code === 'P2025') return make(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Record not found')
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus()
    const res = exception.getResponse()
    let message = typeof res === 'string' ? res : ((res as { message?: string | string[] }).message ?? exception.message)
    if (Array.isArray(message)) message = message.join(', ')
    if (status === 404 && /^Cannot (GET|POST|PUT|PATCH|DELETE)/.test(String(message))) message = 'Route not found'
    if (status === 413) message = 'File is too large'
    return make(status, STATUS_CODES[status] ?? (status >= 500 ? ERROR_CODES.INTERNAL : 'HTTP_ERROR'), String(message))
  }
  const raw = exception as { type?: string; status?: number }
  if (raw?.type === 'entity.parse.failed') {
    return make(HttpStatus.BAD_REQUEST, ERROR_CODES.VALIDATION, 'The request body is not valid JSON')
  }
  if (raw?.type === 'entity.too.large') {
    return make(HttpStatus.PAYLOAD_TOO_LARGE, ERROR_CODES.VALIDATION, 'The request body is too large')
  }
  return make(HttpStatus.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL, 'Something went wrong on our side. Please try again.')
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors')

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>()
    const { status, body } = normalizeError(exception)
    if (status >= 500) this.logger.error(exception instanceof Error ? exception.stack : String(exception))
    if (res.headersSent) return
    res.status(status).json(body)
  }
}
