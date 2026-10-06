import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DEFAULT_SELECTION_DEFAULTS, type SelectionDefaultsDto } from '@weddyzone/shared'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import { toastError } from '../../lib/query'
import { Spinner, Toggle } from '../ui'

export const SELECTION_DEFAULTS_KEY = ['selection-defaults']

export function useSelectionDefaults() {
  return useQuery({ queryKey: SELECTION_DEFAULTS_KEY, queryFn: () => api.get<SelectionDefaultsDto>('/studio/selection-defaults') })
}

/** Studio-wide defaults for new selections. Collapsed to a one-line summary until opened. */
export function StudioDefaultsCard() {
  const qc = useQueryClient()
  const q = useSelectionDefaults()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<SelectionDefaultsDto>(DEFAULT_SELECTION_DEFAULTS)
  const [daysError, setDaysError] = useState('')

  const save = useMutation({
    mutationFn: (body: SelectionDefaultsDto) => api.put<SelectionDefaultsDto>('/studio/selection-defaults', body),
    onSuccess: (d) => {
      qc.setQueryData(SELECTION_DEFAULTS_KEY, d)
      toast.success('Studio defaults saved — new selections will use them')
      setOpen(false)
    },
    onError: (e) => toastError(e),
  })

  const d = q.data ?? DEFAULT_SELECTION_DEFAULTS
  const summary = [
    d.watermark ? 'Watermark on' : 'No watermark',
    d.allowDownload ? 'downloads on' : 'downloads off',
    `gallery open ${d.galleryDays} days`,
    d.notesAllowed ? 'notes on' : 'notes off',
  ].join(' · ')
  const dirty = q.data && JSON.stringify(q.data) !== JSON.stringify(draft)

  const submit = () => {
    const days = Number(draft.galleryDays)
    if (!Number.isInteger(days) || days < 1 || days > 365) return setDaysError('1 to 365 days')
    save.mutate({ ...draft, galleryDays: days })
  }

  return (
    <section className="card ps-card sw-defaults" aria-labelledby="studio-defaults">
      <div className="row-between">
        <div>
          <h2 id="studio-defaults" className="ps-section-title">
            <i className="bi bi-sliders2" /> Studio defaults
          </h2>
          <p className="muted sw-small" data-testid="defaults-summary">
            {q.isPending ? 'Loading…' : summary}
          </p>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            if (!open) setDraft(q.data ?? DEFAULT_SELECTION_DEFAULTS)
            setDaysError('')
            setOpen(!open)
          }}
          aria-expanded={open}
        >
          <i className={`bi bi-${open ? 'chevron-up' : 'pencil'}`} /> {open ? 'Close' : 'Edit'}
        </button>
      </div>
      {open && (
        <form
          className="sw-defaults-form"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
          noValidate
        >
          <Toggle checked={draft.watermark} onChange={() => setDraft({ ...draft, watermark: !draft.watermark })} label="Watermark previews" />
          <Toggle checked={draft.allowDownload} onChange={() => setDraft({ ...draft, allowDownload: !draft.allowDownload })} label="Client can download originals" />
          <Toggle checked={draft.notesAllowed} onChange={() => setDraft({ ...draft, notesAllowed: !draft.notesAllowed })} label="Notes on photos" />
          <div className={`field sw-days${daysError ? ' has-error' : ''}`}>
            <label htmlFor="gallery-days">Gallery stays open for (days)</label>
            <input
              id="gallery-days"
              className="input"
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              value={draft.galleryDays}
              aria-invalid={!!daysError}
              onChange={(e) => {
                setDraft({ ...draft, galleryDays: e.target.value === '' ? ('' as unknown as number) : Number(e.target.value) })
                setDaysError('')
              }}
            />
            {daysError && (
              <p className="field-error" role="alert">
                {daysError}
              </p>
            )}
          </div>
          <div className="form-foot">
            <button className="btn btn-primary" disabled={save.isPending || !dirty}>
              {save.isPending ? <Spinner size={14} /> : <i className="bi bi-check2" />} Save defaults
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
