import { useState } from 'react'
import { PageHeader, Card, StatCard, StatusPill, Toggle } from '../components/ui'
import db from '../data'
import { formatNumber } from '../utils/format'
import poster from '../assets/wedding-poster-horizontal.png'

function MyWebsite() {
  const { website, studio } = db
  const [sections, setSections] = useState(website.sections)

  const flip = (key) => setSections((list) => list.map((s) => (s.key === key ? { ...s, on: !s.on } : s)))

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Business"
        title="My Website"
        subtitle="Your portfolio site — clients find you, browse your work and send enquiries."
        actions={
          <>
            <a href={`https://${studio.website}`} target="_blank" rel="noreferrer" className="btn btn-ghost"><i className="bi bi-box-arrow-up-right" />Visit site</a>
            <button className="btn btn-primary"><i className="bi bi-brush" />Edit design</button>
          </>
        }
      />

      <div className="grid grid-3">
        <StatCard icon="broadcast" label="Status" value={<StatusPill status={website.status} />} tone="green" />
        <StatCard icon="eye" label="Visits this month" value={formatNumber(website.visits)} trend={14} tone="blue" />
        <StatCard icon="envelope-heart" label="Enquiries" value={website.enquiries} trend={9} tone="wine" />
      </div>

      <div className="grid grid-2-1">
        <Card title="Live preview" subtitle={`Theme: ${website.theme}`}>
          <div className="browser">
            <div className="browser-bar">
              <i /><i /><i />
              <span><i className="bi bi-lock-fill" style={{ background: 'none', width: 'auto', height: 'auto' }} /> {studio.website}</span>
            </div>
            <img src={poster} alt="Website homepage preview" />
          </div>
        </Card>

        <Card title="Page sections" subtitle="Show or hide sections on your site">
          {sections.map((s) => (
            <Toggle key={s.key} label={s.label} checked={s.on} onChange={() => flip(s.key)} />
          ))}
        </Card>
      </div>
    </div>
  )
}

export default MyWebsite
