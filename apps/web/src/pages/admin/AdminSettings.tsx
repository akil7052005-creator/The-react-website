import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  alertSettingsSchema,
  totpCodeSchema,
  type AdminAlertSettingsDto,
  type TwoFactorSetupDto,
  type TwoFactorStatusDto,
} from '@weddyzone/shared'
import { useState } from 'react'
import { toast } from 'sonner'
import { FieldShell } from '../../components/form/form'
import { Card, CardSkeleton, ErrorState, PageHeader, Spinner } from '../../components/ui'
import { formatIstDateTime } from '../../lib/admin'
import { api, isApiError } from '../../lib/api'
import { toastError } from '../../lib/query'

const SETTINGS_KEY = ['admin', 'settings', 'alerts'] as const

interface Draft {
  reminderDays: number[]
  graceDays: string
  digestTime: string
  winbackOn: boolean
  winbackAfterDays: string
  winbackPercentOff: string
}

const toDraft = (s: AdminAlertSettingsDto): Draft => ({
  reminderDays: s.reminderDays,
  graceDays: String(s.graceDays),
  digestTime: s.digestTime,
  winbackOn: s.winbackAfterDays !== null,
  winbackAfterDays: String(s.winbackAfterDays ?? 7),
  winbackPercentOff: String(s.winbackPercentOff),
})

function AlertSettingsCard({ settings }: { settings: AdminAlertSettingsDto }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings))
  const [newDay, setNewDay] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const body = {
    reminderDays: draft.reminderDays,
    graceDays: draft.graceDays,
    digestTime: draft.digestTime,
    winbackAfterDays: draft.winbackOn ? draft.winbackAfterDays : null,
    winbackPercentOff: draft.winbackPercentOff,
  }
  const dirty = JSON.stringify(toDraft(settings)) !== JSON.stringify(draft)

  const save = useMutation({
    mutationFn: (b: object) => api.put<AdminAlertSettingsDto>('/admin/settings/alerts', b),
    onSuccess: (s) => {
      qc.setQueryData(SETTINGS_KEY, s)
      setErrors({})
      toast.success('Alert settings saved')
    },
    onError: (e) => {
      if (isApiError(e) && e.fields) setErrors(e.fields)
      toastError(e)
    },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = alertSettingsSchema.safeParse(body)
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])))
      return
    }
    save.mutate(parsed.data)
  }

  const addDay = () => {
    const n = Number(newDay)
    if (!Number.isInteger(n) || n < 1 || n > 60) {
      setErrors((x) => ({ ...x, reminderDays: 'Enter a whole number of days from 1 to 60' }))
      return
    }
    setDraft((d) => ({ ...d, reminderDays: [...new Set([...d.reminderDays, n])].sort((a, b) => b - a) }))
    setNewDay('')
    setErrors((x) => ({ ...x, reminderDays: '' }))
  }

  return (
    <Card title="Deadline alerts" subtitle={settings.updatedAt ? `Last changed ${formatIstDateTime(settings.updatedAt)} IST` : 'Using the defaults'}>
      <form className="form-grid" onSubmit={submit} noValidate>
        <FieldShell
          label="Remind studios this many days before the deadline"
          htmlFor="s-day"
          error={errors.reminderDays}
          full
          hint="The first reminder goes by in-app, email and WhatsApp; the last one also alerts admins; the ones in between go in-app and on WhatsApp."
        >
          <div className="chip-input">
            {draft.reminderDays.map((d) => (
              <span className="chip" key={d}>
                T-{d}
                <button type="button" aria-label={`Remove the ${d}-day reminder`} onClick={() => setDraft((x) => ({ ...x, reminderDays: x.reminderDays.filter((v) => v !== d) }))}>
                  <i className="bi bi-x" />
                </button>
              </span>
            ))}
            <input
              id="s-day"
              type="number"
              min={1}
              max={60}
              placeholder="Days"
              value={newDay}
              onChange={(e) => setNewDay(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addDay()
                }
              }}
            />
            <button type="button" className="btn btn-sm btn-ghost" onClick={addDay}>
              <i className="bi bi-plus" /> Add
            </button>
          </div>
        </FieldShell>
        <FieldShell label="Grace period (days)" htmlFor="s-grace" error={errors.graceDays} hint="Full access after the deadline; then the studio becomes read-only.">
          <input id="s-grace" type="number" min={0} max={30} value={draft.graceDays} onChange={(e) => setDraft((d) => ({ ...d, graceDays: e.target.value }))} />
        </FieldShell>
        <FieldShell label="Daily admin digest (IST)" htmlFor="s-digest" error={errors.digestTime} hint="Emailed to every admin once a day.">
          <input id="s-digest" type="time" value={draft.digestTime} onChange={(e) => setDraft((d) => ({ ...d, digestTime: e.target.value }))} />
        </FieldShell>
        <label className="check-row full">
          <input type="checkbox" checked={draft.winbackOn} onChange={(e) => setDraft((d) => ({ ...d, winbackOn: e.target.checked }))} /> Send a win-back coupon after a plan ends
        </label>
        {draft.winbackOn && (
          <>
            <FieldShell label="Days after it ends" htmlFor="s-wb-days" error={errors.winbackAfterDays}>
              <input id="s-wb-days" type="number" min={1} max={90} value={draft.winbackAfterDays} onChange={(e) => setDraft((d) => ({ ...d, winbackAfterDays: e.target.value }))} />
            </FieldShell>
            <FieldShell label="Discount (%)" htmlFor="s-wb-pct" error={errors.winbackPercentOff} hint="One code per studio, valid 14 days.">
              <input id="s-wb-pct" type="number" min={5} max={90} value={draft.winbackPercentOff} onChange={(e) => setDraft((d) => ({ ...d, winbackPercentOff: e.target.value }))} />
            </FieldShell>
          </>
        )}
        <div className="form-foot full">
          <span className="muted">Changes apply from the next hourly run.</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-ghost" disabled={!dirty || save.isPending} onClick={() => setDraft(toDraft(settings))}>
              Reset
            </button>
            <button type="submit" className="btn btn-primary" disabled={!dirty || save.isPending}>
              {save.isPending && <Spinner size={14} />} Save
            </button>
          </div>
        </div>
      </form>
    </Card>
  )
}

