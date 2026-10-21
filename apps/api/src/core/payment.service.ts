import { Injectable } from '@nestjs/common'
import type { Payment, PaymentPurpose, Prisma } from '@prisma/client'
import type { PaymentDto, PaymentMode } from '@weddyzone/shared'
import { randomToken } from '../common/util'
import type { Tx } from '../prisma/prisma.service'

export interface ChargeRequest {
  purpose: PaymentPurpose
  amountPaise: number
  description: string
  meta?: Prisma.InputJsonValue
}

/** Webhook body in the gateway's (Razorpay's) format. */
export interface GatewayWebhook {
  event: string
  payload: {
    payment?: { entity: { id: string; order_id?: string | null; amount: number; status?: string; error_description?: string | null; subscription_id?: string | null } }
    order?: { entity: { id: string; amount: number } }
    subscription?: { entity: { id: string; status?: string } }
  }
  created_at?: number
}

/**
 * Takes money. Credit packs are charged directly (`charge`). Plans never activate from the
 * browser: the API opens an order (`createOrder`) and the plan is applied only when the
 * gateway's signed webhook confirms the payment (POST /webhooks/payments).
 *
 * Without Razorpay keys MockPaymentService runs ("Test mode, no real charge"): it confirms every
 * order at once by handing a gateway-format webhook to the same handler. RazorpayPaymentService
 * returns a real order id instead: the studio pays in Razorpay Checkout, and Razorpay's webhook (or
 * the browser's signed Checkout response, checked with Razorpay) confirms it.
 */
export abstract class PaymentService {
  /** No real money moves (simulated payments, or the gateway's test keys). */
  abstract readonly testMode: boolean
  abstract readonly provider: string
  abstract readonly mode: PaymentMode
  /** The gateway can charge each period by itself (auto-renew mandates). */
  abstract readonly supportsAutoRenew: boolean
  /** The public key the browser opens Checkout with; null when payments are simulated. */
  abstract readonly checkoutKeyId: string | null
  /** Simulated payments complete at once; a real gateway needs its Checkout first. */
  get instant(): boolean {
    return this.mode === 'mock'
  }
  /** Simulated only: takes the money at once (credit packs, add-ons). */
  abstract charge(tx: Tx, studioId: string, req: ChargeRequest): Promise<Payment>
  /** Gateway order id for a pending plan payment. */
  abstract createOrder(payment: { id: string; amount: number }): Promise<string>
  /** Gateway subscription (auto-renew mandate) id, or null when the gateway can't renew on its own. */
  abstract createGatewaySubscription(sub: { id: string; planCode: string; cycle: string }): Promise<string | null>
  abstract cancelGatewaySubscription(id: string): Promise<void>
  /** Test mode: the webhook the gateway would send once an order is paid. Null with a real gateway. */
  abstract simulatedCapture(payment: Payment): GatewayWebhook | null
  /** Test mode: the webhook for an automatic renewal charge. Null with a real gateway. */
  abstract simulatedRenewal(gatewaySubscriptionId: string, amountPaise: number): GatewayWebhook | null
  /**
   * A real gateway: the payment the browser's Checkout reported, once its signature checks out and
   * the gateway confirms it was captured, as the webhook the gateway sends for it. Null otherwise.
   */
  abstract confirmCheckout(orderId: string, gatewayPaymentId: string, signature: string): Promise<GatewayWebhook | null>
}

@Injectable()
export class MockPaymentService extends PaymentService {
  readonly testMode = true
  readonly provider = 'mock'
  readonly mode = 'mock' as const
  readonly supportsAutoRenew = true
  readonly checkoutKeyId = null

  async charge(tx: Tx, studioId: string, req: ChargeRequest): Promise<Payment> {
    return tx.payment.create({
      data: {
        studioId,
        purpose: req.purpose,
        amount: req.amountPaise,
        description: req.description,
        status: 'SUCCESS',
        provider: this.provider,
        providerRef: `mock_${randomToken(12)}`,
        meta: req.meta,
        paidAt: new Date(),
      },
    })
  }

  async createOrder(): Promise<string> {
    return `order_mock_${randomToken(12)}`
  }

  async createGatewaySubscription(): Promise<string> {
    return `sub_mock_${randomToken(12)}`
  }

  async cancelGatewaySubscription(): Promise<void> {}

  simulatedCapture(payment: Payment): GatewayWebhook {
    return {
      event: 'payment.captured',
      payload: { payment: { entity: { id: `pay_mock_${randomToken(12)}`, order_id: payment.gatewayOrderId, amount: payment.amount, status: 'captured' } } },
      created_at: Math.floor(Date.now() / 1000),
    }
  }

  async confirmCheckout(): Promise<null> {
    return null
  }

  simulatedRenewal(gatewaySubscriptionId: string, amountPaise: number): GatewayWebhook {
    return {
      event: 'subscription.charged',
      payload: {
        subscription: { entity: { id: gatewaySubscriptionId, status: 'active' } },
        payment: { entity: { id: `pay_mock_${randomToken(12)}`, amount: amountPaise, status: 'captured', subscription_id: gatewaySubscriptionId } },
      },
      created_at: Math.floor(Date.now() / 1000),
    }
  }
}

export function paymentDto(p: Payment): PaymentDto {
  return {
    id: p.id,
    purpose: p.purpose,
    description: p.description,
    amountPaise: p.amount,
    gstPaise: p.gst,
    status: p.status,
    provider: p.provider,
    invoiceNumber: p.invoiceNumber,
    paidAt: p.paidAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  }
}
