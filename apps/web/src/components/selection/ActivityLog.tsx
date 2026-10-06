import type { SelectionLogDto } from '@weddyzone/shared'
import { formatDateTime } from '../../utils/format'
import { EmptyState } from '../ui'

const ACTOR: Record<SelectionLogDto['actor'], { icon: string; label: string }> = {
  STUDIO: { icon: 'person-badge', label: 'You' },
  CLIENT: { icon: 'heart', label: 'Client' },
  SYSTEM: { icon: 'gear', label: 'System' },
}

export function ActivityLog({ log }: { log: SelectionLogDto[] }) {
  if (!log.length) return <EmptyState icon="clock-history" title="No activity yet" />
  return (
    <ol className="sw-log" aria-label="Change log">
      {log.map((l) => (
        <li key={l.id}>
          <span className={`sw-log-icon ${l.actor.toLowerCase()}`} aria-hidden="true">
            <i className={`bi bi-${ACTOR[l.actor].icon}`} />
          </span>
          <div>
            <strong>{l.action}</strong>
            {l.detail && <span className="sw-log-detail"> — {l.detail}</span>}
            <div className="muted sw-small">
              {ACTOR[l.actor].label} · {formatDateTime(l.createdAt)}
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}
