import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader, Card, StatCard, StatusPill, Progress, Avatar, FeatureTooltip, FeatureBar } from '../components/ui'
import db from '../data'
import { formatDate, formatNumber } from '../utils/format'
import { featureInfo } from '../data/featureInfo'
import AlbumCard from '../components/AlbumCard'
import poster from '../assets/wedding-poster-horizontal.png'
import FlipbookModal from '../components/FlipbookModal'
import FaceMatchSimulator from '../components/FaceMatchSimulator'
import WhatsAppPreviewModal from '../components/WhatsAppPreviewModal'

const quickActions = [
  {
    to: '/photo-selection',
    icon: 'images',
    label: 'New Selection',
    text: 'Let clients pick favourites',
    tone: 'wine',
    feature: featureInfo.photoSelection,
  },
  {
    to: '/digital-album',
    icon: 'journal-album',
    label: 'Digital Album',
    text: 'Design a flipbook album',
    tone: 'gold',
    feature: featureInfo.digitalAlbum,
  },
  {
    to: '/face-recognition',
    icon: 'person-bounding-box',
    label: 'AI Face',
    text: 'Guests find their photos',
    tone: 'blue',
    feature: featureInfo.faceRecognition,
  },
  {
    to: '/billing',
    icon: 'receipt',
    label: 'Create Bill',
    text: 'GST-ready invoices',
    tone: 'green',
    feature: featureInfo.billing,
  },
  {
    to: '/my-website',
    icon: 'globe2',
    label: 'Manage Website',
    text: 'Update your portfolio',
    tone: 'gold',
    feature: featureInfo.myWebsite,
  },
  {
    to: '/whatsapp-credit',
    icon: 'whatsapp',
    label: 'WhatsApp Credit',
    text: `${formatNumber(db.whatsapp.credits)} credits left`,
    tone: 'green',
    feature: featureInfo.whatsappCredit,
  },
]

