import { useState } from 'react'
import { PageHeader, Card, StatCard, StatusPill, Avatar } from '../components/ui'
import db from '../data'
import { formatDate, formatINR } from '../utils/format'

const filters = ['All', 'Pending', 'Overdue', 'Paid']

function Billing() {
  const [filter, setFilter] = useState('All')
  const { invoices } = db
  const sum = (status) => invoices.filter((i) => i.status === status).reduce((s, i) => s + i.amount, 0)
  const shown = filter === 'All' ? invoices : invoices.filter((i) => i.status === filter)

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Business"
        title="Billing"
        subtitle="GST-ready invoices for every booking. Send them on WhatsApp and get paid faster."
        actions={<button className="btn btn-primary"><i className="bi bi-plus-lg" />Create Invoice</button>}
      />

      <div className="grid grid-3">
        <StatCard icon="hourglass-split" label="Outstanding" value={formatINR(sum('Pending'))} tone="gold" />
        <StatCard icon="exclamation-triangle" label="Overdue" value={formatINR(sum('Overdue'))} tone="wine" />
        <StatCard icon="check2-circle" label="Collected" value={formatINR(sum('Paid'))} tone="green" />
      </div>

      <Card
        title="Invoices"
        flush
        action={
          <div className="tabs">
            {filters.map((f) => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f}</button>
            ))}
          </div>
        }
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Issued</th>
                <th>Due</th>
                <th className="num">Amount</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((inv) => (
                <tr key={inv.id}>
                  <td className="mono">{inv.id}</td>
                  <td><div className="person"><Avatar name={inv.customer} size={30} />{inv.customer}</div></td>
                  <td>{formatDate(inv.date)}</td>
                  <td>{formatDate(inv.due)}</td>
                  <td className="num cell-main">{formatINR(inv.amount)}</td>
                  <td><StatusPill status={inv.status} /></td>
                  <td className="num"><button className="icon-btn" aria-label={`Download ${inv.id}`}><i className="bi bi-download" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export default Billing
