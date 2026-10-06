import { useQuery, useQueryClient } from '@tanstack/react-query'
import { gstOn, type BillingCycle, type MySubscriptionBannerDto, type PaymentDto, type PlanDto, type SubscriptionDto, type UsageItem } from '@weddyzone/shared'
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

/** Compact plan status for banners (GET /me/subscription). */
export const usePlanBanner = () =>
  useQuery({ queryKey: ['subscription', 'banner'], queryFn: () => api.get<MySubscriptionBannerDto>('/me/subscription'), refetchInterval: 5 * 60_000 })

/** Same plan and cycle, and it's ending, ended or failed to charge: the plan button says "Renew". */
export function isRenewal(current: SubscriptionDto | undefined, plan: PlanDto, cycle: BillingCycle): boolean {
  return Boolean(current && !current.isTrial && current.plan.code === plan.code && current.cycle === cycle && current.status !== 'ACTIVE' && current.status !== 'TRIAL')
}

/**
 * How a usage meter reads. Plan quotas: "6 / 50 (12%)". WhatsApp credits are a prepaid balance,
 * not a plan limit: "0 used this month · 1,839 left in balance".
 */
export function usageText(u: UsageItem): string {
  const n = (v: number) => v.toLocaleString('en-IN')
  const unit = u.unit ? ` ${u.unit}` : ''
  if (u.key === 'credits') return `${n(u.used)} used this month · ${n(u.remaining ?? 0)} left in balance`
  if (u.limit === null) return `${n(u.used)}${unit} · Unlimited`
  return `${n(u.used)} / ${n(u.limit)}${unit} (${u.limit ? Math.round((u.used / u.limit) * 100) : 0}%)`
}

/** The bar's full width: the plan limit, or for credits everything available this month (used + left). */
export function usageMax(u: UsageItem): number {
  if (u.key === 'credits') return Math.max(1, u.used + (u.remaining ?? 0))
  return u.limit ?? Math.max(u.used, 1) * 4
}

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
    // Also refreshes the plan banner (['subscription', 'banner']).
    qc.invalidateQueries({ queryKey: ['subscription'] })
    qc.invalidateQueries({ queryKey: ME_KEY })
    qc.invalidateQueries({ queryKey: ['credits'] })
    qc.invalidateQueries({ queryKey: ['referrals'] })
  }

  const change = (plan: PlanDto, cycle: BillingCycle, current?: SubscriptionDto, couponCode?: string) => {
    const price = priceFor(plan, cycle)
    if (price === null) {
      toast.error(`${plan.name} is billed yearly only`)
      return Promise.resolve(false)
    }
    const currentPrice = current ? current.pricePaise : 0
    const renewal = isRenewal(current, plan, cycle)
    const verb = renewal ? 'Renew' : !current || current.isTrial || current.readOnly ? 'Subscribe to' : price >= currentPrice ? 'Upgrade to' : 'Switch to'
    const gst = gstOn(price)
    return confirm({
      title: `${verb} ${plan.name}?`,
      icon: 'patch-check',
      message: (
        <>
          You'll pay <strong>{formatMoney(price + gst)}</strong> ({formatMoney(price)} + {formatMoney(gst)} GST) {cycle === 'YEARLY' ? 'per year' : 'per month'}
          {couponCode ? <>, less your coupon <strong>{couponCode}</strong></> : null}.{' '}
          {renewal && current && !current.readOnly && current.status !== 'GRACE'
            ? `Your plan continues from ${new Date(current.currentPeriodEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}, so you lose no days`
            : `The ${plan.name} plan starts as soon as the payment is confirmed`}
          {plan.limits.includedCredits ? ` and includes ${plan.limits.includedCredits.toLocaleString('en-IN')} WhatsApp credits` : ''}.
          <TestModeNote />
        </>
      ),
      confirmLabel: `${verb} ${plan.name}`,
      onConfirm: async () => {
        try {
          const res = await api.post<{ checkout: unknown }>('/subscription/change', { planCode: plan.code, cycle, couponCode })
          if (res.checkout) toast.info('Complete the payment to activate your plan')
          else toast.success(renewal ? `${plan.name} renewed` : `You're now on the ${plan.name} plan`, { description: 'Test mode, no real charge' })
          refresh()
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    })
  }

  const resume = async (s: SubscriptionDto) => {
    try {
      await api.post('/subscription/resume')
      toast.success(`${s.plan.name} will renew as usual`)
      refresh()
    } catch (e) {
      toastError(e)
    }
  }

  const setAutoRenew = async (autoRenew: boolean) => {
    try {
      await api.post('/subscription/auto-renew', { autoRenew })
      toast.success(autoRenew ? 'Auto-renew is on' : 'Auto-renew is off', {
        description: autoRenew ? 'Your plan renews by itself at the end of each period.' : "We'll remind you before your plan ends.",
      })
      refresh()
    } catch (e) {
      toastError(e)
    }
  }

  return { change, resume, setAutoRenew, refresh }
}
