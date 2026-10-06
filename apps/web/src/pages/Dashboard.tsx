import { useQuery } from '@tanstack/react-query'
import type { DashboardDto, EventDto, Paginated, SelectionDto, SelectionEffectiveStatus } from '@weddyzone/shared'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMe } from '../auth/AuthProvider'
import { HeroCarousel } from '../components/dashboard/HeroCarousel'
import { EventModal } from '../components/EventModal'
import { LIVE_POLL_MS, selectionPath, selectionPill, type StatusPill } from '../components/selection/selectionUi'
import { ErrorState, Skeleton, TableSkeleton } from '../components/ui'
import { api } from '../lib/api'
import { formatNumber, timeAgo } from '../utils/format'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

/** The dashboard's pill colours for the shared status tones. */
const DB_TONE: Record<StatusPill['tone'], string> = { pending: 'amber', shared: 'blue', progress: 'blue', submitted: 'green', downloaded: 'grey' }

/** Status pill for Recent Events and Client Activity: the same names as the Photo Selection table. */
function dbPill(s: { status: SelectionEffectiveStatus; reopened?: boolean }): { label: string; tone: string } {
  const p = selectionPill(s)
  return { label: p.label, tone: DB_TONE[p.tone] }
}

const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** A key number as a large link card: title, big number and "+N this month". */
function StatCard({ tone, icon, label, value, added, to }: { tone: 'red' | 'royal'; icon: string; label: string; value: number | undefined; added: number | undefined; to: string }) {
  return (
    <Link to={to} className={`db-stat ${tone}`} aria-label={value === undefined ? label : `${label}: ${formatNumber(value)}, +${formatNumber(added ?? 0)} this month`}>
      <span className="db-stat-icon" aria-hidden="true">
        <i className={`bi bi-${icon}`} />
      </span>
      <span className="db-stat-body">
        <span className="db-stat-label">{label}</span>
        <strong className="db-num">{value === undefined ? <Skeleton width={56} height={28} /> : formatNumber(value)}</strong>
        <span className="db-stat-foot">
          <span className="db-chip">+{formatNumber(added ?? 0)}</span> this month
        </span>
      </span>
      <i className="bi bi-arrow-right db-stat-go" aria-hidden="true" />
    </Link>
  )
}

