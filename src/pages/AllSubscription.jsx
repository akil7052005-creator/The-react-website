import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader, FeatureTooltip } from '../components/ui'
import db from '../data'
import { formatINR } from '../utils/format'
import { featureInfo } from '../data/featureInfo'

function AllSubscription() {
  const [yearly, setYearly] = useState(false)

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Plans & Pricing"
        featureBadge="Cancel Anytime · Zero Contracts"
        title="Choose Your Studio Plan"
        subtitle="Transparent pricing built to scale as your wedding calendar fills up. Point cursor at any feature to see what's included."
        actions={
          <div className="tabs">
            <button className={!yearly ? 'on' : ''} onClick={() => setYearly(false)}>
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
              <button className={yearly ? 'on' : ''} onClick={() => setYearly(true)}>
                Yearly <span className="save">2 months free</span>
              </button>
            </FeatureTooltip>
          </div>
        }
      />

      <div className="grid grid-3" style={{ paddingTop: 12 }}>
        {db.plans.map((p) => {
          const current = p.name === db.subscription.plan
          return (
            <div
              key={p.name}
              className={`plan plan-catchy ${p.popular ? 'popular' : ''} ${current ? 'is-current-plan' : ''}`}
            >
              {current && <span className="plan-flag plan-flag-current">Your Current Plan</span>}
              {!current && p.popular && <span className="plan-flag">Most Popular</span>}
              
              <div className="plan-header">
                <h3>{p.name}</h3>
                <p className="tagline">{p.tagline}</p>
              </div>

              <div className="price">
                {formatINR(yearly ? p.yearly : p.monthly)}
                <small> / {yearly ? 'year' : 'month'}</small>
              </div>

              <p className="plan-features-header">
                <i className="bi bi-stars" /> Hover on features to inspect:
              </p>

              <ul className="checklist">
                {p.features.map((f) => {
                  const feat = featureInfo.features?.[f]
                  const item = (
                    <li key={f} className="plan-feature-item">
                      <i className="bi bi-check-circle-fill" />
                      <span>{f}</span>
                      <i className="bi bi-info-circle plan-feat-info" />
                    </li>
                  )

                  return feat ? (
                    <FeatureTooltip
                      key={f}
                      title={feat.title || f}
                      summary={feat.description}
                      badge={p.name}
                      position="top"
                      width={280}
                      delay={80}
                    >
                      {item}
                    </FeatureTooltip>
                  ) : (
                    item
                  )
                })}
              </ul>

              <button
                className={`btn btn-block ${
                  current ? 'btn-ghost' : p.popular ? 'btn-primary' : 'btn-ghost'
                }`}
                disabled={current}
              >
                {current ? 'Active Studio Plan' : `Choose ${p.name}`}
              </button>
            </div>
          )
        })}
      </div>

      <div className="all-access-callout">
        <div className="aac-content">
          <div>
            <span className="pill pill-warning"><i className="bi bi-stars" /> Highest Value</span>
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
        <Link to="/support" className="link">Talk to our concierge</Link>
      </p>
    </div>
  )
}

export default AllSubscription
