import { Injectable } from '@nestjs/common'
import type { BillingCycle, Payment, PaymentPurpose, PlanCode, Prisma } from '@prisma/client'
import {
  CREDIT_PACKS,
  gstOn,
  renewsAutomatically,
  type CancelReason,
  type GatewayCheckoutDto,
  type ListQuery,
  type MySubscriptionBannerDto,
  type VerifyPaymentInput,
} from '@weddyzone/shared'
import { badRequest } from '../common/errors'
import { config } from '../config'
import { paginate, skipTake } from '../common/util'
import { LedgerService } from '../core/ledger.service'
import { NotificationsService } from '../core/notifications.service'
import { paymentDto, PaymentService } from '../core/payment.service'
import { PlansService, stateOf } from '../core/plans.service'
import { UsageService } from '../core/usage.service'
import { PrismaService, type Tx } from '../prisma/prisma.service'
import { renewPath } from '../subscriptions/format'
import { SubscriptionLifecycleService } from '../subscriptions/lifecycle.service'

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
    private readonly usage: UsageService,
    private readonly payments: PaymentService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly lifecycle: SubscriptionLifecycleService,
  ) {}

  async overview(studioId: string) {
    const eff = await this.plans.effective(studioId)
    const [usage, payments] = await Promise.all([
      this.usage.usage(studioId),
      this.prisma.payment.findMany({ where: { studioId }, orderBy: { createdAt: 'desc' }, take: 6 }),
    ])
    return {
      subscription: this.plans.subscriptionDto(eff),
      usage,
      recentPayments: payments.map(paymentDto),
      testMode: this.payments.testMode,
      paymentMode: this.payments.mode,
      autoRenewAvailable: this.payments.supportsAutoRenew,
    }
  }

  /** What the browser needs to open Razorpay Checkout for a pending payment; null when nothing is left to pay. */
  async checkoutFor(payment: Payment): Promise<GatewayCheckoutDto | null> {
    const keyId = this.payments.checkoutKeyId
    if (payment.status !== 'PENDING' || !keyId || !payment.gatewayOrderId) return null
    const [studio, owner] = await Promise.all([
      this.prisma.studio.findUniqueOrThrow({ where: { id: payment.studioId }, select: { name: true, email: true, phone: true } }),
      this.prisma.user.findFirst({ where: { studioId: payment.studioId, role: 'OWNER' }, select: { name: true, email: true, phone: true } }),
    ])
    return {
      provider: 'razorpay',
      keyId,
      orderId: payment.gatewayOrderId,
      paymentId: payment.id,
      amountPaise: payment.amount,
      currency: 'INR',
      name: config().PLATFORM_LEGAL_NAME,
      description: payment.description,
      prefill: { name: owner?.name ?? studio.name, email: owner?.email ?? studio.email ?? '', contact: owner?.phone ?? studio.phone ?? '' },
    }
  }

  /** A credit pack or add-on with a real gateway: a pending payment and its order; applied once paid. */
  private async openOrder(studioId: string, purpose: PaymentPurpose, amountPaise: number, gstPaise: number, description: string, meta: Prisma.InputJsonValue) {
    // An earlier checkout for the same kind of purchase left unpaid is closed (a late payment still applies).
    await this.prisma.payment.updateMany({ where: { studioId, purpose, status: 'PENDING' }, data: { status: 'FAILED', failureReason: 'Not completed' } })
    const payment = await this.prisma.payment.create({
      data: { studioId, purpose, amount: amountPaise, gst: gstPaise, description, status: 'PENDING', provider: this.payments.provider, meta },
    })
    const orderId = await this.payments.createOrder(payment).catch(async (e: unknown) => {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: 'Payment gateway unavailable' } })
      throw e
    })
    return this.prisma.payment.update({ where: { id: payment.id }, data: { gatewayOrderId: orderId, providerRef: orderId } })
  }

  /** Checkout says it's paid: confirm it with the gateway and apply it. */
  async verifyPayment(studioId: string, paymentId: string, input: VerifyPaymentInput) {
    const payment = await this.lifecycle.confirmCheckout(studioId, paymentId, input)
    return { payment: paymentDto(payment) }
  }

  /** GET /me/subscription: what the dashboard banner needs. */
  async banner(studioId: string): Promise<MySubscriptionBannerDto> {
    const eff = await this.plans.effective(studioId)
    const dto = this.plans.subscriptionDto(eff)
    return {
      planName: eff.plan.name,
      planCode: eff.plan.code,
      status: dto.status,
      endDate: dto.currentPeriodEnd,
      graceEndsAt: dto.graceEndsAt,
      daysLeft: dto.daysLeft,
      readOnly: dto.readOnly,
      autoRenew: renewsAutomatically(stateOf(eff.subscription)),
      renewLink: renewPath(eff.plan.code, eff.subscription.cycle),
    }
  }

  async paymentHistory(studioId: string, q: ListQuery) {
    const where = { studioId }
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q) }),
      this.prisma.payment.count({ where }),
    ])
    return paginate(rows.map(paymentDto), total, q)
  }

  /**
   * Upgrade/downgrade/renew. Opens a gateway order; the plan changes only when the gateway
   * confirms the payment by webhook (instantly in test mode). No proration in v1.
   */
  async changePlan(studioId: string, planCode: PlanCode, cycle: BillingCycle, couponCode?: string) {
    const payment = await this.lifecycle.checkout(studioId, planCode, cycle, couponCode)
    return {
      payment: paymentDto(payment),
      // With a real gateway the browser completes this order in Razorpay Checkout.
      checkout: await this.checkoutFor(payment),
      ...(await this.overview(studioId)),
    }
  }

  rewardReferral(tx: Tx, studioId: string) {
    return this.lifecycle.rewardReferral(tx, studioId)
  }

  async cancel(studioId: string, reason: CancelReason, details?: string) {
    await this.lifecycle.cancelAtPeriodEnd(studioId, reason, details)
    return this.overview(studioId)
  }

  async resume(studioId: string) {
    await this.lifecycle.resume(studioId)
    return this.overview(studioId)
  }

  async setAutoRenew(studioId: string, autoRenew: boolean) {
    await this.lifecycle.setAutoRenew(studioId, autoRenew)
    return this.overview(studioId)
  }

  usageMeter(studioId: string) {
    return this.usage.meter(studioId)
  }

  /**
   * Buys the plan's "+N events" add-on for the current 30-day window (unused events don't carry
   * over). Test mode charges straight away, like WhatsApp credit packs.
   */
  async buyEventAddon(studioId: string) {
    const w = await this.usage.window(studioId)
    const { addonEvents: events, addonEventsPricePaise: price } = w.quota
    if (w.lifetime || !events || price === null) throw badRequest(`Extra events aren't available on ${w.eff.plan.name}. Upgrade instead.`)
    if (w.eff.readOnly || w.eff.status === 'GRACE') throw badRequest('Renew your plan first, then add events.')
    const gst = gstOn(price)
    const description = `+${events} events (until ${w.resetsOn.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })})`
    if (!this.payments.instant) {
      const pending = await this.openOrder(studioId, 'EVENT_ADDON', price + gst, gst, description, { events, windowStart: w.start.toISOString(), basePaise: price, gstPaise: gst })
      return { payment: paymentDto(pending), usage: await this.usage.meter(studioId), ...this.mode(), checkout: await this.checkoutFor(pending) }
    }
    const payment = await this.prisma.$transaction(async (tx) => {
      const payment = await this.payments.charge(tx, studioId, {
        purpose: 'EVENT_ADDON',
        amountPaise: price + gst,
        description,
        meta: { events, windowStart: w.start.toISOString(), basePaise: price, gstPaise: gst },
      })
      await tx.payment.update({ where: { id: payment.id }, data: { gst } })
      await tx.usageAddon.create({ data: { studioId, windowStart: w.start, events, paymentId: payment.id } })
      await this.notifications.notify(studioId, { type: 'PLAN_CHANGED', title: `+${events} events`, body: 'added for this month', link: '/my-subscription', icon: 'plus-circle' }, tx)
      return payment
    })
    return { payment: paymentDto(payment), usage: await this.usage.meter(studioId), ...this.mode(), checkout: null }
  }

  private mode() {
    return { testMode: this.payments.testMode, paymentMode: this.payments.mode }
  }

  // ------------------------------------------------------------- WhatsApp credits

  async buyCredits(studioId: string, packCode: string) {
    const pack = CREDIT_PACKS.find((p) => p.code === packCode)
    if (!pack) throw badRequest('Unknown credit pack', { packCode: 'Select a pack' })
    const description = `${pack.credits.toLocaleString('en-IN')} WhatsApp credits`
    if (!this.payments.instant) {
      const pending = await this.openOrder(studioId, 'CREDIT_PACK', pack.pricePaise, 0, description, { packCode, credits: pack.credits })
      const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { creditBalance: true } })
      return { payment: paymentDto(pending), creditBalance: studio.creditBalance, ...this.mode(), checkout: await this.checkoutFor(pending) }
    }
    const { payment, creditBalance } = await this.prisma.$transaction(async (tx) => {
      const payment = await this.payments.charge(tx, studioId, {
        purpose: 'CREDIT_PACK',
        amountPaise: pack.pricePaise,
        description,
        meta: { packCode },
      })
      const creditBalance = await this.ledger.applyCredits(tx, studioId, pack.credits, 'PURCHASE', { type: 'payment', id: payment.id })
      await this.notifications.notify(
        studioId,
        { type: 'CREDITS_ADDED', title: `${pack.credits.toLocaleString('en-IN')} credits`, body: 'added to your WhatsApp balance', link: '/whatsapp-credit', icon: 'whatsapp' },
        tx,
      )
      return { payment, creditBalance }
    })
    return { payment: paymentDto(payment), creditBalance, ...this.mode(), checkout: null }
  }
}
