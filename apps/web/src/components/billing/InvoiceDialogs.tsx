import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  INVOICE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  recordPaymentSchema,
  stateName,
  todayIST,
  type InvoiceDetailDto,
  type InvoiceDto,
  type SendResultDto,
} from '@weddyzone/shared'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import { toastError } from '../../lib/query'
import { sendViaWhatsApp } from '../../lib/whatsapp'
import { formatDate, formatMoney } from '../../utils/format'
import { applyApiErrors, SelectField, SubmitButton, TextField, useGuardedClose, useZodForm } from '../form/form'
import { Modal, useConfirm } from '../Modal'
import { CardSkeleton, ErrorState, StatusPill } from '../ui'

const methodOptions = PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))

export function refreshInvoices(qc: ReturnType<typeof useQueryClient>, id?: string) {
  qc.invalidateQueries({ queryKey: ['invoices'] })
  qc.invalidateQueries({ queryKey: ['invoices-summary'] })
  if (id) qc.invalidateQueries({ queryKey: ['invoice', id] })
  qc.invalidateQueries({ queryKey: ['dashboard'] })
}

export function RecordPaymentModal({ invoice, onClose }: { invoice: InvoiceDto | null; onClose: () => void }) {
  const qc = useQueryClient()
  const form = useZodForm(recordPaymentSchema, {
    values: invoice ? { amount: invoice.balancePaise / 100, method: 'UPI', paidOn: todayIST(), reference: '' } : undefined,
  })
  const pay = useMutation({
    mutationFn: (body: object) => api.post<InvoiceDto>(`/invoices/${invoice!.id}/payments`, body),
    onSuccess: (inv) => {
      toast.success(inv.status === 'PAID' ? `Invoice ${inv.number} is fully paid` : `Payment recorded on ${inv.number} · ${formatMoney(inv.balancePaise)} still due`)
      refreshInvoices(qc, inv.id)
      onClose()
    },
    onError: (e) => applyApiErrors(form, e),
  })
  const close = useGuardedClose(form.formState.isDirty, onClose)
  if (!invoice) return null
  return (
    <Modal
      open
      onClose={close}
      title={`Record payment · ${invoice.number}`}
      subtitle={`${invoice.client.name} · balance due ${formatMoney(invoice.balancePaise)}`}
      icon="cash-coin"
      size="sm"
      busy={pay.isPending}
      footer={
        <>
          <button className="btn btn-ghost" onClick={close} disabled={pay.isPending}>
            Cancel
          </button>
          <SubmitButton busy={pay.isPending} form="payment-form" icon="check2">
            Record payment
          </SubmitButton>
        </>
      }
    >
      <form id="payment-form" onSubmit={form.handleSubmit((v) => pay.mutate(v))} noValidate>
        <div className="stack" style={{ gap: 14 }}>
          <TextField form={form} name="amount" label="Amount received (₹)" type="number" step="0.01" min={0} required />
          <SelectField form={form} name="method" label="Method" required options={methodOptions} />
          <TextField form={form} name="paidOn" label="Paid on" type="date" required max={todayIST()} />
          <TextField form={form} name="reference" label="Reference (optional)" maxLength={80} placeholder="UPI ref / cheque no." />
        </div>
      </form>
    </Modal>
  )
}

