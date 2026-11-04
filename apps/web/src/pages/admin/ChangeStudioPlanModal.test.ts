import type { BillingCycle, PlanDto } from '@weddyzone/shared'
import { describe, expect, it } from 'vitest'
import { defaultChoice, paidPlans } from './ChangeStudioPlanModal'

const plan = (id: string, code: PlanDto['code'], prices: Partial<Record<BillingCycle, number | null>>): PlanDto =>
  ({ id, code, name: code, prices: { MONTHLY: null, QUARTERLY: null, HALF_YEARLY: null, YEARLY: null, ...prices } }) as PlanDto

const free = plan('f', 'STARTER', {})
const pro = plan('p', 'PRO', { MONTHLY: 60_000, HALF_YEARLY: 300_000, YEARLY: 500_000 })
const vip = plan('v', 'ALL_ACCESS', { MONTHLY: 120_000, HALF_YEARLY: 600_000, YEARLY: 1_000_000 })
const yearlyOnly = plan('y', 'PRO', { YEARLY: 500_000 })

describe('Change plan dialog choices', () => {
  it('offers only plans sold for 1 month, 6 months or 1 year (not the free subscription)', () => {
    expect(paidPlans([free, pro, vip]).map((p) => p.id)).toEqual(['p', 'v'])
  })

  it('starts on a plan other than the current one, keeping the studio’s period when it is sold', () => {
    expect(defaultChoice([free, pro, vip], { planCode: null, cycle: null })).toEqual({ planId: 'p', cycle: 'MONTHLY' })
    expect(defaultChoice([free, pro, vip], { planCode: 'PRO', cycle: 'HALF_YEARLY' })).toEqual({ planId: 'v', cycle: 'HALF_YEARLY' })
    expect(defaultChoice([free, pro, vip], { planCode: 'ALL_ACCESS', cycle: 'YEARLY' })).toEqual({ planId: 'p', cycle: 'YEARLY' })
  })

  it('falls back to the first period the plan is sold for, and to nothing when no plan is for sale', () => {
    expect(defaultChoice([yearlyOnly], { planCode: null, cycle: 'MONTHLY' })).toEqual({ planId: 'y', cycle: 'YEARLY' })
    expect(defaultChoice([free], { planCode: null, cycle: null })).toBeNull()
  })
})
