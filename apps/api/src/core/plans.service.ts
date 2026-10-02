import { Injectable } from '@nestjs/common'
import type { Plan, Subscription } from '@prisma/client'
import type { AdminPlanDto, PlanDto, PlanLimits, SubscriptionDto } from '@weddyzone/shared'
import { notFound } from '../common/errors'
import { PrismaService, type Tx } from '../prisma/prisma.service'

export interface EffectiveSubscription {
  subscription: Subscription
  plan: Plan
  /** True when a cancelled subscription has run out and the studio fell back to Starter. */
  lapsed: boolean
}

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  limits(plan: Plan): PlanLimits {
    return plan.limits as unknown as PlanLimits
  }

  toDto(plan: Plan): PlanDto {
    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      tagline: plan.tagline,
      monthlyPricePaise: plan.monthlyPrice,
      yearlyPricePaise: plan.yearlyPrice,
      limits: this.limits(plan),
      features: plan.features as string[],
      comingSoon: plan.comingSoon as string[],
      popular: plan.popular,
    }
  }

  toAdminDto(plan: Plan): AdminPlanDto {
    return { ...this.toDto(plan), isActive: plan.isActive }
  }

  /** Every plan, hidden ones included (platform admins). */
  async listAll(): Promise<Plan[]> {
    return this.prisma.plan.findMany({ orderBy: { sortOrder: 'asc' } })
  }

  async list(): Promise<Plan[]> {
    return this.prisma.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } })
  }

  async byCode(code: Plan['code'], db: Tx | PrismaService = this.prisma): Promise<Plan> {
    const plan = await db.plan.findUnique({ where: { code } })
    if (!plan) throw notFound('Plan')
    return plan
  }

  /**
   * The plan a studio is on right now. No background jobs: a subscription that
   * was cancelled at period end is treated as Starter once that date passes.
   */
  async effective(studioId: string, db: Tx | PrismaService = this.prisma): Promise<EffectiveSubscription> {
    const subscription = await db.subscription.findUnique({ where: { studioId }, include: { plan: true } })
    if (!subscription) throw notFound('Subscription')
    if (subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd < new Date()) {
      const starter = await this.byCode('STARTER', db)
      return { subscription, plan: starter, lapsed: true }
    }
    return { subscription, plan: subscription.plan, lapsed: false }
  }

  subscriptionDto(eff: EffectiveSubscription): SubscriptionDto {
    const { subscription: s, plan, lapsed } = eff
    const price = s.cycle === 'YEARLY' ? plan.yearlyPrice : (plan.monthlyPrice ?? plan.yearlyPrice)
    return {
      plan: this.toDto(plan),
      cycle: s.cycle,
      status: lapsed || s.cancelAtPeriodEnd ? 'CANCELLED' : 'ACTIVE',
      isTrial: s.isTrial && !lapsed,
      currentPeriodStart: s.currentPeriodStart.toISOString(),
      currentPeriodEnd: s.currentPeriodEnd.toISOString(),
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      pricePaise: price,
    }
  }
}
