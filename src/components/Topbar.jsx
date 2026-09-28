import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar, FeatureTooltip } from './ui'
import db from '../data'
import { formatNumber } from '../utils/format'
import { featureInfo } from '../data/featureInfo'

function Topbar({ onMenu }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  // Close the profile menu when clicking anywhere outside it.
  useEffect(() => {
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  return (
    <header className="topbar">
      <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Open menu">
        <i className="bi bi-list" />
      </button>

      <FeatureTooltip
        title="Universal Studio Search"
        badge="Quick Nav"
        icon="search"
        summary="Search across 48+ events, couple names, wedding venues, digital albums, and invoices in milliseconds."
        highlights={[
          'Instant matching across client names and phone numbers',
          'Jump directly into photo selections and albums',
          'Press / to search anytime'
        ]}
        position="bottom"
        width={300}
        delay={150}
      >
        <label className="search">
          <i className="bi bi-search" />
          <input type="search" placeholder="Search events, clients, albums… (hover for info)" />
          <kbd className="search-kbd">/</kbd>
        </label>
      </FeatureTooltip>

      <div className="topbar-actions">
        <FeatureTooltip
          feature={featureInfo.whatsappCredit}
          position="bottom"
          width={310}
        >
          <Link to="/whatsapp-credit" className="credit-chip" title="WhatsApp credits">
            <i className="bi bi-whatsapp" />
            <span>{formatNumber(db.whatsapp.credits)}</span>
            <small>Credits</small>
          </Link>
        </FeatureTooltip>

        <FeatureTooltip
          title="Studio Activity Feed"
          badge="Live Alerts"
          icon="bell"
          summary="Real-time alerts whenever a client completes a photo selection, signs an album, or makes an advance payment."
          position="bottom"
          width={280}
        >
          <button className="icon-btn" aria-label="Notifications">
            <i className="bi bi-bell" />
            <span className="dot" />
          </button>
        </FeatureTooltip>

        <FeatureTooltip
          feature={featureInfo.help}
          position="bottom"
          width={290}
        >
          <Link to="/help" className="icon-btn" aria-label="Help">
            <i className="bi bi-question-circle" />
          </Link>
        </FeatureTooltip>

        <div className="profile" ref={menuRef}>
          <button className="profile-btn" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen}>
            <Avatar name={db.studio.owner} />
            <span className="profile-text">
              <strong>{db.studio.owner}</strong>
              <small>{db.studio.name} · <span className="pro-pill">PRO</span></small>
            </span>
            <i className="bi bi-chevron-down" />
          </button>
          {menuOpen && (
            <div className="menu" onClick={() => setMenuOpen(false)}>
              <Link to="/profile"><i className="bi bi-person" />My Profile</Link>
              <Link to="/my-subscription"><i className="bi bi-patch-check" />My Subscription</Link>
              <Link to="/billing"><i className="bi bi-receipt" />Billing</Link>
              <hr />
              <Link to="/logout" className="danger"><i className="bi bi-box-arrow-left" />Logout</Link>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

export default Topbar
