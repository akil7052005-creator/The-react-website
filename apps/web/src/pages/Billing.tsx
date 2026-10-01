import { useQuery } from '@tanstack/react-query'
import { INVOICE_STATUS_LABELS, type InvoiceDto, type InvoiceSummaryDto, type Paginated } from '@weddyzone/shared'
import { useState } from 'react'
import {
  PageHeader,
  Card,
  StatCard,
  StatusPill,
  Avatar,
  FeatureTooltip,
  FeatureBar,
  EmptyState,
  ErrorState,
  TableSkeleton,
  Pagination,
  type FeatureBarItem,
} from '../components/ui'
import { CreateInvoiceModal } from '../components/billing/CreateInvoiceModal'
import { InvoiceDetailModal, RecordPaymentModal, useInvoiceActions } from '../components/billing/InvoiceDialogs'
import { useMe } from '../auth/AuthProvider'
import { formatDate, formatMoney } from '../utils/format'
import { featureInfo } from '../data/featureInfo'
import { useDebouncedUrlSearch, useUrlState } from '../hooks/useUrlState'
import { api } from '../lib/api'

const filters: { key: string; label: string; count: keyof InvoiceSummaryDto['counts'] }[] = [
  { key: '', label: 'All', count: 'all' },
  { key: 'PENDING', label: 'Pending', count: 'pending' },
  { key: 'OVERDUE', label: 'Overdue', count: 'overdue' },
  { key: 'PAID', label: 'Paid', count: 'paid' },
]

const billingFeatures: FeatureBarItem[] = [
  {
    title: 'GST-Ready Invoices',
    badge: 'SAC 9983',
    icon: 'file-earmark-check',
    summary: 'Automated 18% GST (9% CGST + 9% SGST or 18% IGST) calculations formatted for Indian tax compliance.',
    highlights: ['Includes studio GSTIN & client details', 'Automated sequential invoice numbers', 'One-click tax report export for GSTR-1'],
    tip: 'Saves your accountant hours during monthly GST filing.',
  },
  {
    title: 'WhatsApp UPI Payment Links',
    badge: 'Instant Pay',
    icon: 'whatsapp',
    summary: 'Send invoice links directly on WhatsApp with integrated UPI QR codes (GPay, PhonePe, Paytm).',
    highlights: ['Zero transaction friction for clients', 'Instant WhatsApp payment receipts sent upon receipt', 'Over 70% of clients pay within 2 hours'],
    tip: 'Include payment link when delivering digital album preview.',
  },
  {
    title: 'Milestone Tracking',
    badge: 'Cash Flow',
    icon: 'graph-up-arrow',
    summary: 'Split contracts into Booking Advance (30%), Pre-Shoot (30%), and Final Delivery (40%).',
    highlights: ['Automatic balance notifications before final handover', 'Reduces overdue receivables by 90%', 'Clear timeline for brides and families'],
    tip: 'Never release full-resolution unwatermarked photos before final payment.',
  },
  {
    title: 'Automated Overdue Nudges',
    badge: 'Gentle Reminders',
    icon: 'bell',
    summary: 'Polite, automated WhatsApp reminders sent 3 days before and on the invoice due date.',
    highlights: ['Tone is polite and professional', 'Customizable message template', 'Option to pause reminders per client'],
    tip: 'Reminders reduce awkward money conversations.',
  },
]