/** Studio home: hero highlights, the two key numbers, client activity and recent selection events. */
function Dashboard() {
  const { user, studio } = useMe()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardDto>('/dashboard'), refetchInterval: LIVE_POLL_MS, refetchOnWindowFocus: true })
  const recent = useQuery({
    queryKey: ['selections', { dashboard: true }],
    queryFn: () => api.get<Paginated<SelectionDto>>('/selections', { limit: 5, page: 1 }),
    // A customer's submit shows here as Selected without a refresh.
    refetchInterval: LIVE_POLL_MS,
    refetchOnWindowFocus: true,
  })

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

  const d = q.data
  const activity = d?.workflow?.activity ?? []
  const rows = recent.data?.data ?? []

  return (
    <div className="stack db-page">
      <header className="db-head">
        <div>
          <p className="db-eyebrow">{studio.name}</p>
          <h1 className="db-title">
            {greeting()}, <span>{user.name.split(' ')[0]}</span>
          </h1>
          <p className="db-sub">Plan, manage and track your photography work with ease.</p>
        </div>
        <Link to="/photo-selection?new=1" className="db-new">
          <i className="bi bi-plus-lg" aria-hidden="true" /> New Selection
        </Link>
      </header>

      <HeroCarousel />

      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="We could not load your dashboard" />
      ) : (
        <div className="db-stats" data-testid="stat-cards">
          {/* Every event belongs to a photo selection, so the events list is the Photo Selection list. */}
          <StatCard to="/photo-selection" tone="red" icon="calendar-event" label="Total Events" value={d?.stats.totalEvents.value} added={d?.workflow?.createdThisMonth?.events} />
          <StatCard to="/photo-selection" tone="royal" icon="image" label="Photo Selection" value={d?.stats.photoSelections.value} added={d?.workflow?.createdThisMonth?.selections} />
        </div>
      )}

      <section className="db-panel" aria-labelledby="db-recent-title">
        <div className="db-panel-head">
          <div>
            <h2 id="db-recent-title">Recent Events</h2>
            <p className="db-hint">Latest photo selection events.</p>
          </div>
          <Link to="/photo-selection" className="db-ghost">
            View all
          </Link>
        </div>
        {recent.isPending ? (
          <TableSkeleton rows={4} cols={5} />
        ) : recent.isError ? (
          <ErrorState error={recent.error} onRetry={() => recent.refetch()} />
        ) : rows.length === 0 ? (
          <p className="db-empty">
            No photo selections yet. <Link to="/photo-selection?new=1">Start your first one</Link>.
          </p>
        ) : (
          <div className="db-table-wrap">
            <table className="db-table" data-testid="recent-events">
              <thead>
                <tr>
                  <th scope="col">Event ID</th>
                  <th scope="col">Event Name</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Date</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const pill = dbPill(s)
                  return (
                    <tr key={s.id} onClick={() => navigate(selectionPath(s.id))}>
                      <td>
                        <Link to={selectionPath(s.id)} className="db-id" onClick={(e) => e.stopPropagation()}>
                          #{s.code}
                        </Link>
                      </td>
                      <td className="db-strong">{s.event.title}</td>
                      <td>{s.client.name}</td>
                      <td className="db-num">{shortDate(s.eventDate ?? s.createdAt)}</td>
                      <td>
                        <span className={`db-pill ${pill.tone}`}>{pill.label}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {!q.isError && (
        <section className="db-panel" aria-labelledby="db-activity-title">
          <div className="db-panel-head">
            <div>
              <h2 id="db-activity-title">Client Activity</h2>
              <p className="db-hint">Who's working on photo selection.</p>
            </div>
            <Link to="/photo-selection" className="db-ghost">
              View all
            </Link>
          </div>
          {!d ? (
            <TableSkeleton rows={4} cols={5} />
          ) : activity.length === 0 ? (
            <p className="db-empty">When clients open their galleries, pick or submit, it shows up here.</p>
          ) : (
            <div className="db-table-wrap">
              <table className="db-table db-activity-table" data-testid="client-activity">
                <thead>
                  <tr>
                    <th scope="col">Client</th>
                    <th scope="col">Action</th>
                    <th scope="col">Event</th>
                    <th scope="col">Time</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.slice(0, 8).map((a) => {
                    const pill = a.status ? dbPill({ status: a.status, reopened: a.reopened }) : null
                    return (
                      <tr key={a.id} onClick={() => navigate(selectionPath(a.selectionId))}>
                        <td>
                          <Link
                            to={selectionPath(a.selectionId)}
                            className="db-client"
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`${a.clientName}: ${a.action}, ${a.eventTitle}${pill ? `, ${pill.label}` : ''}`}
                          >
                            <span className="db-avatar" aria-hidden="true">
                              {a.clientName.trim().charAt(0).toUpperCase()}
                            </span>
                            <span className="db-strong">{a.clientName}</span>
                          </Link>
                        </td>
                        <td>{a.action}</td>
                        <td>
                          <span className="db-ellipsis" title={a.eventTitle}>
                            {a.eventTitle}
                          </span>
                        </td>
                        <td className="db-muted">
                          <time dateTime={a.at}>{timeAgo(a.at)}</time>
                        </td>
                        <td>{pill ? <span className={`db-pill ${pill.tone}`}>{pill.label}</span> : <span className="db-muted">—</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {linkedEvent.data &&<EventModal open onClose={closeEvent} event={linkedEvent.data} />}
    </div>
  )
}

export default Dashboard
