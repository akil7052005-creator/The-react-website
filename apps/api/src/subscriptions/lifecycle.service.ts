import { Injectable, Logger } from '@nestjs/common'
import { Prisma, type BillingCycle, type Payment, type Plan, type Subscription, type SubscriptionEventType } from '@prisma/client'
import {
  addCycle,
  addDays,
  amountInWords,
  computeStatus,
  financialYearStart,
  gstOn,
  istDate,
  istParts,
  platformInvoiceNumber,
  REFERRAL_REWARD_PAISE,
  type PlanCode,
  type ReminderChannel,
} from '@weddyzone/shared'
import { CYCLE_LABELS, CYCLE_MONTHS, proratedCredit } from '@weddyzone/shared'
import { badRequest, conflict, notFound } from '../common/errors'
import { randomToken } from '../common/util'
import { config } from '../config'
import { LedgerService } from '../core/ledger.service'
import { type GatewayWebhook, PaymentService } from '../core/payment.service'
import { PlansService, priceFor, stateOf } from '../core/plans.service'
import { SettingsService } from '../core/settings.service'
import { PrismaService, type Tx } from '../prisma/prisma.service'
import { AlertsService, type QueuedAlert } from './alerts.service'
import { absoluteUrl, cycleLabel, inr, istDay, renewPath } from './format'

type SubWithPlan = Subscription & { plan: Plan }

export interface WebhookResult {
  duplicate: boolean
  handled: string
}

/** Monthly-equivalent list price, to tell an upgrade from a downgrade. */
function monthlyEquivalent(plan: Plan, cycle: BillingCycle): number {
  const price = priceFor(plan, cycle) ?? priceFor(plan, 'MONTHLY') ?? priceFor(plan, 'YEARLY') ?? 0
  return price / (priceFor(plan, cycle) !== null ? CYCLE_MONTHS[cycle] : priceFor(plan, 'MONTHLY') !== null ? 1 : 12)
}

const listPrice = (plan: Plan, cycle: BillingCycle): number | null => priceFor(plan, cycle)

/**
 * Everything that changes a subscription: purchases and renewals (only ever from a confirmed
 * gateway payment), failed payments, and admin actions. Each change writes a SubscriptionEvent
 * and queues its alerts in the same transaction; alerts are dispatched after commit.
 */
