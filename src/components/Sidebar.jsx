import { NavLink, Link } from 'react-router-dom'
import { navSections } from '../nav'
import { featureInfo } from '../data/featureInfo'
import FeatureTooltip from './FeatureTooltip'

function Sidebar({ onNavigate }) {
  return (
    <aside className="sidebar">
      <Link to="/" className="brand" onClick={onNavigate}>
        <span className="brand-mark">W</span>
        <div className="brand-info">
          <span className="brand-name">Wedzone</span>
          <span className="brand-sub">Studio OS</span>
        </div>
        <span className="brand-pro-tag">PRO</span>
      </Link>
      
      <nav className="nav">
        {navSections.map((section) => (
          <div className="nav-section" key={section.label}>
            <p className="nav-label">{section.label}</p>
            {section.items.map((item) => {
              const feat = featureInfo[item.featureKey]
              const link = (
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className="nav-link"
                  onClick={onNavigate}
                >
                  <i className={`bi bi-${item.icon}`} />
                  <span>{item.label}</span>
                  {item.badge && <span className="nav-badge">{item.badge}</span>}
                </NavLink>
              )

              return feat ? (
                <FeatureTooltip
                  key={item.to}
                  feature={feat}
                  position="right"
                  width={310}
                  delay={100}
                >
                  {link}
                </FeatureTooltip>
              ) : (
                <div key={item.to}>{link}</div>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-foot">
        <FeatureTooltip
          feature={featureInfo.allAccess}
          position="right"
          width={320}
          delay={100}
        >
          <Link to="/all-access" className="upsell" onClick={onNavigate}>
            <i className="bi bi-stars" />
            <div>
              <strong>Go All-Access</strong>
              <span>Every feature, zero limits</span>
            </div>
            <span className="upsell-badge">VIP</span>
          </Link>
        </FeatureTooltip>

        <NavLink to="/logout" className="nav-link" onClick={onNavigate}>
          <i className="bi bi-box-arrow-left" />
          <span>Logout</span>
        </NavLink>
      </div>
    </aside>
  )
}

export default Sidebar
