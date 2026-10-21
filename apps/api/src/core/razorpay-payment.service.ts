import { HttpStatus, Logger } from '@nestjs/common'
import type { Payment } from '@prisma/client'
import type { PaymentMode } from '@weddyzone/shared'
import { createHmac, timingSafeEqual } from 'crypto'
import { AppError } from '../common/errors'
import { config } from '../config'
import { MockPaymentService, PaymentService, type GatewayWebhook } from './payment.service'

const API = 'https://api.razorpay.com/v1'

/** The parts of a Razorpay payment we read. */
interface RazorpayPayment {
  id: string
  order_id: string | null
  amount: number
  currency: string
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed'
}

const gatewayDown = () => new AppError(HttpStatus.BAD_GATEWAY, 'PAYMENT_GATEWAY_ERROR', "Couldn't reach the payment gateway. Please try again in a minute.")

function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex')
  const y = Buffer.from(b, 'hex')
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y)
}

/**
 * Razorpay (one payment per period: no auto-renew mandates yet). Orders are opened here; the studio
 * pays in Razorpay Checkout; the plan, credits or add-on are applied when the payment is confirmed —
 * by Razorpay's signed webhook or by the browser's signed Checkout response, checked with Razorpay.
 */
export class RazorpayPaymentService extends PaymentService {
  readonly provider = 'razorpay'
  readonly supportsAutoRenew = false
  readonly mode: PaymentMode
  readonly testMode: boolean
  readonly checkoutKeyId: string
  private readonly logger = new Logger('Razorpay')

  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    /** Tests pass a fake; nothing else calls Razorpay. */
    private readonly http: typeof fetch = fetch,
  ) {
    super()
    this.mode = keyId.startsWith('rzp_live_') ? 'live' : 'test'
    this.testMode = this.mode !== 'live'
    this.checkoutKeyId = keyId
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
    let res: Response
    try {
      res = await this.http(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      })
    } catch (e) {
      this.logger.error(`${method} ${path}: ${(e as Error).message}`)
      throw gatewayDown()
    }
    const text = await res.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      const reason = (json as { error?: { description?: string } } | null)?.error?.description ?? text.slice(0, 200)
      this.logger.error(`${method} ${path} → ${res.status}: ${reason}`)
      throw gatewayDown()
    }
    return json as T
  }

  charge(): never {
    throw new Error('Razorpay payments are opened with createOrder and paid in Checkout')
  }

  async createOrder(payment: { id: string; amount: number }): Promise<string> {
    const order = await this.call<{ id: string }>('POST', '/orders', {
      amount: payment.amount,
      currency: 'INR',
      receipt: payment.id,
      notes: { paymentId: payment.id },
    })
    return order.id
  }

  async createGatewaySubscription(): Promise<null> {
    return null
  }

  async cancelGatewaySubscription(): Promise<void> {
    // No Razorpay mandates are created (supportsAutoRenew is false); simulated ones need nothing.
  }

  simulatedCapture(_payment: Payment): null {
    return null
  }

  simulatedRenewal(): null {
    return null
  }

  async confirmCheckout(orderId: string, gatewayPaymentId: string, signature: string): Promise<GatewayWebhook | null> {
    // Checkout signs "order_id|payment_id" with the key secret.
    const expected = createHmac('sha256', this.keySecret).update(`${orderId}|${gatewayPaymentId}`).digest('hex')
    if (!sameHex(expected, signature)) return null
    const path = `/payments/${encodeURIComponent(gatewayPaymentId)}`
    let p = await this.call<RazorpayPayment>('GET', path)
    if (p.order_id !== orderId) return null
    if (p.status === 'authorized') {
      // Accounts without automatic capture: capture it now (Razorpay refunds uncaptured payments).
      try {
        p = await this.call<RazorpayPayment>('POST', `${path}/capture`, { amount: p.amount, currency: p.currency })
      } catch {
        // Captured meanwhile (automatic capture, or the webhook's handler): read it again.
        p = await this.call<RazorpayPayment>('GET', path)
      }
    }
    if (p.status !== 'captured') return null
    return {
      event: 'payment.captured',
      payload: { payment: { entity: { id: p.id, order_id: p.order_id, amount: p.amount, status: p.status } } },
      created_at: Math.floor(Date.now() / 1000),
    }
  }
}

/** Razorpay when both keys are set; otherwise simulated payments ("Test mode, no real charge"). */
export function createPaymentService(): PaymentService {
  const { RAZORPAY_KEY_ID: id, RAZORPAY_KEY_SECRET: secret } = config()
  if (id && secret) return new RazorpayPaymentService(id, secret)
  // One key without the other is a mistake: refuse to start instead of quietly taking simulated payments.
  if (id || secret) throw new Error('Set both RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (only one is set)')
  if (config().NODE_ENV === 'production') new Logger('Payments').warn('No Razorpay keys set: payments are SIMULATED. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to take real payments.')
  return new MockPaymentService()
}
