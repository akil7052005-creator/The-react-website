import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createEventSchema,
  EVENT_STATUS_LABELS,
  EVENT_STATUSES,
  EVENT_TYPE_LABELS,
  EVENT_TYPES,
  POPULAR_CITIES,
  todayIST,
  updateEventSchema,
  type EventDto,
} from '@weddyzone/shared'
import { toast } from 'sonner'
import { api } from '../lib/api'
import { toastError } from '../lib/query'
import { ClientSelectField } from './ClientSelect'
import { applyApiErrors, SelectField, SubmitButton, TextAreaField, TextField, useGuardedClose, useZodForm } from './form/form'
import { Modal, useConfirm } from './Modal'

const typeOptions = EVENT_TYPES.map((t) => ({ value: t, label: EVENT_TYPE_LABELS[t] }))
const statusOptions = EVENT_STATUSES.map((s) => ({ value: s, label: EVENT_STATUS_LABELS[s] }))
const cityOptions = POPULAR_CITIES.map((c) => ({ value: c, label: c }))

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['events'] })
  qc.invalidateQueries({ queryKey: ['dashboard'] })
  qc.invalidateQueries({ queryKey: ['search'] })
}

/** New Event (create) or Edit Event (when `event` is given). */
export function EventModal({ open, onClose, event }: { open: boolean; onClose: () => void; event?: EventDto | null }) {
  const editing = Boolean(event)
  const qc = useQueryClient()
  const confirm = useConfirm()
  // Both schemas share fields; typing the form with the update schema (a superset) keeps one form type.
  const schema = (editing ? updateEventSchema : createEventSchema) as typeof updateEventSchema
  const form = useZodForm(schema, {
    values: event
      ? {
          clientId: event.client.id,
          title: event.title,
          type: event.type,
          date: event.date,
          venue: event.venue,
          city: event.city,
          guests: event.guests ?? '',
          notes: event.notes ?? '',
          status: event.status,
        }
      : { clientId: '', title: '', type: 'WEDDING', date: '', venue: '', city: '', guests: '', notes: '', status: 'UPCOMING' },
  })

  const save = useMutation({
    mutationFn: (body: object) => (editing ? api.patch<EventDto>(`/events/${event!.id}`, body) : api.post<EventDto>('/events', body)),
    onSuccess: (e) => {
      toast.success(editing ? `Event ${e.code} updated` : `Event ${e.code} created`)
      invalidate(qc)
      form.reset()
      onClose()
    },
    onError: (e) => applyApiErrors(form, e),
  })
  const close = useGuardedClose(form.formState.isDirty, onClose)

  const remove = () =>
    confirm({
      title: 'Delete event?',
      message: (
        <>
          <strong>
            {event!.code} · {event!.title}
          </strong>{' '}
          will be removed from your calendar and dashboard. Selections, albums and invoices already created stay as they are.
        </>
      ),
      confirmLabel: 'Delete event',
      tone: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/events/${event!.id}`)
          toast.success(`Event ${event!.code} deleted`)
          invalidate(qc)
          onClose()
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    })

  return (
    <Modal
      open={open}
      onClose={close}
      title={editing ? `Edit ${event!.code}` : 'New Event'}
      subtitle={editing ? event!.title : 'Create a wedding event workspace for your client'}
      icon="calendar-plus"
      size="lg"
      busy={save.isPending}
      footer={
        <>
          {editing && (
            <button className="btn btn-ghost" style={{ marginRight: 'auto', color: 'var(--danger)' }} onClick={remove} disabled={save.isPending}>
              <i className="bi bi-trash" /> Delete
            </button>
          )}
          <button className="btn btn-ghost" onClick={close} disabled={save.isPending}>
            Cancel
          </button>
          <SubmitButton busy={save.isPending} form="event-form" icon="check2">
            {editing ? 'Save event' : 'Create event'}
          </SubmitButton>
        </>
      }
    >
      <form id="event-form" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate data-testid="event-form">
        <div className="form-grid">
          <ClientSelectField form={form} name="clientId" initial={event?.client ?? null} full />
          <TextField form={form} name="title" label="Event title" required maxLength={120} showCounter placeholder="Priya & Karthik Wedding" />
          <SelectField form={form} name="type" label="Event type" required options={typeOptions} />
          <TextField form={form} name="date" label="Event date" type="date" required min={editing ? undefined : todayIST()} />
          <TextField form={form} name="venue" label="Venue" required maxLength={120} placeholder="Palace Grounds" />
          <SelectField form={form} name="city" label="City" required kind="creatable" options={cityOptions} placeholder="Select or type a city" />
          <TextField form={form} name="guests" label="Expected guests" type="number" min={0} inputMode="numeric" placeholder="450" />
          {editing && <SelectField form={form} name="status" label="Status" required options={statusOptions} />}
          <TextAreaField form={form} name="notes" label="Notes" maxLength={1000} rows={3} placeholder="Shot list, crew, special requests…" />
        </div>
      </form>
    </Modal>
  )
}
