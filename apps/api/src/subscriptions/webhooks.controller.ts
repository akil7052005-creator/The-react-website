import { Controller, Headers, HttpCode, HttpStatus, Post, Req, type RawBodyRequest } from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'
import { ERROR_CODES } from '@weddyzone/shared'
import { createHmac, timingSafeEqual } from 'crypto'
import type { Request } from 'express'
import { z } from 'zod'
import { Public } from '../auth/auth.decorators'
import { AppError, badRequest } from '../common/errors'
import { sha256 } from '../common/util'
import { config } from '../config'
import type { GatewayWebhook } from '../core/payment.service'
import { SubscriptionLifecycleService } from './lifecycle.service'

const entity = z.object({ id: z.string().min(1) }).passthrough()
const webhookSchema = z.object({
  event: z.string().min(1),
  payload: z.object({
    payment: z.object({ entity: entity.extend({ amount: z.number().int() }) }).optional(),
    order: z.object({ entity: entity.extend({ amount: z.number().int() }) }).optional(),
    subscription: z.object({ entity }).optional(),
  }),
})

/** HMAC-SHA256 of the exact request bytes, hex — Razorpay's X-Razorpay-Signature. */
export function signWebhook(raw: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(raw).digest('hex')
}

function signatureMatches(raw: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature) return false
  const expected = Buffer.from(signWebhook(raw, secret), 'hex')
  const given = Buffer.from(signature, 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/**
 * Payment gateway → API. The only way a paid plan is activated or renewed. Signed with
 * PAYMENT_WEBHOOK_SECRET; deliveries are idempotent (the gateway retries until it gets a 2xx).
 */
@ApiExcludeController()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly lifecycle: SubscriptionLifecycleService) {}

  @Public()
  @Post('payments')
  @HttpCode(200)
  async payments(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Headers('x-razorpay-event-id') eventId: string | undefined,
  ) {
    const secret = config().PAYMENT_WEBHOOK_SECRET
    if (!secret) throw new AppError(HttpStatus.SERVICE_UNAVAILABLE, 'WEBHOOKS_DISABLED', 'Payment webhooks are not configured')
    const raw = req.rawBody
    if (!raw?.length) throw badRequest('Empty webhook body')
    if (!signatureMatches(raw, signature, secret)) {
      throw new AppError(HttpStatus.UNAUTHORIZED, ERROR_CODES.UNAUTHENTICATED, 'Invalid webhook signature')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.toString('utf8'))
    } catch {
      throw badRequest('Webhook body is not JSON')
    }
    const body = webhookSchema.safeParse(parsed)
    if (!body.success) throw badRequest('Unrecognised webhook payload')
    // Razorpay sends a unique event id header; without one the body itself identifies the delivery.
    const id = eventId?.trim() || `body_${sha256(raw)}`
    return this.lifecycle.processWebhook(id.slice(0, 200), body.data as GatewayWebhook)
  }
}
