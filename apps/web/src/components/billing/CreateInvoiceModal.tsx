import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  computeInvoiceTotals,
  DEFAULT_SAC,
  GST_RATES,
  INDIAN_STATES,
  makeInvoiceSchema,
  stateName,
  toPaise,
  todayIST,
  type ClientDto,
  type InvoiceDto,
} from '@weddyzone/shared'
import { useMemo } from 'react'
import { useFieldArray, useWatch } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useMe } from '../../auth/AuthProvider'
import { api } from '../../lib/api'
import { formatMoney } from '../../utils/format'
import { ClientSelectField } from '../ClientSelect'
import { EventSelectField } from '../EventSelect'
import { applyApiErrors, SelectField, SubmitButton, TextAreaField, TextField, useGuardedClose, useZodForm } from '../form/form'
import { Modal } from '../Modal'

const stateOptions = INDIAN_STATES.map((s) => ({ value: s.code, label: s.name, sub: `GST code ${s.code}` }))
const gstOptions = GST_RATES.map((r) => ({ value: r, label: `${r}%` }))

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const emptyItem = { description: '', sac: DEFAULT_SAC, qty: 1, rate: '' as unknown as number, gstRate: 18 }

export function CreateInvoiceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { studio } = useMe()
  const qc = useQueryClient()
  const schema = useMemo(() => makeInvoiceSchema(studio.stateCode), [studio.stateCode])
  const today = todayIST()
  const form = useZodForm(schema, {
    defaultValues: {
      clientId: '',
      eventId: '',
      issueDate: today,
      dueDate: addDays(today, 15),
      placeOfSupply: studio.stateCode ?? '',
      items: [emptyItem],
      milestones: [],
      notes: '',
    },
  })
  const items = useFieldArray({ control: form.control, name: 'items' })
  const milestones = useFieldArray({ control: form.control, name: 'milestones' })
  const watched = useWatch({ control: form.control, name: ['items', 'placeOfSupply', 'milestones'] })
  const [wItems, pos, wMilestones] = watched as [
    { qty: unknown; rate: unknown; gstRate: unknown }[],
    string,
    { amount: unknown }[],
  ]

  // Live totals with the exact maths the API uses to store the invoice.
  const totals = useMemo(() => {
    const lines = (wItems ?? []).map((i) => ({
      qty: Number(i.qty) > 0 ? Math.floor(Number(i.qty)) : 0,
      ratePaise: Number(i.rate) > 0 ? toPaise(Number(i.rate)) : 0,
      gstRate: Number(i.gstRate) || 0,
    }))
    return computeInvoiceTotals(lines, studio.stateCode, pos || studio.stateCode || '')
  }, [wItems, pos, studio.stateCode])
  const milestoneSum = (wMilestones ?? []).reduce((s, m) => s + (Number(m.amount) > 0 ? toPaise(Number(m.amount)) : 0), 0)

  const create = useMutation({
    mutationFn: (body: object) => api.post<InvoiceDto>('/invoices', body),
    onSuccess: (inv) => {
      toast.success(`Invoice ${inv.number} created`)
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['invoices-summary'] })
      form.reset()
      onClose()
    },
    onError: (e) => applyApiErrors(form, e),
  })
  const close = useGuardedClose(form.formState.isDirty, () => {
    form.reset()
    onClose()
  })

  const splitMilestones = () => {
    if (totals.totalPaise <= 0) return toast.info('Add line items first — milestones split the invoice total')
    const total = totals.totalPaise
    const a = Math.round(total * 0.3)
    const b = Math.round(total * 0.3)
    const c = total - a - b
    const issue = form.getValues('issueDate')
    const due = form.getValues('dueDate')
    milestones.replace([
      { label: 'Booking advance', amount: a / 100, dueDate: issue },
      { label: 'Pre-shoot', amount: b / 100, dueDate: due },
      { label: 'Final delivery', amount: c / 100, dueDate: due },
    ])
  }

  const itemsError = form.formState.errors.items?.message as string | undefined
  const milestonesError = (form.formState.errors.milestones?.message ?? form.formState.errors.milestones?.root?.message) as string | undefined
  const missingState = !studio.stateCode

  return (
    <Modal
      open={open}
      onClose={close}
      title="Create GST Invoice"
      subtitle={`${studio.name}${studio.gstin ? ` · GSTIN ${studio.gstin}` : ''} · ${stateName(studio.stateCode) || 'State not set'}`}
      icon="receipt"
      size="xl"
      busy={create.isPending}
      footer={
        <>
          <span className="invoice-foot-total">
            Total <strong>{formatMoney(totals.totalPaise)}</strong>
          </span>
          <button className="btn btn-ghost" onClick={close} disabled={create.isPending}>
            Cancel
          </button>
          <SubmitButton busy={create.isPending} form="invoice-form" icon="check2" disabled={missingState}>
            Create invoice
          </SubmitButton>
        </>
      }
    >
      {missingState && (
        <p className="notice danger" style={{ marginBottom: 16 }}>
          <i className="bi bi-exclamation-triangle" />
          <span>
            Add your studio's state in <Link to="/profile" className="link">My Profile</Link> first — it decides whether the invoice uses CGST + SGST or IGST.
          </span>
        </p>
      )}
      <form id="invoice-form" onSubmit={form.handleSubmit((v) => create.mutate(v))} noValidate data-testid="invoice-form">
        <div className="form-grid">
          <ClientSelectField form={form} name="clientId" />
          <EventSelectField form={form} name="eventId" label="Event (optional)" required={false} hint="Links the invoice to a wedding event" />
          <TextField form={form} name="issueDate" label="Issue date" type="date" required />
          <TextField form={form} name="dueDate" label="Due date" type="date" required min={form.watch('issueDate')} />
          <SelectField
            form={form}
            name="placeOfSupply"
            label="Place of supply"
            required
            options={stateOptions}
            hint={
              pos
                ? totals.supplyType === 'INTRA'
                  ? 'Same state as your studio → CGST + SGST'
                  : 'Different state from your studio → IGST'
                : 'Where the service is provided'
            }
          />
        </div>

        <div className="invoice-items">
          <div className="row-between" style={{ alignItems: 'center' }}>
            <strong>Line items</strong>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => items.append(emptyItem)} disabled={items.fields.length >= 50}>
              <i className="bi bi-plus-lg" /> Add row
            </button>
          </div>
          {itemsError && (
            <p className="field-error" role="alert">
              <i className="bi bi-exclamation-circle" /> {itemsError}
            </p>
          )}
          {items.fields.map((f, i) => (
            <div className="invoice-item-row" key={f.id}>
              <TextField form={form} name={`items.${i}.description`} label={`Item ${i + 1}`} required maxLength={200} placeholder="Wedding day coverage" />
              <TextField form={form} name={`items.${i}.sac`} label="SAC" required inputMode="numeric" />
              <TextField form={form} name={`items.${i}.qty`} label="Qty" type="number" min={1} required />
              <TextField form={form} name={`items.${i}.rate`} label="Rate (₹)" type="number" min={0} step="0.01" required placeholder="100000" />
              <SelectField form={form} name={`items.${i}.gstRate`} label="GST" required options={gstOptions} />
              <div className="invoice-line-total">
                <span className="muted">Amount</span>
                <strong>{formatMoney(totals.lines[i]?.totalPaise ?? 0)}</strong>
              </div>
              <button type="button" className="icon-btn" onClick={() => items.remove(i)} disabled={items.fields.length === 1} aria-label={`Remove item ${i + 1}`}>
                <i className="bi bi-trash" />
              </button>
            </div>
          ))}
        </div>

        <div className="invoice-summary">
          <div className="invoice-milestones">
            <div className="row-between" style={{ alignItems: 'center' }}>
              <div>
                <strong>Payment milestones</strong>
                <p className="muted">Optional — must add up to the invoice total.</p>
              </div>
              <div className="share-actions">
                <button type="button" className="btn btn-sm btn-ghost" onClick={splitMilestones}>
                  Split 30/30/40
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => milestones.append({ label: '', amount: '' as unknown as number, dueDate: form.getValues('dueDate') })}
                  disabled={milestones.fields.length >= 10}
                >
                  <i className="bi bi-plus-lg" /> Add
                </button>
              </div>
            </div>
            {milestones.fields.map((f, i) => (
              <div className="milestone-row" key={f.id}>
                <TextField form={form} name={`milestones.${i}.label`} label="Milestone" required maxLength={80} />
                <TextField form={form} name={`milestones.${i}.amount`} label="Amount (₹)" type="number" step="0.01" required />
                <TextField form={form} name={`milestones.${i}.dueDate`} label="Due" type="date" required />
                <button type="button" className="icon-btn" onClick={() => milestones.remove(i)} aria-label={`Remove milestone ${i + 1}`}>
                  <i className="bi bi-trash" />
                </button>
              </div>
            ))}
            {milestones.fields.length > 0 && (
              <p className={`milestone-check ${milestoneSum === totals.totalPaise ? 'ok' : 'off'}`}>
                <i className={`bi bi-${milestoneSum === totals.totalPaise ? 'check-circle-fill' : 'exclamation-circle'}`} /> Milestones {formatMoney(milestoneSum)} of{' '}
                {formatMoney(totals.totalPaise)}
              </p>
            )}
            {milestonesError && (
              <p className="field-error" role="alert">
                <i className="bi bi-exclamation-circle" /> {milestonesError}
              </p>
            )}
            <TextAreaField form={form} name="notes" label="Notes on invoice" maxLength={1000} rows={2} placeholder="Bank / UPI details, terms…" />
          </div>

          <dl className="invoice-totals" aria-live="polite">
            <div>
              <dt>Taxable value</dt>
              <dd>{formatMoney(totals.subtotalPaise)}</dd>
            </div>
            {totals.supplyType === 'INTRA' ? (
              <>
                <div>
                  <dt>CGST</dt>
                  <dd data-testid="cgst">{formatMoney(totals.cgstPaise)}</dd>
                </div>
                <div>
                  <dt>SGST</dt>
                  <dd data-testid="sgst">{formatMoney(totals.sgstPaise)}</dd>
                </div>
              </>
            ) : (
              <div>
                <dt>IGST</dt>
                <dd data-testid="igst">{formatMoney(totals.igstPaise)}</dd>
              </div>
            )}
            <div className="grand">
              <dt>Total (incl. GST)</dt>
              <dd data-testid="grand-total">{formatMoney(totals.totalPaise)}</dd>
            </div>
          </dl>
        </div>
      </form>
    </Modal>
  )
}

export type { ClientDto }
