import { forwardRef, type ReactNode } from 'react'
import ReactSelect, { type GroupBase, type Props as RSProps, type SelectInstance } from 'react-select'
import AsyncSelect, { type AsyncProps } from 'react-select/async'
import CreatableSelect, { type CreatableProps } from 'react-select/creatable'
import AsyncCreatableSelect, { type AsyncCreatableProps } from 'react-select/async-creatable'

export interface Option<V = string> {
  value: V
  label: string
  sub?: string
}

// Styling hooks: every part gets a `wz-select__*` class, styled in additions.css
// with the same tokens as the existing inputs (44px, 12px radius, gold focus ring).
const shared = {
  classNamePrefix: 'wz-select',
  unstyled: true,
  menuPlacement: 'auto' as const,
  // Rendered in place with fixed positioning (not portaled): a portal outside a
  // Radix dialog would be unclickable, and fixed escapes the dialog's scroll area.
  menuPosition: 'fixed' as const,
  styles: { menu: (base: object) => ({ ...base, zIndex: 10050 }) },
  noOptionsMessage: ({ inputValue }: { inputValue: string }) => (inputValue ? `No matches for “${inputValue}”` : 'No options'),
  formatOptionLabel: (o: Option<unknown>) =>
    o.sub ? (
      <span className="wz-select__opt">
        <span>{o.label}</span>
        <small>{o.sub}</small>
      </span>
    ) : (
      o.label
    ),
}

type Base<V> = RSProps<Option<V>, false, GroupBase<Option<V>>>

export const Select = forwardRef(function Select<V>(
  { invalid, ...props }: Base<V> & { invalid?: boolean },
  ref: React.Ref<SelectInstance<Option<V>, false>>,
) {
  return (
    <ReactSelect<Option<V>, false>
      ref={ref}
      {...(shared as object)}
      className={`wz-select${invalid ? ' is-invalid' : ''}`}
      aria-invalid={invalid || undefined}
      {...props}
    />
  )
}) as <V = string>(p: Base<V> & { invalid?: boolean; ref?: React.Ref<SelectInstance<Option<V>, false>> }) => ReactNode

type AsyncBase<V> = AsyncProps<Option<V>, false, GroupBase<Option<V>>>

export const AsyncSelectField = forwardRef(function AsyncSelectField<V>(
  { invalid, ...props }: AsyncBase<V> & { invalid?: boolean },
  ref: React.Ref<SelectInstance<Option<V>, false>>,
) {
  return (
    <AsyncSelect<Option<V>, false>
      ref={ref}
      {...(shared as object)}
      cacheOptions
      defaultOptions
      className={`wz-select${invalid ? ' is-invalid' : ''}`}
      aria-invalid={invalid || undefined}
      loadingMessage={() => 'Searching…'}
      {...props}
    />
  )
}) as <V = string>(p: AsyncBase<V> & { invalid?: boolean; ref?: React.Ref<SelectInstance<Option<V>, false>> }) => ReactNode

type CreatableBase<V> = CreatableProps<Option<V>, false, GroupBase<Option<V>>>

export const CreatableSelectField = forwardRef(function CreatableSelectField<V>(
  { invalid, ...props }: CreatableBase<V> & { invalid?: boolean },
  ref: React.Ref<SelectInstance<Option<V>, false>>,
) {
  return (
    <CreatableSelect<Option<V>, false>
      ref={ref}
      {...(shared as object)}
      className={`wz-select${invalid ? ' is-invalid' : ''}`}
      aria-invalid={invalid || undefined}
      formatCreateLabel={(v) => `Use “${v}”`}
      {...props}
    />
  )
}) as <V = string>(p: CreatableBase<V> & { invalid?: boolean; ref?: React.Ref<SelectInstance<Option<V>, false>> }) => ReactNode

type AsyncCreatableBase<V> = AsyncCreatableProps<Option<V>, false, GroupBase<Option<V>>>

/** Async search with a "Create …" option (e.g. inline "Create new client"). */
export const AsyncCreatableSelectField = forwardRef(function AsyncCreatableSelectField<V>(
  { invalid, ...props }: AsyncCreatableBase<V> & { invalid?: boolean },
  ref: React.Ref<SelectInstance<Option<V>, false>>,
) {
  return (
    <AsyncCreatableSelect<Option<V>, false>
      ref={ref}
      {...(shared as object)}
      cacheOptions={false}
      defaultOptions
      className={`wz-select${invalid ? ' is-invalid' : ''}`}
      aria-invalid={invalid || undefined}
      loadingMessage={() => 'Searching…'}
      {...props}
    />
  )
}) as <V = string>(p: AsyncCreatableBase<V> & { invalid?: boolean; ref?: React.Ref<SelectInstance<Option<V>, false>> }) => ReactNode