function Billing() {
  const { studio } = useMe()
  const [url, setUrl] = useUrlState({ status: '', search: '', page: '1', invoice: '', create: '' })
  const [search, setSearch] = useDebouncedUrlSearch(url.search, (v) => setUrl({ search: v }))
  const [paying, setPaying] = useState<InvoiceDto | null>(null)
  const page = Math.max(1, Number(url.page) || 1)
  const actions = useInvoiceActions(setPaying)

  const summary = useQuery({ queryKey: ['invoices-summary'], queryFn: () => api.get<InvoiceSummaryDto>('/invoices/summary') })
  const list = useQuery({
    queryKey: ['invoices', { status: url.status, search: url.search, page }],
    queryFn: () => api.get<Paginated<InvoiceDto>>('/invoices', { status: url.status, search: url.search, page, limit: 10 }),
    placeholderData: (prev) => prev,
  })
  const s = summary.data
  const rows = list.data?.data ?? []
  const money = (paise: number | undefined) => (paise === undefined ? '—' : formatMoney(paise))

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
            <button className="btn btn-primary" onClick={() => setUrl({ create: '1' })}>
              <i className="bi bi-plus-lg" />
              Create Invoice
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
          value={money(s?.outstandingPaise)}
          tone="gold"
          tooltip={{
            title: 'Pending Balances Awaiting Payment',
            badge: `${money(s?.outstandingPaise)} Pending`,
            icon: 'hourglass-split',
            summary: 'Invoices currently within their due date period; milestone balances pending delivery.',
            highlights: [`${s?.counts.pending ?? 0} invoice(s) not yet due`],
          }}
        />
        <StatCard
          icon="exclamation-triangle"
          label="Overdue"
          value={money(s?.overduePaise)}
          tone="wine"
          tooltip={{
            title: 'Overdue Invoices Requiring Follow-Up',
            badge: `${money(s?.overduePaise)} Overdue`,
            icon: 'exclamation-triangle',
            summary: 'Invoices whose payment due date has elapsed without settlement.',
            highlights: [`${s?.counts.overdue ?? 0} overdue invoice(s)`, 'One-click WhatsApp payment nudge available'],
            tip: 'Send a gentle WhatsApp nudge with the invoice details.',
          }}
        />
        <StatCard
          icon="check2-circle"
          label="Collected"
          value={money(s?.collectedPaise)}
          tone="green"
          tooltip={{
            title: 'Revenue Collected This Period',
            badge: `${money(s?.collectedPaise)} Collected`,
            icon: 'check2-circle',
            summary: 'Total payments successfully reconciled and verified in your studio account.',
            highlights: ['100% tax compliant', 'Ready for monthly CA filing'],
          }}
        />
      </div>

      <Card
        title="Invoice History"
        subtitle="Point cursor at status or amount for payment breakdown"
        feature={featureInfo.billing}
        flush
        action={
          <div className="tabs" role="tablist">
            {filters.map((f) => (
              <button key={f.label} role="tab" aria-selected={url.status === f.key} className={url.status === f.key ? 'on' : ''} onClick={() => setUrl({ status: f.key })}>
                {f.label}
                {s && <span className="tab-count">({s.counts[f.count]})</span>}
              </button>
            ))}
          </div>
        }
      >
        <div className="list-toolbar">
          <label className="search">
            <i className="bi bi-search" />
            <input type="search" placeholder="Search invoice number, client or event" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search invoices" />
          </label>
          {!studio.gstin && (
            <span className="pill pill-warning" title="Add your GSTIN in My Profile so it prints on invoices">
              <i className="bi bi-info-circle" /> GSTIN not set in profile
            </span>
          )}
        </div>
        {list.isPending ? (
          <TableSkeleton rows={6} cols={7} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : rows.length === 0 ? (
          url.status || url.search ? (
            <EmptyState icon="search" title="No invoices match" text="Try another tab or search." action={<button className="btn btn-ghost" onClick={() => setUrl({ status: '', search: '' })}>Clear filters</button>} />
          ) : (
            <EmptyState
              icon="receipt"
              title="No invoices yet"
              text="Create your first GST invoice — totals, CGST/SGST or IGST and numbering are automatic."
              action={
                <button className="btn btn-primary" onClick={() => setUrl({ create: '1' })}>
                  <i className="bi bi-plus-lg" /> Create Invoice
                </button>
              }
            />
          )
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Issued</th>
                  <th>Due</th>
                  <th className="num">
                    <FeatureTooltip title="Invoice Amount" summary="Total amount including GST (SAC 998386, photography services)." position="top" width={240}>
                      <span className="table-th-interactive">
                        Amount (incl. GST) <i className="bi bi-info-circle" />
                      </span>
                    </FeatureTooltip>
                  </th>
                  <th>Status</th>
                  <th className="num">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((inv) => {
                  const open = inv.status === 'PENDING' || inv.status === 'OVERDUE'
                  return (
                    <tr key={inv.id}>
                      <td className="mono">
                        <button className="table-th-interactive link-plain" onClick={() => setUrl({ invoice: inv.id })} title="Open invoice">
                          {inv.number}
                        </button>
                      </td>
                      <td>
                        <div className="person">
                          <Avatar name={inv.client.name} size={30} />
                          {inv.client.name}
                        </div>
                      </td>
                      <td>{formatDate(inv.issueDate)}</td>
                      <td>{formatDate(inv.dueDate)}</td>
                      <td className="num cell-main">
                        <FeatureTooltip
                          title={inv.number}
                          summary={`Taxable ${formatMoney(inv.subtotalPaise)} + ${inv.supplyType === 'INTRA' ? `CGST ${formatMoney(inv.cgstPaise)} + SGST ${formatMoney(inv.sgstPaise)}` : `IGST ${formatMoney(inv.igstPaise)}`}. Paid ${formatMoney(inv.amountPaidPaise)}, balance ${formatMoney(inv.balancePaise)}.`}
                          position="top"
                          width={260}
                        >
                          <span>{formatMoney(inv.totalPaise)}</span>
                        </FeatureTooltip>
                      </td>
                      <td>
                        <StatusPill status={INVOICE_STATUS_LABELS[inv.status]} />
                      </td>
                      <td className="num">
                        <div className="row-actions">
                          <button className="icon-btn" aria-label={`Print ${inv.number}`} title="View / print (Save as PDF)" onClick={() => actions.print(inv)}>
                            <i className="bi bi-download" />
                          </button>
                          {inv.status !== 'CANCELLED' && (
                            <button className="icon-btn" aria-label={`Send ${inv.number} on WhatsApp`} title="Share on WhatsApp" onClick={() => actions.whatsapp(inv)}>
                              <i className="bi bi-whatsapp" />
                            </button>
                          )}
                          {open && (
                            <button className="icon-btn" aria-label={`Record payment for ${inv.number}`} title="Record payment" onClick={() => setPaying(inv)}>
                              <i className="bi bi-cash-coin" />
                            </button>
                          )}
                          <button className="icon-btn" aria-label={`More actions for ${inv.number}`} title="Details, mark paid, cancel" onClick={() => setUrl({ invoice: inv.id })}>
                            <i className="bi bi-three-dots" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {list.data && <Pagination page={page} limit={list.data.meta.limit} total={list.data.meta.total} onPage={(p) => setUrl({ page: String(p) })} />}
      </Card>

      <CreateInvoiceModal open={url.create === '1'} onClose={() => setUrl({ create: '' })} />
      <InvoiceDetailModal id={url.invoice || null} onClose={() => setUrl({ invoice: '' })} onPay={setPaying} />
      <RecordPaymentModal invoice={paying} onClose={() => setPaying(null)} />
    </div>
  )
}

export default Billing