function TwoFactorCard() {
  const qc = useQueryClient()
  const status = useQuery({ queryKey: ['admin', '2fa'], queryFn: () => api.get<TwoFactorStatusDto>('/admin/2fa') })
  const [setup, setSetup] = useState<TwoFactorSetupDto | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  const done = (msg: string) => {
    setSetup(null)
    setCode('')
    setError('')
    toast.success(msg)
    qc.invalidateQueries({ queryKey: ['admin', '2fa'] })
  }
  const onError = (e: unknown) => (isApiError(e) && e.fields?.code ? setError(e.fields.code) : toastError(e))
  const start = useMutation({ mutationFn: () => api.post<TwoFactorSetupDto>('/admin/2fa/setup'), onSuccess: setSetup, onError: toastError })
  const enable = useMutation({ mutationFn: () => api.post('/admin/2fa/enable', { code }), onSuccess: () => done('Two-factor sign-in is on'), onError })
  const disable = useMutation({ mutationFn: () => api.post('/admin/2fa/disable', { code }), onSuccess: () => done('Two-factor sign-in is off'), onError })

  const submit = (action: typeof enable) => (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = totpCodeSchema.safeParse({ code })
    if (!parsed.success) return setError(parsed.error.issues[0].message)
    action.mutate()
  }

  const codeField = (
    <FieldShell label="6-digit code from your authenticator app" htmlFor="totp" error={error}>
      <input id="totp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
    </FieldShell>
  )

  return (
    <Card title="Two-factor sign-in" subtitle="Optional: ask for a code from an authenticator app (Google Authenticator, 1Password, Authy) when you sign in.">
      {status.isPending ? (
        <CardSkeleton rows={2} />
      ) : status.isError ? (
        <ErrorState error={status.error} onRetry={() => status.refetch()} />
      ) : status.data.enabled ? (
        <form className="form-grid" onSubmit={submit(disable)} noValidate>
          <p className="full" style={{ margin: 0 }}>
            <i className="bi bi-shield-check" style={{ color: 'var(--success)' }} /> On for your account.
          </p>
          {codeField}
          <div className="form-foot full">
            <span />
            <button type="submit" className="btn btn-danger" disabled={disable.isPending}>
              {disable.isPending && <Spinner size={14} />} Turn off
            </button>
          </div>
        </form>
      ) : setup ? (
        <form className="form-grid" onSubmit={submit(enable)} noValidate>
          <div className="full stack" style={{ gap: 8 }}>
            <p style={{ margin: 0 }}>Add this key in your authenticator app (or open the link on your phone), then enter the code it shows.</p>
            <div className="secret-box">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</div>
            <a className="link" href={setup.otpauthUrl}>
              Open in authenticator app
            </a>
          </div>
          {codeField}
          <div className="form-foot full">
            <button type="button" className="btn btn-ghost" onClick={() => setSetup(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={enable.isPending}>
              {enable.isPending && <Spinner size={14} />} Turn on
            </button>
          </div>
        </form>
      ) : (
        <div className="row-between" style={{ alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className="muted">Off. Your password alone signs you in.</span>
          <button className="btn btn-primary" onClick={() => start.mutate()} disabled={start.isPending}>
            {start.isPending && <Spinner size={14} />} <i className="bi bi-shield-lock" /> Set up
          </button>
        </div>
      )}
    </Card>
  )
}

export default function AdminSettings() {
  const q = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => api.get<AdminAlertSettingsDto>('/admin/settings/alerts') })
  return (
    <div className="stack">
      <PageHeader eyebrow="Platform admin" title="Settings" subtitle="When studios are reminded about their plan deadline, how long grace lasts, and your sign-in security." />
      <div className="grid grid-2">
        {q.isPending ? <CardSkeleton rows={6} /> : q.isError ? <div className="card"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div> : <AlertSettingsCard key={q.data.updatedAt ?? 'defaults'} settings={q.data} />}
        <TwoFactorCard />
      </div>
    </div>
  )
}
