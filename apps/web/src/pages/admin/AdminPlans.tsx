import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CYCLE_LABELS, PRICING_CYCLES, resolveUploadLimits, STARTER_UPLOAD_LIMITS, type AdminPlanDto, type BillingCycle, type PlanLimits } from '@weddyzone/shared'
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

/**
 * Limits that may be "unlimited" (blank field = null). `optional` ones (photo uploads) may be left
 * blank to use the Starter value instead.
 */
type NumericLimit = Exclude<keyof PlanLimits, 'favourites'>
const LIMIT_FIELDS: { key: NumericLimit; label: string; unit?: string; unlimited: boolean; optional?: boolean }[] = [
  { key: 'eventsPerMonth', label: 'New customer events per month', unlimited: true },
  { key: 'eventsTotal', label: 'Customer events in total (trial)', unlimited: true, optional: true },
  { key: 'fairUseEventsPerMonth', label: 'Fair-use events per month', unlimited: true, optional: true },
  { key: 'photosPerEvent', label: 'Photos per event', unlimited: true, optional: true },
  { key: 'uploadGbPerMonth', label: 'Uploads per month', unit: 'GB, original size', unlimited: true, optional: true },
  { key: 'uploadGbTotal', label: 'Uploads in total (trial)', unit: 'GB', unlimited: true, optional: true },
  { key: 'trialDays', label: 'Trial length', unit: 'days', unlimited: true, optional: true },
  { key: 'galleryDays', label: 'Customer gallery open at most', unit: 'days', unlimited: true, optional: true },
  { key: 'addonEvents', label: 'Events in the add-on', unlimited: true, optional: true },
  { key: 'addonEventsPricePaise', label: 'Add-on price', unit: 'paise', unlimited: true, optional: true },
  { key: 'albums', label: 'Digital albums', unlimited: true },
  { key: 'storageGb', label: 'Storage', unit: 'GB', unlimited: true },
  { key: 'teamSeats', label: 'Team seats', unlimited: false },
  { key: 'includedCredits', label: 'WhatsApp credits included', unlimited: false },
  { key: 'maxPhotoMb', label: 'Largest photo', unit: 'MB', unlimited: false, optional: true },
  { key: 'maxFilesPerUpload', label: 'Photos per upload', unlimited: false, optional: true },
  { key: 'uploadConcurrency', label: 'Uploads at a time', unlimited: false, optional: true },
]

interface Draft {
  name: string
  tagline: string
  prices: Record<BillingCycle, string>
  limits: Record<NumericLimit, string>
  favourites: boolean
  features: string
  comingSoon: string[]
  popular: boolean
  isActive: boolean
}

const toDraft = (p: AdminPlanDto): Draft => ({
  name: p.name,
  tagline: p.tagline,
  prices: Object.fromEntries(PRICING_CYCLES.map((c) => [c, p.prices?.[c] ? String(p.prices[c]! / 100) : ''])) as Draft['prices'],
  favourites: p.limits.favourites === true,
  limits: Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, p.limits[f.key] === null || p.limits[f.key] === undefined ? '' : String(p.limits[f.key])])) as Draft['limits'],
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
      // Each billing period's price; empty = not sold for that period.
      prices: Object.fromEntries(PRICING_CYCLES.map((c) => [c, num(draft.prices[c])])),
      monthlyPrice: num(draft.prices.MONTHLY),
      yearlyPrice: num(draft.prices.YEARLY),
      limits: {
        // A blank upload setting is left out (the default applies); other blanks mean none / unlimited.
        ...Object.fromEntries(LIMIT_FIELDS.filter((f) => f.unlimited || draft.limits[f.key].trim() !== '').map((f) => [f.key, num(draft.limits[f.key])])),
        favourites: draft.favourites,
      },
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
        {PRICING_CYCLES.map((c) =>
          field(
            `p-price-${c}`,
            `Price for ${CYCLE_LABELS[c]} (₹)`,
            errors[`prices.${c}`],
            <input id={`p-price-${c}`} inputMode="decimal" value={draft.prices[c]} placeholder="Not sold" onChange={(e) => set('prices', { ...draft.prices, [c]: e.target.value })} />,
            'Leave empty if the plan is not sold for this period',
          ),
        )}
        <label className="check-row full">
          <input type="checkbox" checked={draft.favourites} onChange={(e) => set('favourites', e.target.checked)} /> Customer favourites (tick picks, heart favourites)
        </label>
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
            f.unlimited ? 'Leave empty for none / unlimited' : f.optional ? `Leave empty for the default (${STARTER_UPLOAD_LIMITS[f.key as keyof typeof STARTER_UPLOAD_LIMITS]})` : undefined,
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
              <p className="muted" style={{ margin: '0 0 12px', fontSize: 13.5 }}>
                Uploads: up to {resolveUploadLimits(p.limits).maxPhotoMb} MB per photo · {formatNumber(resolveUploadLimits(p.limits).maxFilesPerUpload)} per upload · {resolveUploadLimits(p.limits).uploadConcurrency} at a time
              </p>
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
