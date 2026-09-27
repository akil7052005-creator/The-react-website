import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader, Card, EmptyState } from '../components/ui'
import db from '../data'

const topics = [
  { icon: 'rocket-takeoff', title: 'Getting started', text: 'Set up your studio in 10 minutes' },
  { icon: 'images', title: 'Selections & albums', text: 'Share, select and deliver' },
  { icon: 'person-bounding-box', title: 'Face recognition', text: 'Guest links, QR codes, privacy' },
  { icon: 'receipt', title: 'Billing & GST', text: 'Invoices, payments, refunds' },
]

function HelpCenter() {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const faqs = db.faqs.filter((f) => !q || f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q))

  return (
    <div className="stack">
      <PageHeader eyebrow="Account" title="Help Center" subtitle="Answers, guides and tips for running your studio on Weddingz." />

      <label className="search" style={{ maxWidth: 560, height: 50 }}>
        <i className="bi bi-search" />
        <input type="search" placeholder="Search help articles…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>

      <div className="grid grid-4">
        {topics.map((t) => (
          <a href="#faq" className="topic" key={t.title}>
            <span className="stat-icon tone-gold"><i className={`bi bi-${t.icon}`} /></span>
            <div>
              <strong>{t.title}</strong>
              <p>{t.text}</p>
            </div>
          </a>
        ))}
      </div>

      <Card title="Frequently asked questions" className="faq">
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
              text="Try different words, or ask our team directly."
              action={<Link to="/support" className="btn btn-primary">Raise a ticket</Link>}
            />
          )}
        </div>
      </Card>
    </div>
  )
}

export default HelpCenter
