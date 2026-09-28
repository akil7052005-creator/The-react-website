import { useState } from 'react'
import { PageHeader, Card, StatusPill, FeatureTooltip, FeatureBar } from '../components/ui'
import db from '../data'
import { formatDate } from '../utils/format'
import { featureInfo } from '../data/featureInfo'

const ticketFeatures = [
  {
    title: 'Guaranteed 4h SLA',
    badge: 'Fast Turnaround',
    icon: 'clock-history',
    summary: 'Our engineering and photography support desk responds to all studio inquiries in under 4 hours.',
    highlights: ['Weekend emergency support queue active', 'Assigned directly to dedicated engineer', 'Email & SMS notification on reply'],
    tip: 'Pro and All-Access members receive prioritized queue placement.'
  },
  {
    title: 'Screen-Share Assistance',
    badge: 'Live Support',
    icon: 'display',
    summary: 'Request a 1-on-1 Google Meet screen share for complex custom domain DNS or large RAW library uploads.',
    highlights: ['Live DNS verification with Cloudflare/GoDaddy', 'Lightroom catalog troubleshooting', 'Zero extra charge for studio members'],
    tip: 'Schedule screen shares during weekday mornings for fastest slots.'
  },
  {
    title: 'Album Recovery Vault',
    badge: 'Data Safety',
    icon: 'shield-check',
    summary: 'Accidentally deleted a gallery? Our recovery vault preserves backups of client selections for 90 days.',
    highlights: ['1-click historical restore', 'Preserves bride & groom heart selections', 'Audit trail of client actions'],
    tip: 'Open a ticket immediately if an accidental deletion occurs.'
  },
  {
    title: 'Dedicated WhatsApp Desk',
    badge: 'Pro & VIP',
    icon: 'whatsapp',
    summary: 'All-Access studio owners receive a direct private WhatsApp support line for instantaneous answers.',
    highlights: ['Direct line to engineering lead', 'Voice note queries accepted', 'Real-time shoot status checks'],
    tip: 'Upgrade to All-Access to unlock direct WhatsApp concierge.'
  }
]

function SupportTickets() {
  const [tickets, setTickets] = useState(db.tickets)
  const [showForm, setShowForm] = useState(false)

  const submit = (e) => {
    e.preventDefault()
    const form = new FormData(e.target)
    const ticket = {
      id: `TKT-${513 + tickets.length}`,
      subject: form.get('subject'),
      priority: form.get('priority'),
      updated: new Date().toISOString().slice(0, 10),
      status: 'Open',
    }
    setTickets([ticket, ...tickets])
    setShowForm(false)
  }

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Account & Support"
        featureBadge="Priority Helpdesk · 4h SLA"
        title="Support Tickets & Concierge"
        subtitle="Our dedicated technical support team replies within 4 working hours. Pro and All-Access studio plans receive front-of-line priority."
        actions={
          <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
            <i className={`bi bi-${showForm ? 'x-lg' : 'plus-lg'}`} />{showForm ? 'Cancel' : 'New Ticket'}
          </button>
        }
      />

      {/* Feature Capabilities Ribbon */}
      <FeatureBar items={ticketFeatures} />

      {showForm && (
        <Card title="Raise a Support Ticket" subtitle="Fill in details to connect with a senior technical specialist">
          <form onSubmit={submit}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="subject">Subject</label>
                <input id="subject" name="subject" required placeholder="What do you need help with?" />
              </div>
              <div className="field">
                <label htmlFor="priority">Priority</label>
                <select id="priority" name="priority" defaultValue="Medium">
                  <option>Low — General inquiry</option>
                  <option>Medium — Feature guidance</option>
                  <option>High — Active wedding shoot issue</option>
                </select>
              </div>
              <div className="field full">
                <label htmlFor="details">Details & Steps</label>
                <textarea id="details" name="details" placeholder="Please describe the event name, client URL, or screenshots link…" />
              </div>
            </div>
            <div className="form-foot">
              <button type="submit" className="btn btn-primary">
                <i className="bi bi-send" /> Submit Ticket
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card
        title="Your Support Tickets"
        subtitle="Point cursor at ticket ID or priority for status SLA"
        feature={featureInfo.support}
        flush
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Ticket ID</th>
                <th>Subject</th>
                <th>Priority</th>
                <th>Last Update</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id}>
                  <td className="mono">
                    <FeatureTooltip
                      title={t.id}
                      summary={`Ticket ${t.id} logged for Golden Hour Studios. Assigned to Senior Support Team.`}
                      position="top"
                      width={240}
                    >
                      <span className="table-th-interactive">{t.id}</span>
                    </FeatureTooltip>
                  </td>
                  <td className="cell-main">{t.subject}</td>
                  <td>
                    <FeatureTooltip
                      title={`${t.priority} Priority Ticket`}
                      summary={t.priority === 'High' ? 'Guaranteed response within 60 minutes.' : 'Guaranteed response within 4 working hours.'}
                      position="top"
                      width={220}
                    >
                      <span className="table-th-interactive">
                        <StatusPill status={t.priority} />
                      </span>
                    </FeatureTooltip>
                  </td>
                  <td>{formatDate(t.updated)}</td>
                  <td><StatusPill status={t.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export default SupportTickets
