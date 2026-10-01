import type { BillingCycle } from '@weddyzone/shared'
import { Link } from 'react-router-dom'
import { PageHeader, FeatureTooltip, ErrorState, Skeleton, type FeatureInfo } from '../components/ui'
import { formatMoney } from '../utils/format'
import { featureInfo } from '../data/featureInfo'
import { useUrlState } from '../hooks/useUrlState'
import { priceFor, usePlanActions, usePlans, useSubscription } from '../lib/billing'

function AllSubscription() {
  const [url, setUrl] = useUrlState({ cycle: 'monthly' })
  const yearly = url.cycle === 'yearly'
  const cycle: BillingCycle = yearly ? 'YEARLY' : 'MONTHLY'
  const plans = usePlans()
  const sub = useSubscription()
  const { change } = usePlanActions()
  const current = sub.data?.subscription
  const gridPlans = (plans.data ?? []).filter((p) => p.code !== 'ALL_ACCESS')

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Plans & Pricing"
        featureBadge="Cancel Anytime · Zero Contracts"
        title="Choose Your Studio Plan"
        subtitle="Transparent pricing built to scale as your wedding calendar fills up. Point cursor at any feature to see what's included."
        actions={
          <div className="tabs">
            <button className={!yearly ? 'on' : ''} onClick={() => setUrl({ cycle: 'monthly' })}>
              Monthly
            </button>
            <FeatureTooltip
              title="Annual Commitment Discount"
              badge="Save 17%"
              icon="tag"
              summary="Pay yearly and receive 2 full months completely free on all studio tiers."
              position="bottom"
              width={260}
            >
              <button className={yearly ? 'on' : ''} onClick={() => setUrl({ cycle: 'yearly' })}>
                Yearly <span className="save">2 months free</span>
              </button>
            </FeatureTooltip>
          </div>
        }
      />

      {plans.isError ? (
        <div className="card">
          <ErrorState error={plans.error} onRetry={() => plans.refetch()} title="We could not load the plans" />
        </div>
      ) : (
        <div className="grid grid-3" style={{ paddingTop: 12 }}>
          {plans.isPending
            ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={420} radius={22} />)
            : gridPlans.map((p) => {
                const isCurrent = Boolean(current && current.plan.code === p.code && current.status === 'ACTIVE' && !current.isTrial)
                const onThisCycle = isCurrent && current!.cycle === cycle
                const price = priceFor(p, cycle)
                return (
                  <div key={p.code} className={`plan plan-catchy ${p.popular ? 'popular' : ''} ${isCurrent ? 'is-current-plan' : ''}`}>
                    {isCurrent && <span className="plan-flag plan-flag-current">Your Current Plan</span>}
                    {!isCurrent && p.popular && <span className="plan-flag">Most Popular</span>}

                    <div className="plan-header">
                      <h3>{p.name}</h3>
                      <p className="tagline">{p.tagline}</p>
                    </div>

                    <div className="price">
                      {price === null ? '—' : formatMoney(price)}
                      <small> / {yearly ? 'year' : 'month'}</small>
                    </div>

                    <p className="plan-features-header">
                      <i className="bi bi-stars" /> Hover on features to inspect:
                    </p>

                    <ul className="checklist">
                      {p.features.map((f) => {
                        const feat = (featureInfo.features as Record<string, FeatureInfo>)?.[f]
                        const item = (
                          <li key={f} className="plan-feature-item">
                            <i className="bi bi-check-circle-fill" />
                            <span>{f}</span>
                            <i className="bi bi-info-circle plan-feat-info" />
                          </li>
                        )
                        return feat ? (
                          <FeatureTooltip key={f} title={feat.title || f} summary={feat.description} badge={p.name} position="top" width={280} delay={80}>
                            {item}
                          </FeatureTooltip>
                        ) : (
                          item
                        )
                      })}
                    </ul>

                    <button
                      className={`btn btn-block ${onThisCycle ? 'btn-ghost' : p.popular ? 'btn-primary' : 'btn-ghost'}`}
                      disabled={onThisCycle || !current}
                      onClick={() => change(p, cycle, current)}
                    >
                      {onThisCycle ? 'Active Studio Plan' : isCurrent ? `Switch to ${yearly ? 'yearly' : 'monthly'}` : `Choose ${p.name}`}
                    </button>
                  </div>
                )
              })}
        </div>
      )}

      <div className="all-access-callout">
        <div className="aac-content">
          <div>
            <span className="pill pill-warning">
              <i className="bi bi-stars" /> Highest Value
            </span>
            <h3>Looking for zero limits on events, storage and scans?</h3>
            <p>Our VIP All-Access tier gives your studio complete freedom all wedding season.</p>
          </div>
          <Link to="/all-access" className="btn btn-gold">
            <i className="bi bi-lightning-charge-fill" /> Explore All-Access
          </Link>
        </div>
      </div>

      <p className="muted" style={{ textAlign: 'center' }}>
        All prices exclude 18% GST. Need custom enterprise seats for multiple studio branches?{' '}
        <Link to="/support" className="link">
          Talk to our concierge
        </Link>
      </p>
    </div>
  )
}

export default AllSubscription
