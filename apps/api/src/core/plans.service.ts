import { Injectable } from '@nestjs/common'
import type { Plan, Subscription } from '@prisma/client'
import {
  computeStatus,
  daysLeft,
  isReadOnlyStatus,
  type AdminPlanDto,
  type AlertSettings,
  type PlanDto,
  type PlanLimits,
  type SubscriptionDto,
  type SubscriptionState,
  type SubscriptionStatus,
} from '@weddyzone/shared'
import { notFound } from '../common/errors'
import { PrismaService, type Tx } from '../prisma/prisma.service'
import { SettingsService } from './settings.service'

export interface EffectiveSubscription {
  subscription: Subscription
  plan: Plan
  /** Recomputed from the dates at read time (the stored status may be up to an hour old). */
  status: SubscriptionStatus
  /** Expired or cancelled: the studio can view but not create events, albums or uploads. */
  readOnly: boolean
}

/** The fields computeStatus needs, from a subscription row. */
export function stateOf(s: Subscription): SubscriptionState {
  return {
    status: s.status,
    isTrial: s.isTrial,
    startDate: s.currentPeriodStart,
    endDate: s.currentPeriodEnd,
    graceEndsAt: s.graceEndsAt,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    autoRenew: s.autoRenew,
    gatewaySubscriptionId: s.gatewaySubscriptionId,
    lastPaymentFailedAt: s.lastPaymentFailedAt,
  }
}

export function statusOf(s: Subscription, settings: Pick<AlertSettings, 'reminderDays' | 'graceDays'>, now = new Date()): SubscriptionStatus {
  return computeStatus(stateOf(s), now, settings)
}

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

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

  /** The studio's subscription and plan, with its status as of now. */
  async effective(studioId: string, db: Tx | PrismaService = this.prisma): Promise<EffectiveSubscription> {
    const subscription = await db.subscription.findUnique({ where: { studioId }, include: { plan: true } })
    if (!subscription) throw notFound('Subscription')
    const status = statusOf(subscription, await this.settings.alerts())
    return { subscription, plan: subscription.plan, status, readOnly: isReadOnlyStatus(status) }
  }

  subscriptionDto(eff: EffectiveSubscription): SubscriptionDto {
    const { subscription: s, plan, status, readOnly } = eff
    const price = s.cycle === 'YEARLY' ? plan.yearlyPrice : (plan.monthlyPrice ?? plan.yearlyPrice)
    return {
      plan: this.toDto(plan),
      cycle: s.cycle,
      status,
      isTrial: s.isTrial,
      currentPeriodStart: s.currentPeriodStart.toISOString(),
      currentPeriodEnd: s.currentPeriodEnd.toISOString(),
      graceEndsAt: s.graceEndsAt?.toISOString() ?? null,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      autoRenew: s.autoRenew,
      daysLeft: daysLeft(s.currentPeriodEnd),
      readOnly,
      pricePaise: price,
    }
  }
}