/** Confirm-driven invoice actions shared by the table and the detail dialog. */
export function useInvoiceActions(onPay: (inv: InvoiceDto) => void) {
  const qc = useQueryClient()
  const confirm = useConfirm()

  const print = (inv: InvoiceDto) => window.open(`/invoices/${inv.id}/print`, '_blank', 'noopener')

  const whatsapp = (inv: InvoiceDto) =>
    confirm({
      title: `Send ${inv.number} on WhatsApp?`,
      icon: 'whatsapp',
      message: (
        <>
          We'll open WhatsApp with the invoice amount ({formatMoney(inv.totalPaise)}) and due date for <strong>{inv.client.name}</strong>. This uses{' '}
          <strong>1 credit</strong>.
        </>
      ),
      confirmLabel: 'Send on WhatsApp',
      onConfirm: () =>
        sendViaWhatsApp(() => api.post<SendResultDto>(`/invoices/${inv.id}/send`), qc, `Invoice ${inv.number} sent to ${inv.client.name}`).catch((e) => {
          toastError(e)
          throw e
        }),
    })

  const markPaid = (inv: InvoiceDto) =>
    confirm({
      title: `Mark ${inv.number} as paid?`,
      icon: 'check2-circle',
      message: (
        <>
          Records a UPI payment of <strong>{formatMoney(inv.balancePaise)}</strong> from {inv.client.name} dated today. Use <em>Record payment</em> instead for a different
          amount, method or date.
        </>
      ),
      confirmLabel: 'Mark paid',
      onConfirm: async () => {
        try {
          await api.post(`/invoices/${inv.id}/mark-paid`, { method: 'UPI' })
          toast.success(`Invoice ${inv.number} marked as paid`)
          refreshInvoices(qc, inv.id)
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    })

  const cancel = (inv: InvoiceDto) =>
    confirm({
      title: `Cancel ${inv.number}?`,
      tone: 'danger',
      message: (
        <>
          The invoice for <strong>{inv.client.name}</strong> ({formatMoney(inv.totalPaise)}) will be marked cancelled. Its number stays reserved so your GST series has no gaps.
        </>
      ),
      confirmLabel: 'Cancel invoice',
      cancelLabel: 'Keep invoice',
      onConfirm: async () => {
        try {
          await api.post(`/invoices/${inv.id}/cancel`)
          toast.success(`Invoice ${inv.number} cancelled`)
          refreshInvoices(qc, inv.id)
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    })

  return { print, whatsapp, markPaid, cancel, pay: onPay }
}

export function InvoiceDetailModal({ id, onClose, onPay }: { id: string | null; onClose: () => void; onPay: (inv: InvoiceDto) => void }) {
  const q = useQuery({ queryKey: ['invoice', id], queryFn: () => api.get<InvoiceDetailDto>(`/invoices/${id}`), enabled: Boolean(id) })
  const actions = useInvoiceActions(onPay)
  if (!id) return null
  const inv = q.data
  const open = inv && (inv.status === 'PENDING' || inv.status === 'OVERDUE')

  return (
    <Modal
      open
      onClose={onClose}
      title={inv ? `Invoice ${inv.number}` : 'Invoice'}
      subtitle={inv ? `${inv.client.name}${inv.event ? ` · ${inv.event.title}` : ''}` : undefined}
      icon="receipt"
      size="lg"
      footer={
        inv && (
          <>
            {inv.status !== 'CANCELLED' && inv.status !== 'PAID' && inv.amountPaidPaise === 0 && (
              <button className="btn btn-ghost" style={{ marginRight: 'auto', color: 'var(--danger)' }} onClick={() => actions.cancel(inv)}>
                Cancel invoice
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => actions.print(inv)}>
              <i className="bi bi-printer" /> Print / PDF
            </button>
            {inv.status !== 'CANCELLED' && (
              <button className="btn btn-ghost" onClick={() => actions.whatsapp(inv)}>
                <i className="bi bi-whatsapp" /> WhatsApp
              </button>
            )}
            {open && (
              <>
                <button className="btn btn-ghost" onClick={() => actions.markPaid(inv)}>
                  <i className="bi bi-check2-circle" /> Mark paid
                </button>
                <button className="btn btn-primary" onClick={() => onPay(inv)}>
                  <i className="bi bi-cash-coin" /> Record payment
                </button>
              </>
            )}
          </>
        )
      }
    >
      {q.isPending ? (
        <CardSkeleton rows={6} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        inv && (
          <div className="stack" style={{ gap: 18 }}>
            <div className="invoice-meta-grid">
              <div>
                <span className="muted">Status</span>
                <StatusPill status={INVOICE_STATUS_LABELS[inv.status]} />
              </div>
              <div>
                <span className="muted">Issued</span>
                <strong>{formatDate(inv.issueDate)}</strong>
              </div>
              <div>
                <span className="muted">Due</span>
                <strong>{formatDate(inv.dueDate)}</strong>
              </div>
              <div>
                <span className="muted">Place of supply</span>
                <strong>{stateName(inv.placeOfSupply)}</strong>
              </div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>SAC</th>
                    <th className="num">Qty</th>
                    <th className="num">Rate</th>
                    <th className="num">GST</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.items.map((it) => (
                    <tr key={it.id}>
                      <td className="cell-main">{it.description}</td>
                      <td className="mono">{it.sac}</td>
                      <td className="num">{it.qty}</td>
                      <td className="num">{formatMoney(it.ratePaise)}</td>
                      <td className="num">{it.gstRate}%</td>
                      <td className="num cell-main">{formatMoney(it.totalPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="invoice-totals">
              <div>
                <dt>Taxable value</dt>
                <dd>{formatMoney(inv.subtotalPaise)}</dd>
              </div>
              {inv.supplyType === 'INTRA' ? (
                <>
                  <div>
                    <dt>CGST</dt>
                    <dd>{formatMoney(inv.cgstPaise)}</dd>
                  </div>
                  <div>
                    <dt>SGST</dt>
                    <dd>{formatMoney(inv.sgstPaise)}</dd>
                  </div>
                </>
              ) : (
                <div>
                  <dt>IGST</dt>
                  <dd>{formatMoney(inv.igstPaise)}</dd>
                </div>
              )}
              <div className="grand">
                <dt>Total</dt>
                <dd>{formatMoney(inv.totalPaise)}</dd>
              </div>
              <div>
                <dt>Paid</dt>
                <dd>{formatMoney(inv.amountPaidPaise)}</dd>
              </div>
              <div className="grand">
                <dt>Balance due</dt>
                <dd>{formatMoney(inv.balancePaise)}</dd>
              </div>
            </dl>
            {inv.milestones.length > 0 && (
              <div>
                <strong>Milestones</strong>
                <ul className="milestone-list">
                  {inv.milestones.map((m) => (
                    <li key={m.id}>
                      <span>{m.label}</span>
                      <span className="muted">due {formatDate(m.dueDate)}</span>
                      <strong>{formatMoney(m.amountPaise)}</strong>
                      <StatusPill status={m.paidAt ? 'Paid' : 'Pending'} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {inv.payments.length > 0 && (
              <div>
                <strong>Payments received</strong>
                <ul className="milestone-list">
                  {inv.payments.map((p) => (
                    <li key={p.id}>
                      <span>{formatDate(p.paidOn)}</span>
                      <span className="muted">
                        {PAYMENT_METHOD_LABELS[p.method]}
                        {p.reference ? ` · ${p.reference}` : ''}
                      </span>
                      <strong>{formatMoney(p.amountPaise)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )
      )}
    </Modal>
  )
}
