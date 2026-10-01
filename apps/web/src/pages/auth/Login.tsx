import { useMutation, useQueryClient } from '@tanstack/react-query'
import { loginSchema, type MeDto } from '@weddyzone/shared'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ME_KEY } from '../../auth/AuthProvider'
import { applyApiErrors, SubmitButton, TextField, useZodForm } from '../../components/form/form'
import { api } from '../../lib/api'
import { AuthLayout, PasswordField } from './AuthLayout'

export default function Login() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const form = useZodForm(loginSchema, { defaultValues: { email: '', password: '' } })

  const login = useMutation({
    mutationFn: (body: object) => api.post<MeDto>('/auth/login', body),
    onSuccess: (me) => {
      qc.setQueryData(ME_KEY, me)
      toast.success(`Welcome back, ${me.user.name.split(' ')[0]}!`)
      const next = params.get('next')
      navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true })
    },
    onError: (e) => applyApiErrors(form, e),
  })

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to manage your weddings, galleries and invoices."
      footer={
        <>
          New to Weddyzone? <Link to="/signup" className="link">Create a studio account</Link>
        </>
      }
    >
      {params.get('admin') && (
        <p className="notice warning" style={{ marginBottom: 14 }}>
          <i className="bi bi-info-circle" /> Platform admin accounts use the admin API; log in with a studio account here.
        </p>
      )}
      <form method="post" onSubmit={form.handleSubmit((v) => login.mutate(v))} noValidate>
        <TextField form={form} name="email" label="Email" type="email" autoComplete="email" required placeholder="you@studio.com" />
        <PasswordField form={form} name="password" label="Password" autoComplete="current-password" />
        <div className="auth-inline">
          <Link to="/forgot-password" className="link">
            Forgot password?
          </Link>
        </div>
        <SubmitButton busy={login.isPending} className="btn btn-primary btn-block btn-lg" icon="box-arrow-in-right">
          Log in
        </SubmitButton>
      </form>
    </AuthLayout>
  )
}
