import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CYCLE_LABELS, PRICING_CYCLES, type AdminPlanOrderDto, type AdminPlanQuoteDto, type AdminStudioRowDto, type BillingCycle, type PaymentDto, type PlanDto } from '@weddyzone/shared'
import { useState } from 'react'
import { toast } from 'sonner'
import { FieldShell } from '../../components/form/form'
import { Modal } from '../../components/Modal'
import { Spinner } from '../../components/ui'
import { formatIstDate } from '../../lib/admin'
import { api, isApiError } from '../../lib/api'
import { priceFor, TestModeNote, usePlans } from '../../lib/billing'
import { payWithRazorpay } from '../../lib/razorpay'
import { formatMoney } from '../../utils/format'

/** The plans an admin can pay for: those sold for 1 month, 6 months or 1 year (not the free one). */
export function paidPlans(plans: PlanDto[]): PlanDto[] {
  return plans.filter((p) => PRICING_CYCLES.some((c) => priceFor(p, c) !== null))
}

/**
 * What the dialog starts on: a plan other than the studio's current one (so the first choice is a real
 * change), for the studio's billing period when that plan is sold for it, otherwise the first one sold.
 */
export function defaultChoice(plans: PlanDto[], studio: Pick<AdminStudioRowDto, 'planCode' | 'cycle'>): { planId: string; cycle: BillingCycle } | null {
  const choices = paidPlans(plans)
  const plan = choices.find((p) => p.code !== studio.planCode) ?? choices[0]
  if (!plan) return null
  const cycle = studio.cycle && priceFor(plan, studio.cycle) !== null ? studio.cycle : PRICING_CYCLES.find((c) => priceFor(plan, c) !== null)!
  return { planId: plan.id, cycle }
}

/**
 * Admin → Studios → Change plan: the admin pays for the studio's plan in Razorpay Checkout. The price
 * shown is the server's quote (GST included, credit for the studio's unused days taken off), the same
 * sum the order is opened for. The plan changes only once the server has confirmed the payment.
 */
