import { CYCLE_LABELS, PRICING_CYCLES, type BillingCycle } from '@weddyzone/shared'
import { useUrlState } from '../../hooks/useUrlState'
import { perMonth, priceFor, usePlans } from '../../lib/billing'
import { isTrialPlan, planLimitLines } from '../../lib/planCopy'
import { formatMoney } from '../../utils/format'
import { ErrorState, Skeleton } from '../ui'
import { CYCLE_SHORT } from './headerPanels'
import { Arrow, SectionTitle } from './PublicShell'
import { usePublicMenu } from './SiteHeader'

const CYCLE_PARAM: Record<BillingCycle, string> = { MONTHLY: '1', QUARTERLY: '3', HALF_YEARLY: '6', YEARLY: '12' }
const cycleOf = (v: string): BillingCycle => (Object.entries(CYCLE_PARAM).find(([, p]) => p === v)?.[0] as BillingCycle | undefined) ?? 'MONTHLY'

/** Home's full Plans & Pricing (Compare all plans): Trial / Pro / VIP for 1, 3, 6 or 12 months; Choose opens sign-up with that plan. */
export function PricingSection() {
  const [url, setUrl] = useUrlState({ months: '1' })
  const cycle = cycleOf(url.months)
  const plans = usePlans()
  const { openPanel } = usePublicMenu()

  return (
    <>
      <section className="pub-section" id="pricing" aria-labelledby="pricing-title">
        <div className="pub-wrap">
          <SectionTitle id="pricing-title">Plans &amp; Pricing</SectionTitle>
          <p className="pub-lead">Start free for 14 days. Pay for 1, 3, 6 or 12 months; upgrade any time with credit for unused days.</p>
          <div className="pub-switch" role="tablist" aria-label="Billing period">
            {PRICING_CYCLES.map((c) => (
              <button key={c} type="button" role="tab" aria-selected={c === cycle} className={c === cycle ? 'on' : ''} onClick={() => setUrl({ months: CYCLE_PARAM[c] })}>
                {CYCLE_SHORT[c]}
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
                        <button
                          type="button"
                          className={`pub-btn block${popular ? '' : ' ghost'}`}
                          onClick={() => openPanel('trial', trial ? null : { code: p.code, name: p.name, cycle, cycleLabel: CYCLE_SHORT[cycle] })}
                        >
                          {trial ? 'Start free trial' : `Choose ${p.name}`} <Arrow />
                        </button>
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
    </>
  )
}
