import { Suspense, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAdmin } from '../auth/AuthProvider'
import { AdminBell } from '../components/AdminBell'
import { PageSkeleton } from '../components/ui'

const adminNav = [
  { label: 'Revenue', items: [
    { to: '/admin', label: 'Dashboard', icon: 'speedometer2', end: true },
    { to: '/admin/studios', label: 'Studios', icon: 'shop' },
    { to: '/admin/subscriptions', label: 'Subscriptions', icon: 'credit-card-2-front' },
  ] },
  { label: 'Manage', items: [
    { to: '/admin/tickets', label: 'Support inbox', icon: 'headset' },
    { to: '/admin/help', label: 'Help Center', icon: 'question-circle' },
    { to: '/admin/plans', label: 'Plans', icon: 'box-seam' },
    { to: '/admin/settings', label: 'Settings', icon: 'gear' },
  ] },
]

/** Shell of the platform-admin area (/admin): its own sidebar, separate from the studio app. */
function AdminLayout() {
  const me = useAdmin()
  const [navOpen, setNavOpen] = useState(false)
  const close = () => setNavOpen(false)

  return (
    <div className={`app admin-app ${navOpen ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <Link to="/admin" className="brand" onClick={close}>
          <span className="brand-mark">W</span>
          <div className="brand-info">
            <span className="brand-name">Wedmanage</span>
            <span className="brand-sub">Platform admin</span>
          </div>
        </Link>
        <nav className="nav" aria-label="Admin">
          {adminNav.map((section) => (
            <div className="nav-section" key={section.label}>
              <p className="nav-label">{section.label}</p>
              {section.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={'end' in item} className="nav-link" onClick={close}>
                  <i className={`bi bi-${item.icon}`} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot admin-who">
          <p>
            <strong>{me.user.name}</strong>
            <span>{me.user.email}</span>
          </p>
          <NavLink to="/admin/logout" className="nav-link" onClick={close}>
            <i className="bi bi-box-arrow-left" />
            <span>Log out</span>
          </NavLink>
        </div>
      </aside>
      <div className="scrim" onClick={close} aria-hidden="true" />
      <div className="main">
        <header className="topbar admin-topbar">
          <button className="icon-btn menu-btn" onClick={() => setNavOpen(true)} aria-label="Open menu">
            <i className="bi bi-list" />
          </button>
          {/* The one place admin money is labelled: every amount in the admin area excludes GST. */}
          <span className="muted admin-gst-note">Amounts exclude GST</span>
          <div className="topbar-actions">
            <span className="admin-badge" title="You're signed in as a platform admin. Every change is recorded.">
              <i className="bi bi-shield-lock" /> Admin
            </span>
            <AdminBell />
          </div>
        </header>
        <main className="content">
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}

export default AdminLayout
