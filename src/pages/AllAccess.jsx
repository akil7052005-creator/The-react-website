import { PageHeader, Card } from '../components/ui'
import { formatINR } from '../utils/format'

const perks = [
  'Unlimited events & photo selections',
  'Unlimited AI face recognition scans',
  '5 TB storage with original-quality downloads',
  '10,000 WhatsApp credits every year',
  'Premium website themes & custom domain',
  'Dedicated account manager',
]

const compare = [
  ['Events per month', '30', 'Unlimited'],
  ['Storage', '500 GB', '5 TB'],
  ['Face recognition scans', '10,000 / mo', 'Unlimited'],
  ['WhatsApp credits', 'Pay as you go', '10,000 / yr included'],
  ['Team seats', '1', '10'],
  ['Support', 'Email', 'Dedicated manager'],
]

function AllAccess() {
  return (
    <div className="stack">
      <PageHeader eyebrow="Plans" title="All-Access" subtitle="One plan. Every feature. No limits holding your studio back." />

      <div className="lux">
        <div className="grid grid-2" style={{ alignItems: 'center' }}>
          <div>
            <p className="eyebrow"><i className="bi bi-stars" /> All-Access · Yearly</p>
            <h2>Everything Weddingz offers, <em>without limits.</em></h2>
            <p>Built for studios shooting through the whole wedding season. Pay once a year and never think about quotas again.</p>
            <p className="big-number">{formatINR(49999)}<small style={{ fontSize: 15, fontWeight: 500, opacity: 0.7 }}> / year</small></p>
            <div className="store-btns" style={{ marginTop: 18 }}>
              <button className="btn btn-gold"><i className="bi bi-lightning-charge-fill" />Upgrade to All-Access</button>
            </div>
          </div>
          <ul className="checklist" style={{ marginBottom: 0 }}>
            {perks.map((p) => (
              <li key={p}><i className="bi bi-check-circle-fill" />{p}</li>
            ))}
          </ul>
        </div>
      </div>

      <Card title="Pro vs All-Access" flush>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Pro (current)</th>
                <th>All-Access</th>
              </tr>
            </thead>
            <tbody>
              {compare.map(([f, pro, all]) => (
                <tr key={f}>
                  <td className="cell-main">{f}</td>
                  <td>{pro}</td>
                  <td style={{ color: 'var(--wine)', fontWeight: 600 }}><i className="bi bi-check2" /> {all}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export default AllAccess
