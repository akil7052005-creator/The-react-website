import { useState } from 'react'
import { PageHeader, Card, StatusPill } from '../components/ui'
import db from '../data'
import { formatDate } from '../utils/format'

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
        eyebrow="Account"
        title="Support Tickets"
        subtitle="Our team replies within 4 working hours. Pro plans get priority."
        actions={
          <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
            <i className={`bi bi-${showForm ? 'x-lg' : 'plus-lg'}`} />{showForm ? 'Cancel' : 'New Ticket'}
          </button>
        }
      />

      {showForm && (
        <Card title="Raise a ticket">
          <form onSubmit={submit}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="subject">Subject</label>
                <input id="subject" name="subject" required placeholder="What do you need help with?" />
              </div>
              <div className="field">
                <label htmlFor="priority">Priority</label>
                <select id="priority" name="priority" defaultValue="Medium">
                  <option>Low</option>
                  <option>Medium</option>
                  <option>High</option>
                </select>
              </div>
              <div className="field full">
                <label htmlFor="details">Details</label>
                <textarea id="details" name="details" placeholder="Steps, event name, screenshots link…" />
              </div>
            </div>
            <div className="form-foot">
              <button type="submit" className="btn btn-primary"><i className="bi bi-send" />Submit ticket</button>
            </div>
          </form>
        </Card>
      )}

      <Card title="Your tickets" flush>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Subject</th>
                <th>Priority</th>
                <th>Last update</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id}>
                  <td className="mono">{t.id}</td>
                  <td className="cell-main">{t.subject}</td>
                  <td><StatusPill status={t.priority} /></td>
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
