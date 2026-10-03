import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isSelectionLocked, todayIST, updateSelectionSchema, type SelectionDto, type SelectionLogDto } from '@weddyzone/shared'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import { toastError } from '../../lib/query'
import { formatDate, formatDateTime } from '../../utils/format'
import { applyApiErrors, SubmitButton, TextField, useZodForm } from '../form/form'
import { useConfirm } from '../Modal'
import { EmptyState, Toggle } from '../ui'
import { refreshSelection } from './selectionUi'

type AccessKey = 'allowDownload' | 'watermark' | 'notesAllowed'

const ACCESS: { key: AccessKey; label: string; hint: string }[] = [
  { key: 'watermark', label: 'Watermark previews', hint: 'Your studio name across every photo the client sees. Originals are never shown.' },
  { key: 'allowDownload', label: 'Client can download originals', hint: 'Off: the client only sees previews and can’t save the full files.' },
  { key: 'notesAllowed', label: 'Notes on photos', hint: 'Let the client add a note to a photo, e.g. “brighten this”.' },
]

export function EventSettings({ s }: { s: SelectionDto }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const locked = isSelectionLocked(s.status)
  const [saving, setSaving] = useState<AccessKey | null>(null)
  const form = useZodForm(updateSelectionSchema, { values: { quota: s.quota, deadline: s.deadline } })
  const save = useMutation({
    mutationFn: (body: object) => api.patch<SelectionDto>(`/selections/${s.id}`, body),
    onSuccess: () => {
      toast.success('Selection updated')
      refreshSelection(qc, s.id)
    },
    onError: (e) => applyApiErrors(form, e),
  })

  const toggle = async (key: AccessKey) => {
    setSaving(key)
    try {
      await api.patch(`/selections/${s.id}/access`, { [key]: !s[key] })
      refreshSelection(qc, s.id)
      toast.success(`${ACCESS.find((a) => a.key === key)!.label}: ${s[key] ? 'off' : 'on'}`)
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(null)
    }
  }

  const remove = () =>
    confirm({
      title: `Delete ${s.code}?`,
      message: (
        <>
          The gallery for <strong>{s.event.title}</strong> and its link stop working for the client. Picks made so far are kept in your records.
        </>
      ),
      confirmLabel: 'Delete selection',
      tone: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/selections/${s.id}`)
          toast.success(`Selection ${s.code} deleted`)
          refreshSelection(qc)
          navigate('/photo-selection')
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    })

  return (
    <div className="sw-settings">
      <section className="card sw-card" aria-labelledby="limits-title">
        <h3 id="limits-title">
          <i className="bi bi-sliders" /> Limit & expiry
        </h3>
        {locked && (
          <p className="notice success">
            <i className="bi bi-lock" /> Submitted {formatDate(s.submittedAt)}. Unlock the selection to change the limit or expiry.
          </p>
        )}
        {s.status === 'EXPIRED' && (
          <p className="notice warning">
            <i className="bi bi-hourglass-bottom" /> The gallery has expired. Move the expiry date forward to reopen it.
          </p>
        )}
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
          <div className="form-grid">
            <TextField form={form} name="quota" label="Photo limit" type="number" required min={1} disabled={locked} hint={`Picked so far: ${s.pickedCount}`} />
            <TextField form={form} name="deadline" label="Gallery expires on" type="date" required min={todayIST()} disabled={locked} />
          </div>
          <div className="form-foot">
            <SubmitButton busy={save.isPending} disabled={locked || !form.formState.isDirty}>
              Save
            </SubmitButton>
          </div>
        </form>
      </section>

      <section className="card sw-card" aria-labelledby="access-title">
        <h3 id="access-title">
          <i className="bi bi-shield-check" /> Client gallery
        </h3>
        <div className="sw-toggles">
          {ACCESS.map((a) => (
            <div key={a.key} className="sw-toggle-row">
              <Toggle checked={!!s[a.key]} onChange={() => void toggle(a.key)} label={a.label} disabled={saving !== null} />
              <p className="muted sw-small">{a.hint}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="danger-zone">
        <div>
          <strong>Delete selection</strong>
          <p className="muted">Removes it from your list and disables the client link.</p>
        </div>
        <button className="btn btn-ghost sw-danger" onClick={remove}>
          <i className="bi bi-trash" /> Delete
        </button>
      </div>
    </div>
  )
}

const ACTOR: Record<SelectionLogDto['actor'], { icon: string; label: string }> = {
  STUDIO: { icon: 'person-badge', label: 'You' },
  CLIENT: { icon: 'heart', label: 'Client' },
  SYSTEM: { icon: 'gear', label: 'System' },
}

export function ActivityLog({ log }: { log: SelectionLogDto[] }) {
  if (!log.length) return <EmptyState icon="clock-history" title="No activity yet" />
  return (
    <ol className="sw-log" aria-label="Change log">
      {log.map((l) => (
        <li key={l.id}>
          <span className={`sw-log-icon ${l.actor.toLowerCase()}`} aria-hidden="true">
            <i className={`bi bi-${ACTOR[l.actor].icon}`} />
          </span>
          <div>
            <strong>{l.action}</strong>
            {l.detail && <span className="sw-log-detail"> — {l.detail}</span>}
            <div className="muted sw-small">
              {ACTOR[l.actor].label} · {formatDateTime(l.createdAt)}
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}
