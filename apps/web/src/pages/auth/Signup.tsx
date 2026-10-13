import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CYCLE_LABELS, cycleSavingPct, PRICING_CYCLES, signupSchema, type BillingCycle, type MeDto } from '@weddyzone/shared'
import { useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ME_KEY } from '../../auth/AuthProvider'
import { applyApiErrors, SubmitButton, TextField, useZodForm } from '../../components/form/form'
import { api, isApiError } from '../../lib/api'
import { priceFor, usePlans } from '../../lib/billing'
import { formatMoney } from '../../utils/format'
import { PasswordField } from './AuthLayout'

/** The plan picked for a new studio: null = Trial; Pro/VIP go on to payment after sign-up. */
export type SignupPlan = { code: 'PRO' | 'ALL_ACCESS'; cycle: BillingCycle } | null

const PAID = ['PRO', 'ALL_ACCESS'] as const
const isPaid = (code: string | null): code is (typeof PAID)[number] => (PAID as readonly string[]).includes(code ?? '')

/** A /signup?plan=PRO&months=6 link's plan (only periods on sale; anything else is Trial / 1 month). */
export function planFromParams(params: URLSearchParams): SignupPlan {
  const code = params.get('plan')
  const months: Record<string, BillingCycle> = { '1': 'MONTHLY', '6': 'HALF_YEARLY', '12': 'YEARLY' }
  return isPaid(code) ? { code, cycle: months[params.get('months') ?? ''] ?? 'MONTHLY' } : null
}

/**
 * Create your studio (the home page card; /signup focuses it). Every studio starts on the trial;
 * with Pro or VIP picked it goes on to My Subscription to pay for that plan.
 */
export function SignupForm({ plan, onPlanChange }: { plan: SignupPlan; onPlanChange: (p: SignupPlan) => void }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const plans = usePlans()
  const [failure, setFailure] = useState<string | null>(null)
  // "… is required" shows only after Create studio, or on leaving a field the user typed in
  // (not on page load or from just clicking through the fields).
  const typed = useRef(new Set<string>())
  const form = useZodForm(signupSchema, {
    mode: 'onSubmit',
    defaultValues: {
      studioName: '',
      ownerName: '',
      email: '',
      phone: '',
      password: '',
      // Referral links (/signup?ref=CODE) still apply the code; the field itself isn't shown.
      referralCode: params.get('ref') ?? '',
    },
  })

  const signup = useMutation({
    mutationFn: (body: object) => api.post<MeDto>('/auth/signup', body),
    onMutate: () => setFailure(null),
    onSuccess: (me) => {
      qc.setQueryData(ME_KEY, me)
      toast.success(`Welcome to Wedmanage, ${me.user.name.split(' ')[0]}! Your 14-day free trial has begun.`)
      navigate(plan ? `/subscriptions?renew=${plan.code}&cycle=${plan.cycle}` : '/', { replace: true })
    },
    onError: (e) => {
      if (!applyApiErrors(form, e, { toast: false })) setFailure(isApiError(e) ? e.message : 'Something went wrong. Please try again.')
    },
  })

  const planRow = plan ? plans.data?.find((p) => p.code === plan.code) : undefined
  const price = planRow && plan ? priceFor(planRow, plan.cycle) : null
  const save = planRow && plan ? cycleSavingPct(planRow.prices, plan.cycle) : null
  const nameOf = (code: string, fallback: string) => plans.data?.find((p) => p.code === code)?.name ?? fallback

  return (
    <form
      method="post"
      onSubmit={form.handleSubmit((v) => signup.mutate(v))}
      noValidate
      className="pub-signup-form"
      onChange={(e) => {
        const name = (e.target as HTMLInputElement).name as keyof typeof form.formState.errors
        if (!name) return
        typed.current.add(name)
        if (form.getFieldState(name).error) void form.trigger(name)
      }}
      onBlur={(e) => {
        const name = (e.target as HTMLInputElement).name as keyof typeof form.formState.errors
        if (name && typed.current.has(name)) void form.trigger(name)
      }}
    >
      <div className="pub-plan-switch" role="radiogroup" aria-label="Plan" data-testid="signup-plan">
        {(
          [
            [null, 'Trial'],
            ['PRO', nameOf('PRO', 'Pro')],
            ['ALL_ACCESS', nameOf('ALL_ACCESS', 'VIP')],
          ] as const
        ).map(([code, label]) => {
          const on = (plan?.code ?? null) === code
          return (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={on}
              className={on ? 'on' : ''}
              onClick={() => onPlanChange(code ? { code, cycle: plan?.cycle ?? 'MONTHLY' } : null)}
            >
              {label}
            </button>
          )
        })}
      </div>
      {plan && (
        <div className="pub-plan-period">
          <label htmlFor="su-period">Billing period</label>
          <select id="su-period" value={plan.cycle} onChange={(e) => onPlanChange({ ...plan, cycle: e.target.value as BillingCycle })}>
            {PRICING_CYCLES.map((c) => (
              <option key={c} value={c}>
                {CYCLE_LABELS[c]}
              </option>
            ))}
          </select>
          {price !== null && (
            <span className="pub-plan-price">
              {formatMoney(price)} + GST{save ? <span className="pub-save">Save {save}%</span> : null}
            </span>
          )}
        </div>
      )}
      {failure && (
        <div className="notice danger" role="alert" style={{ marginBottom: 10 }}>
          <i className="bi bi-exclamation-triangle" />
          <span>{failure}</span>
        </div>
      )}
      {/* The labels stay for screen readers; the card shows the same words as placeholders. */}
      <TextField form={form} idPrefix="su" name="ownerName" label="Your name" required autoComplete="name" placeholder="Your name" maxLength={80} />
      <TextField form={form} idPrefix="su" name="studioName" label="Studio name" required autoComplete="organization" placeholder="Studio name" maxLength={80} />
      <TextField form={form} idPrefix="su" name="phone" label="Phone number (+91)" type="tel" required autoComplete="tel" placeholder="Phone number (+91)" />
      <TextField form={form} idPrefix="su" name="email" label="Email" type="email" required autoComplete="email" placeholder="Email" />
      <PasswordField form={form} idPrefix="su" name="password" label="Password" autoComplete="new-password" placeholder="Password (min 8 characters)" />
      <SubmitButton busy={signup.isPending} className="pub-btn block">
        Create studio →
      </SubmitButton>
      {!plan && <p className="pub-signup-note">14-day free trial · no card needed</p>}
    </form>
  )
}
