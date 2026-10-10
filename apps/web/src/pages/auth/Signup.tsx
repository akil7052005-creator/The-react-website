import { useMutation, useQueryClient } from '@tanstack/react-query'
import { signupSchema, type MeDto } from '@weddyzone/shared'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ME_KEY } from '../../auth/AuthProvider'
import { applyApiErrors, SubmitButton, TextField, useZodForm } from '../../components/form/form'
import { api } from '../../lib/api'
import { AuthLayout, PasswordField } from './AuthLayout'

export default function Signup() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
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
    onSuccess: (me) => {
      qc.setQueryData(ME_KEY, me)
      toast.success(`Welcome to Wedmanage, ${me.user.name.split(' ')[0]}! Your 14-day free trial has begun.`)
      const plan = params.get('plan')
      const months: Record<string, string> = { '1': 'MONTHLY', '3': 'QUARTERLY', '6': 'HALF_YEARLY', '12': 'YEARLY' }
      const cycle = months[params.get('months') ?? ''] ?? 'MONTHLY'
      navigate(plan === 'PRO' || plan === 'ALL_ACCESS' ? `/subscriptions?renew=${plan}&cycle=${cycle}` : '/', { replace: true })
    },
    onError: (e) => applyApiErrors(form, e),
  })

  return (
    <AuthLayout
      title="Create your studio"
      subtitle="Start your free 14-day trial. No card needed."
      footer={
        <>
          Already have an account? <Link to="/login" className="link">Log in</Link>
        </>
      }
    >
      <form method="post" onSubmit={form.handleSubmit((v) => signup.mutate(v))} noValidate>
        <TextField form={form} name="studioName" label="Studio name" required autoComplete="organization" placeholder="Golden Hour Studios" maxLength={80} />
        <TextField form={form} name="ownerName" label="Your name" required autoComplete="name" placeholder="Arjun Mehta" maxLength={80} />
        <TextField form={form} name="email" label="Email" type="email" required autoComplete="email" placeholder="you@studio.com" />
        <TextField form={form} name="phone" label="Mobile number" type="tel" required autoComplete="tel" placeholder="98765 43210" hint="Indian mobile number — used for WhatsApp messages" />
        <PasswordField form={form} name="password" label="Password" autoComplete="new-password" hint="At least 8 characters, with a letter and a number" />
        <TextField form={form} name="referralCode" label="Referral code (optional)" placeholder="e.g. GOLDEN25" autoComplete="off" style={{ textTransform: 'uppercase' }} />
        <SubmitButton busy={signup.isPending} className="btn btn-primary btn-block btn-lg">
          Start free trial →
        </SubmitButton>
      </form>
    </AuthLayout>
  )
}