@Injectable()
export class SubscriptionLifecycleService {
  private readonly logger = new Logger('Subscriptions')

  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
    private readonly settings: SettingsService,
    private readonly payments: PaymentService,
    private readonly ledger: LedgerService,
    private readonly alerts: AlertsService,
  ) {}

  // ------------------------------------------------------------------ checkout

  /**
   * Opens a gateway order for a plan. Nothing about the subscription changes here: the plan is
   * applied when the gateway confirms the payment by webhook. In test mode the mock gateway
   * confirms straight away through that same webhook handler.
   */
  async checkout(studioId: string, planCode: PlanCode, cycle: BillingCycle, couponCode?: string): Promise<Payment> {
    const plan = await this.plans.byCode(planCode)
    if (!plan.isActive) throw badRequest('This plan is not available', { planCode: 'This plan is not available' })
    const base = listPrice(plan, cycle)
    if (base === null) {
      throw badRequest(`${plan.name} isn't sold for ${CYCLE_LABELS[cycle]}`, { cycle: `${plan.name} isn't available for ${CYCLE_LABELS[cycle]}` })
    }
    const eff = await this.plans.effective(studioId)
    const s = eff.subscription
    if (eff.status === 'ACTIVE' && !s.isTrial && !s.cancelAtPeriodEnd && s.planId === plan.id && s.cycle === cycle) {
      throw conflict(`You're already on the ${plan.name} plan (${CYCLE_LABELS[cycle]})`)
    }
    // Changing plan (or period) mid-way: the unused days of what was paid count towards the new plan.
    const changing = !s.isTrial && !eff.readOnly && !(s.planId === plan.id && s.cycle === cycle) && s.currentPeriodEnd > new Date()
    const prorationPaise = changing ? Math.min(Math.max(0, base - 100), proratedCredit(Math.max(0, s.amountPaid - s.gstAmount), s.currentPeriodStart, s.currentPeriodEnd)) : 0

    let coupon: { id: string; percentOff: number } | null = null
    if (couponCode) {
      const c = await this.prisma.coupon.findUnique({ where: { code: couponCode } })
      if (!c || c.redeemedAt || c.expiresAt < new Date() || (c.subscriptionId && c.subscriptionId !== s.id)) {
        throw badRequest('This coupon is not valid', { couponCode: 'This coupon is invalid, used or expired' })
      }
      coupon = { id: c.id, percentOff: c.percentOff }
    }
    const discount = coupon ? Math.round((base * coupon.percentOff) / 100) : 0
    const taxable = Math.max(100, base - discount - prorationPaise)
    const gst = gstOn(taxable)

    let payment = await this.prisma.payment.create({
      data: {
        studioId,
        purpose: 'SUBSCRIPTION',
        description: `${plan.name} plan · ${cycleLabel(cycle)}${coupon ? ` · ${coupon.percentOff}% off` : ''}${prorationPaise ? ` · ${inr(prorationPaise)} credit for unused days` : ''}`,
        amount: taxable + gst,
        gst,
        status: 'PENDING',
        provider: this.payments.provider,
        subscriptionId: s.id,
        planId: plan.id,
        cycle,
        meta: { planCode, cycle, previousPlan: eff.plan.code, basePaise: base, discountPaise: discount, prorationPaise, couponId: coupon?.id ?? null },
      },
    })
    const orderId = await this.payments.createOrder(payment)
    payment = await this.prisma.payment.update({ where: { id: payment.id }, data: { gatewayOrderId: orderId, providerRef: orderId } })

    const simulated = this.payments.simulatedCapture(payment)
    if (simulated) {
      await this.processWebhook(`evt_mock_${randomToken(12)}`, simulated)
      payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })
    }
    return payment
  }

  // ------------------------------------------------------------------ webhooks

  /**
   * Applies one gateway webhook. Idempotent twice over: the event id is recorded (a retried
   * delivery is a no-op) and payments are matched by their unique gateway ids.
   */
  async processWebhook(eventId: string, body: GatewayWebhook): Promise<WebhookResult> {
    const queued: QueuedAlert[] = []
    let handled = 'ignored'
    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.webhookEvent.create({ data: { id: eventId, provider: this.payments.provider, type: body.event } })
          handled = await this.dispatchEvent(tx, body, queued)
        },
        { timeout: 20_000 },
      )
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && String(e.meta?.modelName ?? e.meta?.target).match(/webhook/i)) {
        return { duplicate: true, handled: 'duplicate' }
      }
      throw e
    }
    await this.alerts.dispatch(queued)
    return { duplicate: false, handled }
  }

  private async dispatchEvent(tx: Tx, body: GatewayWebhook, queued: QueuedAlert[]): Promise<string> {
    const pay = body.payload.payment?.entity
    switch (body.event) {
      case 'payment.captured':
      case 'order.paid': {
        if (!pay) return 'ignored'
        // Auto-renewal charges arrive as subscription.charged; their payment.captured has no order.
        const orderId = pay.order_id ?? body.payload.order?.entity.id
        if (!orderId) return 'ignored'
        return this.applyCapture(tx, orderId, pay.id, pay.amount, queued)
      }
      case 'subscription.charged': {
        const gsub = body.payload.subscription?.entity
        if (!gsub || !pay) return 'ignored'
        return this.applyRenewal(tx, gsub.id, pay.id, pay.amount, queued)
      }
      case 'payment.failed': {
        if (!pay) return 'ignored'
        return this.applyFailure(tx, pay.id, pay.order_id ?? null, pay.subscription_id ?? null, pay.error_description ?? 'Payment declined', queued)
      }
      case 'subscription.halted':
      case 'subscription.cancelled':
      case 'subscription.completed': {
        const gsub = body.payload.subscription?.entity
        if (!gsub) return 'ignored'
        const sub = await tx.subscription.findUnique({ where: { gatewaySubscriptionId: gsub.id } })
        if (!sub) return 'ignored'
        await tx.subscription.update({ where: { id: sub.id }, data: { autoRenew: false, gatewaySubscriptionId: null } })
        await this.event(tx, sub.id, 'AUTO_RENEW_CHANGED', { note: `Auto-renew stopped by the payment gateway (${body.event})` })
        return 'auto_renew_stopped'
      }
      default:
        return 'ignored'
    }
  }

  private async lockSubscription(tx: Tx, where: { studioId: string } | { id: string }): Promise<SubWithPlan> {
    if ('id' in where) await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${where.id}::uuid FOR UPDATE`
    else await tx.$queryRaw`SELECT id FROM subscriptions WHERE studio_id = ${where.studioId}::uuid FOR UPDATE`
    const sub = await tx.subscription.findUnique({ where, include: { plan: true } })
    if (!sub) throw notFound('Subscription')
    return sub
  }

  private async nextInvoiceNumber(tx: Tx, at: Date): Promise<string> {
    const fy = financialYearStart(istDate(at))
    const row = await tx.platformCounter.upsert({
      where: { key: `invoice:${fy}` },
      create: { key: `invoice:${fy}`, value: 1 },
      update: { value: { increment: 1 } },
    })
    return platformInvoiceNumber(fy, row.value)
  }

  /** A paid order: create or renew the subscription, issue the GST invoice, alert studio and admin. */
  private async applyCapture(tx: Tx, orderId: string, gatewayPaymentId: string, amount: number, queued: QueuedAlert[]): Promise<string> {
    const payment = await tx.payment.findUnique({ where: { gatewayOrderId: orderId }, include: { plan: true } })
    if (!payment || payment.purpose !== 'SUBSCRIPTION' || !payment.plan || !payment.cycle) return 'unknown_order'
    if (payment.status === 'SUCCESS') return 'already_paid'
    if (amount !== payment.amount) {
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: `Amount mismatch: gateway ${amount}, expected ${payment.amount}` } })
      queued.push(
        ...(await this.alerts.queue(
          {
            to: { type: 'ADMIN' },
            channels: ['IN_APP', 'EMAIL'],
            dedupe: `mismatch:${payment.id}`,
            type: 'PAYMENT_FAILED',
            title: 'Payment amount mismatch',
            message: `Order ${orderId} was paid ${inr(amount)} but ${inr(payment.amount)} was expected. The plan was not activated; check the gateway.`,
            icon: 'exclamation-triangle',
            subscriptionId: payment.subscriptionId ?? undefined,
          },
          tx,
        )),
      )
      return 'amount_mismatch'
    }

    const now = new Date()
    const plan = payment.plan
    const cycle = payment.cycle
    const sub = await this.lockSubscription(tx, { studioId: payment.studioId })
    const settings = await this.settings.alerts()
    const prevStatus = computeStatus(stateOf(sub), now, settings)
    const sameTerms = sub.planId === plan.id && sub.cycle === cycle && !sub.isTrial && prevStatus !== 'CANCELLED'

    // Renewing the same plan continues from the current deadline, so paying early loses nothing.
    const continues = sameTerms && sub.currentPeriodEnd > now
    const start = continues ? sub.currentPeriodEnd : now
    const anchorDay = continues ? (sub.anchorDay ?? istParts(sub.currentPeriodStart).day) : istParts(now).day
    const end = addCycle(start, cycle, anchorDay)

    let type: SubscriptionEventType
    if (sameTerms) type = 'RENEWED'
    else if (sub.isTrial || prevStatus === 'CANCELLED' || prevStatus === 'EXPIRED') type = 'CREATED'
    else type = monthlyEquivalent(plan, cycle) >= monthlyEquivalent(sub.plan, sub.cycle) ? 'UPGRADED' : 'DOWNGRADED'

    // A different plan needs a new auto-renew mandate at the new price.
    let gatewaySubscriptionId = sub.gatewaySubscriptionId
    if (gatewaySubscriptionId && !sameTerms) {
      await this.payments.cancelGatewaySubscription(gatewaySubscriptionId)
      gatewaySubscriptionId = null
    }
    if (sub.autoRenew && !gatewaySubscriptionId) {
      gatewaySubscriptionId = await this.payments.createGatewaySubscription({ id: sub.id, planCode: plan.code, cycle })
    }

    const next = {
      planId: plan.id,
      cycle,
      isTrial: false,
      // Monthly limits reset every 30 days from the plan's start: a renewal keeps the dates.
      usageAnchor: type === 'RENEWED' ? (sub.usageAnchor ?? sub.currentPeriodStart) : start,
      currentPeriodStart: start,
      currentPeriodEnd: end,
      graceEndsAt: null,
      anchorDay,
      amountPaid: payment.amount,
      gstAmount: payment.gst,
      lastPaymentFailedAt: null,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      cancelReason: null,
      cancelDetails: null,
      gatewaySubscriptionId,
    }
    const status = computeStatus({ ...stateOf({ ...sub, ...next }), status: 'ACTIVE' }, now, settings)
    await tx.subscription.update({ where: { id: sub.id }, data: { ...next, status } })

    const invoiceNumber = await this.nextInvoiceNumber(tx, now)
    const paid = await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'SUCCESS', gatewayPaymentId, paidAt: now, periodStart: start, periodEnd: end, invoiceNumber, subscriptionId: sub.id },
    })
    const couponId = (payment.meta as { couponId?: string | null } | null)?.couponId
    if (couponId) await tx.coupon.update({ where: { id: couponId }, data: { redeemedAt: now, paymentId: payment.id } })

    const included = this.plans.limits(plan).includedCredits
    if (included > 0) await this.ledger.applyCredits(tx, payment.studioId, included, 'PLAN_GRANT', { type: 'payment', id: payment.id })
    await this.rewardReferral(tx, payment.studioId, queued)

    await this.event(tx, sub.id, type, { fromPlan: sub.isTrial ? `${sub.plan.name} (trial)` : sub.plan.name, toPlan: plan.name, amount: payment.amount, note: `Invoice ${invoiceNumber}` })

    const studio = await tx.studio.findUniqueOrThrow({ where: { id: payment.studioId } })
    const label = `${plan.name} (${cycleLabel(cycle)})`
    queued.push(
      ...(await this.alerts.queue(
        {
          to: { type: 'STUDIO', studioId: studio.id },
          channels: ['IN_APP', 'EMAIL'],
          dedupe: `purchase:${payment.id}`,
          type: 'SUBSCRIPTION_PURCHASED',
          title: `${plan.name} plan`,
          message: `is now active (${CYCLE_LABELS[cycle]}) until ${istDay(end)}${included ? ` · ${included.toLocaleString('en-IN')} WhatsApp credits added` : ''}`,
          link: '/my-subscription',
          icon: 'patch-check',
          subscriptionId: sub.id,
          email: { subject: `Payment received: ${label} · invoice ${invoiceNumber}`, text: this.invoiceEmail(studio.name, paid, label, start, end) },
        },
        tx,
      )),
      ...(await this.alerts.queue(
        {
          to: { type: 'ADMIN' },
          channels: ['IN_APP', 'EMAIL'],
          dedupe: `purchase:${payment.id}`,
          type: 'SUBSCRIPTION_PURCHASED',
          title: `${studio.name} chose ${label}`,
          message: `${inr(payment.amount - payment.gst)} + GST · ${type === 'RENEWED' ? 'renewal' : type.toLowerCase()} · expires ${istDay(end)}`,
          link: `/admin/subscriptions/${sub.id}`,
          icon: 'cash-coin',
          subscriptionId: sub.id,
          email: {
            subject: `New subscription: ${studio.name} chose ${label}, ${inr(payment.amount - payment.gst)} + GST`,
            text: `${studio.name} chose ${label}, ${inr(payment.amount - payment.gst)} + ${inr(payment.gst)} GST, expires ${istDay(end)}.\nInvoice ${invoiceNumber}.\n\n${absoluteUrl(`/admin/subscriptions/${sub.id}`)}`,
          },
        },
        tx,
      )),
    )
    return 'activated'
  }

  private invoiceEmail(studioName: string, p: Payment, label: string, start: Date, end: Date): string {
    const c = config()
    return [
      `Hi ${studioName},`,
      '',
      `Thank you — your payment for the ${label} plan was received. Your plan runs from ${istDay(start)} to ${istDay(end)}.`,
      '',
      `Tax invoice ${p.invoiceNumber}`,
      `Seller: ${c.PLATFORM_LEGAL_NAME}${c.PLATFORM_GSTIN ? ` · GSTIN ${c.PLATFORM_GSTIN}` : ''}`,
      `Amount (before GST): ${inr(p.amount - p.gst)}`,
      `GST @ 18%: ${inr(p.gst)}`,
      `Total paid: ${inr(p.amount)} (${amountInWords(p.amount)})`,
      '',
      `View or print the invoice: ${absoluteUrl(`/my-subscription/invoices/${p.id}`)}`,
    ].join('\n')
  }

  /** A gateway auto-renewal charge: extend by one cycle from the deadline and say so. */
  private async applyRenewal(tx: Tx, gatewaySubscriptionId: string, gatewayPaymentId: string, amount: number, queued: QueuedAlert[]): Promise<string> {
    const found = await tx.subscription.findUnique({ where: { gatewaySubscriptionId } })
    if (!found) return 'unknown_subscription'
    if (await tx.payment.findUnique({ where: { gatewayPaymentId } })) return 'already_paid'
    const sub = await this.lockSubscription(tx, { id: found.id })
    const now = new Date()
    const settings = await this.settings.alerts()
    const continues = sub.currentPeriodEnd > now || computeStatus(stateOf(sub), now, settings) === 'GRACE'
    const start = continues ? sub.currentPeriodEnd : now
    const anchorDay = continues ? (sub.anchorDay ?? istParts(sub.currentPeriodStart).day) : istParts(now).day
    const end = addCycle(start, sub.cycle, anchorDay)
    const gst = amount - Math.round((amount * 100) / 118)
    const invoiceNumber = await this.nextInvoiceNumber(tx, now)
    const payment = await tx.payment.create({
      data: {
        studioId: sub.studioId,
        purpose: 'SUBSCRIPTION',
        description: `${sub.plan.name} plan · ${cycleLabel(sub.cycle)} · auto-renewal`,
        amount,
        gst,
        status: 'SUCCESS',
        provider: this.payments.provider,
        providerRef: gatewayPaymentId,
        gatewayPaymentId,
        subscriptionId: sub.id,
        planId: sub.planId,
        cycle: sub.cycle,
        periodStart: start,
        periodEnd: end,
        invoiceNumber,
        paidAt: now,
      },
    })
    const next = { currentPeriodStart: start, currentPeriodEnd: end, graceEndsAt: null, anchorDay, amountPaid: amount, gstAmount: gst, lastPaymentFailedAt: null }
    const status = computeStatus({ ...stateOf({ ...sub, ...next }), status: 'ACTIVE' }, now, settings)
    await tx.subscription.update({ where: { id: sub.id }, data: { ...next, status } })
    const included = this.plans.limits(sub.plan).includedCredits
    if (included > 0) await this.ledger.applyCredits(tx, sub.studioId, included, 'PLAN_GRANT', { type: 'payment', id: payment.id })
    await this.event(tx, sub.id, 'RENEWED', { fromPlan: sub.plan.name, toPlan: sub.plan.name, amount, note: `Auto-renewal · invoice ${invoiceNumber}` })

    const studio = await tx.studio.findUniqueOrThrow({ where: { id: sub.studioId } })
    const label = `${sub.plan.name} (${cycleLabel(sub.cycle)})`
    queued.push(
      ...(await this.alerts.queue(
        {
          to: { type: 'STUDIO', studioId: sub.studioId },
          channels: ['IN_APP', 'EMAIL', 'WHATSAPP'],
          dedupe: `renewal:${payment.id}`,
          type: 'SUBSCRIPTION_RENEWED',
          title: 'Renewed successfully',
          message: `Your ${label} plan renewed until ${istDay(end)} · ${inr(amount)} charged`,
          link: '/my-subscription',
          icon: 'arrow-repeat',
          subscriptionId: sub.id,
          email: { subject: `Renewed successfully: ${label} · invoice ${invoiceNumber}`, text: this.invoiceEmail(studio.name, payment, label, start, end) },
          whatsapp: { template: 'PLAN_RENEWED', vars: { studioName: studio.name, planName: sub.plan.name, date: istDay(end) } },
        },
        tx,
      )),
      ...(await this.alerts.queue(
        {
          to: { type: 'ADMIN' },
          channels: ['IN_APP'],
          dedupe: `renewal:${payment.id}`,
          type: 'SUBSCRIPTION_RENEWED',
          title: `${studio.name} auto-renewed ${label}`,
          message: `${inr(amount - gst)} + GST · next deadline ${istDay(end)}`,
          link: `/admin/subscriptions/${sub.id}`,
          icon: 'arrow-repeat',
          subscriptionId: sub.id,
        },
        tx,
      )),
    )
    return 'renewed'
  }

  private async applyFailure(
    tx: Tx,
    gatewayPaymentId: string,
    orderId: string | null,
    gatewaySubscriptionId: string | null,
    reason: string,
    queued: QueuedAlert[],
  ): Promise<string> {
    const payment = orderId ? await tx.payment.findUnique({ where: { gatewayOrderId: orderId }, include: { plan: true } }) : null
    if (payment?.status === 'SUCCESS') return 'already_paid'
    const sub = payment?.subscriptionId
      ? await tx.subscription.findUnique({ where: { id: payment.subscriptionId }, include: { plan: true } })
      : gatewaySubscriptionId
        ? await tx.subscription.findUnique({ where: { gatewaySubscriptionId }, include: { plan: true } })
        : null
    if (!sub) return 'unknown_payment'
    const now = new Date()
    if (payment) await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: reason.slice(0, 300) } })
    const settings = await this.settings.alerts()
    const status = computeStatus({ ...stateOf(sub), lastPaymentFailedAt: now }, now, settings)
    await tx.subscription.update({ where: { id: sub.id }, data: { lastPaymentFailedAt: now, status } })

    const plan = payment?.plan ?? sub.plan
    const cycle = payment?.cycle ?? sub.cycle
    await this.event(tx, sub.id, 'PAYMENT_FAILED', { toPlan: plan.name, amount: payment?.amount ?? null, note: reason.slice(0, 300) })
    const studio = await tx.studio.findUniqueOrThrow({ where: { id: sub.studioId } })
    const retry = renewPath(plan.code, cycle)
    queued.push(
      ...(await this.alerts.queue(
        {
          to: { type: 'STUDIO', studioId: sub.studioId },
          channels: ['IN_APP', 'EMAIL', 'WHATSAPP'],
          dedupe: `payfail:${gatewayPaymentId}`,
          type: 'PAYMENT_FAILED',
          title: 'Payment failed',
          message: `Your payment for the ${plan.name} plan didn't go through (${reason}). Please try again.`,
          link: retry,
          icon: 'exclamation-octagon',
          subscriptionId: sub.id,
          whatsapp: { template: 'PLAN_PAYMENT_FAILED', vars: { studioName: studio.name, planName: plan.name, link: absoluteUrl(retry) } },
        },
        tx,
      )),
      ...(await this.alerts.queue(
        {
          to: { type: 'ADMIN' },
          channels: ['IN_APP', 'EMAIL'],
          dedupe: `payfail:${gatewayPaymentId}`,
          type: 'PAYMENT_FAILED',
          title: `Payment failed: ${studio.name}`,
          message: `${plan.name} (${cycleLabel(cycle)})${payment ? ` · ${inr(payment.amount - payment.gst)} + GST` : ''} · ${reason}`,
          link: `/admin/subscriptions/${sub.id}`,
          icon: 'exclamation-octagon',
          subscriptionId: sub.id,
        },
        tx,
      )),
    )
    return 'payment_failed'
  }

  /**
   * ₹1,500 to both studios the first time a referred studio pays for a plan.
   * The conditional status update (PENDING → REWARDED) plus unique wallet
   * transaction keys make this safe to call any number of times.
   */
  async rewardReferral(tx: Tx, studioId: string, queued: QueuedAlert[] = []) {
    const referral = await tx.referral.findUnique({ where: { referredStudioId: studioId } })
    if (!referral || referral.status !== 'PENDING') return false
    const claimed = await tx.referral.updateMany({
      where: { id: referral.id, status: 'PENDING' },
      data: { status: 'REWARDED', rewardedAt: new Date() },
    })
    if (claimed.count === 0) return false
    const amount = referral.rewardAmount || REFERRAL_REWARD_PAISE
    await this.ledger.creditWallet(tx, referral.referrerStudioId, amount, 'REFERRAL_REWARD', referral.id)
    await this.ledger.creditWallet(tx, studioId, amount, 'REFERRAL_WELCOME', referral.id)
    const referred = await tx.studio.findUniqueOrThrow({ where: { id: studioId }, select: { name: true } })
    queued.push(
      ...(await this.alerts.queue(
        {
          to: { type: 'STUDIO', studioId: referral.referrerStudioId },
          channels: ['IN_APP'],
          type: 'REFERRAL_REWARD',
          title: referred.name,
          message: `upgraded — ${inr(amount)} added to your wallet`,
          link: '/refer-and-earn',
          icon: 'gift',
        },
        tx,
      )),
      ...(await this.alerts.queue(
        { to: { type: 'STUDIO', studioId }, channels: ['IN_APP'], type: 'REFERRAL_REWARD', title: 'Referral bonus', message: `${inr(amount)} welcome credit added to your wallet`, link: '/refer-and-earn', icon: 'gift' },
        tx,
      )),
    )
    return true
  }

  async event(
    tx: Tx | PrismaService,
    subscriptionId: string,
    type: SubscriptionEventType,
    data: { fromPlan?: string | null; toPlan?: string | null; amount?: number | null; actorId?: string | null; note?: string | null } = {},
  ) {
    await tx.subscriptionEvent.create({ data: { subscriptionId, type, ...data } })
  }

  // ------------------------------------------------------------------ studio actions

  async cancelAtPeriodEnd(studioId: string, reason: Subscription['cancelReason'], details: string | undefined) {
    const eff = await this.plans.effective(studioId)
    const s = eff.subscription
    if (eff.readOnly || s.cancelAtPeriodEnd) throw conflict('Your plan is already cancelled')
    if (s.isTrial) throw conflict('Your free trial ends on its own — there is nothing to cancel.')
    if (s.gatewaySubscriptionId) await this.payments.cancelGatewaySubscription(s.gatewaySubscriptionId)
    const queued = await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: s.id },
        data: { cancelAtPeriodEnd: true, cancelledAt: new Date(), cancelReason: reason, cancelDetails: details ?? null, autoRenew: false, gatewaySubscriptionId: null },
      })
      await this.event(tx, s.id, 'CANCELLED', { fromPlan: eff.plan.name, note: `Studio cancelled at period end (${reason})${details ? `: ${details}` : ''}` })
      const studio = await tx.studio.findUniqueOrThrow({ where: { id: studioId } })
      return this.alerts.queue(
        {
          to: { type: 'ADMIN' },
          channels: ['IN_APP'],
          type: 'SUBSCRIPTION_CANCELLED',
          title: `${studio.name} cancelled ${eff.plan.name}`,
          message: `Reason: ${reason?.toLowerCase().replace(/_/g, ' ')}${details ? ` — "${details}"` : ''} · ends ${istDay(s.currentPeriodEnd)}`,
          link: `/admin/subscriptions/${s.id}`,
          icon: 'x-octagon',
          subscriptionId: s.id,
        },
        tx,
      )
    })
    await this.alerts.dispatch(queued)
  }

  async resume(studioId: string) {
    const eff = await this.plans.effective(studioId)
    if (eff.readOnly) throw conflict('This plan has ended. Choose a plan to subscribe again.')
    if (!eff.subscription.cancelAtPeriodEnd) throw conflict('Your plan is not cancelled')
    await this.prisma.subscription.update({ where: { studioId }, data: { cancelAtPeriodEnd: false, cancelledAt: null, cancelReason: null, cancelDetails: null } })
  }

  async setAutoRenew(studioId: string, autoRenew: boolean) {
    const eff = await this.plans.effective(studioId)
    const s = eff.subscription
    if (autoRenew && (s.isTrial || eff.readOnly)) throw conflict('Choose a paid plan first, then turn on auto-renew.')
    if (autoRenew && s.cancelAtPeriodEnd) throw conflict('Resume your plan first, then turn on auto-renew.')
    if (s.autoRenew === autoRenew) return
    let gatewaySubscriptionId = s.gatewaySubscriptionId
    if (autoRenew && !gatewaySubscriptionId) gatewaySubscriptionId = await this.payments.createGatewaySubscription({ id: s.id, planCode: eff.plan.code, cycle: s.cycle })
    if (!autoRenew && gatewaySubscriptionId) {
      await this.payments.cancelGatewaySubscription(gatewaySubscriptionId)
      gatewaySubscriptionId = null
    }
    const settings = await this.settings.alerts()
    const status = computeStatus(stateOf({ ...s, autoRenew, gatewaySubscriptionId }), new Date(), settings)
    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({ where: { id: s.id }, data: { autoRenew, gatewaySubscriptionId, status } })
      await this.event(tx, s.id, 'AUTO_RENEW_CHANGED', { note: autoRenew ? 'Studio turned on auto-renew' : 'Studio turned off auto-renew' })
    })
  }

  // ------------------------------------------------------------------ admin actions

  /** Moves the deadline N days forward (from today if it has already passed). */
  async extend(id: string, days: number, note: string, actorId: string) {
    const now = new Date()
    const settings = await this.settings.alerts()
    const { sub, end, queued } = await this.prisma.$transaction(async (tx) => {
      const sub = await this.lockSubscription(tx, { id })
      const base = sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now
      const end = addDays(base, days)
      const next = { currentPeriodEnd: end, graceEndsAt: null }
      // An extension also reopens a plan an admin had cancelled.
      const status = computeStatus({ ...stateOf({ ...sub, ...next }), status: 'ACTIVE' }, now, settings)
      await tx.subscription.update({ where: { id }, data: { ...next, status, ...(sub.status === 'CANCELLED' ? { cancelledAt: null } : {}) } })
      await this.event(tx, id, 'EXTENDED_BY_ADMIN', { fromPlan: sub.plan.name, toPlan: sub.plan.name, actorId, note: `+${days} day${days === 1 ? '' : 's'} (${istDay(sub.currentPeriodEnd)} → ${istDay(end)}): ${note}` })
      const queued = await this.alerts.queue(
        {
          to: { type: 'STUDIO', studioId: sub.studioId },
          channels: ['IN_APP'],
          type: 'SUBSCRIPTION_CHANGED',
          title: 'Plan extended',
          message: `Your ${sub.plan.name} plan now runs until ${istDay(end)}`,
          link: '/my-subscription',
          icon: 'calendar-plus',
          subscriptionId: id,
        },
        tx,
      )
      return { sub, end, queued }
    })
    await this.alerts.dispatch(queued)
    return { sub, end }
  }

  /** Puts the studio on another plan/cycle without a payment; the deadline stays. */
  async adminChangePlan(id: string, planId: string, cycle: BillingCycle, note: string, actorId: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } })
    if (!plan) throw badRequest('Unknown plan', { planId: 'Select a plan' })
    if (priceFor(plan, cycle) === null && !plan.code.startsWith('STARTER')) throw badRequest(`${plan.name} isn't sold for ${CYCLE_LABELS[cycle]}`, { billingCycle: `${plan.name} isn't available for ${CYCLE_LABELS[cycle]}` })
    const settings = await this.settings.alerts()
    const { sub, queued } = await this.prisma.$transaction(async (tx) => {
      const sub = await this.lockSubscription(tx, { id })
      if (sub.planId === plan.id && sub.cycle === cycle) throw conflict(`Already on ${plan.name} (${CYCLE_LABELS[cycle]})`)
      const status = computeStatus(stateOf({ ...sub, isTrial: false }), new Date(), settings)
      await tx.subscription.update({ where: { id }, data: { planId: plan.id, cycle, isTrial: false, status } })
      await this.event(tx, id, 'PLAN_CHANGED_BY_ADMIN', {
        fromPlan: `${sub.plan.name} (${cycleLabel(sub.cycle)})`,
        toPlan: `${plan.name} (${cycleLabel(cycle)})`,
        actorId,
        note,
      })
      const queued = await this.alerts.queue(
        {
          to: { type: 'STUDIO', studioId: sub.studioId },
          channels: ['IN_APP'],
          type: 'SUBSCRIPTION_CHANGED',
          title: `${plan.name} plan`,
          message: `Wedmanage moved your studio to ${plan.name} (${CYCLE_LABELS[cycle]}) until ${istDay(sub.currentPeriodEnd)}`,
          link: '/my-subscription',
          icon: 'patch-check',
          subscriptionId: id,
        },
        tx,
      )
      return { sub, queued }
    })
    await this.alerts.dispatch(queued)
    return { sub, plan }
  }

  /** Ends the plan now: the studio turns read-only (nothing is deleted). */
  async adminCancel(id: string, note: string, actorId: string) {
    const { sub, queued } = await this.prisma.$transaction(async (tx) => {
      const sub = await this.lockSubscription(tx, { id })
      if (sub.status === 'CANCELLED') throw conflict('This subscription is already cancelled')
      await tx.subscription.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), autoRenew: false, gatewaySubscriptionId: null } })
      await this.event(tx, id, 'CANCELLED', { fromPlan: sub.plan.name, actorId, note: `Cancelled by admin: ${note}` })
      const queued = await this.alerts.queue(
        {
          to: { type: 'STUDIO', studioId: sub.studioId },
          channels: ['IN_APP', 'EMAIL'],
          type: 'SUBSCRIPTION_CANCELLED',
          title: 'Plan cancelled',
          message: `Your ${sub.plan.name} plan was cancelled by Wedmanage. Your studio is read-only; your photos and albums are safe. Contact support or choose a plan to continue.`,
          link: '/subscriptions',
          icon: 'x-octagon',
          subscriptionId: id,
        },
        tx,
      )
      return { sub, queued }
    })
    if (sub.gatewaySubscriptionId) await this.payments.cancelGatewaySubscription(sub.gatewaySubscriptionId).catch((e) => this.logger.warn(`Gateway cancel failed: ${(e as Error).message}`))
    await this.alerts.dispatch(queued)
    return sub
  }

  /** "Send reminder now": a reminder about the current deadline on the chosen channels. */
  async remindNow(id: string, channels: ReminderChannel[]) {
    const sub = await this.prisma.subscription.findUnique({ where: { id }, include: { plan: true, studio: true } })
    if (!sub) throw notFound('Subscription')
    const settings = await this.settings.alerts()
    const status = computeStatus(stateOf(sub), new Date(), settings)
    const link = renewPath(sub.plan.code, sub.cycle)
    const date = istDay(sub.currentPeriodEnd)
    const message =
      status === 'GRACE'
        ? `Your ${sub.plan.name} plan expired on ${date}. Renew soon to keep adding events and uploads.`
        : status === 'EXPIRED' || status === 'CANCELLED'
          ? `Your ${sub.plan.name} plan has ended and your studio is read-only. Renew any time to continue.`
          : `Your ${sub.plan.name} plan expires on ${date}.`
    return this.alerts.send({
      to: { type: 'STUDIO', studioId: sub.studioId },
      channels,
      type: 'SUBSCRIPTION_REMINDER',
      title: 'Plan reminder',
      message,
      link,
      icon: 'alarm',
      subscriptionId: id,
      email: { subject: `Your Wedmanage ${sub.plan.name} plan`, text: `Hi ${sub.studio.name},\n\n${message}\n\nRenew in one click: ${absoluteUrl(link)}` },
      whatsapp:
        status === 'GRACE'
          ? { template: 'PLAN_EXPIRED_GRACE', vars: { studioName: sub.studio.name, planName: sub.plan.name, date, graceDays: String(settings.graceDays), link: absoluteUrl(link) } }
          : status === 'EXPIRED' || status === 'CANCELLED'
            ? { template: 'PLAN_READ_ONLY', vars: { studioName: sub.studio.name, planName: sub.plan.name, link: absoluteUrl(link) } }
            : { template: 'PLAN_EXPIRY_REMINDER', vars: { studioName: sub.studio.name, planName: sub.plan.name, date, link: absoluteUrl(link) } },
    })
  }
}
