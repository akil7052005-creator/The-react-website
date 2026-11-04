import { Injectable } from '@nestjs/common'
import type { BillingCycle } from '@prisma/client'
import type { AdminPlanOrderDto, AdminPlanQuoteDto, PaymentDto, VerifyPaymentInput } from '@weddyzone/shared'
import { SubscriptionsService } from '../billing/subscriptions.service'
import { badRequest, notFound } from '../common/errors'
import { paymentDto, PaymentService } from '../core/payment.service'
import { PrismaService } from '../prisma/prisma.service'
import { SubscriptionLifecycleService } from './lifecycle.service'

/**
 * Admin → Studios → Change plan: a platform admin pays for a studio's plan. The price, the credit for
 * unused days and the GST come from the same quote as the studio's own checkout, worked out here on
 * the server (never from the browser). The plan is applied by the same handler as any plan payment,
 * and only once the gateway confirms it: Razorpay's signed Checkout response checked with Razorpay,
 * or Razorpay's webhook, whichever comes first (the other is a no-op). The payment records the admin.
 */
@Injectable()
export class AdminPlanPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentService,
    private readonly lifecycle: SubscriptionLifecycleService,
    private readonly subs: SubscriptionsService,
  ) {}

  /** A studio that exists, isn't removed and has a subscription. */
  private async studio(studioId: string) {
    const studio = await this.prisma.studio.findFirst({ where: { id: studioId, purgedAt: null }, select: { removedAt: true, subscription: { select: { id: true } } } })
    if (!studio) throw notFound('Studio')
    if (studio.removedAt) throw badRequest('This studio is removed. Restore it first, then change its plan.')
    if (!studio.subscription) throw badRequest("This studio doesn't have a subscription yet")
  }

  private async plan(planId: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } })
    if (!plan) throw badRequest('Unknown plan', { planId: 'Select a plan' })
    return plan
  }

  /** What the admin will pay: the plan's price (GST included), less credit for the studio's unused days. */
  async quote(studioId: string, adminId: string, planId: string, cycle: BillingCycle): Promise<AdminPlanQuoteDto> {
    await this.studio(studioId)
    const plan = await this.plan(planId)
    const q = await this.lifecycle.quote(studioId, plan.code, cycle, undefined, { adminId })
    return {
      planCode: q.planCode,
      cycle: q.cycle,
      pricePaise: q.pricePaise,
      discountPaise: q.discountPaise,
      creditPaise: q.creditPaise,
      payablePaise: q.payablePaise,
      basePaise: q.basePaise,
      gstPaise: q.gstPaise,
      planName: plan.name,
      paymentMode: this.payments.mode,
    }
  }

  /**
   * Opens the gateway order for exactly the quoted amount. Nothing about the studio's plan changes
   * here. With simulated payments (no Razorpay keys) it is confirmed at once, like a studio's checkout.
   */
  async order(studioId: string, adminId: string, planId: string, cycle: BillingCycle): Promise<AdminPlanOrderDto> {
    await this.studio(studioId)
    const plan = await this.plan(planId)
    const payment = await this.lifecycle.checkout(studioId, plan.code, cycle, undefined, { adminId })
    return { payment: paymentDto(payment), checkout: await this.subs.checkoutFor(payment), paymentMode: this.payments.mode }
  }

  /** Razorpay Checkout says it's paid: check the signature and the payment with Razorpay, then apply it (once). */
  async verify(studioId: string, paymentId: string, input: VerifyPaymentInput): Promise<{ payment: PaymentDto }> {
    const own = await this.prisma.payment.findFirst({ where: { id: paymentId, studioId, purpose: 'SUBSCRIPTION', paidByAdminId: { not: null } }, select: { id: true } })
    if (!own) throw notFound('Payment')
    const payment = await this.lifecycle.confirmCheckout(studioId, paymentId, input)
    return { payment: paymentDto(payment) }
  }
}
