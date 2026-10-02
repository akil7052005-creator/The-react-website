import { useQuery } from '@tanstack/react-query'
import {
  EVENT_STATUS_LABELS,
  EVENT_TYPE_LABELS,
  type AlbumDto,
  type DashboardDto,
  type EventDto,
  type MessagePreviewDto,
  type Paginated,
  type SelectionDto,
} from '@weddyzone/shared'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  PageHeader,
  Card,
  StatCard,
  StatusPill,
  Progress,
  Avatar,
  FeatureTooltip,
  FeatureBar,
  EmptyState,
  ErrorState,
  PageSkeleton,
  type FeatureBarItem,
} from '../components/ui'
import { formatDate, formatNumber, timeAgo } from '../utils/format'
import { featureInfo } from '../data/featureInfo'
import AlbumCard from '../components/AlbumCard'
import poster from '../assets/wedding-photo.jpg'
import { AlbumViewer } from '../components/AlbumViewer'
import FaceMatchSimulator from '../components/FaceMatchSimulator'
import WhatsAppPreviewModal from '../components/WhatsAppPreviewModal'
import { EventModal } from '../components/EventModal'
import { ShareGalleryModal } from '../components/ShareGalleryModal'
import { useMe } from '../auth/AuthProvider'
import { api } from '../lib/api'
import { features, fileUrl } from '../lib/env'
import type { FeatureInfo } from '../components/FeatureTooltip'

const allStudioHighlights: (FeatureBarItem & { flag?: keyof typeof features })[] = [
  {
    title: 'AI Face Match',
    icon: 'person-bounding-box',
    badge: '1.5s Match',
    summary: 'Wedding guests scan a venue QR code, snap a selfie, and get every picture they are in.',
    highlights: ['99.8% neural accuracy', 'Instant QR venue access', 'Watermarked proofing'],
    tip: 'Print QR codes on guest dining tables for viral engagement.',
    flag: 'faceRecognition',
  },
  {
    title: 'Smart Selection',
    icon: 'images',
    badge: 'Live Sync',
    summary: 'Couples heart their favorite shots on their phone, limited to the photos in their package.',
    highlights: ['Export picked filenames for a Lightroom filter', 'Zero login friction for couples', 'Real-time quota lock'],
    tip: 'Send a WhatsApp reminder from Photo Selection as the deadline gets close.'
  },
  {
    title: 'Digital Flipbook Album',
    icon: 'journal-album',
    badge: 'Interactive',
    summary: 'Share designed album spreads as an online flipbook couples can browse spread by spread.',
    highlights: ['Spread commenting & approval', '2× zoom for detail checks', 'Private share link'],
    tip: 'Get digital approval before sending expensive physical print orders.'
  },
  {
    title: 'GST Invoicing',
    icon: 'receipt',
    badge: 'GST Ready',
    summary: 'Create GST-compliant photography invoices and record advance and balance payments.',
    highlights: ['Automated CGST/SGST/IGST', 'WhatsApp invoice delivery', 'Milestone payment tracking'],
    tip: 'Add milestones so you can see what is due before album handover.'
  }
]
const studioHighlights = allStudioHighlights.filter((h) => !h.flag || features[h.flag])

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function EventsChart({ data }: { data: DashboardDto['monthlyEvents'] }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  return (
    <div>
      <div className="bars" style={{ '--n': data.length } as React.CSSProperties}>
        {data.map((d) => (
          <FeatureTooltip
            key={d.month}
            title={`${d.month} Bookings`}
            badge={d.count === max ? 'Peak Season' : 'Active'}
            summary={`${d.count} event${d.count === 1 ? '' : 's'} scheduled for ${d.month}.`}
            position="top"
            width={240}
          >
            <div className={`bar ${d.count === max ? 'peak' : ''}`}>
              <span style={{ '--h': `${(d.count / max) * 100}%` } as React.CSSProperties} />
              <em className="tip" style={{ '--h': `${(d.count / max) * 100}%`, fontStyle: 'normal' } as React.CSSProperties}>
                {d.count}
              </em>
            </div>
          </FeatureTooltip>
        ))}
      </div>
      <div className="bar-labels" style={{ '--n': data.length } as React.CSSProperties}>
        {data.map((d) => (
          <span key={d.month}>{d.month}</span>
        ))}
      </div>
    </div>
  )
}

