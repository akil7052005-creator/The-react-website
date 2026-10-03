import { useQuery, useQueryClient } from '@tanstack/react-query'
import { EVENT_TYPE_LABELS, formatINR, type AttentionItemDto, type DashboardDto, type EventDto } from '@weddyzone/shared'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMe } from '../auth/AuthProvider'
import { EventModal } from '../components/EventModal'
import { PlanBanner } from '../components/PlanBanner'
import { selectionPath } from '../components/selection/selectionUi'
import { EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui'
import { api } from '../lib/api'
import { formatNumber, timeAgo } from '../utils/format'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

const ATTENTION: Record<AttentionItemDto['kind'], { icon: string; tone: string; label: string }> = {
  SUBMITTED: { icon: 'check2-circle', tone: 'done', label: 'Picks in' },
  EXPIRING: { icon: 'hourglass-split', tone: 'warn', label: 'Expiring' },
  UNPAID: { icon: 'receipt', tone: 'money', label: 'Unpaid' },
}

const ACTIVITY_ICON: Record<string, string> = {
  'Opened the gallery': 'eye',
  'Started picking': 'heart',
  Submitted: 'send-check',
}

function whenLabel(days: number) {
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `In ${days} days`
}

/** Studio home: what needs doing now, what's coming up, and what clients are doing. */
function Dashboard() {
  const { user, studio } = useMe()
  const [params, setParams] = useSearchParams()
  const [newEvent, setNewEvent] = useState(false)
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardDto>('/dashboard'), refetchInterval: 60_000 })

  // Deep links from the global search (/?event=<id>) open that event.
  const linkedEventId = params.get('event')
  const linkedEvent = useQuery({
    queryKey: ['event', linkedEventId],
    queryFn: () => api.get<EventDto>(`/events/${linkedEventId}`),
    enabled: Boolean(linkedEventId),
  })
  const closeEvent = () => {
    const next = new URLSearchParams(params)
    next.delete('event')
    setParams(next, { replace: true })
  }

  const w = q.data?.workflow
  const uploadTo = w?.uploadTarget ? `${selectionPath(w.uploadTarget.id)}?upload=1` : '/photo-selection?new=1'
  const steps = w
    ? [
        { done: w.checklist.eventCreated, label: 'Create your first event', hint: 'The couple, the date and the venue.', action: () => setNewEvent(true), cta: 'New event' },
        { done: w.checklist.photosUploaded, label: 'Upload the photos', hint: 'Drop whole folders — Haldi, Wedding, Reception.', to: uploadTo, cta: 'Upload photos' },
        { done: w.checklist.selectionShared, label: 'Share the gallery', hint: 'Send the link on WhatsApp; the couple picks their favourites.', to: '/photo-selection', cta: 'Share' },
      ]
    : []
  const showChecklist = w && !w.checklist.selectionShared

  return (
    <div className="stack db-page">
      <PageHeader
        eyebrow={studio.name}
        title={`${greeting()}, ${user.name.split(' ')[0]}`}
        subtitle="Here's what needs you today."
        actions={
          <div className="db-actions">
            <button className="btn btn-primary" onClick={() => setNewEvent(true)}>
              <i className="bi bi-calendar-plus" /> New event
            </button>
            <Link to={uploadTo} className="btn btn-ghost">
              <i className="bi bi-cloud-arrow-up" /> Upload photos
            </Link>
            <Link to="/billing?create=1" className="btn btn-ghost">
              <i className="bi bi-receipt" /> Create bill
            </Link>
          </div>
        }
      />

      <PlanBanner always />

      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="We could not load your dashboard" />
      ) : !w ? (
        <div className="db-grid">
          <Skeleton height={180} radius={16} />
          <Skeleton height={180} radius={16} />
        </div>
      ) : (
        <>
          {showChecklist && (
            <section className="card db-card db-checklist" aria-labelledby="db-start">
              <h2 id="db-start">Get started in 3 steps</h2>
              <ol>
                {steps.map((s, i) => (
                  <li key={s.label} className={s.done ? 'done' : ''}>
                    <span className="db-step" aria-hidden="true">
                      {s.done ? <i className="bi bi-check-lg" /> : i + 1}
                    </span>
                    <div className="db-step-text">
                      <strong>{s.label}</strong>
                      <span className="muted">{s.done ? 'Done' : s.hint}</span>
                    </div>
                    {!s.done &&
                      (s.to ? (
                        <Link className="btn btn-sm btn-ghost" to={s.to}>
                          {s.cta}
                        </Link>
                      ) : (
                        <button className="btn btn-sm btn-ghost" onClick={s.action}>
                          {s.cta}
                        </button>
                      ))}
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="card db-card" aria-labelledby="db-attention">
            <h2 id="db-attention">
              Needs attention {w.needsAttention.length > 0 && <span className="db-count">{w.needsAttention.length}</span>}
            </h2>
            {w.needsAttention.length === 0 ? (
              <p className="muted db-empty">
                <i className="bi bi-emoji-smile" /> All clear — nothing waiting on you.
              </p>
            ) : (
              <ul className="db-list" data-testid="needs-attention">
                {w.needsAttention.map((n) => (
                  <li key={`${n.kind}-${n.id}`}>
                    <Link to={n.link} className="db-row">
                      <span className={`db-icon ${ATTENTION[n.kind].tone}`} aria-hidden="true">
                        <i className={`bi bi-${ATTENTION[n.kind].icon}`} />
                      </span>
                      <span className="db-row-text">
                        <strong>{n.title}</strong>
                        <span className="muted">{n.detail}</span>
                      </span>
                      <span className={`db-tag ${ATTENTION[n.kind].tone}`}>{ATTENTION[n.kind].label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="db-grid">
            <section className="card db-card" aria-labelledby="db-next">
              <h2 id="db-next">Next events</h2>
              {w.upcoming.length === 0 ? (
                <EmptyState
                  icon="calendar-heart"
                  title="No upcoming events"
                  action={
                    <button className="btn btn-sm btn-primary" onClick={() => setNewEvent(true)}>
                      <i className="bi bi-plus-lg" /> New event
                    </button>
                  }
                />
              ) : (
                <ul className="db-list">
                  {w.upcoming.map((e) => (
                    <li key={e.id}>
                      <Link to={e.selectionId ? selectionPath(e.selectionId) : `/?event=${e.id}`} className="db-row">
                        <span className="db-date" aria-hidden="true">
                          <strong>{new Date(`${e.date}T00:00:00`).getDate()}</strong>
                          <small>{new Date(`${e.date}T00:00:00`).toLocaleString('en-IN', { month: 'short' })}</small>
                        </span>
                        <span className="db-row-text">
                          <strong>{e.title}</strong>
                          <span className="muted">
                            {EVENT_TYPE_LABELS[e.type]} · {e.clientName} · {e.city}
                          </span>
                        </span>
                        <span className={`db-tag${e.daysLeft <= 2 ? ' warn' : ''}`}>{whenLabel(e.daysLeft)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card db-card" aria-labelledby="db-live">
              <h2 id="db-live">
                Client activity <span className="db-live-dot" aria-hidden="true" />
              </h2>
              {w.activity.length === 0 ? (
                <p className="muted db-empty">When clients open their galleries, pick or submit, it shows up here.</p>
              ) : (
                <ul className="db-list" data-testid="client-activity">
                  {w.activity.map((a) => (
                    <li key={a.id}>
                      <Link to={selectionPath(a.selectionId)} className="db-row">
                        <span className="db-icon client" aria-hidden="true">
                          <i className={`bi bi-${ACTIVITY_ICON[a.action] ?? 'activity'}`} />
                        </span>
                        <span className="db-row-text">
                          <strong>
                            {a.clientName} · {a.action.toLowerCase()}
                          </strong>
                          <span className="muted">
                            {a.eventTitle}
                            {a.detail ? ` · ${a.detail}` : ''}
                          </span>
                        </span>
                        <span className="muted db-when">{timeAgo(a.at)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="card db-card" aria-labelledby="db-month">
            <h2 id="db-month">This month</h2>
            <dl className="db-month" data-testid="this-month">
              <div>
                <dt>Events</dt>
                <dd>{formatNumber(w.thisMonth.events)}</dd>
              </div>
              <div>
                <dt>Photos uploaded</dt>
                <dd>{formatNumber(w.thisMonth.photosUploaded)}</dd>
              </div>
              <div>
                <dt>Selections submitted</dt>
                <dd>{formatNumber(w.thisMonth.selectionsSubmitted)}</dd>
              </div>
              <div>
                <dt>Billed</dt>
                <dd>{formatINR(w.thisMonth.billedPaise)}</dd>
              </div>
            </dl>
          </section>
        </>
      )}

      <EventModal open={newEvent} onClose={() => setNewEvent(false)} onCreated={() => qc.invalidateQueries({ queryKey: ['dashboard'] })} />
      {linkedEvent.data && <EventModal open onClose={closeEvent} event={linkedEvent.data} />}
    </div>
  )
}

export default Dashboard
