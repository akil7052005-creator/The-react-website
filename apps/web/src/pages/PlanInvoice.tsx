import { useQuery } from '@tanstack/react-query'
import { stateName, type PlatformInvoiceDto } from '@weddyzone/shared'
import { useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CardSkeleton, EmptyState, ErrorState } from '../components/ui'
import { api, isApiError } from '../lib/api'
import { formatDate, formatMoney } from '../utils/format'

/** Studio: Wedmanage's GST tax invoice for one of its own plan payments. */
export default function PlanInvoice() {
  const { id = '' } = useParams()
  return <PlanInvoiceView path={`/subscription/payments/${id}/invoice`} backTo="/my-subscription" backLabel="Back to my subscription" />
}

/** Platform admin: the same invoice for any studio's plan payment (/admin/invoices/:id). */
export function AdminPlanInvoice() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate('/admin/subscriptions'))
  return <PlanInvoiceView path={`/admin/payments/${id}/invoice`} onBack={back} backLabel="Back" />
}

/** Wedmanage's GST tax invoice for a plan payment. Print / Save as PDF from the browser. */
function PlanInvoiceView({ path, backTo, onBack, backLabel }: { path: string; backTo?: string; onBack?: () => void; backLabel: string }) {
  const q = useQuery({ queryKey: ['plan-invoice', path], queryFn: () => api.get<PlatformInvoiceDto>(path) })
  const inv = q.data
  const backButton = backTo ? (
    <Link to={backTo} className="btn btn-ghost">
      <i className="bi bi-arrow-left" /> {backLabel}
    </Link>
  ) : (
    <button className="btn btn-ghost" onClick={onBack}>
      <i className="bi bi-arrow-left" /> {backLabel}
    </button>
  )

  useEffect(() => {
    if (inv) document.title = `${inv.number} · Wedmanage`
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
            <EmptyState icon="receipt" title="Invoice not found" action={backButton} />
          ) : (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          )}
        </div>
      </div>
    )
  }

  const intra = inv.igstPaise === 0 && inv.cgstPaise + inv.sgstPaise > 0
  return (
    <div className="print-shell">
      <div className="print-toolbar no-print">
        {backButton}
        <button className="btn btn-primary" onClick={() => window.print()}>
          <i className="bi bi-printer" /> Print / Save as PDF
        </button>
      </div>

      <article className="invoice-sheet" aria-label={`Tax invoice ${inv.number}`}>
        <div className="invoice-watermark paid">PAID</div>
        <header className="inv-head">
          <div className="inv-studio">
            <div>
              <h1>{inv.seller.name}</h1>
              {inv.seller.address && <p>{inv.seller.address}</p>}
              {inv.seller.gstin && (
                <p>
                  <strong>GSTIN:</strong> {inv.seller.gstin}
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
              <dd>{formatDate(inv.date)}</dd>
              <dt>Status</dt>
              <dd>Paid</dd>
            </dl>
          </div>
        </header>

        <section className="inv-parties">
          <div>
            <h3>Bill to</h3>
            <p className="inv-strong">{inv.buyer.name}</p>
            {inv.buyer.address && <p>{inv.buyer.address}</p>}
            {inv.buyer.stateCode && <p>{stateName(inv.buyer.stateCode)}</p>}
            {inv.buyer.email && <p>{inv.buyer.email}</p>}
            {inv.buyer.gstin && (
              <p>
                <strong>GSTIN:</strong> {inv.buyer.gstin}
              </p>
            )}
          </div>
          <div>
            <h3>Supply details</h3>
            <p>
              <strong>Tax type:</strong> {intra ? 'Intra-state (CGST + SGST)' : 'Inter-state (IGST)'}
            </p>
            {inv.paymentRef && (
              <p>
                <strong>Payment ref:</strong> <span className="mono">{inv.paymentRef}</span>
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
              <th className="num">Taxable value</th>
              <th className="num">GST</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td>Wedmanage Studio subscription — {inv.description}</td>
              <td className="mono">{inv.sac}</td>
              <td className="num">{formatMoney(inv.taxablePaise)}</td>
              <td className="num">18%</td>
              <td className="num">{formatMoney(inv.totalPaise)}</td>
            </tr>
          </tbody>
        </table>

        <section className="inv-bottom">
          <div className="inv-words">
            <h3>Amount in words</h3>
            <p>{inv.totalInWords}</p>
          </div>
          <dl className="inv-totals">
            <dt>Taxable value</dt>
            <dd>{formatMoney(inv.taxablePaise)}</dd>
            {intra ? (
              <>
                <dt>CGST @ 9%</dt>
                <dd>{formatMoney(inv.cgstPaise)}</dd>
                <dt>SGST @ 9%</dt>
                <dd>{formatMoney(inv.sgstPaise)}</dd>
              </>
            ) : (
              <>
                <dt>IGST @ 18%</dt>
                <dd>{formatMoney(inv.igstPaise)}</dd>
              </>
            )}
            <dt className="grand">Total</dt>
            <dd className="grand">{formatMoney(inv.totalPaise)}</dd>
          </dl>
        </section>
      </article>
    </div>
  )
}
