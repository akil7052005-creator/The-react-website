import { useState } from 'react'
import { PageHeader, Card, StatCard, StatusPill, Progress, FeatureTooltip, FeatureBar } from '../components/ui'
import { faceDemo } from '../data/faceDemo'
import { formatNumber } from '../utils/format'
import { featureInfo } from '../data/featureInfo'
import FaceMatchSimulator from '../components/FaceMatchSimulator'

const faceAiFeatures = [
  {
    title: 'Neural Face Matching',
    badge: '99.8% Precision',
    icon: 'cpu',
    summary: 'Identifies wedding guests even in crowded dance floors, side profiles, wearing sunglasses, turbans, or traditional wedding jewelry.',
    highlights: ['Deep learning 512-dimension face embeddings', 'Trained specifically on Indian & destination weddings', 'Automatic group photo detection'],
    tip: 'Works with RAW, JPG, and compressed camera feeds.'
  },
  {
    title: 'Venue QR Table Stands',
    badge: 'Zero App Download',
    icon: 'qr-code-scan',
    summary: 'Generate print-ready, branded QR table cards to place at dinner tables and reception halls.',
    highlights: ['Guests scan with native iPhone/Android camera', 'Direct browser match without installing apps', 'Branded with your studio logo and Instagram handle'],
    tip: 'Place QR cards near the cocktail lounge for 2.4x higher guest selfie scans.'
  },
  {
    title: 'Studio Watermark Overlay',
    badge: 'Free Brand Viral',
    icon: 'shield-check',
    summary: 'Every photo downloaded by guests can include an elegant studio logo watermark in the bottom corner.',
    highlights: ['Automatic high-res placement', 'Spreads your studio name across guest Instagram & WhatsApp stories', 'Couples get clean unwatermarked files'],
    tip: 'Drives on average 3 new wedding inquiries from every 100 guest downloads.'
  },
  {
    title: 'Lightning Cloud Indexing',
    badge: '< 1.5s Response',
    icon: 'lightning-charge',
    summary: 'Processes thousands of high-resolution images in background clusters with zero server downtime.',
    highlights: ['Indexes 3,000 photos in under 4 minutes', 'Real-time match streaming as guests take selfies', 'End-to-end encrypted guest privacy'],
    tip: 'Start upload immediately after the wedding reception for morning-after guest searches.'
  }
]

