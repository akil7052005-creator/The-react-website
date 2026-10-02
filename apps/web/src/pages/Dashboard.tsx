import { useQuery } from '@tanstack/react-query'
import type { DashboardDto, EventDto } from '@weddyzone/shared'
import { Link, useSearchParams } from 'react-router-dom'
import welcomePhoto from '../assets/wedding-photo.jpg'
import { useMe } from '../auth/AuthProvider'
import { EventModal } from '../components/EventModal'
import { ErrorState, PageHeader, StatCard, StatSkeletonRow } from '../components/ui'
import { api } from '../lib/api'
import { formatNumber } from '../utils/format'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

/** Studio home: a clean at-a-glance view with the one action studios use most. */
function Dashboard() {
  const { user, studio } = useMe()
  const [params, setParams] = useSearchParams()
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardDto>('/dashboard') })

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
  const tiles = d
    ? [
        { label: 'Total events', value: d.stats.totalEvents.value, icon: 'calendar-heart', tone: 'wine', to: null },
        { label: 'Completed selections', value: d.stats.completedSelections, icon: 'check2-circle', tone: 'green', to: '/photo-selection?status=SUBMITTED' },
        { label: 'Digital albums', value: d.stats.digitalAlbums.value, icon: 'journal-album', tone: 'gold', to: '/digital-album' },
      ]
    : []

  return (
    <div className="stack">
      <PageHeader
        eyebrow={studio.name}
        title={`${greeting()}, ${user.name.split(' ')[0]}`}
        subtitle="Your studio at a glance."
        actions={
          <Link to="/photo-selection?new=1" className="btn btn-primary">
            <i className="bi bi-plus-lg" /> New Selection
          </Link>
        }
      />

      {q.isPending ? (
        <StatSkeletonRow count={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="We could not load your dashboard" />
      ) : (
        <div className="grid grid-3 dashboard-tiles">
          {tiles.map((t) => {
            const card = <StatCard icon={t.icon} label={t.label} value={formatNumber(t.value)} tone={t.tone} />
            return t.to ? (
              <Link key={t.label} to={t.to} className="dashboard-tile" aria-label={`${t.label}: ${t.value}`}>
                {card}
              </Link>
            ) : (
              <div key={t.label}>{card}</div>
            )
          })}
        </div>
      )}

      <section className="welcome-banner" aria-label="Welcome">
        <img src={welcomePhoto} alt="Bride and groom under a floral wedding arch" width={950} height={1016} loading="lazy" />
        <div className="welcome-banner-text">
          <p className="eyebrow">Welcome to Weddyzone</p>
          <h2>
            Every wedding, <em>beautifully</em> organised.
          </h2>
          <p>Share photo selections, send albums for approval and keep every booking in one place.</p>
        </div>
      </section>

      {linkedEvent.data && <EventModal open onClose={closeEvent} event={linkedEvent.data} />}
    </div>
  )
}

export default Dashboard
