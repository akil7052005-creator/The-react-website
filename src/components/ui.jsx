// Small reusable building blocks. Every page is assembled from these,
// so the whole app keeps one consistent look with rich interactive cursor tooltips.
import { statusTone, initials } from '../utils/format'
import { FeatureTooltip, FeatureInfoBadge } from './FeatureTooltip'
import { featureInfo } from '../data/featureInfo'

export { FeatureTooltip, FeatureInfoBadge }

const statusExplanations = {
  'Upcoming': { title: 'Upcoming Event', summary: 'Booking confirmed on the calendar. Crew and shot lists are scheduled.' },
  'In Progress': { title: 'In Progress', summary: 'Shooting, culling, or editing actively underway by the studio team.' },
  'Awaiting Selection': { title: 'Awaiting Selection', summary: 'Gallery link has been sent to client; waiting for couple to pick favorites.' },
  'Completed': { title: 'Completed Selection', summary: 'Client has locked their favorite picks. Ready for Lightroom/album layout.' },
  'Delivered': { title: 'Delivered', summary: 'All final high-resolution photos and printed albums delivered to client.' },
  'Live': { title: 'Live on Cloud', summary: 'AI face search and photo gallery are active and accessible to wedding guests.' },
  'Processing': { title: 'AI Processing', summary: 'Neural engine is currently scanning and indexing faces across all event photos.' },
  'Not Started': { title: 'Not Started', summary: 'Event folder created; awaiting photo upload and face indexing.' },
  'Published': { title: 'Published Album', summary: 'Virtual flipbook is published and viewable worldwide via shareable link.' },
  'In Review': { title: 'Client Review', summary: 'Couple is currently previewing album spreads and adding feedback notes.' },
  'Draft': { title: 'Draft Album', summary: 'Album layout in progress; private to studio and not visible to couple yet.' },
  'Paid': { title: 'Payment Settled', summary: 'Full invoice amount received and reconciled with GST records.' },
  'Pending': { title: 'Payment Pending', summary: 'Invoice issued to client; awaiting payment before milestone release.' },
  'Overdue': { title: 'Payment Overdue', summary: 'Due date elapsed. One-click WhatsApp payment nudge available.' },
}

export function PageHeader({ eyebrow, title, subtitle, actions, featureBadge }) {
  return (
    <header className="page-header">
      <div>
        <div className="eyebrow-row">
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          {featureBadge && (
            <span className="page-feature-tag">
              <i className="bi bi-stars" /> {featureBadge}
            </span>
          )}
        </div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function Card({ title, subtitle, action, children, className = '', flush = false, feature }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="card-head">
          <div className="card-title-group">
            {title && (
              <div className="card-title-row">
                <h2 className="card-title">{title}</h2>
                {feature && <FeatureInfoBadge feature={feature} />}
              </div>
            )}
            {subtitle && <p className="card-subtitle">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={flush ? 'card-body flush' : 'card-body'}>{children}</div>
    </section>
  )
}

export function StatCard({ icon, label, value, trend, tone = 'wine', tooltip, featureKey }) {
  const feat = tooltip || (featureKey ? featureInfo[featureKey] : featureInfo.features?.[label])

  const content = (
    <div className="stat-card">
      <span className={`stat-icon tone-${tone}`}>
        <i className={`bi bi-${icon}`} />
      </span>
      <div className="stat-info">
        <div className="stat-label-row">
          <p className="stat-label">{label}</p>
          <span className="stat-info-trigger" aria-hidden="true">
            <i className="bi bi-info-circle" />
          </span>
        </div>
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

  if (feat) {
    return (
      <FeatureTooltip feature={feat} position="top" width={290} delay={100}>
        {content}
      </FeatureTooltip>
    )
  }

  return content
}

export function StatusPill({ status }) {
  const info = statusExplanations[status]
  const pill = <span className={`pill pill-${statusTone(status)}`}>{status}</span>

  if (info) {
    return (
      <FeatureTooltip
        title={info.title}
        summary={info.summary}
        badge={status}
        position="top"
        width={240}
        delay={100}
      >
        {pill}
      </FeatureTooltip>
    )
  }

  return pill
}

export function Progress({ value, max = 100, label }) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  return (
    <FeatureTooltip
      title={label || 'Progress'}
      summary={`${pct}% completed (${value} of ${max})`}
      badge={`${pct}%`}
      position="top"
      width={220}
      delay={80}
    >
      <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </FeatureTooltip>
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

export function Toggle({ checked, onChange, label, feature }) {
  const element = (
    <label className="toggle">
      <span className="toggle-label-group">
        <span>{label}</span>
        {feature && <FeatureInfoBadge feature={feature} />}
      </span>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="toggle-track" aria-hidden="true" />
    </label>
  )

  return element
}

/**
 * FeatureBar - Catchy interactive feature highlights ribbon with hover info cards
 */
export function FeatureBar({ items }) {
  return (
    <div className="feature-bar">
      <span className="feature-bar-label">
        <i className="bi bi-stars" /> Key Capabilities:
      </span>
      <div className="feature-bar-chips">
        {items.map((item, idx) => (
          <FeatureTooltip
            key={idx}
            title={item.title}
            badge={item.badge || 'Feature'}
            icon={item.icon || 'check-circle-fill'}
            summary={item.summary || item.description}
            highlights={item.highlights}
            tip={item.tip}
            position="bottom"
            width={290}
            delay={80}
          >
            <button className="feature-chip">
              <i className={`bi bi-${item.icon || 'check2'}`} />
              <span>{item.title}</span>
              <span className="feature-chip-hover-hint">Hover for info</span>
            </button>
          </FeatureTooltip>
        ))}
      </div>
    </div>
  )
}
