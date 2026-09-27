import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar } from './ui'
import db from '../data'
import { formatNumber } from '../utils/format'

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

      <label className="search">
        <i className="bi bi-search" />
        <input type="search" placeholder="Search events, clients, albums…" />
      </label>

      <div className="topbar-actions">
        <Link to="/whatsapp-credit" className="credit-chip" title="WhatsApp credits">
          <i className="bi bi-whatsapp" />
          {formatNumber(db.whatsapp.credits)}
        </Link>
        <button className="icon-btn" aria-label="Notifications">
          <i className="bi bi-bell" />
          <span className="dot" />
        </button>
        <Link to="/help" className="icon-btn" aria-label="Help">
          <i className="bi bi-question-circle" />
        </Link>

        <div className="profile" ref={menuRef}>
          <button className="profile-btn" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen}>
            <Avatar name={db.studio.owner} />
            <span className="profile-text">
              <strong>{db.studio.owner}</strong>
              <small>{db.studio.name}</small>
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
