import { BILLING_CYCLES, CYCLE_LABELS, PLAN_CODES, PRICING_CYCLES, type BillingCycle } from '@weddyzone/shared'
import { useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ErrorState, PageHeader, Skeleton } from '../components/ui'
import { useUrlState } from '../hooks/useUrlState'
import { isRenewal, perMonth, priceFor, usePlanActions, usePlans, useSubscription } from '../lib/billing'
import { isTrialPlan, planLimitLines } from '../lib/planCopy'
import { formatMoney } from '../utils/format'

const CYCLE_PARAM: Record<BillingCycle, string> = { MONTHLY: '1', QUARTERLY: '3', HALF_YEARLY: '6', YEARLY: '12' }
const cycleOf = (v: string | null | undefined): BillingCycle => (Object.entries(CYCLE_PARAM).find(([, p]) => p === v)?.[0] as BillingCycle | undefined) ?? 'MONTHLY'

/** Plans & Pricing (in the app): Trial, Pro and VIP for 1, 3, 6 or 12 months. */
function AllSubscription() {
  const [url, setUrl] = useUrlState({ months: '1' })
  const cycle = cycleOf(url.months)
  const plans = usePlans()
  const sub = useSubscription()
  const { change } = usePlanActions()
  const current = sub.data?.subscription

  // One-click renewal links from reminders: /subscriptions?renew=PRO&cycle=YEARLY[&coupon=CODE]
  const [params, setParams] = useSearchParams()
  const handled = useRef(false)
  useEffect(() => {
    const code = params.get('renew')
    if (handled.current || !code || !plans.data || !current) return
    handled.current = true
    const plan = plans.data.find((p) => p.code === code && (PLAN_CODES as readonly string[]).includes(code))
    const c = (BILLING_CYCLES as readonly string[]).includes(params.get('cycle') ?? '') ? (params.get('cycle') as BillingCycle) : 'MONTHLY'
    const coupon = params.get('coupon') ?? undefined
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        ;['renew', 'cycle', 'coupon'].forEach((k) => next.delete(k))
        next.set('months', CYCLE_PARAM[c])
        return next
      },
      { replace: true },
    )
    if (plan && !isTrialPlan(plan)) void change(plan, priceFor(plan, c) === null ? 'MONTHLY' : c, current, coupon)
  }, [params, plans.data, current, change, setParams])

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Plans & Pricing"
        featureBadge="Upgrade any time · Credit for unused days"
        title="Choose Your Studio Plan"
        subtitle="Pay for 1, 3, 6 or 12 months. Limits reset every 30 days from your plan's start date."
        actions={
          <div className="tabs" role="tablist" aria-label="Billing period">
            {PRICING_CYCLES.map((c) => (
              <button key={c} role="tab" aria-selected={c === cycle} className={c === cycle ? 'on' : ''} onClick={() => setUrl({ months: CYCLE_PARAM[c] })}>
                {CYCLE_LABELS[c]}
              </button>
            ))}
          </div>
        }
      />

      {plans.isError ? (
        <div className="card">
          <ErrorState error={plans.error} onRetry={() => plans.refetch()} title="We could not load the plans" />
        </div>
      ) : (
        <div className="grid grid-3" style={{ paddingTop: 12 }} data-testid="plan-grid">
          {plans.isPending
            ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={420} radius={22} />)
            : (plans.data ?? []).map((p) => {
                const trial = isTrialPlan(p)
                const onTrial = Boolean(current?.isTrial && current.plan.code === p.code)
                const isCurrent = Boolean(current && current.plan.code === p.code && !current.isTrial && current.status !== 'CANCELLED')
                const renew = isRenewal(current, p, cycle)
                const onThisCycle = isCurrent && current!.cycle === cycle && !renew
                const price = priceFor(p, cycle)
                return (
                  <div key={p.code} className={`plan plan-catchy ${p.popular ? 'popular' : ''} ${isCurrent || onTrial ? 'is-current-plan' : ''}`} data-testid={`plan-${p.code}`}>
                    {(isCurrent || onTrial) && <span className="plan-flag plan-flag-current">{onTrial ? 'Your trial' : 'Your Current Plan'}</span>}
                    {!isCurrent && !onTrial && p.popular && <span className="plan-flag">Most Popular</span>}

                    <div className="plan-header">
                      <h3>{p.name}</h3>
                      <p className="tagline">{p.tagline}</p>
                    </div>

                    <div className="price">
                      {trial ? 'Free' : price === null ? '—' : formatMoney(price)}
                      <small> {trial ? '· 14 days' : `/ ${CYCLE_LABELS[cycle]}`}</small>
                    </div>
                    {!trial && price !== null && cycle !== 'MONTHLY' && <p className="muted plan-per-month">{formatMoney(perMonth(price, cycle))} a month</p>}

                    <ul className="checklist" data-testid={`plan-limits-${p.code}`}>
                      {planLimitLines(p).map((line) => (
                        <li key={line} className="plan-feature-item">
                          <i className="bi bi-check-circle-fill" />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>

                    {trial ? (
                      <button className="btn btn-block btn-ghost" disabled>
                        {onTrial ? `Trial ends ${new Date(current!.currentPeriodEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : 'Free trial for new studios'}
                      </button>
                    ) : (
                      <button
                        className={`btn btn-block ${onThisCycle ? 'btn-ghost' : p.popular ? 'btn-primary' : 'btn-ghost'}`}
                        disabled={onThisCycle || !current || price === null}
                        onClick={() => change(p, cycle, current)}
                      >
                        {onThisCycle ? 'Active Studio Plan' : renew ? `Renew ${p.name}` : isCurrent ? `Switch to ${CYCLE_LABELS[cycle]}` : `Choose ${p.name}`}
                      </button>
                    )}
                  </div>
                )
              })}
        </div>
      )}

      <p className="muted" style={{ textAlign: 'center' }}>
        All prices exclude 18% GST. Upgrades start straight away, with credit for the unused days of your current plan. Questions?{' '}
        <Link to="/support" className="link">
          Contact support
        </Link>
      </p>
    </div>
  )
}

export default AllSubscription
