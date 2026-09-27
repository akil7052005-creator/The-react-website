import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/ui'
import db from '../data'
import { formatINR } from '../utils/format'

function AllSubscription() {
  const [yearly, setYearly] = useState(false)

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Plans"
        title="Choose your plan"
        subtitle="Simple pricing that grows with your studio. Switch or cancel anytime."
        actions={
          <div className="tabs">
            <button className={!yearly ? 'on' : ''} onClick={() => setYearly(false)}>Monthly</button>
            <button className={yearly ? 'on' : ''} onClick={() => setYearly(true)}>Yearly <span className="save">2 months free</span></button>
          </div>
        }
      />

      <div className="grid grid-3" style={{ paddingTop: 12 }}>
        {db.plans.map((p) => {
          const current = p.name === db.subscription.plan
          return (
            <div key={p.name} className={`plan ${p.popular ? 'popular' : ''}`}>
              {p.popular && <span className="plan-flag">Most popular</span>}
              <h3>{p.name}</h3>
              <p className="tagline">{p.tagline}</p>
              <p className="price">
                {formatINR(yearly ? p.yearly : p.monthly)}
                <small> / {yearly ? 'year' : 'month'}</small>
              </p>
              <ul className="checklist">
                {p.features.map((f) => (
                  <li key={f}><i className="bi bi-check-circle-fill" />{f}</li>
                ))}
              </ul>
              <button className={`btn btn-block ${current ? 'btn-ghost' : p.popular ? 'btn-primary' : 'btn-ghost'}`} disabled={current}>
                {current ? 'Current plan' : `Choose ${p.name}`}
              </button>
            </div>
          )
        })}
      </div>

      <p className="muted" style={{ textAlign: 'center' }}>
        All prices exclude 18% GST. Need something custom? <Link to="/support" className="link">Talk to us</Link>
      </p>
    </div>
  )
}

export default AllSubscription
