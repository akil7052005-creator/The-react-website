import { useMutation, useQueryClient } from '@tanstack/react-query'
import { loginSchema, type MeDto } from '@weddyzone/shared'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ME_KEY, useMeQuery } from '../../auth/AuthProvider'
import { applyApiErrors, SubmitButton, TextField, useZodForm } from '../../components/form/form'
import { PageSkeleton, Spinner } from '../../components/ui'
import { api, isApiError } from '../../lib/api'
import { toastError } from '../../lib/query'
import { AuthLayout, PasswordField } from './AuthLayout'

/**
 * Where to go after logging in: a same-site `?next=` path, otherwise home. Platform admins only
 * ever land in /admin (their home), studio users never do.
 */
function safeNext(params: URLSearchParams, admin = false) {
  const next = params.get('next')
  const ok = next && next.startsWith('/') && !next.startsWith('//')
  const inAdmin = ok && (next === '/admin' || next.startsWith('/admin/'))
  if (admin) return inAdmin ? next : '/admin'
  return ok && !inAdmin ? next : '/'
}

export default function Login() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const me = useMeQuery()
  const form = useZodForm(loginSchema, { defaultValues: { email: '', password: '', otp: '' } })
  // Shown once the API says this account uses two-factor sign-in.
  const [needsOtp, setNeedsOtp] = useState(false)

  const login = useMutation({
    mutationFn: (body: object) => api.post<MeDto>('/auth/login', body),
    onSuccess: (data) => {
      qc.setQueryData(ME_KEY, data)
      toast.success(`Welcome back, ${data.user.name.split(' ')[0]}!`)
      navigate(safeNext(params, data.user.role === 'SUPER_ADMIN'), { replace: true })
    },
    onError: (e) => {
      if (isApiError(e) && e.code === 'OTP_REQUIRED') setNeedsOtp(true)
      applyApiErrors(form, e)
    },
  })

  // "Log in with a different account": end this session, drop everything cached for it, then the
  // session check runs again (now logged out) and the form appears.
  const switchAccount = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSuccess: async () => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] })
      await qc.resetQueries({ queryKey: ME_KEY })
    },
    onError: (e) => toastError(e),
  })

  if (me.isPending || login.isSuccess) return <PageSkeleton />

  const isAdmin = me.data?.user.role === 'SUPER_ADMIN'
  const signedIn = me.data?.studio || isAdmin ? me.data : null
  if (signedIn) {
    return (
      <AuthLayout title="You're already logged in" subtitle="Continue to your studio, or switch to another account.">
        <div className="notice success" role="status" data-testid="signed-in-notice">
          <i className="bi bi-person-check" />
          <span>
            You're logged in as <strong>{signedIn.user.name}</strong> ({signedIn.user.email})
          </span>
        </div>
        <div className="stack" style={{ gap: 10, marginTop: 18 }}>
          <Link to={safeNext(params, isAdmin)} replace className="btn btn-primary btn-block btn-lg">
            <i className={`bi bi-${isAdmin ? 'shield-lock' : 'grid-1x2'}`} /> {isAdmin ? 'Go to admin panel' : 'Go to dashboard'}
          </Link>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => switchAccount.mutate()} disabled={switchAccount.isPending}>
            {switchAccount.isPending ? <Spinner size={14} /> : <i className="bi bi-arrow-left-right" />} Log in with a different account
          </button>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to your studio."
      footer={
        <>
          New here?{' '}
          <Link to="/signup" className="link">
            Start free trial
          </Link>
        </>
      }
    >
      <form method="post" onSubmit={form.handleSubmit((v) => login.mutate(v))} noValidate>
        <TextField form={form} name="email" label="Email or mobile number" type="text" inputMode="email" autoComplete="username" required placeholder="you@studio.com or 98765 43210" />
        <PasswordField form={form} name="password" label="Password" autoComplete="current-password" />
        {needsOtp && (
          <TextField form={form} name="otp" label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required placeholder="6-digit code" autoFocus />
        )}
        <div className="auth-inline">
          <Link to="/forgot-password" className="link">
            Forgot password?
          </Link>
        </div>
        <SubmitButton busy={login.isPending} className="btn btn-primary btn-block btn-lg">
          {login.isPending ? 'Logging in…' : 'Log in →'}
        </SubmitButton>
      </form>
    </AuthLayout>
  )
}
