import { useMutation, useQueryClient } from '@tanstack/react-query'
import { signupSchema, type BillingCycle, type MeDto } from '@weddyzone/shared'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ME_KEY } from '../../auth/AuthProvider'
import { applyApiErrors, SubmitButton, TextField, useZodForm } from '../../components/form/form'
import { api, isApiError } from '../../lib/api'
import { PasswordField } from './AuthLayout'

/** The plan picked in Plans & Pricing (a pill on the form); paid plans continue to checkout after sign-up. */
export interface ChosenPlan {
  code: string
  name: string
  cycle: BillingCycle
  cycleLabel?: string
}

/**
 * The sign-up form (the public site's Start free trial panel; /signup opens it). Every studio
 * starts on the trial; a chosen Pro or VIP plan goes on to My Subscription to pay for it.
 */
export function SignupForm({ plan, onLogin }: { plan: ChosenPlan | null; onLogin: () => void }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [failure, setFailure] = useState<string | null>(null)
  const form = useZodForm(signupSchema, {
    defaultValues: {
      studioName: '',
      ownerName: '',
      email: '',
      phone: '',
      password: '',
      referralCode: params.get('ref') ?? '',
    },
  })

  const signup = useMutation({
    mutationFn: (body: object) => api.post<MeDto>('/auth/signup', body),
    onMutate: () => setFailure(null),
    onSuccess: (me) => {
      qc.setQueryData(ME_KEY, me)
      toast.success(`Welcome to Wedmanage, ${me.user.name.split(' ')[0]}! Your 14-day free trial has begun.`)
      const paid = plan && (plan.code === 'PRO' || plan.code === 'ALL_ACCESS')
      navigate(paid ? `/subscriptions?renew=${plan.code}&cycle=${plan.cycle}` : '/', { replace: true })
    },
    onError: (e) => {
      if (!applyApiErrors(form, e, { toast: false })) setFailure(isApiError(e) ? e.message : 'Something went wrong. Please try again.')
    },
  })

  return (
    <form method="post" onSubmit={form.handleSubmit((v) => signup.mutate(v))} noValidate>
      <p className="pub-plan-pill" data-testid="signup-plan">
        <i className="bi bi-stars" aria-hidden="true" /> Plan: <strong>{plan ? plan.name : 'Trial'}</strong>
        {plan?.cycleLabel ? ` · ${plan.cycleLabel}` : ''}
      </p>
      {failure && (
        <div className="notice danger" role="alert" style={{ marginBottom: 12 }}>
          <i className="bi bi-exclamation-triangle" />
          <span>{failure}</span>
        </div>
      )}
      <TextField form={form} name="ownerName" label="Your name" required autoComplete="name" placeholder="Arjun Mehta" maxLength={80} />
      <TextField form={form} name="studioName" label="Studio name" required autoComplete="organization" placeholder="Golden Hour Studios" maxLength={80} />
      <TextField form={form} name="phone" label="Mobile number" type="tel" required autoComplete="tel" placeholder="98765 43210" hint="Used for WhatsApp messages" />
      <TextField form={form} name="email" label="Email" type="email" required autoComplete="email" placeholder="you@studio.com" />
      <PasswordField form={form} name="password" label="Password" autoComplete="new-password" hint="At least 8 characters, with a letter and a number" />
      <SubmitButton busy={signup.isPending} className="pub-btn block">
        Start free trial →
      </SubmitButton>
      <p className="pub-panel-foot">
        Already have an account?{' '}
        <button type="button" className="pub-link" onClick={onLogin}>
          Log in
        </button>
      </p>
    </form>
  )
}
