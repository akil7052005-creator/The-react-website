import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CYCLE_LABELS,
  CYCLE_MONTHS,
  splitInclusiveGstPaise,
  type BillingCycle,
  type CheckoutQuoteDto,
  type GatewayCheckoutDto,
  type MySubscriptionBannerDto,
  type PaymentDto,
  type PaymentMode,
  type PlanDto,
  type SubscriptionDto,
  type UsageItem,
  type UsageMeterDto,
} from '@weddyzone/shared'
import { toast } from 'sonner'
import { ME_KEY } from '../auth/AuthProvider'
import { useConfirm } from '../components/Modal'
import { formatMoney } from '../utils/format'
import { api } from './api'
import { toastError } from './query'
import { payWithRazorpay } from './razorpay'

export interface SubscriptionOverview {
  subscription: SubscriptionDto
  usage: UsageItem[]
  recentPayments: PaymentDto[]
  testMode: boolean
  /** mock = simulated, test = Razorpay test keys, live = real money. */
  paymentMode: PaymentMode
  /** Auto-renew needs a gateway that charges by itself (not Razorpay yet). */
  autoRenewAvailable: boolean
}

export const usePlans = () => useQuery({ queryKey: ['plans'], queryFn: () => api.get<PlanDto[]>('/plans'), staleTime: 5 * 60_000 })

export const useSubscription = () =>
  useQuery({ queryKey: ['subscription'], queryFn: () => api.get<SubscriptionOverview>('/subscription') })

/** Events and uploads used in this 30-day window (GET /me/usage): the dashboard meter. */
export const USAGE_KEY = ['subscription', 'usage'] as const
export const useUsage = () => useQuery({ queryKey: USAGE_KEY, queryFn: () => api.get<UsageMeterDto>('/me/usage'), refetchInterval: 5 * 60_000 })

/** "320 GB", "1.2 TB", "48 GB". */
export function gbText(bytes: number) {
  const gb = bytes / 1024 ** 3
  if (gb >= 1024) return `${(gb / 1024).toFixed(gb % 1024 === 0 ? 0 : 1)} TB`
  return `${gb >= 10 ? Math.round(gb) : Math.round(gb * 10) / 10} GB`
}

/** "1 Dec": when the meter resets (IST, whatever the browser's time zone). */
export const resetDay = (m: Pick<UsageMeterDto, 'resetsOn'>) => new Date(m.resetsOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })

/**
 * "Events 7/10 · Uploads 320 GB of 500 GB · resets on 8 Nov". Trial: "Events 2/5 (November) ·
 * Uploads 12 GB of 50 GB · resets on 1 Dec", then "… (December) · … · trial ends 31 Dec".
 */
export function meterText(m: UsageMeterDto) {
  const period = m.period ? ` (${m.period.name})` : ''
  const events = m.events.limit === null ? `Events ${m.events.used}` : `Events ${m.events.used}/${m.events.limit}${period}`
  const uploads = m.uploads.limitBytes === null ? `Uploads ${gbText(m.uploads.usedBytes)}` : `Uploads ${gbText(m.uploads.usedBytes)} of ${gbText(m.uploads.limitBytes)}`
  const when = resetDay(m)
  return `${events} · ${uploads} · ${m.lifetime && !m.period?.next ? `trial ends ${when}` : `resets on ${when}`}`
}

/** The meter's note when a limit is reached ("You've used your 5 trial events for November. 5 more unlock on 1 Dec."). */
export function limitNote(m: UsageMeterDto, what: 'events' | 'uploads'): string {
  const p = m.period
  if (what === 'events') {
    if (!p) return `You've used all your events${m.lifetime ? ` on the ${m.planName}` : ' this month'}.`
    return `You've used your ${m.events.limit} trial events for ${p.name}. ${p.next ? `${m.events.limit} more unlock on ${resetDay(m)}.` : 'Upgrade to Pro to keep creating events.'}`
  }
  if (!p || m.uploads.limitBytes === null) return `You've used all your uploads${m.lifetime ? ` on the ${m.planName}` : ' this month'}.`
  const gb = gbText(m.uploads.limitBytes)
  return `You've used your ${gb} of uploads for ${p.name}. ${p.next ? `${gb} more on ${resetDay(m)}.` : 'Upgrade to Pro to upload more.'}`
}

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

/** A plan's price for one billing period (1, 6 or 12 months; 3 for older subscriptions), paise; null when not sold for it. */
export function priceFor(plan: PlanDto, cycle: BillingCycle): number | null {
  const p = plan.prices?.[cycle]
  if (p !== undefined) return p
  return cycle === 'YEARLY' ? plan.yearlyPricePaise || null : cycle === 'MONTHLY' ? plan.monthlyPricePaise : null
}

/** Per-month equivalent of a longer period, for "₹1,800 / month" under a 6-month price. */
export const perMonth = (price: number, cycle: BillingCycle) => Math.round(price / CYCLE_MONTHS[cycle])

/** A note under a price: simulated payments, or Razorpay's test mode. Nothing when payments are live. */
export function TestModeNote({ mode }: { mode: PaymentMode | undefined }) {
  if (mode === 'test') {
    return (
      <p className="test-mode-note">
        <i className="bi bi-cone-striped" /> Razorpay test mode: no real money moves. Pay with a Razorpay test card or the UPI ID success@razorpay.
      </p>
    )
  }
  if (mode !== 'mock') return null
  return (
    <p className="test-mode-note">
      <i className="bi bi-cone-striped" /> Test mode, no real charge. Payments are simulated until online payments are switched on.
    </p>
  )
}

