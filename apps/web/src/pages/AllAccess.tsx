import { CYCLE_LABELS, PRICING_CYCLES, quotaOf, type BillingCycle, type PlanDto } from '@weddyzone/shared'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader, Skeleton } from '../components/ui'
import { perMonth, priceFor, usePlanActions, usePlans, useSubscription } from '../lib/billing'
import { planLimitLines } from '../lib/planCopy'
import { formatMoney } from '../utils/format'

const n = (v: number | null, unit = '') => (v === null ? 'Unlimited' : `${v.toLocaleString('en-IN')}${unit}`)
const gb = (v: number | null) => (v === null ? 'Unlimited' : v >= 1024 ? `${v / 1024} TB` : `${v} GB`)

/** The comparison rows: the current plan against VIP, from the plans' own limits. */
function rows(current: PlanDto, vip: PlanDto) {
  const c = quotaOf(current.limits)
  const v = quotaOf(vip.limits)
  const events = (q: typeof c) => (q.eventsTotal !== null ? `${q.eventsTotal} in total` : q.eventsPerMonth !== null ? `${q.eventsPerMonth} a month` : 'Unlimited (fair use)')
  return [
    { feature: 'Customer events', cur: events(c), vip: events(v) },
    { feature: 'Photos per event', cur: n(c.photosPerEvent), vip: n(v.photosPerEvent) },
    { feature: 'Uploads', cur: c.uploadGbTotal !== null ? `${gb(c.uploadGbTotal)} in total` : `${gb(c.uploadGbPerMonth)} a month`, vip: `${gb(v.uploadGbPerMonth)} a month` },
    { feature: 'Customer favourites', cur: c.favourites ? 'Yes' : 'No (heart picks)', vip: 'Yes (tick picks, heart favourites)' },
  ]
}

/** VIP: unlimited events (fair use), 5,000 photos per event, 1 TB a month and customer favourites. */
function AllAccess() {
  const plans = usePlans()
  const sub = useSubscription()
  const { change } = usePlanActions()
  const [cycle, setCycle] = useState<BillingCycle>('YEARLY')
  const vip = plans.data?.find((p) => p.code === 'ALL_ACCESS')
  const current = sub.data?.subscription
  const onVip = current?.plan.code === 'ALL_ACCESS' && !current.isTrial && current.status !== 'CANCELLED' && current.status !== 'EXPIRED'
  const price = vip ? priceFor(vip, cycle) : null

  return (
    <div className="stack">
      <PageHeader eyebrow="Plans" featureBadge="Top tier" title="VIP" subtitle="Unlimited customer events (fair use), 5,000 photos per event, 1 TB of uploads a month and customer favourites." />

      <div className="lux lux-catchy">
        <div className="grid grid-2" style={{ alignItems: 'center' }}>
          <div>
            <p className="eyebrow">
              <i className="bi bi-stars" /> VIP
            </p>
            <h2>
              Every wedding, <em>no limits to watch.</em>
            </h2>
            <div className="tabs" role="tablist" aria-label="Billing period" style={{ marginTop: 12 }}>
              {PRICING_CYCLES.map((c) => (
                <button key={c} role="tab" aria-selected={c === cycle} className={c === cycle ? 'on' : ''} onClick={() => setCycle(c)}>
                  {CYCLE_LABELS[c]}
                </button>
              ))}
            </div>
            <div className="price-tag-group">
              <p className="big-number">
                {price !== null ? formatMoney(price) : vip ? '—' : <Skeleton width={180} height={40} />}
                <small style={{ fontSize: 16, fontWeight: 500, opacity: 0.8 }}> / {CYCLE_LABELS[cycle]}</small>
              </p>
              {price !== null && cycle !== 'MONTHLY' && <span className="save-badge">{formatMoney(perMonth(price, cycle))} a month</span>}
            </div>
            <div className="store-btns" style={{ marginTop: 22 }}>
              <button className="btn btn-gold btn-lg" disabled={!vip || !current || (onVip && current?.cycle === cycle) || price === null} onClick={() => vip && change(vip, cycle, current)}>
                <i className="bi bi-lightning-charge-fill" /> {onVip && current?.cycle === cycle ? "You're on VIP" : `Choose VIP for ${CYCLE_LABELS[cycle]}`}
              </button>
            </div>
          </div>
          <ul className="checklist checklist-catchy" style={{ marginBottom: 0 }}>
            {(vip ? planLimitLines(vip) : []).map((line) => (
              <li key={line} className="perk-item">
                <i className="bi bi-check-circle-fill" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {vip && current && current.plan.code !== 'ALL_ACCESS' && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{current.plan.name} vs VIP</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>{current.plan.name}</th>
                  <th>VIP</th>
                </tr>
              </thead>
              <tbody>
                {rows(current.plan, vip).map((r) => (
                  <tr key={r.feature}>
                    <td>{r.feature}</td>
                    <td>{r.cur}</td>
                    <td>
                      <strong>{r.vip}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="muted" style={{ textAlign: 'center' }}>
        All prices exclude 18% GST. Compare every plan on{' '}
        <Link to="/subscriptions" className="link">
          Plans &amp; Pricing
        </Link>
        .
      </p>
    </div>
  )
}

export default AllAccess
