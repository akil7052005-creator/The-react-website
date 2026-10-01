import { useQuery } from '@tanstack/react-query'
import { amountInWords, INVOICE_STATUS_LABELS, PAYMENT_METHOD_LABELS, stateName, type InvoiceDetailDto } from '@weddyzone/shared'
import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CardSkeleton, EmptyState, ErrorState } from '../components/ui'
import { api, isApiError } from '../lib/api'
import { fileUrl } from '../lib/env'
import { formatDate, formatMoney } from '../utils/format'

/** Print-friendly GST tax invoice. "Print / Save as PDF" uses the browser's print dialog. */
export default function InvoicePrint() {
  const { id = '' } = useParams()
  const q = useQuery({ queryKey: ['invoice', id], queryFn: () => api.get<InvoiceDetailDto>(`/invoices/${id}`) })
  const inv = q.data

  useEffect(() => {
    if (inv) document.title = `${inv.number} · ${inv.client.name}`
  }, [inv])

  if (q.isPending) {
    return (
      <div className="print-shell">
        <CardSkeleton rows={10} />
      </div>
    )
  }
  if (q.isError || !inv) {
    return (
      <div className="print-shell">
        <div className="card">
          {isApiError(q.error) && q.error.status === 404 ? (
            <EmptyState icon="receipt" title="Invoice not found" text="It may have been removed." action={<Link to="/billing" className="btn btn-primary">Back to billing</Link>} />
          ) : (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          )}
        </div>
      </div>
    )
  }

  const s = inv.studio
  const intra = inv.supplyType === 'INTRA'

  return (
    <div className="print-shell">
      <div className="print-toolbar no-print">
        <Link to={`/billing?invoice=${inv.id}`} className="btn btn-ghost">
          <i className="bi bi-arrow-left" /> Back to billing
        </Link>
        <button className="btn btn-primary" onClick={() => window.print()}>
          <i className="bi bi-printer" /> Print / Save as PDF
        </button>
      </div>

      <article className="invoice-sheet" aria-label={`Tax invoice ${inv.number}`}>
        {inv.status === 'CANCELLED' && <div className="invoice-watermark">CANCELLED</div>}
        {inv.status === 'PAID' && <div className="invoice-watermark paid">PAID</div>}

        <header className="inv-head">
          <div className="inv-studio">
            {s.logoUrl && <img src={fileUrl(s.logoUrl)} alt="" className="inv-logo" />}
            <div>
              <h1>{s.name}</h1>
              <p>
                {[s.addressLine1, s.addressLine2].filter(Boolean).join(', ')}
                {(s.addressLine1 || s.addressLine2) && <br />}
                {[s.city, stateName(s.stateCode), s.pincode].filter(Boolean).join(', ')}
              </p>
              <p>
                {s.phone}
                {s.email ? ` · ${s.email}` : ''}
              </p>
              {s.gstin && (
                <p>
                  <strong>GSTIN:</strong> {s.gstin}
                  {s.pan ? ` · PAN: ${s.pan}` : ''}
                </p>
              )}
            </div>
          </div>
          <div className="inv-title">
            <h2>Tax Invoice</h2>
            <dl>
              <dt>Invoice no.</dt>
              <dd className="mono">{inv.number}</dd>
              <dt>Invoice date</dt>
              <dd>{formatDate(inv.issueDate)}</dd>
              <dt>Due date</dt>
              <dd>{formatDate(inv.dueDate)}</dd>
              <dt>Status</dt>
              <dd>{INVOICE_STATUS_LABELS[inv.status]}</dd>
            </dl>
          </div>
        </header>

        <section className="inv-parties">
          <div>
            <h3>Bill to</h3>
            <p className="inv-strong">{inv.client.name}</p>
            <p>{inv.client.phone}</p>
            {inv.client.email && <p>{inv.client.email}</p>}
            {(inv.client.city || inv.client.stateCode) && <p>{[inv.client.city, stateName(inv.client.stateCode)].filter(Boolean).join(', ')}</p>}
            {inv.client.gstin && (
              <p>
                <strong>GSTIN:</strong> {inv.client.gstin}
              </p>
            )}
          </div>
          <div>
            <h3>Supply details</h3>
            <p>
              <strong>Place of supply:</strong> {stateName(inv.placeOfSupply)} ({inv.placeOfSupply})
            </p>
            <p>
              <strong>Tax type:</strong> {intra ? 'Intra-state (CGST + SGST)' : 'Inter-state (IGST)'}
            </p>
            {inv.event && (
              <p>
                <strong>Event:</strong> {inv.event.title} ({inv.event.code})
              </p>
            )}
          </div>
        </section>

        <table className="inv-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Description</th>
              <th>SAC</th>
              <th className="num">Qty</th>
              <th className="num">Rate</th>
              <th className="num">Taxable value</th>
              <th className="num">GST</th>
              <th className="num">Tax</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((it, i) => (
              <tr key={it.id}>
                <td>{i + 1}</td>
                <td>{it.description}</td>
                <td className="mono">{it.sac}</td>
                <td className="num">{it.qty}</td>
                <td className="num">{formatMoney(it.ratePaise)}</td>
                <td className="num">{formatMoney(it.taxablePaise)}</td>
                <td className="num">{it.gstRate}%</td>
                <td className="num">{formatMoney(it.taxPaise)}</td>
                <td className="num">{formatMoney(it.totalPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="inv-bottom">
          <div className="inv-words">
            <h3>Amount in words</h3>
            <p>{amountInWords(inv.totalPaise)}</p>
            {inv.milestones.length > 0 && (
              <>
                <h3>Payment schedule</h3>
                <ul>
                  {inv.milestones.map((m) => (
                    <li key={m.id}>
                      {m.label} — {formatMoney(m.amountPaise)} by {formatDate(m.dueDate)}
                      {m.paidAt ? ' (paid)' : ''}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {inv.payments.length > 0 && (
              <>
                <h3>Payments received</h3>
                <ul>
                  {inv.payments.map((p) => (
                    <li key={p.id}>
                      {formatDate(p.paidOn)} · {PAYMENT_METHOD_LABELS[p.method]}
                      {p.reference ? ` (${p.reference})` : ''} — {formatMoney(p.amountPaise)}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {inv.notes && (
              <>
                <h3>Notes</h3>
                <p style={{ whiteSpace: 'pre-line' }}>{inv.notes}</p>
              </>
            )}
          </div>
          <dl className="inv-totals">
            <dt>Taxable value</dt>
            <dd>{formatMoney(inv.subtotalPaise)}</dd>
            {intra ? (
              <>
                <dt>CGST</dt>
                <dd>{formatMoney(inv.cgstPaise)}</dd>
                <dt>SGST</dt>
                <dd>{formatMoney(inv.sgstPaise)}</dd>
              </>
            ) : (
              <>
                <dt>IGST</dt>
                <dd>{formatMoney(inv.igstPaise)}</dd>
              </>
            )}
            <dt className="grand">Invoice total</dt>
            <dd className="grand">{formatMoney(inv.totalPaise)}</dd>
            <dt>Amount paid</dt>
            <dd>{formatMoney(inv.amountPaidPaise)}</dd>
            <dt className="grand">Balance due</dt>
            <dd className="grand">{formatMoney(inv.balancePaise)}</dd>
          </dl>
        </section>

        <footer className="inv-foot">
          <p>This is a computer-generated invoice.</p>
          <div className="inv-sign">
            <span>For {s.name}</span>
            <span className="inv-sign-line">Authorised signatory</span>
          </div>
        </footer>
      </article>
    </div>
  )
}