const studioHighlights = [
  {
    title: 'AI Face Match',
    icon: 'person-bounding-box',
    badge: '1.5s Match',
    summary: 'Wedding guests scan a venue QR code, snap a selfie, and get every picture they are in.',
    highlights: ['99.8% neural accuracy', 'Instant QR venue access', 'Watermarked proofing'],
    tip: 'Print QR codes on guest dining tables for viral engagement.'
  },
  {
    title: 'Smart Selection',
    icon: 'images',
    badge: 'Live Sync',
    summary: 'Couples heart their favorite shots on their phone with automatic package quota lock.',
    highlights: ['Export directly to Lightroom XML', 'Zero login friction for couples', 'Real-time quota lock'],
    tip: 'WhatsApp reminders reduce selection turnaround to 3.2 days.'
  },
  {
    title: '3D Flipbook Album',
    icon: 'journal-album',
    badge: 'Interactive',
    summary: 'Transform layout designs into realistic 3D virtual flipbooks with audio page turns.',
    highlights: ['Spread commenting & approval', 'High-res zoom on bridal jewelry', 'Password protected links'],
    tip: 'Get digital approval before sending expensive physical print orders.'
  },
  {
    title: 'GST Invoicing',
    icon: 'receipt',
    badge: 'GST Ready',
    summary: 'Create GST-compliant photography invoices and collect advance payments via UPI.',
    highlights: ['Automated CGST/SGST/IGST', 'WhatsApp invoice delivery', 'Milestone payment reminders'],
    tip: 'Schedule reminders 48 hours prior to album handover.'
  }
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
          <FeatureTooltip
            key={d.month}
            title={`${d.month} Bookings`}
            badge={d.count === max ? 'Peak Season' : 'Active'}
            summary={`${d.count} wedding assignments scheduled for ${d.month}. Peak booking capacity is 12 shoots.`}
            position="top"
            width={240}
          >
            <div className={`bar ${d.count === max ? 'peak' : ''}`}>
              <span style={{ '--h': `${(d.count / max) * 100}%` }} />
              <em className="tip" style={{ '--h': `${(d.count / max) * 100}%`, fontStyle: 'normal' }}>{d.count}</em>
            </div>
          </FeatureTooltip>
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
  const [demoFlipbook, setDemoFlipbook] = useState(false)
  const [demoFaceSim, setDemoFaceSim] = useState(false)
  const [demoWhatsApp, setDemoWhatsApp] = useState(false)

  const { stats, events, activity, projects, albums, studio } = db
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="stack">
      <PageHeader
        eyebrow={today}
        featureBadge="Studio Pro · 2026 Season"
        title={`${greeting()}, ${studio.owner.split(' ')[0]}`}
        subtitle="Here's what's happening across your weddings this season. Hover over any feature to reveal its superpowers."
        actions={
          <>
            <FeatureTooltip
              title="Share Digital Gallery"
              badge="Client Portal"
              icon="share"
              summary="Generate instant WhatsApp links or QR codes to share private proofing albums with couples and guests."
              position="bottom"
              width={280}
            >
              <Link to="/digital-album" className="btn btn-ghost">
                <i className="bi bi-share" />Share Gallery
              </Link>
            </FeatureTooltip>

            <FeatureTooltip
              title="Create New Wedding Event"
              badge="Quick Setup"
              icon="plus-circle"
              summary="Create a new event workspace, set client selection quotas, and generate venue face-recognition QR stands."
              position="bottom"
              width={280}
            >
              <Link to="/photo-selection" className="btn btn-primary">
                <i className="bi bi-plus-lg" />New Event
              </Link>
            </FeatureTooltip>
          </>
        }
      />

      {/* Catchy Feature Capabilities Ribbon */}
      <FeatureBar items={studioHighlights} />

      {/* Interactive Studio Lab & Live Demos Bar */}
      <div className="interactive-demos-bar">
        <div className="idb-header">
          <span className="pill pill-warning"><i className="bi bi-magic" /> Studio Labs</span>
          <strong>Live Feature Demos:</strong>
          <span className="muted" style={{ fontSize: 13 }}>Experience client workflows directly in this preview:</span>
        </div>
        <div className="idb-actions">
          <FeatureTooltip
            title="Interactive 3D Virtual Album"
            summary="Open a photorealistic wedding album with page-curling animations, zoom, and couple feedback notes."
            position="bottom"
            width={280}
          >
            <button className="btn btn-sm btn-gold" onClick={() => setDemoFlipbook(true)}>
              <i className="bi bi-book-half" /> Test 3D Flipbook Demo
            </button>
          </FeatureTooltip>

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

      {/* Upcoming Wedding Shoot & Production Preparation Widget */}
      <div className="upcoming-shoot-banner">
        <div className="usb-left">
          <div className="usb-countdown">
            <span className="usb-days">7</span>
            <span className="usb-unit">DAYS LEFT</span>
          </div>
          <div className="usb-info">
            <div className="usb-tags">
              <span className="pill pill-warning"><i className="bi bi-calendar-event" /> Next Assignment · 4th Oct</span>
              <span className="pill pill-neutral"><i className="bi bi-geo-alt" /> Palace Grounds, Bengaluru</span>
            </div>
            <h3>Ananya & Rohan — Grand Reception Ceremony</h3>
            <p className="muted">
              450 expected attendees · Pre-reception golden hour portraits + indoor ballroom lighting.
            </p>
          </div>
        </div>

        <div className="usb-checklist">
          <p className="usb-cl-header"><i className="bi bi-camera-fill" /> Crew & Kit Assignment:</p>
          <div className="usb-crew-chips">
            <FeatureTooltip title="Lead Photographer" summary="Directing bridal portraits and family stage rituals." position="top" width={220}>
              <span className="usb-chip"><i className="bi bi-person-fill" /> Arjun (Lead)</span>
            </FeatureTooltip>
            <FeatureTooltip title="Candid Photographer" summary="Capturing natural laughs and guest banquet moments." position="top" width={220}>
              <span className="usb-chip"><i className="bi bi-person-fill" /> Kiran (Candid)</span>
            </FeatureTooltip>
            <FeatureTooltip title="Cinematographer" summary="4K 60fps gimbal footage & drone aerials." position="top" width={220}>
              <span className="usb-chip"><i className="bi bi-camera-reels-fill" /> Vikram (Cinema)</span>
            </FeatureTooltip>
            <FeatureTooltip title="Equipment Checklist" summary="3x Sony A7IV bodies, 70-200mm f/2.8 GM, 50mm f/1.2, 2x Godox V1 Flashes." position="top" width={260}>
              <span className="usb-chip gear"><i className="bi bi-check2-circle" /> Kit Packed (9 Items)</span>
            </FeatureTooltip>
          </div>
        </div>
      </div>

      {/* Catchy Stat Cards with Hover Tooltips */}
      <div className="grid grid-4">
        <StatCard
          icon="calendar-heart"
          label="Total Events"
          value={stats.totalEvents.value}
          trend={stats.totalEvents.trend}
          tone="wine"
          tooltip={{
            title: 'Total Wedding Assignments',
            badge: '48 Bookings',
            icon: 'calendar-heart',
            summary: 'Aggregates all 2026 wedding shoots, engagements, and sangeets actively managed by your studio.',
            highlights: ['12 upcoming weddings scheduled', '8 currently in culling & editing', '28 successfully delivered'],
            metric: '+12% growth vs previous season',
            tip: 'Keep your calendar synced to avoid double-booking primary photographers.'
          }}
        />
        <StatCard
          icon="images"
          label="Photo Selections"
          value={stats.photoSelections.value}
          trend={stats.photoSelections.trend}
          tone="gold"
          tooltip={{
            title: 'Active Selection Galleries',
            badge: '126 Live',
            icon: 'images',
            summary: 'Private proofing links where couples are reviewing and hearting their favorite shots.',
            highlights: ['Real-time quota lock prevents over-picking', '1-click export to Lightroom XML', 'Instant WhatsApp reminder nudges'],
            metric: 'Average selection turnaround: 3.2 days',
            tip: 'Send WhatsApp nudges on Friday evenings when couples review photos together.'
          }}
        />
        <StatCard
          icon="journal-album"
          label="Digital Albums"
          value={stats.digitalAlbums.value}
          trend={stats.digitalAlbums.trend}
          tone="blue"
          tooltip={{
            title: '3D Virtual Flipbook Albums',
            badge: '34 Published',
            icon: 'journal-album',
            summary: 'Photorealistic digital flipbooks shared with clients before sending to physical print labs.',
            highlights: ['Page-turn physics & audio feedback', 'Direct spread commenting & client revisions', 'Password protection for client privacy'],
            metric: '85% shared with extended family abroad',
            tip: 'Collect client spread sign-offs before placing physical print lab orders.'
          }}
        />
        
      </div>

      {/* Hero Showcase + Quick Actions */}
      <div className="grid grid-2">
        <FeatureTooltip
          title="Seasonal Booking Campaign"
          badge="Featured Campaign"
          icon="megaphone"
          summary="Your active promotional campaign 'Forever Begins Here' is currently featured across all client proofing galleries."
          highlights={[
            'Drives up to 34% more album upgrades and second-shooter inquiries',
            'Displays automatically on mobile galleries and flipbooks',
            'Can be customized anytime in the Gallery Banner manager'
          ]}
          position="right"
          width={320}
        >
          <div className="hero hero-catchy">
            <img src={poster} alt="Forever Begins Here — seasonal booking campaign" />
            <div className="hero-overlay">
              <span className="hero-tag">
                <i className="bi bi-megaphone" /> Active Campaign
              </span>
              <div className="hero-banner-info">
                <h3>Forever Begins Here</h3>
                <p>2026 Winter Wedding Season Showcase · Hover for details</p>
              </div>
            </div>
            <span className="hero-pulse" />
          </div>
        </FeatureTooltip>

        <Card
          title="Quick Actions"
          subtitle="Point cursor at any tool to view its superpowers"
          feature={featureInfo.dashboard}
        >
          <div className="actions-grid">
            {quickActions.map((a) => (
              <FeatureTooltip
                key={a.to}
                feature={a.feature}
                position="top"
                width={300}
                delay={100}
              >
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
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>
                    <FeatureTooltip
                      title="Event ID"
                      summary="Unique tracking code for invoices, client albums, and Lightroom collections."
                      position="top"
                      width={220}
                    >
                      <span className="table-th-interactive">Event ID <i className="bi bi-info-circle" /></span>
                    </FeatureTooltip>
                  </th>
                  <th>Event & Venue</th>
                  <th>Customer</th>
                  <th>Date</th>
                  <th>
                    <FeatureTooltip
                      title="Workflow Status"
                      summary="Live milestone indicator. Hover over any pill to see pending actions."
                      position="top"
                      width={240}
                    >
                      <span className="table-th-interactive">Status <i className="bi bi-info-circle" /></span>
                    </FeatureTooltip>
                  </th>
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

        <Card title="Live Client Activity" subtitle="Real-time actions taken by couples and guests">
          <ul className="activity">
            {activity.map((a, i) => (
              <li key={i} className="activity-item">
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

      {/* Analytics, Pipeline, and App promo */}
      <div className="grid grid-3">
        <Card
          title="Booking Analytics"
          subtitle="Wedding assignments booked per month"
          feature={{
            title: 'Seasonal Booking Trends',
            badge: 'Analytics',
            icon: 'bar-chart',
            summary: 'Visualize your annual shoot workload to plan second shooters, gear rentals, and album deadlines.',
            highlights: ['Peak seasons: Oct - Nov with 9-11 weddings', 'Quiet months: Jun - Jul for portfolio revamps', 'Projections indicate 28% YoY increase']
          }}
        >
          <EventsChart data={db.monthlyEvents} />
        </Card>

        <Card
          title="Deliverables Pipeline"
          subtitle="Active post-production and print progress"
          feature={{
            title: 'Post-Production Tracking',
            badge: 'Deliverables',
            icon: 'check2-all',
            summary: 'Track each assignment from RAW culling, color grading, client selections, through to physical album binding.',
            highlights: ['Automatic deadline warnings 7 days prior', 'Percentage syncs with client portal', 'Real-time bottleneck detection']
          }}
        >
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

        <FeatureTooltip
          title="Weddingz Mobile Companion"
          badge="iOS & Android"
          icon="phone"
          summary="Access your entire studio workflow anywhere: shoot locations, bride contacts, instant WhatsApp notifications, and payment receipts."
          highlights={[
            'Instant push notification when client completes selection',
            'On-site QR code display for guests without laptop setup',
            'Works seamlessly offline during remote destination shoots'
          ]}
          position="left"
          width={300}
        >
          <div className="app-promo app-promo-catchy">
            <p className="eyebrow"><i className="bi bi-phone" /> Weddingz Mobile</p>
            <h3>Your studio, in your pocket.</h3>
            <p>Share galleries, track selections and collect payments — right from your phone.</p>
            <div className="store-btns">
              <a href="#" className="store-btn"><i className="bi bi-apple" />App Store</a>
              <a href="#" className="store-btn"><i className="bi bi-google-play" />Google Play</a>
            </div>
            <span className="promo-ring" />
          </div>
        </FeatureTooltip>
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
        <div className="album-grid">
          {albums.slice(0, 4).map((a) => (
            <AlbumCard key={a.id} album={a} />
          ))}
        </div>
      </Card>

      {/* Interactive Studio Lab Demo Modals */}
      <FlipbookModal
        album={albums[0]}
        isOpen={demoFlipbook}
        onClose={() => setDemoFlipbook(false)}
      />

      <FaceMatchSimulator
        isOpen={demoFaceSim}
        onClose={() => setDemoFaceSim(false)}
      />

      <WhatsAppPreviewModal
        isOpen={demoWhatsApp}
        onClose={() => setDemoWhatsApp(false)}
        clientName="Priya & Karthik"
        eventName="Chennai Wedding"
      />
    </div>
  )
}

export default Dashboard
