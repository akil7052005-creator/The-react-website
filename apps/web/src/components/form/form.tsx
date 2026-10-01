import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import {
  Controller,
  useForm,
  type FieldPath,
  type FieldValues,
  type UseFormProps,
  type UseFormReturn,
} from 'react-hook-form'
import { useBlocker } from 'react-router-dom'
import { toast } from 'sonner'
import type { z } from 'zod'
import { isApiError } from '../../lib/api'
import { toastError } from '../../lib/query'
import { useConfirm } from '../Modal'
import { AsyncSelectField, CreatableSelectField, Select, type Option } from '../Select'
import { Spinner } from '../ui'

/**
 * React Hook Form wired to a shared Zod schema. Validates on blur first, then on
 * every change; on submit RHF focuses the first invalid field.
 */
export function useZodForm<S extends z.ZodType<FieldValues, FieldValues>>(
  schema: S,
  options: Omit<UseFormProps<z.input<S>, unknown, z.output<S>>, 'resolver'> = {},
) {
  return useForm<z.input<S>, unknown, z.output<S>>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any) as any,
    mode: 'onTouched',
    reValidateMode: 'onChange',
    shouldFocusError: true,
    ...options,
  })
}

/**
 * Puts API field errors onto the form (e.g. "email already registered") and
 * shows the API message as a toast. Returns true if any field got an error.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyApiErrors(form: UseFormReturn<any, any, any>, error: unknown, opts: { toast?: boolean } = {}): boolean {
  let mapped = false
  if (isApiError(error) && error.fields) {
    const known = Object.keys(form.getValues())
    let first: string | null = null
    for (const [field, message] of Object.entries(error.fields)) {
      const name = field.split('.')[0]
      if (known.includes(name) || field.includes('.')) {
        form.setError(field, { type: 'server', message })
        first ??= field
        mapped = true
      }
    }
    if (first) {
      try {
        form.setFocus(first)
      } catch {
        /* field may not be focusable (e.g. array) */
      }
    }
  }
  if (opts.toast !== false) {
    if (mapped && isApiError(error) && error.code === 'VALIDATION_ERROR') toast.error('Please fix the highlighted fields')
    else toastError(error)
  }
  return mapped
}

// ---------------------------------------------------------------------------
// Field wrappers

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyForm<T extends FieldValues> = UseFormReturn<T, any, any>

interface FieldShellProps {
  label: ReactNode
  htmlFor?: string
  required?: boolean
  error?: string
  hint?: ReactNode
  counter?: { value: number; max: number }
  full?: boolean
  children: ReactNode
  className?: string
}

export function FieldShell({ label, htmlFor, required, error, hint, counter, full, children, className = '' }: FieldShellProps) {
  return (
    <div className={`field${full ? ' full' : ''}${error ? ' has-error' : ''} ${className}`}>
      <div className="field-label-row">
        <label htmlFor={htmlFor}>
          {label}
          {required && (
            <span className="req" aria-hidden="true">
              {' '}
              *
            </span>
          )}
        </label>
        {counter && (
          <span className={`char-count${counter.value > counter.max ? ' over' : ''}`} aria-live="polite">
            {counter.value}/{counter.max}
          </span>
        )}
      </div>
      {children}
      {error ? (
        <p className="field-error" id={htmlFor ? `${htmlFor}-error` : undefined} role="alert">
          <i className="bi bi-exclamation-circle" /> {error}
        </p>
      ) : (
        hint && <p className="field-hint">{hint}</p>
      )}
    </div>
  )
}

