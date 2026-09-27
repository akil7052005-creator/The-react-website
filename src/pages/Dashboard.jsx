import { Link } from 'react-router-dom'
import { PageHeader, Card, StatCard, StatusPill, Progress, Avatar } from '../components/ui'
import db from '../data'
import { formatDate, formatNumber } from '../utils/format'
import AlbumCard from '../components/AlbumCard'
import poster from '../assets/wedding-poster-horizontal.png'

const quickActions = [
  { to: '/photo-selection', icon: 'images', label: 'New Selection', text: 'Let clients pick favourites', tone: 'wine' },
  { to: '/digital-album', icon: 'journal-album', label: 'Digital Album', text: 'Design a flipbook album', tone: 'gold' },
  { to: '/face-recognition', icon: 'person-bounding-box', label: 'AI Face', text: 'Guests find their photos', tone: 'blue' },
  { to: '/billing', icon: 'receipt', label: 'Create Bill', text: 'GST-ready invoices', tone: 'green' },
  { to: '/my-website', icon: 'globe2', label: 'Manage Website', text: 'Update your portfolio', tone: 'gold' },
  { to: '/whatsapp-credit', icon: 'whatsapp', label: 'WhatsApp Credit', text: `${formatNumber(db.whatsapp.credits)} credits left`, tone: 'green' },
]

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function EventsChart({ data }) {
  const max = Math.max(...data.map((d) => d.count))
  return (
    <div>
      <div className="bars" style={{ '--n': data.length }}>
        {data.map((d) => (
          <div key={d.month} className={`bar ${d.count === max ? 'peak' : ''}`} title={`${d.month}: ${d.count} events`}>
            <span style={{ '--h': `${(d.count / max) * 100}%` }} />
            <em className="tip" style={{ '--h': `${(d.count / max) * 100}%`, fontStyle: 'normal' }}>{d.count}</em>
          </div>
        ))}
      </div>
      <div className="bar-labels" style={{ '--n': data.length }}>
        {data.map((d) => (
          <span key={d.month}>{d.month}</span>
        ))}
      </div>
    </div>
  )
}

function Dashboard() {
  const { stats, events, activity, projects, albums, studio } = db
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="stack">
      <PageHeader
        eyebrow={today}
        title={`${greeting()}, ${studio.owner.split(' ')[0]}`}
        subtitle="Here's what's happening across your weddings this season."
        actions={
          <>
            <Link to="/digital-album" className="btn btn-ghost"><i className="bi bi-share" />Share Gallery</Link>
            <Link to="/photo-selection" className="btn btn-primary"><i className="bi bi-plus-lg" />New Event</Link>
          </>
        }
      />

      <div className="grid grid-4">
        <StatCard icon="calendar-heart" label="Total Events" value={stats.totalEvents.value} trend={stats.totalEvents.trend} tone="wine" />
        <StatCard icon="images" label="Photo Selections" value={stats.photoSelections.value} trend={stats.photoSelections.trend} tone="gold" />
        <StatCard icon="journal-album" label="Digital Albums" value={stats.digitalAlbums.value} trend={stats.digitalAlbums.trend} tone="blue" />
        <StatCard icon="person-bounding-box" label="Face Matches" value={formatNumber(stats.faceMatches.value)} trend={stats.faceMatches.trend} tone="green" />
      </div>

      <div className="grid grid-2">
        <div className="hero">
          <img src={poster} alt="Forever Begins Here — seasonal booking campaign" />
          <span className="hero-tag"><i className="bi bi-megaphone" /> Active campaign</span>
        </div>
        <Card title="Quick actions" subtitle="Jump straight into your most-used tools">
          <div className="actions-grid">
            {quickActions.map((a) => (
              <Link key={a.to} to={a.to} className="action-tile">
                <span className={`stat-icon tone-${a.tone}`}><i className={`bi bi-${a.icon}`} /></span>
                <div>
                  <strong>{a.label}</strong>
                  <span style={{ display: 'block' }}>{a.text}</span>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-2-1">
        <Card title="Recent events" subtitle="Your latest bookings and their status" action={<Link to="/photo-selection" className="link">View all <i className="bi bi-arrow-right" /></Link>} flush>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Event ID</th>
                  <th>Event</th>
                  <th>Customer</th>
                  <th>Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="mono">{e.id}</td>
                    <td>
                      <div className="cell-main">{e.name}</div>
                      <div className="cell-sub"><i className="bi bi-geo-alt" /> {e.location}</div>
                    </td>
                    <td>
                      <div className="person"><Avatar name={e.customer} size={30} />{e.customer}</div>
                    </td>
                    <td>{formatDate(e.date)}</td>
                    <td><StatusPill status={e.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Client activity" subtitle="Live updates from your clients">
          <ul className="activity">
            {activity.map((a, i) => (
              <li key={i}>
                <span className="stat-icon tone-wine"><i className={`bi bi-${a.icon}`} /></span>
                <div>
                  <p><strong>{a.who}</strong> {a.action}</p>
                  <time>{a.time}</time>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid grid-3">
        <Card title="Event analytics" subtitle="Events booked per month">
          <EventsChart data={db.monthlyEvents} />
        </Card>

        <Card title="Project progress" subtitle="Deliverables in the pipeline">
          {projects.map((p) => (
            <div className="progress-row" key={p.name}>
              <div className="progress-meta">
                <strong>{p.name}</strong>
                <span>{p.progress}%</span>
              </div>
              <Progress value={p.progress} label={p.name} />
            </div>
          ))}
        </Card>

        <div className="app-promo">
          <p className="eyebrow">Weddingz mobile</p>
          <h3>Your studio, in your pocket.</h3>
          <p>Share galleries, track selections and get paid — right from your phone.</p>
          <div className="store-btns">
            <a href="#" className="store-btn"><i className="bi bi-apple" />App Store</a>
            <a href="#" className="store-btn"><i className="bi bi-google-play" />Google Play</a>
          </div>
          <span className="promo-ring" />
        </div>
      </div>

      <Card title="Recent albums" action={<Link to="/digital-album" className="link">All albums <i className="bi bi-arrow-right" /></Link>}>
        <div className="album-grid">
          {albums.slice(0, 4).map((a) => (
            <AlbumCard key={a.id} album={a} />
          ))}
        </div>
      </Card>
    </div>
  )
}

export default Dashboard
