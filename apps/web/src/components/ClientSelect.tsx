import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  clientSchema,
  INDIAN_STATES,
  POPULAR_CITIES,
  type ClientDto,
  type ClientRef,
  type Paginated,
} from '@weddyzone/shared'
import { useState, type ReactNode } from 'react'
import { Controller, type FieldPath, type FieldValues, type UseFormReturn } from 'react-hook-form'
import { toast } from 'sonner'
import { api } from '../lib/api'
import { applyApiErrors, FieldShell, SelectField, SubmitButton, TextAreaField, TextField, useGuardedClose, useZodForm } from './form/form'
import { Modal } from './Modal'
import { AsyncCreatableSelectField, type Option } from './Select'

const stateOptions = INDIAN_STATES.map((s) => ({ value: s.code, label: s.name }))
const cityOptions = POPULAR_CITIES.map((c) => ({ value: c, label: c }))

export const clientOption = (c: ClientRef & { city?: string | null }): Option<string> => ({
  value: c.id,
  label: c.name,
  sub: [c.phone, c.city].filter(Boolean).join(' · '),
})

export async function loadClientOptions(search: string): Promise<Option<string>[]> {
  const res = await api.get<Paginated<ClientDto>>('/clients', { search, limit: 20 })
  return res.data.map(clientOption)
}

/** Create a client — used inline from the client select. */
export function ClientFormModal({
  open,
  initialName = '',
  onClose,
  onCreated,
}: {
  open: boolean
  initialName?: string
  onClose: () => void
  onCreated: (c: ClientDto) => void
}) {
  const qc = useQueryClient()
  const form = useZodForm(clientSchema, {
    values: { name: initialName, phone: '', email: '', city: '', stateCode: '', gstin: '', notes: '' },
    resetOptions: { keepDirtyValues: false },
  })
  const create = useMutation({
    mutationFn: (body: object) => api.post<ClientDto>('/clients', body),
    onSuccess: (c) => {
      toast.success(`Client ${c.name} created`)
      qc.invalidateQueries({ queryKey: ['clients'] })
      onCreated(c)
      form.reset()
    },
    onError: (e) => applyApiErrors(form, e),
  })
  const close = useGuardedClose(form.formState.isDirty, onClose)

  return (
    <Modal
      open={open}
      onClose={close}
      title="New client"
      subtitle="The couple or family contact for invoices and WhatsApp messages"
      icon="person-plus"
      busy={create.isPending}
      footer={
        <>
          <button className="btn btn-ghost" onClick={close} disabled={create.isPending}>
            Cancel
          </button>
          <SubmitButton busy={create.isPending} form="client-form" icon="check2">
            Create client
          </SubmitButton>
        </>
      }
    >
      <form id="client-form" onSubmit={(e) => { e.stopPropagation(); void form.handleSubmit((v) => create.mutate(v))(e) }} noValidate>
        <div className="form-grid">
          <TextField form={form} name="name" label="Client name" required maxLength={80} autoFocus />
          <TextField form={form} name="phone" label="Mobile number" type="tel" required placeholder="98400 12345" />
          <TextField form={form} name="email" label="Email" type="email" />
          <SelectField form={form} name="city" label="City" kind="creatable" options={cityOptions} placeholder="Select or type a city" isClearable />
          <SelectField form={form} name="stateCode" label="State" options={stateOptions} placeholder="Select state" isClearable />
          <TextField form={form} name="gstin" label="Client GSTIN" placeholder="For B2B invoices" style={{ textTransform: 'uppercase' }} />
          <TextAreaField form={form} name="notes" label="Notes" maxLength={500} rows={3} />
        </div>
      </form>
    </Modal>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyForm<T extends FieldValues> = UseFormReturn<T, any, any>

/** Searchable client select (async) with inline "Create new client". */
export function ClientSelectField<T extends FieldValues>({
  form,
  name,
  label = 'Client',
  initial,
  hint,
  full,
}: {
  form: AnyForm<T>
  name: FieldPath<T>
  label?: ReactNode
  initial?: ClientRef | null
  hint?: ReactNode
  full?: boolean
}) {
  const [selected, setSelected] = useState<Option<string> | null>(initial ? clientOption(initial) : null)
  const [creating, setCreating] = useState<string | null>(null)
  const id = `f-${name}`
  const error = form.formState.errors[name]?.message as string | undefined

  return (
    <FieldShell label={label} htmlFor={id} required full={full} error={error} hint={hint ?? 'Search by name or phone, or type a new name to create a client'}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <>
            <AsyncCreatableSelectField<string>
              ref={field.ref}
              inputId={id}
              invalid={Boolean(error)}
              placeholder="Search clients…"
              loadOptions={loadClientOptions}
              value={field.value ? selected : null}
              onBlur={field.onBlur}
              onChange={(o) => {
                setSelected(o)
                field.onChange(o?.value ?? '')
              }}
              onCreateOption={(input) => setCreating(input)}
              formatCreateLabel={(input) => `+ Create new client “${input}”`}
              isClearable
            />
            <ClientFormModal
              open={creating !== null}
              initialName={creating ?? ''}
              onClose={() => setCreating(null)}
              onCreated={(c) => {
                setCreating(null)
                setSelected(clientOption(c))
                field.onChange(c.id)
              }}
            />
          </>
        )}
      />
    </FieldShell>
  )
}
