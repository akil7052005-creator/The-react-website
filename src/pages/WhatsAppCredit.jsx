import { useState } from 'react'
import { PageHeader, Card, StatusPill, FeatureTooltip, FeatureBar } from '../components/ui'
import db from '../data'
import { formatINR, formatNumber } from '../utils/format'
import { featureInfo } from '../data/featureInfo'

const waFeatures = [
  {
    title: 'Official Meta Cloud API',
    badge: '100% Safe',
    icon: 'shield-check',
    summary: 'Direct integration with Meta WhatsApp Business Cloud API ensures zero risk of phone number bans or spam flags.',
    highlights: ['99.9% message deliverability', 'Official Verified Business branding', 'Zero setup required from studio'],
    tip: 'Clients trust verified business messages 4x more than random personal numbers.'
  },
  {
    title: 'Credits Never Expire',
    badge: 'No Lock-in',
    icon: 'infinity',
    summary: 'Any WhatsApp credits you top up carry over indefinitely and never expire across wedding seasons.',
    highlights: ['1 credit = 1 delivered message', 'Use across photo selection, face AI, and invoices', 'Top up once for the whole year'],
    tip: 'Stock up during festive seasonal discounts.'
  },
  {
    title: 'Read & Delivery Receipts',
    badge: 'Live Status',
    icon: 'check2-all',
    summary: 'Track in real-time whether your client has received, opened, and clicked the gallery link.',
    highlights: ['Blue double-tick tracking', 'Click analytics on gallery links', 'Automatic fallback if phone is unreachable'],
    tip: 'Check read receipts before making follow-up calls.'
  },
  {
    title: 'Personalized Templates',
    badge: 'Auto-Merged',
    icon: 'chat-left-quote',
    summary: 'Messages automatically insert client names, venue names, countdown timers, and personalized URLs.',
    highlights: ['Pre-approved WhatsApp business templates', 'Multilingual support (English, Hindi, Tamil, Telugu)', 'Branded with studio signature'],
    tip: 'Personalized wedding messages achieve a 98% open rate.'
  }
]

function WhatsAppCredit() {
  const { whatsapp } = db
  const [picked, setPicked] = useState(whatsapp.packs.findIndex((p) => p.popular))
  const pack = whatsapp.packs[picked]

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Wallet & Communications"
        featureBadge="Meta WhatsApp Business API"
        title="WhatsApp Credit Management"
        subtitle="Credits power automated client reminders, private proofing links, guest face search links, and GST invoices."
      />

      {/* Feature Capabilities Ribbon */}
      <FeatureBar items={waFeatures} />

      <div className="grid grid-1-2">
        <FeatureTooltip
          feature={featureInfo.whatsappCredit}
          position="right"
          width={310}
        >
          <Card title="Available Credits" subtitle="Your live WhatsApp messaging balance">
            <div className="wa-balance-card">
              <span className="wa-icon-glow">
                <i className="bi bi-whatsapp" />
              </span>
              <div>
                <p className="big-number">{formatNumber(whatsapp.credits)}</p>
                <p className="muted">
                  ≈ {Math.floor(whatsapp.credits / 200)} full weddings worth of guest notifications
                </p>
                <span className="pill pill-success" style={{ marginTop: 8 }}>
                  <i className="bi bi-check-circle" /> Ready to send
                </span>
              </div>
            </div>
          </Card>
        </FeatureTooltip>

        <Card title="Top Up Credits" subtitle="Credits never expire · Instant activation">
          <p className="perks-hint" style={{ marginBottom: 12 }}>
            <i className="bi bi-cursor-fill" /> Point cursor on any pack to see how many weddings it powers:
          </p>
          <div className="grid grid-3" style={{ gap: 12 }}>
            {whatsapp.packs.map((p, i) => (
              <FeatureTooltip
                key={p.credits}
                title={`${formatNumber(p.credits)} WhatsApp Credits`}
                badge={`₹${(p.price / p.credits).toFixed(2)} / msg`}
                summary={`Powers approximately ${Math.round(p.credits / 150)} weddings with complete proofing, guest selfie links, and payment nudges.`}
                position="top"
                width={260}
              >
                <button
                  className={`pack pack-catchy ${picked === i ? 'selected' : ''}`}
                  onClick={() => setPicked(i)}
                >
                  {p.popular ? (
                    <span className="pill pill-warning">Most Popular</span>
                  ) : (
                    <span className="muted" style={{ fontSize: 11 }}>Pack Option</span>
                  )}
                  <strong>{formatNumber(p.credits)}</strong>
                  <span className="muted">credits · {formatINR(p.price)}</span>
                </button>
              </FeatureTooltip>
            ))}
          </div>
          <div className="form-foot">
            <button className="btn btn-primary btn-lg">
              <i className="bi bi-lightning-charge-fill" /> Buy {formatNumber(pack.credits)} Credits for {formatINR(pack.price)}
            </button>
          </div>
        </Card>
      </div>

      <Card
        title="Recent Message Log"
        subtitle="Live delivery and read status for messages dispatched by your studio"
        feature={{
          title: 'Automated Messaging Audit',
          badge: 'Real-time',
          icon: 'list-check',
          summary: 'Transparent delivery logging showing exactly which couple received links and their credit deductions.'
        }}
        flush
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Notification Type</th>
                <th className="num">Credits</th>
                <th>Sent Timestamp</th>
                <th>Delivery Status</th>
              </tr>
            </thead>
            <tbody>
              {whatsapp.log.map((m, i) => (
                <tr key={i}>
                  <td className="cell-main">{m.to}</td>
                  <td>
                    <span className="pill pill-neutral">{m.type}</span>
                  </td>
                  <td className="num cell-main">{m.credits}</td>
                  <td>{m.time}</td>
                  <td><StatusPill status={m.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export default WhatsAppCredit
