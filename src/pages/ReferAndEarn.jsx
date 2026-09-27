import { useState } from 'react'
import { PageHeader, Card, StatCard, StatusPill } from '../components/ui'
import db from '../data'
import { formatDate, formatINR } from '../utils/format'

function ReferAndEarn() {
  const { wallet } = db
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(wallet.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be blocked (e.g. non-HTTPS); the code is still visible to copy by hand.
    }
  }

  return (
    <div className="stack">
      <PageHeader eyebrow="Wallet" title="Refer & Earn" subtitle="Invite fellow photographers. You both get ₹1,500 in wallet credit when they subscribe." />

      <div className="grid grid-2-1">
        <div className="lux">
          <p className="eyebrow">Your referral code</p>
          <h2>Share the love, <em>earn ₹1,500</em> per studio.</h2>
          <div className="code-box">
            <code>{wallet.code}</code>
            <button className="btn btn-gold btn-sm" onClick={copy}>
              <i className={`bi bi-${copied ? 'check2' : 'copy'}`} />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
        <div className="stack">
          <StatCard icon="wallet2" label="Wallet balance" value={formatINR(wallet.balance)} tone="gold" />
          <StatCard icon="gift" label="Total earned" value={formatINR(wallet.earned)} tone="green" />
        </div>
      </div>

      <Card title="Your referrals" flush>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Studio</th>
                <th>Joined</th>
                <th className="num">Reward</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {wallet.referrals.map((r) => (
                <tr key={r.name}>
                  <td className="cell-main">{r.name}</td>
                  <td>{formatDate(r.date)}</td>
                  <td className="num">{formatINR(r.reward)}</td>
                  <td><StatusPill status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export default ReferAndEarn