function errorAt(form: UseFormReturn<FieldValues>, name: string): string | undefined {
  const parts = name.split('.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = form.formState.errors
  for (const p of parts) cur = cur?.[p]
  return cur?.message as string | undefined
}

type TextFieldProps<T extends FieldValues> = {
  form: AnyForm<T>
  name: FieldPath<T>
  label: ReactNode
  required?: boolean
  hint?: ReactNode
  full?: boolean
  showCounter?: boolean
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'name' | 'form'>

export function TextField<T extends FieldValues>({ form, name, label, required, hint, full, showCounter, maxLength, ...rest }: TextFieldProps<T>) {
  const id = `f-${String(name).replace(/\./g, '-')}`
  const f = form as unknown as UseFormReturn<FieldValues>
  const error = errorAt(f, name)
  const value = showCounter && maxLength ? String(f.watch(name) ?? '') : ''
  return (
    <FieldShell
      label={label}
      htmlFor={id}
      required={required}
      error={error}
      hint={hint}
      full={full}
      counter={showCounter && maxLength ? { value: value.length, max: maxLength } : undefined}
    >
      <input
        id={id}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        aria-required={required || undefined}
        maxLength={showCounter ? undefined : maxLength}
        {...rest}
        {...f.register(name)}
      />
    </FieldShell>
  )
}

type TextAreaFieldProps<T extends FieldValues> = {
  form: AnyForm<T>
  name: FieldPath<T>
  label: ReactNode
  required?: boolean
  hint?: ReactNode
  maxLength?: number
  full?: boolean
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'name' | 'form' | 'maxLength'>

export function TextAreaField<T extends FieldValues>({ form, name, label, required, hint, maxLength, full = true, ...rest }: TextAreaFieldProps<T>) {
  const id = `f-${String(name).replace(/\./g, '-')}`
  const f = form as unknown as UseFormReturn<FieldValues>
  const error = errorAt(f, name)
  const value = String(f.watch(name) ?? '')
  return (
    <FieldShell
      label={label}
      htmlFor={id}
      required={required}
      error={error}
      hint={hint}
      full={full}
      counter={maxLength ? { value: value.length, max: maxLength } : undefined}
    >
      <textarea
        id={id}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...rest}
        {...f.register(name)}
      />
    </FieldShell>
  )
}

type SelectFieldProps<T extends FieldValues, V> = {
  form: AnyForm<T>
  name: FieldPath<T>
  label: ReactNode
  required?: boolean
  hint?: ReactNode
  full?: boolean
  placeholder?: string
  isClearable?: boolean
  isDisabled?: boolean
  onValueChange?: (v: V | null) => void
} & (
  | { kind?: 'static'; options: Option<V>[] }
  | { kind: 'async'; loadOptions: (input: string) => Promise<Option<V>[]>; selected?: Option<V> | null; onCreate?: never }
  | { kind: 'creatable'; options: Option<V>[] }
)

/** react-select bound to a form field. The form value is the option's `value` (a primitive). */
export function SelectField<T extends FieldValues, V = string>(props: SelectFieldProps<T, V>) {
  const { form, name, label, required, hint, full, placeholder, isClearable, isDisabled, onValueChange } = props
  const id = `f-${String(name).replace(/\./g, '-')}`
  const f = form as unknown as UseFormReturn<FieldValues>
  const error = errorAt(f, name)
  return (
    <FieldShell label={label} htmlFor={id} required={required} error={error} hint={hint} full={full}>
      <Controller
        control={f.control}
        name={name}
        render={({ field }) => {
          const common = {
            ref: field.ref,
            inputId: id,
            name: field.name,
            invalid: Boolean(error),
            placeholder: placeholder ?? 'Select…',
            isClearable,
            isDisabled,
            onBlur: field.onBlur,
            'aria-describedby': error ? `${id}-error` : undefined,
            onChange: (o: Option<V> | null) => {
              field.onChange(o ? o.value : '')
              onValueChange?.(o ? o.value : null)
            },
          }
          if (props.kind === 'async') {
            return (
              <AsyncSelectField<V>
                {...common}
                loadOptions={props.loadOptions}
                value={field.value ? (props.selected ?? null) : null}
              />
            )
          }
          const value = props.options.find((o) => o.value === field.value) ?? (field.value && props.kind === 'creatable' ? { value: field.value as V, label: String(field.value) } : null)
          if (props.kind === 'creatable') {
            return (
              <CreatableSelectField<V>
                {...common}
                options={props.options}
                value={value}
                onCreateOption={(v: string) => {
                  field.onChange(v)
                  onValueChange?.(v as V)
                }}
              />
            )
          }
          return <Select<V> {...common} options={props.options} value={value} />
        }}
      />
    </FieldShell>
  )
}

export function SubmitButton({
  busy,
  children,
  disabled,
  className = 'btn btn-primary',
  icon,
  form,
}: {
  busy: boolean
  children: ReactNode
  disabled?: boolean
  className?: string
  icon?: string
  form?: string
}) {
  return (
    <button type="submit" className={className} disabled={busy || disabled} aria-busy={busy || undefined} form={form}>
      {busy ? <Spinner size={14} /> : icon ? <i className={`bi bi-${icon}`} /> : null}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Unsaved changes

/** Warns before leaving the page (route change or tab close) while `when` is true. */
export function useUnsavedChangesWarning(when: boolean) {
  const confirm = useConfirm()
  const blocker = useBlocker(({ currentLocation, nextLocation }) => when && currentLocation.pathname !== nextLocation.pathname)

  useEffect(() => {
    if (blocker.state !== 'blocked') return
    void confirm({
      title: 'Discard unsaved changes?',
      message: 'You have unsaved changes. If you leave this page now, they will be lost.',
      confirmLabel: 'Leave without saving',
      cancelLabel: 'Stay on page',
      tone: 'danger',
    }).then((ok) => (ok ? blocker.proceed?.() : blocker.reset?.()))
  }, [blocker, confirm])

  useEffect(() => {
    if (!when) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [when])
}

/** For forms inside modals: asks before closing when the form has unsaved changes. */
export function useGuardedClose(isDirty: boolean, close: () => void) {
  const confirm = useConfirm()
  return async () => {
    if (!isDirty) return close()
    const ok = await confirm({
      title: 'Discard unsaved changes?',
      message: 'You have started filling this form. Close it and lose your changes?',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      tone: 'danger',
    })
    if (ok) close()
  }
}
