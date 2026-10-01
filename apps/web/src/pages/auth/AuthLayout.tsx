import { useState, type ReactNode } from 'react'
import type { FieldPath, FieldValues, UseFormReturn } from 'react-hook-form'
import { Link } from 'react-router-dom'
import poster from '../../assets/wedding-photo.jpg'
import { FieldShell } from '../../components/form/form'

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="auth-shell">
      <aside className="auth-panel">
        <img src={poster} alt="" aria-hidden="true" />
        <Link to="/" className="brand">
          <span className="brand-mark">W</span>
          <div className="brand-info">
            <span className="brand-name">Weddyzone</span>
            <span className="brand-sub">Studio OS</span>
          </div>
        </Link>
        <div>
          <h2>
            Every wedding, <em>beautifully</em> organised.
          </h2>
          <p>Client selections, flipbook albums, GST invoices and your portfolio website — in one studio workspace.</p>
          <ul className="checklist" style={{ marginTop: 18 }}>
            <li>
              <i className="bi bi-check-circle-fill" /> Private selection links with quota lock
            </li>
            <li>
              <i className="bi bi-check-circle-fill" /> Flipbook albums with client feedback
            </li>
            <li>
              <i className="bi bi-check-circle-fill" /> GST-ready invoices with CGST/SGST/IGST
            </li>
          </ul>
        </div>
        <p className="muted" style={{ color: 'rgba(255,255,255,0.6)' }}>
          © {new Date().getFullYear()} Weddyzone Studio
        </p>
      </aside>
      <main className="auth-main">
        <section className="card auth-card">
          <div className="card-body">
            <h1>{title}</h1>
            <p className="auth-sub">{subtitle}</p>
            {children}
            {footer && <div className="auth-foot">{footer}</div>}
          </div>
        </section>
      </main>
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyForm<T extends FieldValues> = UseFormReturn<T, any, any>

export function PasswordField<T extends FieldValues>({
  form,
  name,
  label,
  autoComplete,
  hint,
}: {
  form: AnyForm<T>
  name: FieldPath<T>
  label: string
  autoComplete: string
  hint?: ReactNode
}) {
  const [show, setShow] = useState(false)
  const id = `f-${name}`
  const error = (form.formState.errors[name]?.message as string | undefined) ?? undefined
  return (
    <FieldShell label={label} htmlFor={id} required error={error} hint={hint}>
      <div className="password-wrap">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          {...form.register(name)}
        />
        <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
          <i className={`bi bi-${show ? 'eye-slash' : 'eye'}`} />
        </button>
      </div>
    </FieldShell>
  )
}
