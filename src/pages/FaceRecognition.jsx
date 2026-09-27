import { PageHeader, Card, StatCard, StatusPill, Progress } from '../components/ui'
import db from '../data'
import { formatNumber } from '../utils/format'

function FaceRecognition() {
  const { faceEvents, stats, subscription } = db
  const scans = subscription.usage.find((u) => u.label === 'Face scans')
  const guests = faceEvents.reduce((sum, e) => sum + e.guests, 0)

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Services"
        title="AI Face Recognition"
        subtitle="Guests take one selfie and instantly get every photo they appear in — no more scrolling through thousands."
        actions={<button className="btn btn-primary"><i className="bi bi-upload" />Upload Event Photos</button>}
      />

      <div className="grid grid-3">
        <StatCard icon="person-check" label="Photos matched" value={formatNumber(stats.faceMatches.value)} trend={stats.faceMatches.trend} tone="green" />
        <StatCard icon="people" label="Guests served" value={formatNumber(guests)} tone="wine" />
        <StatCard icon="cpu" label="Scans left this month" value={formatNumber(scans.limit - scans.used)} tone="blue" />
      </div>

      <Card title="How it works">
        <div className="steps">
          <div className="step"><strong>Upload photos</strong><p>Add the full event gallery. We index every face automatically.</p></div>
          <div className="step"><strong>Share the guest link</strong><p>Send it on WhatsApp or print the QR code at the venue.</p></div>
          <div className="step"><strong>Guests take a selfie</strong><p>Each guest instantly sees and downloads only their photos.</p></div>
        </div>
      </Card>

      <Card title="Events" subtitle="Face recognition status per event" flush>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Event</th>
                <th className="num">Photos</th>
                <th style={{ minWidth: 200 }}>Guests matched</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {faceEvents.map((e) => (
                <tr key={e.event}>
                  <td className="cell-main">{e.event}</td>
                  <td className="num">{formatNumber(e.photos)}</td>
                  <td>
                    <div className="progress-meta" style={{ marginBottom: 6 }}>
                      <span>{e.matched} / {e.guests || '—'}</span>
                    </div>
                    <Progress value={e.matched} max={e.guests || 1} label={`${e.event} guests matched`} />
                  </td>
                  <td><StatusPill status={e.status} /></td>
                  <td className="num">
                    <button className="btn btn-ghost btn-sm" disabled={e.status === 'Not Started'}><i className="bi bi-qr-code" />Guest link</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export default FaceRecognition
