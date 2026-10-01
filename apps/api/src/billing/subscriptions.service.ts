import { HttpStatus, Injectable } from '@nestjs/common'
import type { BillingCycle, PlanCode } from '@prisma/client'
import { CREDIT_PACKS, ERROR_CODES, REFERRAL_REWARD_PAISE, type ListQuery } from '@weddyzone/shared'
import { AppError, badRequest, conflict } from '../common/errors'
import { paginate, skipTake } from '../common/util'
import { LedgerService } from '../core/ledger.service'
import { NotificationsService } from '../core/notifications.service'
import { paymentDto, PaymentService } from '../core/payment.service'
import { PlansService } from '../core/plans.service'
import { UsageService } from '../core/usage.service'
import { PrismaService, type Tx } from '../prisma/prisma.service'

function addPeriod(from: Date, cycle: BillingCycle): Date {
  const d = new Date(from)
  if (cycle === 'YEARLY') d.setUTCFullYear(d.getUTCFullYear() + 1)
  else d.setUTCMonth(d.getUTCMonth() + 1)
  return d
}

const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
    private readonly usage: UsageService,
    private readonly payments: PaymentService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
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

  async paymentHistory(studioId: string, q: ListQuery) {
    const where = { studioId }
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q) }),
      this.prisma.payment.count({ where }),
    ])
    return paginate(rows.map(paymentDto), total, q)
  }

  /**
   * Upgrade/downgrade/renew. The mock payment always succeeds; the plan applies
   * immediately with a fresh period (no proration in v1).
   */
  async changePlan(studioId: string, planCode: PlanCode, cycle: BillingCycle) {
    const plan = await this.plans.byCode(planCode)
    if (!plan.isActive) throw badRequest('This plan is not available', { planCode: 'This plan is not available' })
    const price = cycle === 'YEARLY' ? plan.yearlyPrice : plan.monthlyPrice
    if (price === null) {
      throw badRequest(`${plan.name} is billed yearly only`, { cycle: `${plan.name} is available on yearly billing only` })
    }
    const eff = await this.plans.effective(studioId)
    const s = eff.subscription
    if (!eff.lapsed && !s.isTrial && !s.cancelAtPeriodEnd && s.planId === plan.id && s.cycle === cycle) {
      throw conflict(`You're already on the ${plan.name} plan (${cycle.toLowerCase()})`)
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const now = new Date()
      const payment = await this.payments.charge(tx, studioId, {
        purpose: 'SUBSCRIPTION',
        amountPaise: price,
        description: `${plan.name} plan · ${cycle === 'YEARLY' ? 'Yearly' : 'Monthly'}`,
        meta: { planCode, cycle, previousPlan: eff.plan.code },
      })
      await tx.subscription.update({
        where: { studioId },
        data: {
          planId: plan.id,
          cycle,
          status: 'ACTIVE',
          isTrial: false,
          currentPeriodStart: now,
          currentPeriodEnd: addPeriod(now, cycle),
          cancelAtPeriodEnd: false,
          cancelledAt: null,
        },
      })
      const included = this.plans.limits(plan).includedCredits
      if (included > 0) {
        await this.ledger.applyCredits(tx, studioId, included, 'PLAN_GRANT', { type: 'payment', id: payment.id })
      }
      await this.rewardReferral(tx, studioId)
      await this.notifications.notify(
        studioId,
        {
          type: 'PLAN_CHANGED',
          title: `${plan.name} plan`,
          body: `is now active (${cycle.toLowerCase()})${included ? ` · ${included.toLocaleString('en-IN')} WhatsApp credits added` : ''}`,
          link: '/my-subscription',
          icon: 'patch-check',
        },
        tx,
      )
      return payment
    })
    return { payment: paymentDto(result), ...(await this.overview(studioId)) }
  }

  /**
   * ₹1,500 to both studios the first time a referred studio pays for a plan.
   * The conditional status update (PENDING → REWARDED) plus unique wallet
   * transaction keys make this safe to call any number of times.
   */
  async rewardReferral(tx: Tx, studioId: string) {
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
    await this.notifications.notify(
      referral.referrerStudioId,
      {
        type: 'REFERRAL_REWARD',
        title: referred.name,
        body: `upgraded — ${inr(amount)} added to your wallet`,
        link: '/refer-and-earn',
        icon: 'gift',
      },
      tx,
    )
    await this.notifications.notify(
      studioId,
      { type: 'REFERRAL_REWARD', title: 'Referral bonus', body: `${inr(amount)} welcome credit added to your wallet`, link: '/refer-and-earn', icon: 'gift' },
      tx,
    )
    return true
  }

  async cancel(studioId: string) {
    const eff = await this.plans.effective(studioId)
    if (eff.lapsed || eff.subscription.cancelAtPeriodEnd) throw conflict('Your plan is already cancelled')
    if (eff.plan.code === 'STARTER' && eff.subscription.isTrial) {
      throw new AppError(HttpStatus.CONFLICT, ERROR_CODES.CONFLICT, 'Your free trial ends on its own — there is nothing to cancel.')
    }
    await this.prisma.subscription.update({
      where: { studioId },
      data: { cancelAtPeriodEnd: true, cancelledAt: new Date() },
    })
    return this.overview(studioId)
  }

  async resume(studioId: string) {
    const eff = await this.plans.effective(studioId)
    if (eff.lapsed) throw conflict('This plan has ended. Choose a plan to subscribe again.')
    if (!eff.subscription.cancelAtPeriodEnd) throw conflict('Your plan is not cancelled')
    await this.prisma.subscription.update({ where: { studioId }, data: { cancelAtPeriodEnd: false, cancelledAt: null } })
    return this.overview(studioId)
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
