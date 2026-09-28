import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader, Card, EmptyState, FeatureTooltip, FeatureBar } from '../components/ui'
import db from '../data'
import { featureInfo } from '../data/featureInfo'

const helpFeatures = [
  {
    title: 'Video Masterclasses',
    badge: 'HD Tutorials',
    icon: 'play-circle',
    summary: 'Watch step-by-step 5-minute video tutorials covering the complete workflow from photoshoot upload to album delivery.',
    highlights: ['Lightroom export setup', 'QR stand printing guides', 'Client selection psychology tips'],
    tip: 'Watch the "Fast Client Proofing" video to double your speed.'
  },
  {
    title: 'Print Lab Specs',
    badge: 'Lab Guides',
    icon: 'printer',
    summary: 'Exact page bleed dimensions, color ICC profiles, and binding guides for top print labs across India.',
    highlights: ['Canvera, Photostop, and Mazda presets', 'CMYK fogra39 calibration notes', 'Silk vs velvet paper recommendations'],
    tip: 'Download our export presets directly into InDesign.'
  },
  {
    title: 'Legal Contract Templates',
    badge: 'Free Downloads',
    icon: 'file-text',
    summary: 'Lawyer-verified wedding photography contract templates covering deposits, cancellations, and copyright.',
    highlights: ['Includes model release clauses', 'Drone flight disclaimer wording', 'Milestone payment schedules'],
    tip: 'Always get client signature before reserving wedding dates.'
  },
  {
    title: '24/7 Studio Concierge',
    badge: '< 15m Reply',
    icon: 'headset',
    summary: 'Our engineering and photography support specialists are available on live chat and WhatsApp.',
    highlights: ['Weekend priority queue for live shoots', 'Screen-share DNS setup assistance', 'Instant album recovery'],
    tip: 'Tag urgent shoot issues as High Priority for rapid escalations.'
  }
]

const topics = [
  {
    icon: 'rocket-takeoff',
    title: 'Getting started',
    text: 'Set up your studio in 10 minutes',
    summary: 'Configure your studio brand mark, color palette, custom domain, and upload your first wedding event.'
  },
  {
    icon: 'images',
    title: 'Selections & albums',
    text: 'Share, select and deliver',
    summary: 'Master the client selection proofing workflow, 3D flipbook creation, and Lightroom XML catalog exports.'
  },
  {
    icon: 'person-bounding-box',
    title: 'Face recognition',
    text: 'Guest links, QR codes, privacy',
    summary: 'Learn how to generate printable table stands, configure watermark overlays, and batch index wedding attendee faces.'
  },
  {
    icon: 'receipt',
    title: 'Billing & GST',
    text: 'Invoices, payments, refunds',
    summary: 'Generate GST-compliant tax invoices (SAC 9983), track advance deposits, and accept client payments via UPI.'
  },
]

function HelpCenter() {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const faqs = db.faqs.filter((f) => !q || f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q))

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Account & Support"
        featureBadge="24/7 Knowledge Base"
        title="Studio Help Center"
        subtitle="Answers, tutorials, and masterclass guides for scaling your wedding photography studio on Weddingz."
      />

      {/* Feature Capabilities Ribbon */}
      <FeatureBar items={helpFeatures} />

      <label className="search" style={{ maxWidth: 560, height: 50 }}>
        <i className="bi bi-search" />
        <input
          type="search"
          placeholder="Search help articles, guides, presets… (e.g. Lightroom, QR code)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      <div className="grid grid-4">
        {topics.map((t) => (
          <FeatureTooltip
            key={t.title}
            title={t.title}
            summary={t.summary}
            position="top"
            width={270}
          >
            <a href="#faq" className="topic" style={{ height: '100%' }}>
              <span className="stat-icon tone-gold"><i className={`bi bi-${t.icon}`} /></span>
              <div>
                <strong>{t.title}</strong>
                <p>{t.text}</p>
                <span className="action-hover-hint" style={{ marginTop: 6 }}>Point cursor for overview</span>
              </div>
            </a>
          </FeatureTooltip>
        ))}
      </div>

      <Card
        title="Frequently Asked Questions"
        subtitle="Click any question to view the detailed guide"
        className="faq"
        feature={featureInfo.help}
      >
        <div id="faq">
          {faqs.length > 0 ? (
            faqs.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))
          ) : (
            <EmptyState
              icon="search"
              title="No matching answers"
              text="Try different keywords, or connect directly with our studio support team."
              action={<Link to="/support" className="btn btn-primary">Raise a ticket</Link>}
            />
          )}
        </div>
      </Card>
    </div>
  )
}

export default HelpCenter
