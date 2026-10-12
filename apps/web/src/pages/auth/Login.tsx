import { useMutation, useQueryClient } from '@tanstack/react-query'
import { loginSchema, type MeDto } from '@weddyzone/shared'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ME_KEY, useMeQuery } from '../../auth/AuthProvider'
import { applyApiErrors, SubmitButton, TextField, useZodForm } from '../../components/form/form'
import { Spinner } from '../../components/ui'
import { api, isApiError } from '../../lib/api'
import { toastError } from '../../lib/query'
import { PasswordField } from './AuthLayout'

/**
 * Where to go after logging in: a same-site `?next=` path, otherwise home. Platform admins only
 * ever land in /admin (their home), studio users never do.
 */
export function safeNext(params: URLSearchParams, admin = false) {
  const next = params.get('next')
  const ok = next && next.startsWith('/') && !next.startsWith('//')
  const inAdmin = ok && (next === '/admin' || next.startsWith('/admin/'))
  if (admin) return inAdmin ? next : '/admin'
  return ok && !inAdmin ? next : '/'
}

/**
 * The login form (the public site's Login panel; /login opens it). Already logged in, it says who
 * instead, with Go to dashboard and Log out. Success goes to `?next=` or the dashboard.
 */
export function LoginForm({ onForgot, onSignup }: { onForgot: () => void; onSignup: () => void }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const me = useMeQuery({ cached: true })
  const form = useZodForm(loginSchema, { defaultValues: { email: '', password: '', otp: '' } })
  // Shown once the API says this account uses two-factor sign-in.
  const [needsOtp, setNeedsOtp] = useState(false)
  // Errors that belong to no field (too many attempts, offline…) show in the panel, not as a toast.
  const [failure, setFailure] = useState<string | null>(null)

  const login = useMutation({
    mutationFn: (body: object) => api.post<MeDto>('/auth/login', body),
    onSuccess: (data) => {
      qc.setQueryData(ME_KEY, data)
      toast.success(`Welcome back, ${data.user.name.split(' ')[0]}!`)
      navigate(safeNext(params, data.user.role === 'SUPER_ADMIN'), { replace: true })
    },
    onMutate: () => setFailure(null),
    onError: (e) => {
      if (isApiError(e) && e.code === 'OTP_REQUIRED') setNeedsOtp(true)
      if (!applyApiErrors(form, e, { toast: false })) setFailure(isApiError(e) ? e.message : 'Something went wrong. Please try again.')
    },
  })

  // Log out: end this session, drop everything cached for it, then the session check runs again
  // (now logged out) and the form appears.
  const logout = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSuccess: async () => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] })
      await qc.resetQueries({ queryKey: ME_KEY })
    },
    onError: (e) => toastError(e),
  })

  if (me.isPending || login.isSuccess) {
    return (
      <div className="pub-panel-wait">
        <Spinner size={20} />
      </div>
    )
  }

  const isAdmin = me.data?.user.role === 'SUPER_ADMIN'
  const signedIn = me.data?.studio || isAdmin ? me.data : null
  if (signedIn) {
    return (
      <div className="stack" style={{ gap: 10 }}>
        <div className="notice success" role="status" data-testid="signed-in-notice">
          <i className="bi bi-person-check" />
          <span>
            You're logged in as <strong>{signedIn.user.name}</strong> ({signedIn.user.email})
          </span>
        </div>
        <Link to={safeNext(params, isAdmin)} replace className="pub-btn block">
          {isAdmin ? 'Go to admin panel' : 'Go to dashboard'}
        </Link>
        <button type="button" className="pub-btn block ghost" onClick={() => logout.mutate()} disabled={logout.isPending}>
          {logout.isPending && <Spinner size={14} />} Log out
        </button>
      </div>
    )
  }

  return (
    <form method="post" onSubmit={form.handleSubmit((v) => login.mutate(v))} noValidate>
      {failure && (
        <div className="notice danger" role="alert" style={{ marginBottom: 12 }}>
          <i className="bi bi-exclamation-triangle" />
          <span>{failure}</span>
        </div>
      )}
      <TextField form={form} name="email" label="Email or mobile number" type="text" inputMode="email" autoComplete="username" required placeholder="you@studio.com or 98765 43210" />
      <PasswordField form={form} name="password" label="Password" autoComplete="current-password" />
      {needsOtp && <TextField form={form} name="otp" label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required placeholder="6-digit code" autoFocus />}
      <div className="auth-inline">
        <button type="button" className="pub-link" onClick={onForgot}>
          Forgot password?
        </button>
      </div>
      <SubmitButton busy={login.isPending} className="pub-btn block">
        {login.isPending ? 'Logging in…' : 'Log in →'}
      </SubmitButton>
      <p className="pub-panel-foot">
        New here?{' '}
        <button type="button" className="pub-link" onClick={onSignup}>
          Start free trial
        </button>
      </p>
    </form>
  )
}
