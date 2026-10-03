import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createSelectionSchema, EVENT_TYPE_LABELS, todayIST, type EventDto, type SelectionDto } from '@weddyzone/shared'
import { useEffect, useState } from 'react'
import { useFieldArray, useWatch } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import { formatDate } from '../../utils/format'
import { EventModal } from '../EventModal'
import { EventSelectField } from '../EventSelect'
import { applyApiErrors, SubmitButton, TextField, useGuardedClose, useZodForm } from '../form/form'
import { Modal } from '../Modal'
import { Toggle } from '../ui'
import { refreshSelection, selectionPath } from './selectionUi'
import { useSelectionDefaults } from './StudioDefaults'

function inDays(n: number) {
  const d = new Date(`${todayIST()}T00:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * New selection: the event (type and date shown, or create one here), the photo limit, when the
 * gallery expires, and gallery access (studio defaults pre-filled). Creating it opens the event page,
 * ready for the photos.
 */
export function NewSelectionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const defaults = useSelectionDefaults()
  const [newEventOpen, setNewEventOpen] = useState(false)
  const [newEvent, setNewEvent] = useState<EventDto | null>(null)
  const form = useZodForm(createSelectionSchema, {
    defaultValues: { eventId: '', quota: 100, deadline: inDays(30), members: [], pin: '', watermark: false, allowDownload: false, notesAllowed: true },
  })
  const members = useFieldArray({ control: form.control, name: 'members' })
  const [eventId, watermark, allowDownload, notesAllowed] = useWatch({ control: form.control, name: ['eventId', 'watermark', 'allowDownload', 'notesAllowed'] })

  // Studio defaults fill the form until the studio changes something.
  useEffect(() => {
    if (!open || !defaults.data || form.formState.isDirty) return
    const d = defaults.data
    form.reset({ ...form.getValues(), deadline: inDays(d.galleryDays), watermark: d.watermark, allowDownload: d.allowDownload, notesAllowed: d.notesAllowed })
  }, [open, defaults.data, form])

  const event = useQuery({
    queryKey: ['event', eventId],
    queryFn: () => api.get<EventDto>(`/events/${eventId}`),
    enabled: Boolean(eventId),
    initialData: newEvent && newEvent.id === eventId ? newEvent : undefined,
  })

  const create = useMutation({
    mutationFn: (body: object) => api.post<SelectionDto>('/selections', body),
    onSuccess: (s) => {
      toast.success(`Selection ${s.code} created — now add the photos`)
      refreshSelection(qc)
      reset()
      navigate(`${selectionPath(s.id)}?upload=1`)
    },
    onError: (e) => applyApiErrors(form, e),
  })

  const reset = () => {
    setNewEvent(null)
    form.reset()
    onClose()
  }
  const guardedClose = useGuardedClose(form.formState.isDirty, reset)
  const set = (k: 'watermark' | 'allowDownload' | 'notesAllowed', v: boolean) => form.setValue(k, v, { shouldDirty: true })

  return (
    <>
      <Modal
        open={open}
        onClose={guardedClose}
        title="New Selection"
        subtitle="A private gallery where the couple picks their favourites"
        icon="images"
        size="lg"
        busy={create.isPending}
        footer={
          <>
            <button className="btn btn-ghost" onClick={guardedClose} disabled={create.isPending}>
              Cancel
            </button>
            <SubmitButton busy={create.isPending} form="selection-form" icon="arrow-right">
              Create & add photos
            </SubmitButton>
          </>
        }
      >
        <form id="selection-form" onSubmit={form.handleSubmit((v) => create.mutate(v))} noValidate data-testid="selection-form">
          <div className="form-grid">
            <EventSelectField
              key={newEvent?.id ?? 'pick'}
              form={form}
              name="eventId"
              full
              initial={newEvent ? { id: newEvent.id, code: newEvent.code, title: newEvent.title, type: newEvent.type } : null}
              onCreateNew={() => setNewEventOpen(true)}
            />
            {event.data && (
              <p className="sw-event-facts full" data-testid="event-facts">
                <span>
                  <i className="bi bi-tag" /> {EVENT_TYPE_LABELS[event.data.type]}
                </span>
                <span>
                  <i className="bi bi-calendar-event" /> {formatDate(event.data.date)}
                </span>
                <span>
                  <i className="bi bi-person" /> {event.data.client.name}
                </span>
              </p>
            )}
            <TextField form={form} name="quota" label="Photo limit" type="number" required min={1} inputMode="numeric" hint="The couple can pick up to this many photos" />
            <TextField form={form} name="deadline" label="Gallery expires on" type="date" required min={todayIST()} hint="After this date the client can only view" />
          </div>

          <fieldset className="sw-access">
            <legend>Client gallery</legend>
            <Toggle checked={!!watermark} onChange={() => set('watermark', !watermark)} label="Watermark previews" />
            <Toggle checked={!!allowDownload} onChange={() => set('allowDownload', !allowDownload)} label="Client can download originals" />
            <Toggle checked={!!notesAllowed} onChange={() => set('notesAllowed', !notesAllowed)} label="Notes on photos" />
            <TextField form={form} name="pin" label="4-digit PIN (optional)" inputMode="numeric" maxLength={4} autoComplete="off" placeholder="Leave empty for no PIN" />
          </fieldset>

          <div className="members-block">
            <div className="row-between" style={{ alignItems: 'center' }}>
              <div>
                <strong>Family members</strong>
                <p className="muted">Each member gets their own hearts. Leave empty to use the client's name.</p>
              </div>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => members.append({ name: '', phone: '' })} disabled={members.fields.length >= 10}>
                <i className="bi bi-person-plus" /> Add member
              </button>
            </div>
            {members.fields.map((m, i) => (
              <div className="member-row" key={m.id}>
                <TextField form={form} name={`members.${i}.name`} label={`Member ${i + 1} name`} required placeholder="Bride, Groom, Mom…" maxLength={60} />
                <TextField form={form} name={`members.${i}.phone`} label="Mobile (optional)" type="tel" placeholder="98400 12345" />
                <button type="button" className="icon-btn" aria-label={`Remove member ${i + 1}`} onClick={() => members.remove(i)}>
                  <i className="bi bi-trash" />
                </button>
              </div>
            ))}
          </div>
        </form>
      </Modal>
      <EventModal
        open={newEventOpen}
        onClose={() => setNewEventOpen(false)}
        onCreated={(e) => {
          setNewEvent(e)
          form.setValue('eventId', e.id, { shouldDirty: true, shouldValidate: true })
        }}
      />
    </>
  )
}
