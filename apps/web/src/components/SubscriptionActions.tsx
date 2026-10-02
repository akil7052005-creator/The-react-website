import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  adminCancelSchema,
  adminChangePlanSchema,
  extendSubscriptionSchema,
  REMINDER_CHANNELS,
  type AdminAlertSettingsDto,
  type AdminPlanDto,
  type AdminSubscriptionRowDto,
  type ReminderChannel,
} from '@weddyzone/shared'
import { useState } from 'react'
import { toast } from 'sonner'
import { formatIstDate } from '../lib/admin'
import { api } from '../lib/api'
import { toastError } from '../lib/query'
import { applyApiErrors, FieldShell, SubmitButton, TextAreaField, TextField, useGuardedClose, useZodForm } from './form/form'
import { Modal } from './Modal'

export type SubscriptionAction = 'extend' | 'change-plan' | 'cancel' | 'remind'
type Row = Pick<AdminSubscriptionRowDto, 'id' | 'studio' | 'plan' | 'cycle' | 'endDate'>

const CHANNEL_LABELS: Record<ReminderChannel, string> = { IN_APP: 'In-app', EMAIL: 'Email', WHATSAPP: 'WhatsApp' }

function useRefresh() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['admin'] })
}

function ExtendDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const refresh = useRefresh()
  const form = useZodForm(extendSubscriptionSchema, { defaultValues: { days: 7, note: '' } })
  const save = useMutation({
    mutationFn: (body: object) => api.post(`/admin/subscriptions/${row.id}/extend`, body),
    onSuccess: async () => {
      toast.success(`${row.studio.name}: deadline extended`)
      await refresh()
      onClose()
    },
    onError: (e) => applyApiErrors(form, e),
  })
  const close = useGuardedClose(form.formState.isDirty, onClose)
  return (
    <Modal
      open
      onClose={close}
      title="Extend deadline"
      subtitle={`${row.studio.name} · ${row.plan.name} · now ${formatIstDate(row.endDate)}`}
      icon="calendar-plus"
      busy={save.isPending}
      footer={
        <>
          <button className="btn btn-ghost" onClick={close} disabled={save.isPending}>
            Cancel
          </button>
          <SubmitButton busy={save.isPending} form="extend-form" icon="calendar-plus">
            Extend
          </SubmitButton>
        </>
      }
    >
      <form id="extend-form" className="form-grid" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <TextField form={form} name="days" label="Add days" type="number" min={1} max={366} required hint="Counted from the current deadline, or from today if it has passed." />
        <TextAreaField form={form} name="note" label="Note (why)" required maxLength={500} rows={3} hint="Saved in the subscription's timeline and the audit log." />
      </form>
    </Modal>
  )
}

function ChangePlanDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const refresh = useRefresh()
  const plans = useQuery({ queryKey: ['admin', 'plans'], queryFn: () => api.get<AdminPlanDto[]>('/admin/plans') })
  const form = useZodForm(adminChangePlanSchema, { defaultValues: { planId: row.plan.id, billingCycle: row.cycle, note: '' } })
  const save = useMutation({
    mutationFn: (body: object) => api.post(`/admin/subscriptions/${row.id}/change-plan`, body),
    onSuccess: async () => {
      toast.success(`${row.studio.name}: plan changed`)
      await refresh()
      onClose()
    },
    onError: (e) => applyApiErrors(form, e),
  })
  const close = useGuardedClose(form.formState.isDirty, onClose)
  const errors = form.formState.errors
  return (
    <Modal
      open
      onClose={close}
      title="Change plan"
      subtitle={`${row.studio.name} · the deadline (${formatIstDate(row.endDate)}) stays the same and no payment is taken`}
      icon="arrow-left-right"
      busy={save.isPending}
      footer={
        <>
          <button className="btn btn-ghost" onClick={close} disabled={save.isPending}>
            Cancel
          </button>
          <SubmitButton busy={save.isPending} form="plan-form" icon="check2">
            Change plan
          </SubmitButton>
        </>
      }
    >
      <form id="plan-form" className="form-grid" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <FieldShell label="Plan" htmlFor="cp-plan" required error={errors.planId?.message}>
          <select id="cp-plan" {...form.register('planId')} disabled={plans.isPending}>
            {(plans.data ?? [{ id: row.plan.id, name: row.plan.name } as AdminPlanDto]).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </FieldShell>
        <FieldShell label="Billing cycle" htmlFor="cp-cycle" required error={errors.billingCycle?.message}>
          <select id="cp-cycle" {...form.register('billingCycle')}>
            <option value="MONTHLY">Monthly</option>
            <option value="YEARLY">Yearly</option>
          </select>
        </FieldShell>
        <TextAreaField form={form} name="note" label="Note (why)" required maxLength={500} rows={3} />
      </form>
    </Modal>
  )
}

function CancelDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const refresh = useRefresh()
  const form = useZodForm(adminCancelSchema, { defaultValues: { note: '' } })
  const save = useMutation({
    mutationFn: (body: object) => api.post(`/admin/subscriptions/${row.id}/cancel`, body),
    onSuccess: async () => {
      toast.success(`${row.studio.name}: subscription cancelled`)
      await refresh()
      onClose()
    },
    onError: (e) => applyApiErrors(form, e),
  })
  const close = useGuardedClose(form.formState.isDirty, onClose)
  return (
    <Modal
      open
      onClose={close}
      title={`Cancel ${row.studio.name}'s plan?`}
      subtitle="The studio becomes read-only right away. Nothing is deleted and their clients can still view albums."
      icon="x-octagon"
      busy={save.isPending}
      footer={
        <>
          <button className="btn btn-ghost" onClick={close} disabled={save.isPending}>
            Keep plan
          </button>
          <SubmitButton busy={save.isPending} form="cancel-form" icon="x-octagon" className="btn btn-danger">
            Cancel subscription
          </SubmitButton>
        </>
      }
    >
      <form id="cancel-form" className="form-grid" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <TextAreaField form={form} name="note" label="Note (why)" required maxLength={500} rows={3} />
      </form>
    </Modal>
  )
}

interface RemindResult {
  channel: ReminderChannel
  delivered: boolean
  skipped: boolean
  error: string | null
}

function RemindDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const refresh = useRefresh()
  const settings = useQuery({ queryKey: ['admin', 'settings', 'alerts'], queryFn: () => api.get<AdminAlertSettingsDto>('/admin/settings/alerts') })
  // Without a WhatsApp provider the API skips WhatsApp, so it isn't offered (unknown until loaded: offered).
  const whatsappOff = settings.data?.whatsappConfigured === false
  const [picked, setPicked] = useState<ReminderChannel[]>(['IN_APP', 'EMAIL', 'WHATSAPP'])
  const channels = picked.filter((c) => c !== 'WHATSAPP' || !whatsappOff)
  const send = useMutation({
    mutationFn: () => api.post<{ results: RemindResult[] }>(`/admin/subscriptions/${row.id}/remind`, { channels }),
    onSuccess: async (r) => {
      const failed = r.results.filter((x) => !x.delivered && !x.skipped)
      const skipped = r.results.filter((x) => x.skipped)
      if (failed.length) toast.warning(`Sent, but ${failed.map((f) => CHANNEL_LABELS[f.channel]).join(', ')} not delivered`, { description: failed[0].error ?? undefined })
      else toast.success(`Reminder sent to ${row.studio.name}`, skipped.length ? { description: `${skipped.map((s) => CHANNEL_LABELS[s.channel]).join(', ')} skipped – not configured` } : undefined)
      await refresh()
      onClose()
    },
    onError: (e) => toastError(e),
  })
  const toggle = (c: ReminderChannel) => setPicked((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]))
  return (
    <Modal
      open
      onClose={onClose}
      title="Send reminder now"
      subtitle={`${row.studio.name} · ${row.plan.name} · deadline ${formatIstDate(row.endDate)}`}
      icon="alarm"
      size="sm"
      busy={send.isPending}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={send.isPending}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => send.mutate()} disabled={send.isPending || !channels.length}>
            <i className="bi bi-send" /> Send
          </button>
        </>
      }
    >
      <fieldset className="stack" style={{ gap: 10, border: 0, padding: 0, margin: 0 }}>
        <legend className="muted" style={{ marginBottom: 8 }}>
          Channels
        </legend>
        {REMINDER_CHANNELS.map((c) => {
          const off = c === 'WHATSAPP' && whatsappOff
          return (
            <label key={c} className="check-row" style={off ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}>
              <input type="checkbox" checked={channels.includes(c)} disabled={off} onChange={() => toggle(c)} /> {CHANNEL_LABELS[c]}
              {off && <span className="muted"> — not configured</span>}
            </label>
          )
        })}
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {whatsappOff
            ? 'WhatsApp needs the WhatsApp Cloud API (WHATSAPP_CLOUD_TOKEN) before alerts can go out on it.'
            : "WhatsApp is sent from Weddyzone's number and never uses the studio's credits."}
        </p>
      </fieldset>
    </Modal>
  )
}

export function SubscriptionActionDialog({ action, row, onClose }: { action: SubscriptionAction; row: Row; onClose: () => void }) {
  if (action === 'extend') return <ExtendDialog row={row} onClose={onClose} />
  if (action === 'change-plan') return <ChangePlanDialog row={row} onClose={onClose} />
  if (action === 'cancel') return <CancelDialog row={row} onClose={onClose} />
  return <RemindDialog row={row} onClose={onClose} />
}
