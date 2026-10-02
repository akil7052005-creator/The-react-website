import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminPlanDto, PlanLimits } from '@weddyzone/shared'
import { Fragment, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { FieldShell, SubmitButton, useGuardedClose } from '../../components/form/form'
import { Modal } from '../../components/Modal'
import { Card, CardSkeleton, ComingSoonTag, ErrorState, PageHeader, StatusPill } from '../../components/ui'
import { useUrlState } from '../../hooks/useUrlState'
import { limitFeature, storageText } from '../../lib/admin'
import { api, isApiError } from '../../lib/api'
import { toastError } from '../../lib/query'
import { formatMoney, formatNumber } from '../../utils/format'

const PLANS_KEY = ['admin', 'plans'] as const

/** Limits that may be "unlimited" (blank field = null). */
const LIMIT_FIELDS: { key: keyof PlanLimits; label: string; unit?: string; unlimited: boolean }[] = [
  { key: 'eventsPerMonth', label: 'Events per month', unlimited: true },
  { key: 'albums', label: 'Digital albums', unlimited: true },
  { key: 'storageGb', label: 'Storage', unit: 'GB', unlimited: true },
  { key: 'teamSeats', label: 'Team seats', unlimited: false },
  { key: 'includedCredits', label: 'WhatsApp credits included', unlimited: false },
]

interface Draft {
  name: string
  tagline: string
  monthlyPrice: string
  yearlyPrice: string
  limits: Record<keyof PlanLimits, string>
  features: string
  comingSoon: string[]
  popular: boolean
  isActive: boolean
}

const toDraft = (p: AdminPlanDto): Draft => ({
  name: p.name,
  tagline: p.tagline,
  monthlyPrice: p.monthlyPricePaise === null ? '' : String(p.monthlyPricePaise / 100),
  yearlyPrice: String(p.yearlyPricePaise / 100),
  limits: Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, p.limits[f.key] === null ? '' : String(p.limits[f.key])])) as Draft['limits'],
  features: p.features.join('\n'),
  comingSoon: p.comingSoon,
  popular: p.popular,
  isActive: p.isActive,
})

const featureList = (text: string) =>
  text
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean)

function PlanEditor({ plan, onClose }: { plan: AdminPlanDto; onClose: () => void }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState(() => toDraft(plan))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(plan))
  const features = featureList(draft.features)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  const save = useMutation({
    mutationFn: (body: object) => api.patch<AdminPlanDto>(`/admin/plans/${plan.code}`, body),
    onSuccess: async () => {
      toast.success(`${draft.name} saved`)
      await qc.invalidateQueries({ queryKey: PLANS_KEY })
      // Studios see the new prices and features on their pricing pages.
      await qc.invalidateQueries({ queryKey: ['plans'] })
      onClose()
    },
    onError: (e) => {
      if (isApiError(e) && e.fields) setErrors(e.fields)
      toastError(e)
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setErrors({})
    const num = (v: string) => (v.trim() === '' ? null : Number(v))
    save.mutate({
      name: draft.name,
      tagline: draft.tagline,
      monthlyPrice: num(draft.monthlyPrice),
      yearlyPrice: num(draft.yearlyPrice),
      limits: Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, num(draft.limits[f.key])])),
      features,
      // Only features still on the list can be "coming soon".
      comingSoon: draft.comingSoon.filter((f) => features.includes(f)),
      popular: draft.popular,
      isActive: draft.isActive,
    })
  }
  const close = useGuardedClose(dirty, onClose)
  const field = (id: string, label: string, error: string | undefined, input: ReactNode, hint?: string, full = false) => (
    <FieldShell label={label} htmlFor={id} error={error} hint={hint} full={full}>
      {input}
    </FieldShell>
  )

  return (
    <Modal
      open
      onClose={close}
      title={`Edit ${plan.name}`}
      subtitle="Changes show on every studio's pricing pages straight away. Prices exclude GST."
      icon="box-seam"
      size="lg"
      busy={save.isPending}
      footer={
        <>
          <button className="btn btn-ghost" onClick={close} disabled={save.isPending}>
            Cancel
          </button>
          <SubmitButton busy={save.isPending} form="plan-form" icon="check2" disabled={!dirty}>
            Save plan
          </SubmitButton>
        </>
      }
    >
      <form id="plan-form" className="form-grid" onSubmit={submit} noValidate>
        {field('p-name', 'Plan name', errors.name, <input id="p-name" value={draft.name} maxLength={40} onChange={(e) => set('name', e.target.value)} />)}
        {field('p-tagline', 'Tagline', errors.tagline, <input id="p-tagline" value={draft.tagline} maxLength={80} onChange={(e) => set('tagline', e.target.value)} />)}
        {field(
          'p-monthly',
          'Monthly price (₹)',
          errors.monthlyPrice,
          <input id="p-monthly" inputMode="decimal" value={draft.monthlyPrice} placeholder="Yearly only" onChange={(e) => set('monthlyPrice', e.target.value)} />,
          'Leave empty for a yearly-only plan',
        )}
        {field('p-yearly', 'Yearly price (₹)', errors.yearlyPrice, <input id="p-yearly" inputMode="decimal" value={draft.yearlyPrice} onChange={(e) => set('yearlyPrice', e.target.value)} />)}
        {LIMIT_FIELDS.map((f) => (
          <Fragment key={f.key}>
            {field(
            `p-${f.key}`,
            `${f.label}${f.unit ? ` (${f.unit})` : ''}`,
            errors[`limits.${f.key}`],
            <input
              id={`p-${f.key}`}
              inputMode="numeric"
              value={draft.limits[f.key]}
              placeholder={f.unlimited ? 'Unlimited' : undefined}
              onChange={(e) => set('limits', { ...draft.limits, [f.key]: e.target.value })}
            />,
            f.unlimited ? 'Leave empty for unlimited' : undefined,
            )}
          </Fragment>
        ))}
        {field(
          'p-features',
          'Features (one per line)',
          errors.features,
          <textarea id="p-features" rows={6} value={draft.features} onChange={(e) => set('features', e.target.value)} />,
          'Shown on the pricing cards in this order',
          true,
        )}
        <fieldset className="full admin-coming-soon">
          <legend>Coming soon</legend>
          <p className="field-hint">Tick features that are promised but not built yet. They show a "Coming soon" tag instead of a check mark.</p>
          {features.map((f) => (
            <label key={f} className="check-row">
              <input
                type="checkbox"
                checked={draft.comingSoon.includes(f)}
                onChange={(e) => set('comingSoon', e.target.checked ? [...draft.comingSoon, f] : draft.comingSoon.filter((x) => x !== f))}
              />
              {f}
            </label>
          ))}
          {errors.comingSoon && <p className="field-error">{errors.comingSoon}</p>}
        </fieldset>
        <label className="check-row">
          <input type="checkbox" checked={draft.popular} onChange={(e) => set('popular', e.target.checked)} /> Show "Most popular" badge
        </label>
        <label className="check-row">
          <input type="checkbox" checked={draft.isActive} onChange={(e) => set('isActive', e.target.checked)} /> Visible to studios
        </label>
      </form>
    </Modal>
  )
}

