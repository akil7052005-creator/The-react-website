import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { BillingCycle, PaymentDto, PlanDto, SubscriptionDto, UsageItem } from '@weddyzone/shared'
import { toast } from 'sonner'
import { ME_KEY } from '../auth/AuthProvider'
import { useConfirm } from '../components/Modal'
import { formatMoney } from '../utils/format'
import { api } from './api'
import { toastError } from './query'

export interface SubscriptionOverview {
  subscription: SubscriptionDto
  usage: UsageItem[]
  recentPayments: PaymentDto[]
  testMode: boolean
}

export const usePlans = () => useQuery({ queryKey: ['plans'], queryFn: () => api.get<PlanDto[]>('/plans'), staleTime: 5 * 60_000 })

export const useSubscription = () =>
  useQuery({ queryKey: ['subscription'], queryFn: () => api.get<SubscriptionOverview>('/subscription') })

export function priceFor(plan: PlanDto, cycle: BillingCycle): number | null {
  return cycle === 'YEARLY' ? plan.yearlyPricePaise : plan.monthlyPricePaise
}

export function TestModeNote() {
  return (
    <p className="test-mode-note">
      <i className="bi bi-cone-striped" /> Test mode, no real charge. Payments are simulated until online payments are switched on.
    </p>
  )
}

/** Confirm → mock payment → plan applied immediately → toasts and cache refresh. */
export function usePlanActions() {
  const qc = useQueryClient()
  const confirm = useConfirm()

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['subscription'] })
    qc.invalidateQueries({ queryKey: ME_KEY })
    qc.invalidateQueries({ queryKey: ['credits'] })
    qc.invalidateQueries({ queryKey: ['referrals'] })
  }

  const change = (plan: PlanDto, cycle: BillingCycle, current?: SubscriptionDto) => {
    const price = priceFor(plan, cycle)
    if (price === null) {
      toast.error(`${plan.name} is billed yearly only`)
      return Promise.resolve(false)
    }
    const currentPrice = current ? current.pricePaise : 0
    const verb = !current || current.isTrial ? 'Subscribe to' : price >= currentPrice ? 'Upgrade to' : 'Switch to'
    return confirm({
      title: `${verb} ${plan.name}?`,
      icon: 'patch-check',
      message: (
        <>
          You'll pay <strong>{formatMoney(price)}</strong> {cycle === 'YEARLY' ? 'per year' : 'per month'} (+18% GST). The {plan.name} plan starts right away
          {plan.limits.includedCredits ? ` and includes ${plan.limits.includedCredits.toLocaleString('en-IN')} WhatsApp credits` : ''}.
          <TestModeNote />
        </>
      ),
      confirmLabel: `${verb} ${plan.name}`,
      onConfirm: async () => {
        try {
          await api.post('/subscription/change', { planCode: plan.code, cycle })
          toast.success(`You're now on the ${plan.name} plan`, { description: 'Test mode, no real charge' })
          refresh()
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    })
  }

  const cancel = (s: SubscriptionDto) =>
    confirm({
      title: `Cancel your ${s.plan.name} plan?`,
      tone: 'danger',
      message: (
        <>
          You keep {s.plan.name} until <strong>{new Date(s.currentPeriodEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>. After
          that your studio moves to Starter and its limits apply. You can resume any time before then.
        </>
      ),
      confirmLabel: 'Cancel plan',
      cancelLabel: 'Keep my plan',
      onConfirm: async () => {
        try {
          await api.post('/subscription/cancel')
          toast.success(`${s.plan.name} will end on ${new Date(s.currentPeriodEnd).toLocaleDateString('en-IN')}`)
          refresh()
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    })

  const resume = async (s: SubscriptionDto) => {
    try {
      await api.post('/subscription/resume')
      toast.success(`${s.plan.name} will renew as usual`)
      refresh()
    } catch (e) {
      toastError(e)
    }
  }

  return { change, cancel, resume }
}