function NextAssignment({ event, onOpen }: { event: DashboardDto['nextAssignment']; onOpen: (e: EventDto) => void }) {
  if (!event) {
    return (
      <div className="upcoming-shoot-banner">
        <div className="usb-left">
          <div className="usb-countdown">
            <span className="usb-days">—</span>
            <span className="usb-unit">NO EVENTS</span>
          </div>
          <div className="usb-info">
            <h3>No upcoming assignments</h3>
            <p className="muted">Create your next event to see its countdown here.</p>
          </div>
        </div>
      </div>
    )
  }
  const day = new Date(`${event.date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  return (
    <div className="upcoming-shoot-banner" role="button" tabIndex={0} onClick={() => onOpen(event)} onKeyDown={(e) => e.key === 'Enter' && onOpen(event)} style={{ cursor: 'pointer' }}>
      <div className="usb-left">
        <div className="usb-countdown">
          <span className="usb-days">{event.daysLeft}</span>
          <span className="usb-unit">{event.daysLeft === 0 ? 'TODAY' : event.daysLeft === 1 ? 'DAY LEFT' : 'DAYS LEFT'}</span>
        </div>
        <div className="usb-info">
          <div className="usb-tags">
            <span className="pill pill-warning">
              <i className="bi bi-calendar-event" /> Next Assignment · {day}
            </span>
            <span className="pill pill-neutral">
              <i className="bi bi-geo-alt" /> {event.venue}, {event.city}
            </span>
          </div>
          <h3>{event.title}</h3>
          <p className="muted">
            {event.guests ? `${formatNumber(event.guests)} expected attendees` : EVENT_TYPE_LABELS[event.type]}
            {event.notes ? ` · ${event.notes}` : ''}
          </p>
        </div>
      </div>

      <div className="usb-checklist">
        <p className="usb-cl-header">
          <i className="bi bi-camera-fill" /> Event details:
        </p>
        <div className="usb-crew-chips">
          <FeatureTooltip title="Client" summary={`${event.client.name} · ${event.client.phone}`} position="top" width={220}>
            <span className="usb-chip">
              <i className="bi bi-person-fill" /> {event.client.name}
            </span>
          </FeatureTooltip>
          <FeatureTooltip title="Event type" summary={`${EVENT_TYPE_LABELS[event.type]} · ${event.code}`} position="top" width={220}>
            <span className="usb-chip">
              <i className="bi bi-stars" /> {EVENT_TYPE_LABELS[event.type]}
            </span>
          </FeatureTooltip>
          <FeatureTooltip title="Status" summary={EVENT_STATUS_LABELS[event.status]} position="top" width={220}>
            <span className="usb-chip gear">
              <i className="bi bi-check2-circle" /> {EVENT_STATUS_LABELS[event.status]}
            </span>
          </FeatureTooltip>
        </div>
      </div>
    </div>
  )
}

function Dashboard() {
  const { user, studio } = useMe()
  const [params, setParams] = useSearchParams()
  const [newEvent, setNewEvent] = useState(false)
  const [editEvent, setEditEvent] = useState<EventDto | null>(null)
  const [share, setShare] = useState(false)
  const [albumId, setAlbumId] = useState<string | null>(null)
  const [demoFaceSim, setDemoFaceSim] = useState(false)
  const [demoWhatsApp, setDemoWhatsApp] = useState(false)

  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardDto>('/dashboard') })

  // Deep links from global search: /?event=<id>
  const linkedEventId = params.get('event')
  const linkedEvent = useQuery({
    queryKey: ['event', linkedEventId],
    queryFn: () => api.get<EventDto>(`/events/${linkedEventId}`),
    enabled: Boolean(linkedEventId),
  })
  const shownEvent = editEvent ?? (linkedEventId ? (linkedEvent.data ?? null) : null)
  const closeEdit = () => {
    setEditEvent(null)
    if (linkedEventId) setParams((p) => (p.delete('event'), p), { replace: true })
  }

  // WhatsApp preview uses the most urgent live selection.
  const previewSelection = useQuery({
    queryKey: ['selections', { status: 'active', limit: 1, sort: 'deadline' }],
    queryFn: () => api.get<Paginated<SelectionDto>>('/selections', { status: 'active', limit: 1, sort: 'deadline' }),
    enabled: demoWhatsApp,
  })
  const previewId = previewSelection.data?.data[0]?.id
  const preview = useQuery({
    queryKey: ['selection-preview', previewId, 'reminder'],
    queryFn: () => api.get<MessagePreviewDto>(`/selections/${previewId}/message-preview`, { type: 'reminder' }),
    enabled: Boolean(previewId),
  })

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
  const firstName = user.name.split(' ')[0]
  const d = q.data

  const quickActions = [
    { to: '/photo-selection', icon: 'images', label: 'New Selection', text: 'Let clients pick favourites', tone: 'wine', feature: featureInfo.photoSelection },
    { to: '/digital-album', icon: 'journal-album', label: 'Digital Album', text: 'Design a flipbook album', tone: 'gold', feature: featureInfo.digitalAlbum },
    ...(features.faceRecognition
      ? [{ to: '/face-recognition', icon: 'person-bounding-box', label: 'AI Face', text: 'Guests find their photos', tone: 'blue', feature: featureInfo.faceRecognition }]
      : []),
    { to: '/billing', icon: 'receipt', label: 'Create Bill', text: 'GST-ready invoices', tone: 'green', feature: featureInfo.billing },
    { to: '/my-website', icon: 'globe2', label: 'Manage Website', text: 'Update your portfolio', tone: 'gold', feature: featureInfo.myWebsite },
    { to: '/whatsapp-credit', icon: 'whatsapp', label: 'WhatsApp Credit', text: `${formatNumber(studio.creditBalance)} credits left`, tone: 'green', feature: featureInfo.whatsappCredit },
  ]

  return (
    <div className="stack">
      <PageHeader
        eyebrow={today}
        featureBadge={`Studio ${studio.plan.name} · ${new Date().getFullYear()} Season`}
        title={`${greeting()}, ${firstName}`}
        subtitle="Here's what's happening across your weddings this season. Hover over any feature to reveal its superpowers."
        actions={
          <>
            <FeatureTooltip
              title="Share Digital Gallery"
              badge="Client Portal"
              icon="share"
              summary="Send private selection and album links to couples on WhatsApp."
              position="bottom"
              width={280}
            >
              <button className="btn btn-ghost" onClick={() => setShare(true)}>
                <i className="bi bi-share" />
                Share Gallery
              </button>
            </FeatureTooltip>

            <FeatureTooltip
              title="Create New Wedding Event"
              badge="Quick Setup"
              icon="plus-circle"
              summary="Create a new event workspace for a client, then add photo selections, albums and invoices to it."
              position="bottom"
              width={280}
            >
              <button className="btn btn-primary" onClick={() => setNewEvent(true)}>
                <i className="bi bi-plus-lg" />
                New Event
              </button>
            </FeatureTooltip>
          </>
        }
      />

      {/* Catchy Feature Capabilities Ribbon */}
      <FeatureBar items={studioHighlights} />

      {/* Interactive Studio Lab & Live Demos Bar */}
      <div className="interactive-demos-bar">
        <div className="idb-header">
          <span className="pill pill-warning">
            <i className="bi bi-magic" /> Studio Labs
          </span>
          <strong>Live Feature Demos:</strong>
          <span className="muted" style={{ fontSize: 13 }}>
            Experience client workflows directly in this preview:
          </span>
        </div>
        <div className="idb-actions">
          <FeatureTooltip
            title="Interactive 3D Virtual Album"
            summary="Open a wedding album as a flipbook with spread-by-spread navigation, zoom, and couple feedback notes."
            position="bottom"
            width={280}
          >
            <button className="btn btn-sm btn-gold" onClick={() => d?.recentAlbums[0] && setAlbumId(d.recentAlbums[0].id)} disabled={!d?.recentAlbums.length}>
              <i className="bi bi-book-half" /> Test 3D Flipbook Demo
            </button>
          </FeatureTooltip>

          {features.faceRecognition && (
            <FeatureTooltip
              title="AI Face Recognition Scanner"
              summary="Simulate an attendee scanning a selfie and receiving their matching photos in < 1.5 seconds."
              position="bottom"
              width={280}
            >
              <button className="btn btn-sm btn-ghost" onClick={() => setDemoFaceSim(true)}>
                <i className="bi bi-cpu-fill" style={{ color: 'var(--success)' }} /> Try AI Face Scanner
              </button>
            </FeatureTooltip>
          )}

          <FeatureTooltip
            title="Client WhatsApp Nudge Preview"
            summary="View the realistic smartphone WhatsApp reminder message couples receive."
            position="bottom"
            width={280}
          >
            <button className="btn btn-sm btn-ghost" onClick={() => setDemoWhatsApp(true)}>
              <i className="bi bi-whatsapp" style={{ color: 'var(--success)' }} /> Preview WhatsApp Message
            </button>
          </FeatureTooltip>
        </div>
      </div>

      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <div className="card">
          <ErrorState error={q.error} onRetry={() => q.refetch()} title="We could not load your dashboard" />
        </div>
      ) : (
        <>
          <NextAssignment event={d!.nextAssignment} onOpen={setEditEvent} />

          <div className="grid grid-4">
            <StatCard
              icon="calendar-heart"
              label="Total Events"
              value={formatNumber(d!.stats.totalEvents.value)}
              trend={d!.stats.totalEvents.trend}
              tone="wine"
              tooltip={{
                title: 'Total Wedding Assignments',
                badge: `${d!.stats.totalEvents.value} Bookings`,
                icon: 'calendar-heart',
                summary: 'Aggregates all wedding shoots, engagements, and sangeets actively managed by your studio.',
                highlights: [`${d!.stats.upcomingEvents} upcoming events scheduled`],
                metric: `${d!.stats.totalEvents.trend >= 0 ? '+' : ''}${d!.stats.totalEvents.trend}% new bookings vs last month`,
                tip: 'Add every booking here to avoid double-booking your primary photographers.',
              }}
            />
            <StatCard
              icon="images"
              label="Photo Selections"
              value={formatNumber(d!.stats.photoSelections.value)}
              trend={d!.stats.photoSelections.trend}
              tone="gold"
              tooltip={{
                title: 'Selection Galleries',
                badge: `${d!.stats.activeSelections} Live`,
                icon: 'images',
                summary: 'Private proofing links where couples are reviewing and hearting their favorite shots.',
                highlights: ['Real-time quota lock prevents over-picking', 'Export picks for Lightroom', 'WhatsApp reminder nudges'],
                tip: 'Send WhatsApp nudges on Friday evenings when couples review photos together.',
              }}
            />
            <StatCard
              icon="journal-album"
              label="Digital Albums"
              value={formatNumber(d!.stats.digitalAlbums.value)}
              trend={d!.stats.digitalAlbums.trend}
              tone="blue"
              tooltip={{
                title: '3D Virtual Flipbook Albums',
                badge: `${d!.stats.publishedAlbums} Published`,
                icon: 'journal-album',
                summary: 'Digital flipbooks shared with clients before sending to physical print labs.',
                highlights: ['Spread-by-spread navigation', 'Direct spread commenting & client revisions', 'Private share links'],
                tip: 'Collect client spread sign-offs before placing physical print lab orders.',
              }}
            />
          </div>

          {/* Hero Showcase + Quick Actions */}
          <div className="grid grid-2">
            <FeatureTooltip
              title="Seasonal Booking Campaign"
              badge="Featured Campaign"
              icon="megaphone"
              summary={
                d!.activeBanner
                  ? `Your active campaign '${d!.activeBanner.title}' is featured across your client galleries.`
                  : 'Add a gallery banner to feature a campaign across your client galleries.'
              }
              highlights={[
                'Drives up to 34% more album upgrades and second-shooter inquiries',
                'Displays automatically on mobile galleries and flipbooks',
                'Can be customized anytime in the Gallery Banner manager',
              ]}
              position="right"
              width={320}
            >
              <Link to="/gallery-banner" className="hero hero-catchy" style={{ display: 'block' }}>
                <img src={d!.activeBanner ? fileUrl(d!.activeBanner.imageUrl) : poster} alt={d!.activeBanner?.title ?? 'Gallery banner'} />
                <div className="hero-overlay">
                  <span className="hero-tag">
                    <i className="bi bi-megaphone" /> {d!.activeBanner ? 'Active Campaign' : 'No active campaign'}
                  </span>
                  <div className="hero-banner-info">
                    <h3>{d!.activeBanner?.title ?? 'Feature your next campaign'}</h3>
                    <p>{d!.activeBanner?.endDate ? `Running until ${formatDate(d!.activeBanner.endDate)}` : 'Manage in Gallery Banner'}</p>
                  </div>
                </div>
                <span className="hero-pulse" />
              </Link>
            </FeatureTooltip>

            <Card title="Quick Actions" subtitle="Point cursor at any tool to view its superpowers" feature={featureInfo.dashboard}>
              <div className="actions-grid">
                {quickActions.map((a) => (
                  <FeatureTooltip key={a.to} feature={a.feature as FeatureInfo} position="top" width={300} delay={100}>
                    <Link to={a.to} className="action-tile action-tile-catchy">
                      <span className={`stat-icon tone-${a.tone}`}>
                        <i className={`bi bi-${a.icon}`} />
                      </span>
                      <div>
                        <strong>
                          {a.label}
                          <i className="bi bi-chevron-right action-arrow" />
                        </strong>
                        <span>{a.text}</span>
                      </div>
                      <span className="action-hover-hint">Point cursor for info</span>
                    </Link>
                  </FeatureTooltip>
                ))}
              </div>
            </Card>
          </div>

          {/* Events Table & Client Activity */}
          <div className="grid grid-2-1">
            <Card
              title="Recent Events"
              subtitle="Your latest bookings and their live client progress"
              action={
                <Link to="/photo-selection" className="link">
                  View all <i className="bi bi-arrow-right" />
                </Link>
              }
              flush
            >
              {d!.recentEvents.length === 0 ? (
                <EmptyState
                  icon="calendar-plus"
                  title="No events yet"
                  text="Create your first wedding event to get started."
                  action={
                    <button className="btn btn-primary" onClick={() => setNewEvent(true)}>
                      <i className="bi bi-plus-lg" /> New Event
                    </button>
                  }
                />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>
                          <FeatureTooltip title="Event ID" summary="Unique tracking code for invoices, client albums, and Lightroom collections." position="top" width={220}>
                            <span className="table-th-interactive">
                              Event ID <i className="bi bi-info-circle" />
                            </span>
                          </FeatureTooltip>
                        </th>
                        <th>Event & Venue</th>
                        <th>Customer</th>
                        <th>Date</th>
                        <th>
                          <FeatureTooltip title="Workflow Status" summary="Live milestone indicator. Hover over any pill to see pending actions." position="top" width={240}>
                            <span className="table-th-interactive">
                              Status <i className="bi bi-info-circle" />
                            </span>
                          </FeatureTooltip>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {d!.recentEvents.map((e) => (
                        <tr key={e.id} onClick={() => setEditEvent(e)} style={{ cursor: 'pointer' }} title="Edit event">
                          <td className="mono">{e.code}</td>
                          <td>
                            <div className="cell-main">{e.title}</div>
                            <div className="cell-sub">
                              <i className="bi bi-geo-alt" /> {e.city}
                            </div>
                          </td>
                          <td>
                            <div className="person">
                              <Avatar name={e.client.name} size={30} />
                              {e.client.name}
                            </div>
                          </td>
                          <td>{formatDate(e.date)}</td>
                          <td>
                            <StatusPill status={EVENT_STATUS_LABELS[e.status]} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Live Client Activity" subtitle="Real-time actions taken by couples and guests">
              {d!.activity.length === 0 ? (
                <EmptyState icon="activity" title="No activity yet" text="Client picks, feedback, payments and enquiries will appear here." />
              ) : (
                <ul className="activity">
                  {d!.activity.map((a) => (
                    <li key={a.id} className="activity-item">
                      <span className="stat-icon tone-wine">
                        <i className={`bi bi-${a.icon}`} />
                      </span>
                      <div>
                        <p>
                          <strong>{a.title}</strong> {a.body}
                        </p>
                        <time dateTime={a.createdAt}>{timeAgo(a.createdAt)}</time>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Analytics, Pipeline, and App promo */}
          <div className="grid grid-3">
            <Card
              title="Booking Analytics"
              subtitle="Wedding assignments booked per month"
              feature={{
                title: 'Seasonal Booking Trends',
                badge: 'Analytics',
                icon: 'bar-chart',
                summary: 'Visualize your shoot workload to plan second shooters, gear rentals, and album deadlines.',
              }}
            >
              <EventsChart data={d!.monthlyEvents} />
            </Card>

            <Card
              title="Deliverables Pipeline"
              subtitle="Active post-production and print progress"
              feature={{
                title: 'Post-Production Tracking',
                badge: 'Deliverables',
                icon: 'check2-all',
                summary: 'Client selection progress (picked vs quota) and albums moving from design to review.',
              }}
            >
              {d!.pipeline.length === 0 ? (
                <p className="muted">Nothing in progress — new selections and albums will show here.</p>
              ) : (
                d!.pipeline.map((p) => (
                  <Link to={p.link} className="progress-row" key={p.name} style={{ display: 'block' }}>
                    <div className="progress-meta">
                      <strong>{p.name}</strong>
                      <span>{p.progress}%</span>
                    </div>
                    <Progress value={p.progress} label={p.name} />
                  </Link>
                ))
              )}
            </Card>
          </div>

          {/* Recent Albums */}
          <Card
            title="Recent Digital Albums"
            subtitle="Virtual flipbooks ready for client sharing"
            action={
              <Link to="/digital-album" className="link">
                All albums <i className="bi bi-arrow-right" />
              </Link>
            }
          >
            {d!.recentAlbums.length === 0 ? (
              <EmptyState
                icon="journal-album"
                title="No albums yet"
                text="Create a flipbook album from an event's photos."
                action={
                  <Link to="/digital-album?create=1" className="btn btn-primary">
                    <i className="bi bi-plus-lg" /> Create Album
                  </Link>
                }
              />
            ) : (
              <div className="album-grid">
                {d!.recentAlbums.map((a: AlbumDto) => (
                  <AlbumCard key={a.id} album={a} onOpen={(x) => setAlbumId(x.id)} />
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      <EventModal open={newEvent} onClose={() => setNewEvent(false)} />
      <EventModal open={Boolean(shownEvent)} onClose={closeEdit} event={shownEvent} />
      <ShareGalleryModal open={share} onClose={() => setShare(false)} />
      {albumId && <AlbumViewer albumId={albumId} onClose={() => setAlbumId(null)} />}
      {features.faceRecognition && <FaceMatchSimulator isOpen={demoFaceSim} onClose={() => setDemoFaceSim(false)} />}
      <WhatsAppPreviewModal
        isOpen={demoWhatsApp}
        onClose={() => setDemoWhatsApp(false)}
        preview={preview.data}
        loading={previewSelection.isPending || (Boolean(previewId) && preview.isPending)}
        error={previewSelection.isSuccess && !previewId ? 'No active selection to preview yet — create one in Photo Selection.' : null}
      />
    </div>
  )
}

export default Dashboard
