import { useState } from 'react'
import { PageHeader, Card, StatusPill } from '../components/ui'
import db from '../data'
import { formatINR, formatNumber } from '../utils/format'

function WhatsAppCredit() {
  const { whatsapp } = db
  const [picked, setPicked] = useState(whatsapp.packs.findIndex((p) => p.popular))
  const pack = whatsapp.packs[picked]

  return (
    <div className="stack">
      <PageHeader eyebrow="Wallet" title="WhatsApp Credit" subtitle="Credits power reminders, gallery links and invoices sent to clients on WhatsApp. 1 credit = 1 message." />

      <div className="grid grid-1-2">
        <Card title="Available credits">
          <p className="big-number">{formatNumber(whatsapp.credits)}</p>
          <p className="muted">≈ {Math.floor(whatsapp.credits / 200)} events worth of guest messages</p>
        </Card>

        <Card title="Top up" subtitle="Credits never expire">
          <div className="grid grid-3" style={{ gap: 12 }}>
            {whatsapp.packs.map((p, i) => (
              <button key={p.credits} className={`pack ${picked === i ? 'selected' : ''}`} onClick={() => setPicked(i)}>
                {p.popular ? <span className="pill pill-warning">Best value</span> : <span className="muted">&nbsp;</span>}
                <strong>{formatNumber(p.credits)}</strong>
                <span className="muted">credits · {formatINR(p.price)}</span>
              </button>
            ))}
          </div>
          <div className="form-foot">
            <button className="btn btn-primary"><i className="bi bi-lightning-charge" />Buy {formatNumber(pack.credits)} for {formatINR(pack.price)}</button>
          </div>
        </Card>
      </div>

      <Card title="Message log" subtitle="Recent messages sent from your studio" flush>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Type</th>
                <th className="num">Credits</th>
                <th>Sent</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {whatsapp.log.map((m, i) => (
                <tr key={i}>
                  <td className="cell-main">{m.to}</td>
                  <td>{m.type}</td>
                  <td className="num">{m.credits}</td>
                  <td>{m.time}</td>
                  <td><StatusPill status={m.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export default WhatsAppCredit
