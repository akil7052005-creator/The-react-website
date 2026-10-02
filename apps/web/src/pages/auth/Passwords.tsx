import { useMutation } from '@tanstack/react-query'
import { forgotPasswordSchema, resetPasswordSchema } from '@weddyzone/shared'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { applyApiErrors, SubmitButton, TextField, useZodForm } from '../../components/form/form'
import { api, isApiError } from '../../lib/api'
import { AuthLayout, PasswordField } from './AuthLayout'

export function ForgotPassword() {
  const [sentTo, setSentTo] = useState<string | null>(null)
  // Shown on the page (not just a toast) so a failed send is impossible to miss.
  const [failure, setFailure] = useState<string | null>(null)
  const form = useZodForm(forgotPasswordSchema, { defaultValues: { email: '' } })
  const send = useMutation({
    mutationFn: (body: { email: string }) => api.post('/auth/forgot-password', body),
    onMutate: () => setFailure(null),
    onSuccess: (_d, v) => setSentTo(v.email),
    onError: (e) => {
      if (applyApiErrors(form, e, { toast: false })) return
      setFailure(isApiError(e) ? e.message : 'Something went wrong. Please try again.')
    },
  })

  return (
    <AuthLayout
      title="Forgot your password?"
      subtitle="Enter your account email and we'll send you a reset link."
      footer={
        <Link to="/login" className="link">
          <i className="bi bi-arrow-left" /> Back to login
        </Link>
      }
    >
      {sentTo ? (
        <div className="notice success" role="status">
          <i className="bi bi-envelope-check" />
          <span>
            If an account exists for <strong>{sentTo}</strong>, a reset link is on its way. The link is valid for 1 hour.
          </span>
        </div>
      ) : (
        <form method="post" onSubmit={form.handleSubmit((v) => send.mutate(v))} noValidate>
          {failure && (
            <div className="notice danger" role="alert" style={{ marginBottom: 16 }}>
              <i className="bi bi-exclamation-triangle" />
              <span>{failure}</span>
            </div>
          )}
          <TextField form={form} name="email" label="Email" type="email" required autoComplete="email" />
          <SubmitButton busy={send.isPending} className="btn btn-primary btn-block btn-lg" icon="send">
            Send reset link
          </SubmitButton>
        </form>
      )}
    </AuthLayout>
  )
}

export function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''
  const form = useZodForm(resetPasswordSchema, { defaultValues: { token, password: '', confirmPassword: '' } })
  const tokenError = form.formState.errors.token?.message

  const reset = useMutation({
    mutationFn: (body: object) => api.post('/auth/reset-password', body),
    onSuccess: () => {
      toast.success('Password updated. Please log in with your new password.')
      navigate('/login', { replace: true })
    },
    onError: (e) => applyApiErrors(form, e),
  })

  return (
    <AuthLayout
      title="Set a new password"
      subtitle="Choose a strong password you haven't used before."
      footer={
        <Link to="/forgot-password" className="link">
          Need a new link?
        </Link>
      }
    >
      {!token || tokenError ? (
        <div className="notice danger" role="alert" style={{ marginBottom: 14 }}>
          <i className="bi bi-exclamation-triangle" />
          <span>{tokenError ?? 'This reset link is missing its token.'} Request a new link to continue.</span>
        </div>
      ) : null}
      <form method="post" onSubmit={form.handleSubmit((v) => reset.mutate(v))} noValidate>
        <input type="hidden" {...form.register('token')} />
        <PasswordField form={form} name="password" label="New password" autoComplete="new-password" hint="At least 8 characters, with a letter and a number" />
        <PasswordField form={form} name="confirmPassword" label="Confirm new password" autoComplete="new-password" />
        <SubmitButton busy={reset.isPending} disabled={!token} className="btn btn-primary btn-block btn-lg" icon="shield-lock">
          Update password
        </SubmitButton>
      </form>
    </AuthLayout>
  )
}