const limitText = (v: number | null, unit = '') => (v === null ? 'Unlimited' : `${formatNumber(v)}${unit}`)

/** Platform admin: prices, limits and features of the subscription plans. */
export default function AdminPlans() {
  const [url, setUrl] = useUrlState({ edit: '' })
  const q = useQuery({ queryKey: PLANS_KEY, queryFn: () => api.get<AdminPlanDto[]>('/admin/plans') })
  const editing = q.data?.find((p) => p.code === url.edit)

  return (
    <div className="stack">
      <PageHeader title="Plans" subtitle="Prices, limits and features studios see on the pricing pages." />
      {q.isPending ? (
        <CardSkeleton rows={6} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="grid grid-2">
          {q.data.map((p) => (
            <Card
              key={p.code}
              title={
                <span className="admin-plan-title">
                  {p.name} {p.popular && <StatusPill status="Most popular" />} {!p.isActive && <StatusPill status="Hidden" />}
                </span>
              }
              subtitle={p.tagline}
              action={
                <button className="btn btn-sm btn-ghost" onClick={() => setUrl({ edit: p.code })} aria-label={`Edit ${p.name}`}>
                  <i className="bi bi-pencil" /> Edit
                </button>
              }
            >
              <p className="admin-plan-price">
                {p.monthlyPricePaise !== null && (
                  <>
                    <strong>{formatMoney(p.monthlyPricePaise)}</strong> / month ·{' '}
                  </>
                )}
                <strong>{formatMoney(p.yearlyPricePaise)}</strong> / year
              </p>
              {/* Each limit once: feature lines that only restate a limit are folded into it. */}
              <ul className="admin-plan-limits">
                {(
                  [
                    ['eventsPerMonth', 'Events / month', limitText(p.limits.eventsPerMonth)],
                    ['albums', 'Albums', limitText(p.limits.albums)],
                    ['storageGb', 'Storage', storageText(p.limits.storageGb)],
                    ['teamSeats', 'Team seats', formatNumber(p.limits.teamSeats)],
                    ['includedCredits', 'WhatsApp credits included', formatNumber(p.limits.includedCredits)],
                  ] as const
                ).map(([key, label, value]) => (
                  <li key={key}>
                    {label}: {value}
                    {p.comingSoon.some((f) => limitFeature(f) === key) && <ComingSoonTag />}
                  </li>
                ))}
              </ul>
              <ul className="checklist">
                {p.features.filter((f) => !limitFeature(f)).map((f) => (
                  <li key={f} className={p.comingSoon.includes(f) ? 'is-coming-soon' : ''}>
                    {p.comingSoon.includes(f) ? <i className="bi bi-clock" /> : <i className="bi bi-check-circle-fill" />}
                    <span>{f}</span>
                    {p.comingSoon.includes(f) && <ComingSoonTag />}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      {editing && <PlanEditor key={editing.code} plan={editing} onClose={() => setUrl({ edit: '' })} />}
    </div>
  )
}
