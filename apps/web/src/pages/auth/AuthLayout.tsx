import { useState, type ReactNode } from 'react'
import type { FieldPath, FieldValues, UseFormReturn } from 'react-hook-form'
import { Link } from 'react-router-dom'
import heroJpg from '../../assets/login-hero.jpg'
import heroWebp from '../../assets/login-hero.webp'
import { FieldShell } from '../../components/form/form'
import { APP_NAME } from '../../lib/brand'

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="auth-shell">
      {/* Photo panel on the left; on phones the same panel becomes a 180px banner above the form. */}
      <aside className="auth-panel">
        <picture className="auth-photo">
          <source srcSet={heroWebp} type="image/webp" />
          <img
            src={heroJpg}
            alt="Bride and groom holding hands with a rose garland"
            width={504}
            height={504}
            loading="eager"
            fetchPriority="high"
          />
        </picture>
        <Link to="/" className="brand">
          <span className="brand-mark">W</span>
          <div className="brand-info">
            <span className="brand-name">{APP_NAME}</span>
            <span className="brand-sub">Studio</span>
          </div>
        </Link>
        <div className="auth-panel-copy">
          <h2>
            The couple picks. <em>You deliver.</em>
          </h2>
          <p>Upload a wedding, share it on WhatsApp and get the couple's photo picks back.</p>
          <ul className="checklist auth-features">
            <li>
              <i className="bi bi-check-circle-fill" /> Originals stay on your computer
            </li>
            <li>
              <i className="bi bi-check-circle-fill" /> Couples pick on their phone, no app needed
            </li>
            <li>
              <i className="bi bi-check-circle-fill" /> Copy the selected originals in one click
            </li>
          </ul>
          <p className="auth-panel-foot">© {new Date().getFullYear()} {APP_NAME}</p>
        </div>
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