/** "Test mode, no real charge" under a success toast, only while payments are simulated. */
const simulatedNote = (mode: PaymentMode | undefined) => (mode === 'mock' ? 'Test mode, no real charge' : undefined)

/**
 * Pays a pending payment in Razorpay Checkout (opened after the confirm dialog has closed, so the
 * dialog doesn't block it). True once the server has confirmed it with Razorpay and applied it.
 */
export async function completeCheckout(checkout: GatewayCheckoutDto, success: string): Promise<boolean> {
  try {
    const outcome = await payWithRazorpay(checkout, (reason) => toast.error('Payment failed', { description: `${reason}. You can try again in the payment window.` }))
    if (outcome.status === 'closed') {
      toast.info('Payment not completed', { description: 'Nothing was bought. You can pay any time.' })
      return false
    }
    toast.success(success, { description: `Payment received · ${formatMoney(outcome.payment.amountPaise)}` })
    return true
  } catch (e) {
    toastError(e)
    return false
  }
}

/** Confirm → payment (Razorpay Checkout, or simulated) → plan applied → toasts and cache refresh. */
export function usePlanActions() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const mode = useSubscription().data?.paymentMode

  const refresh = () => {
    // Also refreshes the plan banner (['subscription', 'banner']).
    qc.invalidateQueries({ queryKey: ['subscription'] })
    qc.invalidateQueries({ queryKey: ME_KEY })
    qc.invalidateQueries({ queryKey: ['credits'] })
    qc.invalidateQueries({ queryKey: ['referrals'] })
  }

  const change = async (plan: PlanDto, cycle: BillingCycle, current?: SubscriptionDto, couponCode?: string) => {
    const price = priceFor(plan, cycle)
    if (price === null) {
      toast.error(`${plan.name} isn't available for ${CYCLE_LABELS[cycle]}`)
      return false
    }
    // The exact amount from the server: prices include GST, and any credit for unused days or
    // coupon is already taken off (the same sum checkout charges).
    let quote: CheckoutQuoteDto
    try {
      quote = await api.get<CheckoutQuoteDto>('/subscription/quote', { planCode: plan.code, cycle, couponCode })
    } catch (e) {
      toastError(e)
      return false
    }
    const currentPrice = current ? current.pricePaise : 0
    const renewal = isRenewal(current, plan, cycle)
    const verb = renewal ? 'Renew' : !current || current.isTrial || current.readOnly ? 'Subscribe to' : price >= currentPrice ? 'Upgrade to' : 'Switch to'
    const done = renewal ? `${plan.name} renewed` : `You're now on the ${plan.name} plan`
    const less = [
      quote.creditPaise ? `${formatMoney(quote.creditPaise)} credit for the unused days of your current plan` : null,
      quote.discountPaise ? `${formatMoney(quote.discountPaise)} off with coupon ${couponCode}` : null,
    ].filter(Boolean)
    let pending: GatewayCheckoutDto | null = null
    return confirm({
      title: `${verb} ${plan.name}?`,
      icon: 'patch-check',
      message: (
        <>
          You'll pay <strong>{formatMoney(quote.payablePaise)}</strong> (incl. {formatMoney(quote.gstPaise)} GST) for {CYCLE_LABELS[cycle]}
          {less.length ? <>: {formatMoney(quote.pricePaise)} less {less.join(' and ')}</> : null}.{' '}
          {renewal && current && !current.readOnly && current.status !== 'GRACE'
            ? `Your plan continues from ${new Date(current.currentPeriodEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}, so you lose no days`
            : current && !current.isTrial && !current.readOnly && !renewal
              ? `The ${plan.name} plan starts straight away`
              : `The ${plan.name} plan starts as soon as the payment is confirmed`}
          {plan.limits.includedCredits ? ` and includes ${plan.limits.includedCredits.toLocaleString('en-IN')} WhatsApp credits` : ''}.
          <TestModeNote mode={mode} />
        </>
      ),
      confirmLabel: `${verb} ${plan.name}`,
      onConfirm: async () => {
        try {
          const res = await api.post<{ checkout: GatewayCheckoutDto | null }>('/subscription/change', { planCode: plan.code, cycle, couponCode })
          pending = res.checkout
          if (!pending) toast.success(done, { description: simulatedNote(mode) })
          refresh()
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    }).then(async (ok) => {
      if (!ok || !pending) return ok
      const paid = await completeCheckout(pending, done)
      refresh()
      return paid
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

  /** "Buy +5 events" for this month. */
  const buyAddon = (addon: { events: number; pricePaise: number }) => {
    // The add-on's price includes GST.
    const { gstPaise } = splitInclusiveGstPaise(addon.pricePaise)
    const done = `+${addon.events} events added for this month`
    let pending: GatewayCheckoutDto | null = null
    return confirm({
      title: `Buy +${addon.events} events?`,
      icon: 'plus-circle',
      message: (
        <>
          You'll pay <strong>{formatMoney(addon.pricePaise)}</strong> (incl. {formatMoney(gstPaise)} GST). The extra events are for this month only: unused ones
          don't carry over.
          <TestModeNote mode={mode} />
        </>
      ),
      confirmLabel: `Buy +${addon.events} events`,
      onConfirm: async () => {
        try {
          const res = await api.post<{ checkout: GatewayCheckoutDto | null }>('/subscription/addon-events')
          pending = res.checkout
          if (!pending) toast.success(done, { description: simulatedNote(mode) })
          refresh()
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    }).then(async (ok) => {
      if (!ok || !pending) return ok
      const paid = await completeCheckout(pending, done)
      refresh()
      return paid
    })
  }

  return { change, resume, setAutoRenew, refresh, buyAddon }
}
