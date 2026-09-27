import { NavLink, Link } from 'react-router-dom'
import { navSections } from '../nav'

function Sidebar({ onNavigate }) {
  return (
    <aside className="sidebar">
      <Link to="/" className="brand" onClick={onNavigate}>
        <span className="brand-mark">W</span>
        <span className="brand-name">Weddingz</span>
      </Link>

      <nav className="nav">
        {navSections.map((section) => (
          <div className="nav-section" key={section.label}>
            <p className="nav-label">{section.label}</p>
            {section.items.map((item) => (
              // NavLink adds the "active" class automatically on the current page.
              <NavLink key={item.to} to={item.to} end={item.to === '/'} className="nav-link" onClick={onNavigate}>
                <i className={`bi bi-${item.icon}`} />
                <span>{item.label}</span>
                {item.badge && <span className="nav-badge">{item.badge}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-foot">
        <Link to="/all-access" className="upsell" onClick={onNavigate}>
          <i className="bi bi-stars" />
          <div>
            <strong>Go All-Access</strong>
            <span>Every feature, one price</span>
          </div>
        </Link>
        <NavLink to="/logout" className="nav-link" onClick={onNavigate}>
          <i className="bi bi-box-arrow-left" />
          <span>Logout</span>
        </NavLink>
      </div>
    </aside>
  )
}

export default Sidebar
