import { Injectable } from '@nestjs/common'
import type { Payment, PaymentPurpose, Prisma } from '@prisma/client'
import type { PaymentDto } from '@weddyzone/shared'
import { randomToken } from '../common/util'
import type { Tx } from '../prisma/prisma.service'

export interface ChargeRequest {
  purpose: PaymentPurpose
  amountPaise: number
  description: string
  meta?: Prisma.InputJsonValue
}

/**
 * Takes money for plans and credit packs. v1 uses MockPaymentService (always
 * succeeds, "Test mode"); a Razorpay implementation can replace it by creating
 * an order here and confirming it from a webhook.
 */
export abstract class PaymentService {
  abstract readonly testMode: boolean
  abstract charge(tx: Tx, studioId: string, req: ChargeRequest): Promise<Payment>
}

@Injectable()
export class MockPaymentService extends PaymentService {
  readonly testMode = true

  async charge(tx: Tx, studioId: string, req: ChargeRequest): Promise<Payment> {
    return tx.payment.create({
      data: {
        studioId,
        purpose: req.purpose,
        amount: req.amountPaise,
        description: req.description,
        status: 'SUCCESS',
        provider: 'mock',
        providerRef: `mock_${randomToken(12)}`,
        meta: req.meta,
      },
    })
  }
}

export function paymentDto(p: Payment): PaymentDto {
  return {
    id: p.id,
    purpose: p.purpose,
    description: p.description,
    amountPaise: p.amount,
    status: p.status,
    provider: p.provider,
    createdAt: p.createdAt.toISOString(),
  }
}
