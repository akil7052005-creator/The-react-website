import { useState } from 'react'
import { PageHeader, Card, StatCard, StatusPill, Avatar, FeatureTooltip, FeatureBar } from '../components/ui'
import db from '../data'
import { formatDate, formatINR } from '../utils/format'
import { featureInfo } from '../data/featureInfo'

const filters = ['All', 'Pending', 'Overdue', 'Paid']

const billingFeatures = [
  {
    title: 'GST-Ready Invoices',
    badge: 'SAC 9983',
    icon: 'file-earmark-check',
    summary: 'Automated 18% GST (9% CGST + 9% SGST or 18% IGST) calculations formatted for Indian tax compliance.',
    highlights: ['Includes studio GSTIN & client details', 'Automated sequential invoice numbers', 'One-click tax report export for GSTR-1'],
    tip: 'Saves your accountant hours during monthly GST filing.'
  },
  {
    title: 'WhatsApp UPI Payment Links',
    badge: 'Instant Pay',
    icon: 'whatsapp',
    summary: 'Send invoice links directly on WhatsApp with integrated UPI QR codes (GPay, PhonePe, Paytm).',
    highlights: ['Zero transaction friction for clients', 'Instant WhatsApp payment receipts sent upon receipt', 'Over 70% of clients pay within 2 hours'],
    tip: 'Include payment link when delivering digital album preview.'
  },
  {
    title: 'Milestone Tracking',
    badge: 'Cash Flow',
    icon: 'graph-up-arrow',
    summary: 'Split contracts into Booking Advance (30%), Pre-Shoot (30%), and Final Delivery (40%).',
    highlights: ['Automatic balance notifications before final handover', 'Reduces overdue receivables by 90%', 'Clear timeline for brides and families'],
    tip: 'Never release full-resolution unwatermarked photos before final payment.'
  },
  {
    title: 'Automated Overdue Nudges',
    badge: 'Gentle Reminders',
    icon: 'bell',
    summary: 'Polite, automated WhatsApp reminders sent 3 days before and on the invoice due date.',
    highlights: ['Tone is polite and professional', 'Customizable message template', 'Option to pause reminders per client'],
    tip: 'Reminders reduce awkward money conversations.'
  }
]

function Billing() {
  const [filter, setFilter] = useState('All')
  const { invoices } = db
  const sum = (status) => invoices.filter((i) => i.status === status).reduce((s, i) => s + i.amount, 0)
  const shown = filter === 'All' ? invoices : invoices.filter((i) => i.status === filter)

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Business Suite"
        featureBadge="GST Ready · SAC Code 9983"
        title="Billing & Invoicing"
        subtitle="Professional GST-ready photography invoices for every wedding. Send on WhatsApp and collect payments faster."
        actions={
          <FeatureTooltip
            title="Create GST Invoice"
            badge="Quick Bill"
            icon="plus-circle"
            summary="Generate a branded PDF invoice with automated GST breakdown and UPI payment link."
            position="bottom"
            width={280}
          >
            <button className="btn btn-primary">
              <i className="bi bi-plus-lg" />Create Invoice
            </button>
          </FeatureTooltip>
        }
      />

      {/* Feature Capabilities Ribbon */}
      <FeatureBar items={billingFeatures} />

      <div className="grid grid-3">
        <StatCard
          icon="hourglass-split"
          label="Outstanding"
          value={formatINR(sum('Pending'))}
          tone="gold"
          tooltip={{
            title: 'Pending Balances Awaiting Payment',
            badge: `${formatINR(sum('Pending'))} Pending`,
            icon: 'hourglass-split',
            summary: 'Invoices currently within their due date period; milestone balances pending delivery.',
            highlights: ['Expected settlement within 7 business days', 'Automatic payment reminder scheduled']
          }}
        />
        <StatCard
          icon="exclamation-triangle"
          label="Overdue"
          value={formatINR(sum('Overdue'))}
          tone="wine"
          tooltip={{
            title: 'Overdue Invoices Requiring Follow-Up',
            badge: `${formatINR(sum('Overdue'))} Overdue`,
            icon: 'exclamation-triangle',
            summary: 'Invoices whose payment due date has elapsed without settlement.',
            highlights: ['One-click WhatsApp payment nudge available', 'Locks album lab order placement until settled'],
            tip: 'Send a gentle WhatsApp nudge with the direct UPI payment link.'
          }}
        />
        <StatCard
          icon="check2-circle"
          label="Collected"
          value={formatINR(sum('Paid'))}
          tone="green"
          tooltip={{
            title: 'Revenue Collected This Period',
            badge: `${formatINR(sum('Paid'))} Collected`,
            icon: 'check2-circle',
            summary: 'Total payments successfully reconciled and verified in your studio account.',
            highlights: ['100% tax compliant', 'Ready for monthly CA filing']
          }}
        />
      </div>

      <Card
        title="Invoice History"
        subtitle="Point cursor at status or amount for payment breakdown"
        feature={featureInfo.billing}
        flush
        action={
          <div className="tabs">
            {filters.map((f) => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                {f}
              </button>
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
                <th className="num">
                  <FeatureTooltip
                    title="Invoice Amount"
                    summary="Total amount including 18% GST (SAC code 9983 for photographic services)."
                    position="top"
                    width={240}
                  >
                    <span className="table-th-interactive">Amount (incl. GST) <i className="bi bi-info-circle" /></span>
                  </FeatureTooltip>
                </th>
                <th>Status</th>
                <th className="num">PDF</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((inv) => (
                <tr key={inv.id}>
                  <td className="mono">
                    <FeatureTooltip
                      title={`Invoice ${inv.id}`}
                      summary={`GST Invoice issued for ${inv.customer}. SAC code 9983.`}
                      position="top"
                      width={220}
                    >
                      <span className="table-th-interactive">{inv.id}</span>
                    </FeatureTooltip>
                  </td>
                  <td>
                    <div className="person"><Avatar name={inv.customer} size={30} />{inv.customer}</div>
                  </td>
                  <td>{formatDate(inv.date)}</td>
                  <td>{formatDate(inv.due)}</td>
                  <td className="num cell-main">{formatINR(inv.amount)}</td>
                  <td><StatusPill status={inv.status} /></td>
                  <td className="num">
                    <FeatureTooltip
                      title="Download GST Invoice"
                      summary={`Download official tax invoice PDF with studio GSTIN 33ABCDE1234F1Z5.`}
                      position="left"
                      width={240}
                    >
                      <button className="icon-btn" aria-label={`Download ${inv.id}`}>
                        <i className="bi bi-download" />
                      </button>
                    </FeatureTooltip>
                  </td>
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
