import { useState } from 'react'
import { PageHeader, Card, Avatar } from '../components/ui'
import db from '../data'

function MyProfile() {
  const { studio } = db
  const [saved, setSaved] = useState(false)

  const save = (e) => {
    e.preventDefault()
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="stack">
      <PageHeader eyebrow="Account" title="My Profile" subtitle="How your studio appears on invoices, galleries and your website." />

      <div className="grid grid-1-2">
        <Card className="profile-card">
          <Avatar name={studio.owner} size={88} />
          <h3>{studio.owner}</h3>
          <p className="muted">{studio.name}</p>
          <p style={{ marginTop: 10 }}><span className="pill pill-warning">{studio.plan} plan</span></p>
          <ul className="info-list">
            <li><i className="bi bi-envelope" />{studio.email}</li>
            <li><i className="bi bi-telephone" />{studio.phone}</li>
            <li><i className="bi bi-geo-alt" />{studio.city}</li>
            <li><i className="bi bi-globe2" />{studio.website}</li>
          </ul>
        </Card>

        <Card title="Studio details">
          <form onSubmit={save}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="owner">Your name</label>
                <input id="owner" defaultValue={studio.owner} />
              </div>
              <div className="field">
                <label htmlFor="studio">Studio name</label>
                <input id="studio" defaultValue={studio.name} />
              </div>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" type="email" defaultValue={studio.email} />
              </div>
              <div className="field">
                <label htmlFor="phone">Phone</label>
                <input id="phone" type="tel" defaultValue={studio.phone} />
              </div>
              <div className="field">
                <label htmlFor="city">City</label>
                <input id="city" defaultValue={studio.city} />
              </div>
              <div className="field">
                <label htmlFor="gst">GSTIN</label>
                <input id="gst" defaultValue={studio.gst} />
              </div>
              <div className="field full">
                <label htmlFor="bio">About your studio</label>
                <textarea id="bio" defaultValue="Candid wedding storytellers capturing South Indian weddings since 2016." />
              </div>
            </div>
            <div className="form-foot">
              {saved && <span className="toast"><i className="bi bi-check-circle-fill" />Changes saved</span>}
              <button type="reset" className="btn btn-ghost">Reset</button>
              <button type="submit" className="btn btn-primary">Save changes</button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  )
}

export default MyProfile