function FaceRecognition() {
  const [showSim, setShowSim] = useState(false)
  const { faceEvents, stats, scans } = faceDemo
  const guests = faceEvents.reduce((sum, e) => sum + e.guests, 0)

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Services"
        featureBadge="AI Neural Engine · Meta Ready"
        title="AI Face Recognition"
        subtitle="Guests take one selfie and instantly get every photo they appear in from thousands of shots — zero app download needed."
        actions={
          <>
            <FeatureTooltip
              title="Launch Live AI Simulator"
              summary="Interactive test showing how guests experience the 1.5s selfie photo match."
              position="bottom"
              width={260}
            >
              <button className="btn btn-gold" onClick={() => setShowSim(true)}>
                <i className="bi bi-cpu-fill" /> Try Live AI Simulator
              </button>
            </FeatureTooltip>

            <FeatureTooltip
              title="Upload Event Photos for AI Indexing"
              badge="Batch AI Index"
              icon="cloud-arrow-up"
              summary="Upload your culls or full event gallery to index all attendee faces in the background."
              position="bottom"
              width={300}
            >
              <button className="btn btn-primary">
                <i className="bi bi-upload" />Upload Event Photos
              </button>
            </FeatureTooltip>
          </>
        }
      />

      {/* Feature Capabilities Ribbon */}
      <FeatureBar items={faceAiFeatures} />

      <div className="grid grid-3">
        <StatCard
          icon="person-check"
          label="Photos Matched"
          value={formatNumber(stats.faceMatches.value)}
          trend={stats.faceMatches.trend}
          tone="green"
          tooltip={{
            title: 'Guest Photos Delivered',
            badge: `${formatNumber(stats.faceMatches.value)} Matches`,
            icon: 'person-check',
            summary: 'Number of individual wedding photos identified and downloaded by wedding attendees.',
            highlights: ['+21% increase from last month', 'Zero manual search time for guests'],
            tip: 'Each matched photo carries your studio watermark.'
          }}
        />
        <StatCard
          icon="people"
          label="Guests Served"
          value={formatNumber(guests)}
          tone="wine"
          tooltip={{
            title: 'Total Wedding Attendees',
            badge: `${formatNumber(guests)} Guests`,
            icon: 'people',
            summary: 'Unique wedding guests who have scanned venue QR codes and taken a selfie.',
            highlights: ['High guest satisfaction rating', 'Massive brand exposure for your studio']
          }}
        />
        <StatCard
          icon="cpu"
          label="Scans Left This Month"
          value={formatNumber(scans.limit - scans.used)}
          tone="blue"
          tooltip={{
            title: 'Monthly AI Scan Quota',
            badge: `${formatNumber(scans.limit - scans.used)} / ${formatNumber(scans.limit)} Left`,
            icon: 'cpu',
            summary: 'Number of AI selfie scans remaining in your Pro studio tier for this billing cycle.',
            highlights: ['Resets on 2nd Nov', 'Upgrade to All-Access for unmetered scans'],
            tip: 'Need more for a 1,000-guest wedding? Upgrade to All-Access.'
          }}
        />
      </div>

      <Card
        title="How AI Face Recognition Works"
        subtitle="Point cursor at any step to understand the frictionless guest journey"
        feature={featureInfo.faceRecognition}
      >
        <div className="steps">
          <FeatureTooltip
            title="Step 1: Background AI Indexing"
            badge="Studio Side"
            icon="cloud-upload"
            summary="Drop your event gallery into Weddingz. Our neural network detects, aligns, and indexes every face in parallel."
            highlights={['Processes 1,000 photos in 90 seconds', 'Identifies groups, candid moments, and portraits']}
            position="top"
            width={280}
          >
            <div className="step step-interactive">
              <strong>1. Upload Photos</strong>
              <p>Add the full event gallery. We index every face automatically using neural embeddings.</p>
              <span className="step-hover-hint">Point cursor for details</span>
            </div>
          </FeatureTooltip>

          <FeatureTooltip
            title="Step 2: Instant QR Access"
            badge="Guest Access"
            icon="qr-code"
            summary="Print the high-resolution QR poster or send the short link via WhatsApp group chats."
            highlights={['Works on iPhone and Android native cameras', 'Zero app installation required']}
            position="top"
            width={280}
          >
            <div className="step step-interactive">
              <strong>2. Share Guest Link</strong>
              <p>Send it on WhatsApp or print the QR table stands at the wedding banquet hall.</p>
              <span className="step-hover-hint">Point cursor for details</span>
            </div>
          </FeatureTooltip>

          <FeatureTooltip
            title="Step 3: Instant 1.5s Matching"
            badge="Instant Result"
            icon="camera"
            summary="Guest snaps a quick selfie. In under 1.5 seconds, all matching photos are presented with instant download."
            highlights={['Guests can download originals or social-ready watermarked versions', 'Private and secure']}
            position="top"
            width={280}
          >
            <div className="step step-interactive">
              <strong>3. Guests Take a Selfie</strong>
              <p>Each guest instantly sees and downloads only their photos with your studio branding.</p>
              <span className="step-hover-hint">Point cursor for details</span>
            </div>
          </FeatureTooltip>
        </div>
      </Card>

      <Card
        title="Active Event Galleries"
        subtitle="AI Face recognition status and guest participation per wedding"
        flush
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Event</th>
                <th className="num">Indexed Photos</th>
                <th style={{ minWidth: 200 }}>
                  <FeatureTooltip
                    title="Guest Participation Rate"
                    summary="Number of guests who have found and downloaded their photos out of estimated venue attendees."
                    position="top"
                    width={260}
                  >
                    <span className="table-th-interactive">Guests Matched <i className="bi bi-info-circle" /></span>
                  </FeatureTooltip>
                </th>
                <th>Status</th>
                <th className="num">Guest Stand</th>
              </tr>
            </thead>
            <tbody>
              {faceEvents.map((e) => (
                <tr key={e.event}>
                  <td className="cell-main">{e.event}</td>
                  <td className="num cell-main">{formatNumber(e.photos)}</td>
                  <td>
                    <div className="progress-meta" style={{ marginBottom: 6 }}>
                      <span><strong>{e.matched}</strong> / {e.guests || '—'} guests</span>
                      <small style={{ color: 'var(--wine)', fontWeight: 600 }}>
                        {e.guests ? `${Math.round((e.matched / e.guests) * 100)}% reach` : 'Awaiting upload'}
                      </small>
                    </div>
                    <Progress value={e.matched} max={e.guests || 1} label={`${e.event} guests matched`} />
                  </td>
                  <td><StatusPill status={e.status} /></td>
                  <td className="num">
                    <FeatureTooltip
                      title="Printable QR Stand"
                      summary={`Generate instant printable table tent stand and short link for ${e.event}.`}
                      position="left"
                      width={260}
                    >
                      <button className="btn btn-ghost btn-sm" disabled={e.status === 'Not Started'}>
                        <i className="bi bi-qr-code" /> Guest Link
                      </button>
                    </FeatureTooltip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <FaceMatchSimulator
        isOpen={showSim}
        onClose={() => setShowSim(false)}
      />
    </div>
  )
}

export default FaceRecognition
