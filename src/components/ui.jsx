// Small reusable building blocks. Every page is assembled from these,
// so the whole app keeps one consistent look.
import { statusTone, initials } from '../utils/format'

export function PageHeader({ eyebrow, title, subtitle, actions }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function Card({ title, subtitle, action, children, className = '', flush = false }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="card-head">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-subtitle">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={flush ? 'card-body flush' : 'card-body'}>{children}</div>
    </section>
  )
}

export function StatCard({ icon, label, value, trend, tone = 'wine' }) {
  return (
    <div className="stat-card">
      <span className={`stat-icon tone-${tone}`}>
        <i className={`bi bi-${icon}`} />
      </span>
      <div>
        <p className="stat-label">{label}</p>
        <p className="stat-value">{value}</p>
        {trend !== undefined && (
          <p className={`stat-trend ${trend >= 0 ? 'up' : 'down'}`}>
            <i className={`bi bi-arrow-${trend >= 0 ? 'up' : 'down'}-right`} />
            {Math.abs(trend)}% <span>vs last month</span>
          </p>
        )}
      </div>
    </div>
  )
}

export function StatusPill({ status }) {
  return <span className={`pill pill-${statusTone(status)}`}>{status}</span>
}

export function Progress({ value, max = 100, label }) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  return (
    <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Avatar({ name, size = 36 }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials(name)}
    </span>
  )
}

export function EmptyState({ icon, title, text, action }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <i className={`bi bi-${icon}`} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  )
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="toggle-track" aria-hidden="true" />
    </label>
  )
}
