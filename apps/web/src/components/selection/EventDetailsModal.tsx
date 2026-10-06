import { useMutation, useQueryClient } from '@tanstack/react-query'
import { eventDetailsSchema, type Paginated, type SelectionDto } from '@weddyzone/shared'
import { useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import type { FieldPath } from 'react-hook-form'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import { applyApiErrors, FieldShell, SubmitButton, useGuardedClose, useZodForm } from '../form/form'
import { Modal } from '../Modal'
import { refreshSelection } from './selectionUi'

type Values = { customerName: string; customerPhone: string; eventName: string; quota: number | string }
type Form = ReturnType<typeof useZodForm<typeof eventDetailsSchema>>

/** A rounded input with a light grey icon in front of it. */
function IconField({
  form,
  name,
  label,
  icon,
  ...rest
}: { form: Form; name: FieldPath<Values>; label: ReactNode; icon: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'name' | 'form'>) {
  const id = `ed-${name}`
  const error = form.formState.errors[name]?.message as string | undefined
  return (
    <FieldShell label={label} htmlFor={id} required error={error}>
      <div className="ed-input">
        <i className={`bi bi-${icon}`} aria-hidden="true" />
        <input id={id} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? `${id}-error` : undefined} aria-required {...rest} {...form.register(name)} />
      </div>
    </FieldShell>
  )
}

/** "+91 98400 12345" / "+919840012345" → "9840012345" for the input. */
const localPhone = (phone: string) => phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')

const valuesOf = (s: SelectionDto) => ({ customerName: s.client.name, customerPhone: localPhone(s.client.phone), eventName: s.event.title, quota: s.quota })

/**
 * The Event Details form: adds a photo selection (customer, phone, event name, selection limit), or
 * with `selection` edits those details. Used in its dialog and in the event's Settings.
 */
export function EventDetailsForm({
  selection,
  onSaved,
  onDirtyChange,
}: {
  selection?: SelectionDto | null
  onSaved: (s: SelectionDto) => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const qc = useQueryClient()
  const editing = Boolean(selection)
  const form = useZodForm(eventDetailsSchema, {
    defaultValues: selection ? valuesOf(selection) : { customerName: '', customerPhone: '', eventName: '', quota: '' as unknown as number },
  })
  const dirty = form.formState.isDirty
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])

  const save = useMutation({
    mutationFn: (body: object) => (selection ? api.put<SelectionDto>(`/selections/${selection.id}/details`, body) : api.post<SelectionDto>('/selections/details', body)),
    onSuccess: (s) => {
      if (!editing) {
        // Show it at the top of the first page straight away, then refetch the real list.
        qc.setQueriesData<Paginated<SelectionDto>>({ queryKey: ['selections'] }, (d) =>
          d && 'meta' in d && d.meta.page === 1 ? { ...d, data: [s, ...d.data.filter((x) => x.id !== s.id)].slice(0, d.meta.limit), meta: { ...d.meta, total: d.meta.total + 1 } } : d,
        )
        toast.success(`Event added · code ${s.code}`)
      } else {
        toast.success('Event details saved')
      }
      refreshSelection(qc, s.id)
      form.reset(editing ? valuesOf(s) : undefined)
      onSaved(s)
    },
    onError: (e) => applyApiErrors(form, e),
  })

  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate className="ed-form" data-testid="event-details-form" aria-busy={save.isPending || undefined}>
      <IconField form={form} name="customerName" label="Customer Name" icon="person" placeholder="Enter customer name" autoComplete="off" maxLength={80} />
      <IconField form={form} name="customerPhone" label="Customer Phone Number" icon="telephone" placeholder="Enter phone number" type="tel" inputMode="numeric" autoComplete="off" maxLength={16} />
      <IconField form={form} name="eventName" label="Event Name" icon="calendar-event" placeholder="Enter event name" maxLength={120} />
      <IconField
        form={form}
        name="quota"
        label={
          <>
            Selection Limit <span className="ed-suffix">(photos customer can select)</span>
          </>
        }
        icon="check2-all"
        placeholder="e.g. 100"
        type="number"
        inputMode="numeric"
        min={1}
      />
      <SubmitButton busy={save.isPending} className="btn btn-primary ed-submit">
        {editing ? 'Save Changes' : 'Add Event'}
      </SubmitButton>
    </form>
  )
}

/** The Event Details dialog: Add Photo Selection, or Manage with `selection`. */
export function EventDetailsModal({ open, onClose, selection, onCreated }: { open: boolean; onClose: () => void; selection?: SelectionDto | null; onCreated?: (s: SelectionDto) => void }) {
  const [dirty, setDirty] = useState(false)
  const guardedClose = useGuardedClose(dirty, onClose)
  return (
    <Modal open={open} onClose={guardedClose} title={selection ? 'Manage Event' : 'Event Details'} className="ed-modal">
      <EventDetailsForm
        selection={selection}
        onDirtyChange={setDirty}
        // onCreated replaces onClose after an add, so the page can close and reset its view in one go.
        onSaved={(s) => (!selection && onCreated ? onCreated(s) : onClose())}
      />
    </Modal>
  )
}
