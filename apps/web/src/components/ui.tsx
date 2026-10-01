// Small reusable building blocks. Every page is assembled from these,
// so the whole app keeps one consistent look with rich interactive cursor tooltips.
import type { CSSProperties, ReactNode } from 'react'
import { statusTone, initials } from '../utils/format'
import { FeatureTooltip, FeatureInfoBadge, type FeatureInfo } from './FeatureTooltip'
import { featureInfo } from '../data/featureInfo'
import { fileUrl } from '../lib/env'

export { FeatureTooltip, FeatureInfoBadge }
export type { FeatureInfo }

const statusExplanations: Record<string, { title: string; summary: string }> = {
  'Upcoming': { title: 'Upcoming Event', summary: 'Booking confirmed on the calendar. Crew and shot lists are scheduled.' },
  'In Progress': { title: 'In Progress', summary: 'Shooting, culling, or editing actively underway by the studio team.' },
  'Awaiting Selection': { title: 'Awaiting Selection', summary: 'Gallery link has been sent to client; waiting for couple to pick favorites.' },
  'Completed': { title: 'Completed Selection', summary: 'Client has locked their favorite picks. Ready for Lightroom/album layout.' },
  'Delivered': { title: 'Delivered', summary: 'All final high-resolution photos and printed albums delivered to client.' },
  'Expired': { title: 'Deadline Passed', summary: 'The selection deadline passed before the client submitted. Extend the deadline to reopen it.' },
  'Published': { title: 'Published Album', summary: 'Virtual flipbook is published and viewable worldwide via shareable link.' },
  'In Review': { title: 'Client Review', summary: 'Couple is currently previewing album spreads and adding feedback notes.' },
  'Draft': { title: 'Draft', summary: 'Private to the studio and not visible to the couple yet.' },
  'Paid': { title: 'Payment Settled', summary: 'Full invoice amount received and reconciled with GST records.' },
  'Pending': { title: 'Payment Pending', summary: 'Invoice issued to client; awaiting payment before milestone release.' },
  'Overdue': { title: 'Payment Overdue', summary: 'Due date elapsed. One-click WhatsApp payment nudge available.' },
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  featureBadge,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  featureBadge?: ReactNode
}) {
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

export function Card({
  title,
  subtitle,
  action,
  children,
  className = '',
  flush = false,
  feature,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  children?: ReactNode
  className?: string
  flush?: boolean
  feature?: FeatureInfo
}) {
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

export function StatCard({
  icon,
  label,
  value,
  trend,
  tone = 'wine',
  tooltip,
  featureKey,
}: {
  icon: string
  label: string
  value: ReactNode
  trend?: number
  tone?: string
  tooltip?: FeatureInfo
  featureKey?: keyof typeof featureInfo
}) {
  const feat =
    tooltip ||
    (featureKey ? (featureInfo[featureKey] as FeatureInfo) : (featureInfo.features as Record<string, FeatureInfo>)?.[label])

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

export function StatusPill({ status }: { status: string }) {
  const info = statusExplanations[status]
  const pill = <span className={`pill pill-${statusTone(status)}`}>{status}</span>

  if (info) {
    return (
      <FeatureTooltip title={info.title} summary={info.summary} badge={status} position="top" width={240} delay={100}>
        {pill}
      </FeatureTooltip>
    )
  }

  return pill
}

export function Progress({ value, max = 100, label }: { value: number; max?: number; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
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

export function Avatar({ name, size = 36, src }: { name: string; size?: number; src?: string | null }) {
  if (src) {
    return (
      <img
        className="avatar"
        src={fileUrl(src)}
        alt={name}
        style={{ width: size, height: size, objectFit: 'cover' }}
        loading="lazy"
      />
    )
  }
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials(name)}
    </span>
  )
}

export function EmptyState({ icon, title, text, action }: { icon: string; title: ReactNode; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <i className={`bi bi-${icon}`} />
      </span>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  )
}

/** Error state with a Retry button, in the EmptyState style. */
export function ErrorState({
  error,
  onRetry,
  title = 'We could not load this',
}: {
  error?: unknown
  onRetry?: () => void
  title?: string
}) {
  const message = error instanceof Error && error.message ? error.message : 'Please check your connection and try again.'
  return (
    <div className="empty error-state" role="alert">
      <span className="empty-icon">
        <i className="bi bi-exclamation-triangle" />
      </span>
      <h3>{title}</h3>
      <p>{message}</p>
      {onRetry && (
        <button className="btn btn-ghost" onClick={onRetry}>
          <i className="bi bi-arrow-clockwise" /> Retry
        </button>
      )}
    </div>
  )
}

export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
  return <span className="spinner" style={{ width: size, height: size }} role="status" aria-label={label ?? 'Loading'} />
}

export function Skeleton({ width = '100%', height = 14, radius = 8, style }: { width?: number | string; height?: number | string; radius?: number; style?: CSSProperties }) {
  return <span className="skeleton" style={{ width, height, borderRadius: radius, ...style }} aria-hidden="true" />
}

export function CardSkeleton({ rows = 4, height = 18 }: { rows?: number; height?: number }) {
  return (
    <section className="card" aria-busy="true">
      <div className="card-body">
        <Skeleton width="40%" height={20} style={{ marginBottom: 18 }} />
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} height={height} width={`${90 - (i % 3) * 12}%`} style={{ marginBottom: 12 }} />
        ))}
      </div>
    </section>
  )
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="table-wrap" aria-busy="true">
      <table className="table">
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c}>
                  <Skeleton height={14} width={c === 0 ? '70%' : '55%'} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function StatSkeletonRow({ count = 3 }: { count?: number }) {
  return (
    <div className={`grid grid-${count}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div className="stat-card" key={i} aria-busy="true">
          <Skeleton width={44} height={44} radius={12} />
          <div style={{ flex: 1 }}>
            <Skeleton width="50%" height={12} style={{ marginBottom: 10 }} />
            <Skeleton width="35%" height={22} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function PageSkeleton() {
  return (
    <div className="page-skeleton" aria-busy="true" aria-label="Loading">
      <Skeleton width={180} height={12} style={{ marginBottom: 12 }} />
      <Skeleton width={360} height={30} style={{ marginBottom: 28 }} />
      <StatSkeletonRow count={3} />
      <div style={{ height: 20 }} />
      <CardSkeleton rows={5} />
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  feature,
  disabled,
}: {
  checked: boolean
  onChange: () => void
  label: ReactNode
  feature?: FeatureInfo
  disabled?: boolean
}) {
  return (
    <label className="toggle">
      <span className="toggle-label-group">
        <span>{label}</span>
        {feature && <FeatureInfoBadge feature={feature} />}
      </span>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      <span className="toggle-track" aria-hidden="true" />
    </label>
  )
}

export interface FeatureBarItem extends FeatureInfo {
  title: string
}

/**
 * FeatureBar - Catchy interactive feature highlights ribbon with hover info cards
 */
export function FeatureBar({ items }: { items: FeatureBarItem[] }) {
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
            <button className="feature-chip" type="button">
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

/** Simple pager in the table footer. Page state lives in the URL (see useUrlState). */
export function Pagination({
  page,
  limit,
  total,
  onPage,
}: {
  page: number
  limit: number
  total: number
  onPage: (p: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / limit))
  if (total <= limit) return null
  const from = (page - 1) * limit + 1
  const to = Math.min(total, page * limit)
  return (
    <div className="pager">
      <span className="muted">
        {from}–{to} of {total}
      </span>
      <div className="pager-btns">
        <button className="btn btn-sm btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <i className="bi bi-chevron-left" /> Prev
        </button>
        <span className="pager-page">
          Page {page} of {pages}
        </span>
        <button className="btn btn-sm btn-ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next <i className="bi bi-chevron-right" />
        </button>
      </div>
    </div>
  )
}
