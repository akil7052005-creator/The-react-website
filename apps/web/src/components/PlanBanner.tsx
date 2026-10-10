import { useMutation } from '@tanstack/react-query'
import { CANCEL_REASON_LABELS, CANCEL_REASONS, cancelSubscriptionSchema, type MySubscriptionBannerDto, type SubscriptionDto } from '@weddyzone/shared'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { usePlanActions, usePlanBanner } from '../lib/billing'
import { api } from '../lib/api'
import { applyApiErrors, FieldShell, SubmitButton, TextAreaField, useZodForm } from './form/form'
import { Modal } from './Modal'

const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
const daysText = (d: number) => (d <= 0 ? 'ends today' : d === 1 ? '1 day left' : `${d} days left`)

/** States that need the studio's attention on every page, not just the dashboard. */
const URGENT = new Set<MySubscriptionBannerDto['status']>(['GRACE', 'EXPIRED', 'CANCELLED', 'PAYMENT_FAILED'])

/**
 * "<Plan> · X days left · Renew". `always` shows it whatever the state (dashboard, My Subscription);
 * otherwise it only appears in grace, after expiry or when a payment failed.
 */
export function PlanBanner({ always = false }: { always?: boolean }) {
  const q = usePlanBanner()
  const b = q.data
  if (!b || (!always && !URGENT.has(b.status))) return null

  let tone: 'green' | 'amber' | 'red' | 'grey'
  let icon: string
  let text: React.ReactNode
  let cta = { to: b.renewLink, label: 'Renew' }

  switch (b.status) {
    case 'TRIAL':
      tone = b.daysLeft <= 7 ? 'amber' : 'green'
      icon = 'hourglass-split'
      text = (
        <>
          <strong>{/trial/i.test(b.planName) ? 'Free trial' : `${b.planName} trial`}</strong> · {daysText(b.daysLeft)}
        </>
      )
      cta = { to: '/subscriptions', label: 'Choose a plan' }
      break
    case 'GRACE':
      tone = 'red'
      icon = 'exclamation-triangle-fill'
      text = (
        <>
          <strong>Your {b.planName} plan expired on {longDate(b.endDate)}.</strong> You still have full access{b.graceEndsAt ? ` until ${longDate(b.graceEndsAt)}` : ''}; renew before then or your studio becomes read-only.
        </>
      )
      break
    case 'EXPIRED':
    case 'CANCELLED':
      tone = 'grey'
      icon = 'lock-fill'
      text = (
        <>
          <strong>Read-only:</strong> your {b.planName} plan has ended, so you can't add events or upload photos. Nothing is deleted, and your clients can still view their albums and selections.
        </>
      )
      cta = { to: b.status === 'CANCELLED' ? '/subscriptions' : b.renewLink, label: b.status === 'CANCELLED' ? 'Choose a plan' : 'Renew now' }
      break
    case 'PAYMENT_FAILED':
      tone = 'red'
      icon = 'exclamation-octagon-fill'
      text = (
        <>
          <strong>Your last payment didn't go through.</strong> {b.planName} · {daysText(b.daysLeft)}
        </>
      )
      cta = { to: b.renewLink, label: 'Retry payment' }
      break
    default:
      tone = b.status === 'EXPIRING_SOON' ? (b.daysLeft <= 1 ? 'red' : 'amber') : 'green'
      icon = b.status === 'EXPIRING_SOON' ? 'alarm' : 'patch-check'
      text = b.autoRenew ? (
        <>
          <strong>{b.planName}</strong> · renews automatically on {longDate(b.endDate)}
        </>
      ) : (
        <>
          <strong>{b.planName}</strong> · {daysText(b.daysLeft)} · expires {longDate(b.endDate)}
        </>
      )
  }

  return (
    <div className={`plan-banner tone-${tone}`} role={URGENT.has(b.status) ? 'alert' : 'status'}>
      <i className={`bi bi-${icon}`} aria-hidden="true" />
      <span className="grow">{text}</span>
      {!(b.autoRenew && b.status === 'ACTIVE') && (
        <Link to={cta.to} className={`btn btn-sm ${tone === 'green' ? 'btn-ghost' : 'btn-primary'}`}>
          {cta.label}
        </Link>
      )}
    </div>
  )
}

/** Cancel at period end, with the reason (shown to Wedmanage admins). */
export function CancelPlanDialog({ sub, onClose }: { sub: SubscriptionDto; onClose: () => void }) {
  const { refresh } = usePlanActions()
  const form = useZodForm(cancelSubscriptionSchema, { defaultValues: { reason: undefined, details: '' } })
  const save = useMutation({
    mutationFn: (body: object) => api.post('/subscription/cancel', body),
    onSuccess: () => {
      toast.success(`${sub.plan.name} will end on ${longDate(sub.currentPeriodEnd)}`)
      refresh()
      onClose()
    },
    onError: (e) => applyApiErrors(form, e),
  })
  return (
    <Modal
      open
      onClose={onClose}
      title={`Cancel your ${sub.plan.name} plan?`}
      subtitle={`You keep ${sub.plan.name} until ${longDate(sub.currentPeriodEnd)}. After that your studio becomes read-only — nothing is deleted.`}
      icon="exclamation-triangle"
      busy={save.isPending}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={save.isPending}>
            Keep my plan
          </button>
          <SubmitButton busy={save.isPending} form="cancel-plan-form" className="btn btn-danger">
            Cancel plan
          </SubmitButton>
        </>
      }
    >
      <form id="cancel-plan-form" className="form-grid" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <FieldShell label="Why are you cancelling?" htmlFor="cancel-reason" required error={form.formState.errors.reason?.message} full>
          <select id="cancel-reason" defaultValue="" {...form.register('reason')}>
            <option value="" disabled>
              Choose a reason
            </option>
            {CANCEL_REASONS.map((r) => (
              <option key={r} value={r}>
                {CANCEL_REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </FieldShell>
        <TextAreaField form={form} name="details" label="Anything we could do better? (optional)" maxLength={500} rows={3} />
      </form>
    </Modal>
  )
}
