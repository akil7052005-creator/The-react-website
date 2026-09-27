import { Link } from 'react-router-dom'
import { PageHeader, Card, Progress, StatusPill } from '../components/ui'
import db from '../data'
import { formatDate, formatINR, formatNumber } from '../utils/format'

function MySubscription() {
  const { subscription: sub, plans } = db
  const plan = plans.find((p) => p.name === sub.plan)

  return (
    <div className="stack">
      <PageHeader eyebrow="Plans" title="My Subscription" subtitle="Your current plan, usage and renewal details." />

      <div className="grid grid-1-2">
        <div className="lux">
          <p className="eyebrow">Current plan</p>
          <h2><em>{sub.plan}</em> plan</h2>
          <p className="big-number">{formatINR(sub.price)}<small style={{ fontSize: 15, fontWeight: 500, opacity: 0.7 }}> / month</small></p>
          <p style={{ marginTop: 8 }}>Renews on {formatDate(sub.renews)} · Billed {sub.cycle.toLowerCase()}</p>
          <div className="store-btns">
            <Link to="/subscriptions" className="btn btn-gold"><i className="bi bi-arrow-up-circle" />Upgrade</Link>
            <Link to="/all-access" className="store-btn">See All-Access</Link>
          </div>
        </div>

        <Card title="Usage this cycle" subtitle="Resets on your renewal date">
          {sub.usage.map((u) => (
            <div className="progress-row" key={u.label}>
              <div className="progress-meta">
                <strong>{u.label}</strong>
                <span>{formatNumber(u.used)} / {formatNumber(u.limit)} {u.unit}</span>
              </div>
              <Progress value={u.used} max={u.limit} label={u.label} />
            </div>
          ))}
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="What's included">
          <ul className="checklist" style={{ marginBottom: 0 }}>
            {plan.features.map((f) => (
              <li key={f}><i className="bi bi-check-circle-fill" />{f}</li>
            ))}
          </ul>
        </Card>
        <Card title="Recent payments" flush action={<Link to="/billing" className="link">Billing <i className="bi bi-arrow-right" /></Link>}>
          <table className="table">
            <tbody>
              {['2026-09-02', '2026-08-02', '2026-07-02'].map((d) => (
                <tr key={d}>
                  <td>{formatDate(d)}</td>
                  <td>{sub.plan} · Monthly</td>
                  <td className="num">{formatINR(sub.price)}</td>
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
