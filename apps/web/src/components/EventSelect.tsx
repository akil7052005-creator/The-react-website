import type { EventDto, EventRef, Paginated } from '@weddyzone/shared'
import { useState, type ReactNode } from 'react'
import { Controller, type FieldPath, type FieldValues, type UseFormReturn } from 'react-hook-form'
import { api } from '../lib/api'
import { formatDate } from '../utils/format'
import { FieldShell } from './form/form'
import { AsyncSelectField, type Option } from './Select'

export const eventOption = (e: EventDto): Option<string> => ({
  value: e.id,
  label: e.title,
  sub: `${e.code} · ${formatDate(e.date)} · ${e.client.name}`,
})

export async function loadEventOptions(search: string): Promise<Option<string>[]> {
  const res = await api.get<Paginated<EventDto>>('/events', { search, limit: 20, sort: '-date' })
  return res.data.map(eventOption)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyForm<T extends FieldValues> = UseFormReturn<T, any, any>

/** Async, searchable event select bound to a form field. */
export function EventSelectField<T extends FieldValues>({
  form,
  name,
  label = 'Event',
  initial,
  hint,
  full,
  onChange,
  required = true,
  onCreateNew,
}: {
  form: AnyForm<T>
  name: FieldPath<T>
  label?: ReactNode
  initial?: EventRef | null
  hint?: ReactNode
  full?: boolean
  onChange?: (eventId: string | null, option: Option<string> | null) => void
  required?: boolean
  /** Shows a "+ New event" link that calls this (e.g. to open the New Event dialog). */
  onCreateNew?: () => void
}) {
  const [selected, setSelected] = useState<Option<string> | null>(initial ? { value: initial.id, label: initial.title, sub: initial.code } : null)
  const id = `f-${name}`
  const error = form.formState.errors[name]?.message as string | undefined
  return (
    <FieldShell
      label={label}
      htmlFor={id}
      required={required}
      full={full}
      error={error}
      hint={
        <>
          {hint ?? 'Search by couple name, event code or city'}
          {onCreateNew && (
            <>
              {' · '}
              <button type="button" className="link" onClick={onCreateNew}>
                + New event
              </button>
            </>
          )}
        </>
      }
    >
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <AsyncSelectField<string>
            ref={field.ref}
            inputId={id}
            invalid={Boolean(error)}
            placeholder="Search events…"
            loadOptions={loadEventOptions}
            value={field.value ? selected : null}
            onBlur={field.onBlur}
            onChange={(o) => {
              setSelected(o)
              field.onChange(o?.value ?? '')
              onChange?.(o?.value ?? null, o)
            }}
            isClearable={!required}
            noOptionsMessage={({ inputValue }) => (inputValue ? `No events match “${inputValue}”` : onCreateNew ? 'No events yet — use “+ New event” below' : 'No events yet')}
          />
        )}
      />
    </FieldShell>
  )
}
