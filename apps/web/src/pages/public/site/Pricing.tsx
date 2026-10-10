import { CYCLE_LABELS, PRICING_CYCLES, type BillingCycle } from '@weddyzone/shared'
import { Link } from 'react-router-dom'
import { Arrow, PublicShell, SectionTitle, usePageMeta } from '../../../components/public/PublicShell'
import { ErrorState, Skeleton } from '../../../components/ui'
import { useUrlState } from '../../../hooks/useUrlState'
import { perMonth, priceFor, usePlans } from '../../../lib/billing'
import { isTrialPlan, planLimitLines } from '../../../lib/planCopy'
import { formatMoney } from '../../../utils/format'

const CYCLE_PARAM: Record<BillingCycle, string> = { MONTHLY: '1', QUARTERLY: '3', HALF_YEARLY: '6', YEARLY: '12' }
const cycleOf = (v: string): BillingCycle => (Object.entries(CYCLE_PARAM).find(([, p]) => p === v)?.[0] as BillingCycle | undefined) ?? 'MONTHLY'
const SHORT: Record<BillingCycle, string> = { MONTHLY: '1 month', QUARTERLY: '3 months', HALF_YEARLY: '6 months', YEARLY: '1 year' }

/** Public Plans & Pricing: Trial / Pro / VIP for 1, 3, 6 or 12 months; each button signs up with that plan. */
export default function Pricing() {
  usePageMeta('Plans & Pricing', 'Trial, Pro and VIP plans for wedding studios, for 1, 3, 6 or 12 months. Start with a free 14-day trial.')
  const [url, setUrl] = useUrlState({ months: '1' })
  const cycle = cycleOf(url.months)
  const plans = usePlans()

  return (
    <PublicShell>
      <section className="pub-section first">
        <div className="pub-wrap">
          <h1 className="pub-h1">Plans &amp; Pricing</h1>
          <p className="pub-lead">Start free for 14 days. Pay for 1, 3, 6 or 12 months; upgrade any time with credit for unused days.</p>
          <div className="pub-switch" role="tablist" aria-label="Billing period">
            {PRICING_CYCLES.map((c) => (
              <button key={c} type="button" role="tab" aria-selected={c === cycle} className={c === cycle ? 'on' : ''} onClick={() => setUrl({ months: CYCLE_PARAM[c] })}>
                {SHORT[c]}
              </button>
            ))}
          </div>

          {plans.isError ? (
            <ErrorState error={plans.error} onRetry={() => plans.refetch()} title="We could not load the plans" />
          ) : (
            <div className="pub-cards three pub-plans" data-testid="public-plans">
              {plans.isPending
                ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={380} radius={18} />)
                : (plans.data ?? []).map((p) => {
                    const trial = isTrialPlan(p)
                    const price = priceFor(p, cycle)
                    const popular = p.code === 'PRO'
                    const signup = trial ? '/signup' : `/signup?plan=${p.code}&months=${CYCLE_PARAM[cycle]}`
                    return (
                      <article key={p.code} className={`pub-card pub-plan${popular ? ' popular' : ''}`} data-testid={`public-plan-${p.code}`}>
                        {popular && <span className="pub-flag">Most popular</span>}
                        <h3>{p.name}</h3>
                        <p className="pub-plan-tag">{p.tagline}</p>
                        <p className="pub-price">
                          {trial ? 'Free' : price === null ? '—' : formatMoney(price)}
                          <small> {trial ? '· 14 days' : `/ ${CYCLE_LABELS[cycle]}`}</small>
                        </p>
                        {!trial && price !== null && cycle !== 'MONTHLY' && <p className="pub-per-month">{formatMoney(perMonth(price, cycle))} a month</p>}
                        <ul className="pub-limits">
                          {planLimitLines(p).map((line) => (
                            <li key={line}>
                              <i className="bi bi-check-circle-fill" aria-hidden="true" /> {line}
                            </li>
                          ))}
                        </ul>
                        <Link to={signup} className={`pub-btn block${popular ? '' : ' ghost'}`}>
                          {trial ? 'Start free trial' : `Choose ${p.name}`} <Arrow />
                        </Link>
                      </article>
                    )
                  })}
            </div>
          )}
          <p className="pub-note">All prices exclude 18% GST.</p>
        </div>
      </section>
      <section className="pub-section alt" aria-labelledby="faq">
        <div className="pub-wrap">
          <SectionTitle id="faq">Good to know</SectionTitle>
          <div className="pub-cards two">
            <article className="pub-card">
              <h3>Do my original photos go online?</h3>
              <p>No. Only light previews are uploaded. The originals stay on your computer until delivery.</p>
            </article>
            <article className="pub-card">
              <h3>What happens after the trial?</h3>
              <p>Choose Pro or VIP for 1, 3, 6 or 12 months. Your events and selections stay as they are.</p>
            </article>
          </div>
        </div>
      </section>
    </PublicShell>
  )
}
