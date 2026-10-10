import { Injectable } from '@nestjs/common'
import type { BillingCycle, PlanCode } from '@prisma/client'
import { CREDIT_PACKS, gstOn, renewsAutomatically, type CancelReason, type ListQuery, type MySubscriptionBannerDto } from '@weddyzone/shared'
import { badRequest } from '../common/errors'
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
    }
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
      // With a live gateway the browser completes this order in the gateway's checkout.
      checkout: payment.status === 'PENDING' ? { orderId: payment.gatewayOrderId, amountPaise: payment.amount, provider: payment.provider } : null,
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
    const payment = await this.prisma.$transaction(async (tx) => {
      const payment = await this.payments.charge(tx, studioId, {
        purpose: 'EVENT_ADDON',
        amountPaise: price + gst,
        description: `+${events} events (until ${w.resetsOn.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })})`,
        meta: { events, windowStart: w.start.toISOString(), basePaise: price, gstPaise: gst },
      })
      await tx.payment.update({ where: { id: payment.id }, data: { gst } })
      await tx.usageAddon.create({ data: { studioId, windowStart: w.start, events, paymentId: payment.id } })
      await this.notifications.notify(studioId, { type: 'PLAN_CHANGED', title: `+${events} events`, body: 'added for this month', link: '/my-subscription', icon: 'plus-circle' }, tx)
      return payment
    })
    return { payment: paymentDto(payment), usage: await this.usage.meter(studioId), testMode: this.payments.testMode }
  }

  // ------------------------------------------------------------- WhatsApp credits

  async buyCredits(studioId: string, packCode: string) {
    const pack = CREDIT_PACKS.find((p) => p.code === packCode)
    if (!pack) throw badRequest('Unknown credit pack', { packCode: 'Select a pack' })
    const { payment, creditBalance } = await this.prisma.$transaction(async (tx) => {
      const payment = await this.payments.charge(tx, studioId, {
        purpose: 'CREDIT_PACK',
        amountPaise: pack.pricePaise,
        description: `${pack.credits.toLocaleString('en-IN')} WhatsApp credits`,
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
    return { payment: paymentDto(payment), creditBalance, testMode: this.payments.testMode }
  }
}