export function ChangeStudioPlanModal({ studio, onClose }: { studio: AdminStudioRowDto; onClose: () => void }) {
  const qc = useQueryClient()
  const plans = usePlans()
  const choices = paidPlans(plans.data ?? [])
  const [picked, setPicked] = useState<{ planId: string; cycle: BillingCycle } | null>(null)
  const choice = picked ?? (plans.data ? defaultChoice(plans.data, studio) : null)
  const plan = choices.find((p) => p.id === choice?.planId) ?? null
  const cycle = choice?.cycle ?? 'MONTHLY'
  const sold = !!plan && priceFor(plan, cycle) !== null

  const [busy, setBusy] = useState(false)
  // Razorpay's window can't be used while a dialog is open: the dialog hides while the admin pays.
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const quote = useQuery({
    queryKey: ['admin', 'studios', 'plan-quote', studio.id, plan?.id, cycle],
    queryFn: () => api.get<AdminPlanQuoteDto>(`/admin/studios/${studio.id}/plan-quote`, { planId: plan!.id, cycle }),
    enabled: sold,
    retry: false,
  })
  const q = quote.data

  const choose = (next: { planId?: string; cycle?: BillingCycle }) => {
    if (!choice) return
    const planId = next.planId ?? choice.planId
    const nextPlan = choices.find((p) => p.id === planId)
    let nextCycle = next.cycle ?? choice.cycle
    // A plan not sold for the chosen period: keep the choice valid.
    if (nextPlan && priceFor(nextPlan, nextCycle) === null) nextCycle = PRICING_CYCLES.find((c) => priceFor(nextPlan, c) !== null) ?? nextCycle
    setPicked({ planId, cycle: nextCycle })
    setError(null)
  }

  const done = (payment: PaymentDto) => {
    toast.success(`${studio.name} is now on ${plan?.name ?? 'the new plan'} (${CYCLE_LABELS[cycle]})`, {
      description: `Paid ${formatMoney(payment.amountPaise)} (incl. ${formatMoney(payment.gstPaise)} GST) on behalf of the studio`,
    })
    void qc.invalidateQueries({ queryKey: ['admin'] })
    onClose()
  }

  const pay = async () => {
    if (!plan || !q) return
    setError(null)
    setBusy(true)
    let order: AdminPlanOrderDto
    try {
      order = await api.post<AdminPlanOrderDto>(`/admin/studios/${studio.id}/plan-order`, { planId: plan.id, cycle })
    } catch (e) {
      setError(isApiError(e) ? e.message : "Couldn't open the payment. Please try again.")
      setBusy(false)
      return
    }
    // Simulated payments (no Razorpay keys) are confirmed at once.
    if (!order.checkout) {
      setBusy(false)
      if (order.payment.status === 'SUCCESS') done(order.payment)
      else setError('The payment was not completed. The plan was not changed.')
      return
    }
    setPaying(true)
    try {
      const outcome = await payWithRazorpay(
        order.checkout,
        (reason) => toast.error('Payment failed', { description: `${reason}. You can try again in the payment window.` }),
        (response) => api.post<{ payment: PaymentDto }>(`/admin/studios/${studio.id}/plan-verify`, { ...response, paymentId: order.payment.id }),
      )
      if (outcome.status === 'paid') {
        done(outcome.payment)
        return
      }
      toast.error('Payment not completed', { description: 'The plan was not changed.' })
      setError('The payment was not completed, so the plan was not changed. You can try again.')
    } catch (e) {
      setError(isApiError(e) ? e.message : "The payment couldn't be confirmed. The plan was not changed.")
    } finally {
      setPaying(false)
      setBusy(false)
    }
  }

  const less = q?.creditPaise ? `${formatMoney(q.pricePaise)} less ${formatMoney(q.creditPaise)} credit for the unused days of the current plan.` : null
  return (
    <Modal
      open={!paying}
      onClose={onClose}
      title="Change plan"
      subtitle={studio.name}
      icon="arrow-left-right"
      busy={busy}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void pay()} disabled={busy || !q || quote.isFetching} data-testid="pay-change-plan">
            {busy ? <Spinner size={14} /> : <i className="bi bi-credit-card" />} Pay &amp; change plan
          </button>
        </>
      }
    >
      <dl className="acp-current" aria-label="Current plan">
        <div>
          <dt>Current plan</dt>
          <dd>
            {studio.plan ?? '—'}
            {studio.period ? ` · ${studio.period}` : ''}
          </dd>
        </div>
        <div>
          <dt>Start date</dt>
          <dd>{studio.startDate ? formatIstDate(studio.startDate) : '—'}</dd>
        </div>
        <div>
          <dt>Expiry date</dt>
          <dd>{studio.expiryDate ? formatIstDate(studio.expiryDate) : '—'}</dd>
        </div>
      </dl>

      {plans.isPending ? (
        <p className="muted">
          <Spinner size={14} /> Loading plans…
        </p>
      ) : plans.isError ? (
        <p className="notice danger" role="alert">
          {isApiError(plans.error) ? plans.error.message : "Couldn't load the plans."}
        </p>
      ) : (
        <div className="form-grid">
          <FieldShell label="Plan" htmlFor="acp-plan" required>
            <select id="acp-plan" value={choice?.planId ?? ''} onChange={(e) => choose({ planId: e.target.value })} disabled={busy}>
              {choices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </FieldShell>
          <FieldShell label="Duration" htmlFor="acp-cycle" required>
            <select id="acp-cycle" value={cycle} onChange={(e) => choose({ cycle: e.target.value as BillingCycle })} disabled={busy}>
              {PRICING_CYCLES.map((c) => {
                const price = plan ? priceFor(plan, c) : null
                return (
                  <option key={c} value={c} disabled={price === null}>
                    {CYCLE_LABELS[c]}
                    {price === null ? ' (not sold)' : ` · ${formatMoney(price)}`}
                  </option>
                )
              })}
            </select>
          </FieldShell>
        </div>
      )}

      <div className="acp-summary" aria-live="polite" data-testid="admin-plan-price">
        {!sold ? (
          <p className="acp-detail">Choose a plan and how long.</p>
        ) : quote.isPending || (quote.isFetching && !q) ? (
          <p className="acp-detail">
            <Spinner size={14} /> Working out the price…
          </p>
        ) : quote.isError ? (
          <p className="acp-error" role="alert">
            {isApiError(quote.error) ? quote.error.message : "Couldn't work out the price."}
          </p>
        ) : q ? (
          <>
            <p className="acp-total">
              Admin pays <strong>{formatMoney(q.payablePaise)}</strong> (incl. {formatMoney(q.gstPaise)} GST)
            </p>
            <p className="acp-detail">
              {q.planName} for {CYCLE_LABELS[q.cycle]}. {less}
              {less ? ' ' : ''}Taxable value {formatMoney(q.basePaise)} + GST {formatMoney(q.gstPaise)}.
            </p>
          </>
        ) : null}
      </div>

      <p className="acp-note">
        <i className="bi bi-info-circle" /> This payment is made by the admin on behalf of the studio.
      </p>
      <TestModeNote mode={q?.paymentMode} />
      {error && (
        <p className="notice danger" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}
