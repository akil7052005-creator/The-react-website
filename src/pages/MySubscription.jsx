import { Link } from 'react-router-dom'
import { PageHeader, Card, Progress, StatusPill, FeatureTooltip, FeatureBar } from '../components/ui'
import db from '../data'
import { formatDate, formatINR, formatNumber } from '../utils/format'
import { featureInfo } from '../data/featureInfo'

const quotaTooltips = {
  Storage: {
    title: 'High-Speed Cloud Storage',
    summary: 'Used 212 GB out of 500 GB allocated. Stores full-resolution client galleries, web thumbnails, and 3D album spreads.',
    tip: 'Upgrade to All-Access for 5 TB of unmetered storage.'
  },
  'Events this month': {
    title: 'Monthly Event Creation Quota',
    summary: 'Used 18 of 30 wedding events this month. Resets automatically on your monthly billing anniversary.',
    tip: '12 events remaining before reaching plan cap.'
  },
  'Face scans': {
    title: 'AI Face Search Queries',
    summary: '4,200 guest selfie searches processed this month out of your 10,000 monthly allowance.',
    tip: '5,800 scans left — ample for your upcoming bookings.'
  }
}

function MySubscription() {
  const { subscription: sub, plans } = db
  const plan = plans.find((p) => p.name === sub.plan)

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Plans & Usage"
        featureBadge={`Active Tier: ${sub.plan}`}
        title="My Studio Subscription"
        subtitle="Manage your current tier, track real-time quota usage, and review billing statements."
      />

      <div className="grid grid-1-2">
        <div className="lux lux-catchy">
          <p className="eyebrow"><i className="bi bi-patch-check-fill" /> Active Membership</p>
          <h2><em>{sub.plan}</em> Studio Plan</h2>
          <p className="big-number">
            {formatINR(sub.price)}
            <small style={{ fontSize: 16, fontWeight: 500, opacity: 0.8 }}> / month</small>
          </p>
          <p style={{ marginTop: 10, color: 'rgba(255, 255, 255, 0.85)' }}>
            Renews on <strong>{formatDate(sub.renews)}</strong> · Billed {sub.cycle.toLowerCase()}
          </p>
          <div className="store-btns" style={{ marginTop: 20 }}>
            <Link to="/subscriptions" className="btn btn-gold">
              <i className="bi bi-arrow-up-circle-fill" /> Upgrade Plan
            </Link>
            <Link to="/all-access" className="store-btn">
              <i className="bi bi-stars" /> See All-Access
            </Link>
          </div>
        </div>

        <Card
          title="Usage This Billing Cycle"
          subtitle="Point cursor at any meter to inspect usage breakdown"
          feature={featureInfo.mySubscription}
        >
          {sub.usage.map((u) => {
            const tip = quotaTooltips[u.label]
            const pct = Math.round((u.used / u.limit) * 100)
            return (
              <FeatureTooltip
                key={u.label}
                title={tip?.title || u.label}
                badge={`${pct}% Used`}
                summary={tip?.summary}
                tip={tip?.tip}
                position="top"
                width={280}
              >
                <div className="progress-row" style={{ cursor: 'help' }}>
                  <div className="progress-meta">
                    <strong>
                      {u.label} <i className="bi bi-info-circle plan-feat-info" />
                    </strong>
                    <span>
                      {formatNumber(u.used)} / {formatNumber(u.limit)} {u.unit} ({pct}%)
                    </span>
                  </div>
                  <Progress value={u.used} max={u.limit} label={u.label} />
                </div>
              </FeatureTooltip>
            )
          })}
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Included in Your Plan" subtitle="Point cursor at any feature to view specifications">
          <ul className="checklist checklist-catchy" style={{ marginBottom: 0 }}>
            {plan.features.map((f) => {
              const feat = featureInfo.features?.[f]
              const li = (
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
                  position="top"
                  width={280}
                >
                  {li}
                </FeatureTooltip>
              ) : (
                li
              )
            })}
          </ul>
        </Card>

        <Card
          title="Recent Payment Statements"
          flush
          action={
            <Link to="/billing" className="link">
              Billing Center <i className="bi bi-arrow-right" />
            </Link>
          }
        >
          <table className="table">
            <thead>
              <tr>
                <th>Billing Date</th>
                <th>Plan Cycle</th>
                <th className="num">Amount</th>
                <th className="num">Status</th>
              </tr>
            </thead>
            <tbody>
              {['2026-09-02', '2026-08-02', '2026-07-02'].map((d) => (
                <tr key={d}>
                  <td>{formatDate(d)}</td>
                  <td>{sub.plan} Plan · Monthly</td>
                  <td className="num cell-main">{formatINR(sub.price)}</td>
                  <td className="num"><StatusPill status="Paid" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  )
}

export default MySubscription
