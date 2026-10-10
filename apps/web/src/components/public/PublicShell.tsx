import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { APP_NAME } from '../../lib/brand'

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/about', label: 'About Us' },
  { to: '/pricing', label: 'Plans & Pricing' },
]

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.content = content
}

/** Each public page's own title and WhatsApp / social preview card. */
export function usePageMeta(title: string, description: string) {
  useEffect(() => {
    const full = `${title} · ${APP_NAME}`
    document.title = full
    setMeta('name', 'description', description)
    setMeta('property', 'og:title', full)
    setMeta('property', 'og:description', description)
    setMeta('property', 'og:url', window.location.href)
    setMeta('name', 'twitter:title', full)
    setMeta('name', 'twitter:description', description)
  }, [title, description])
}

/** "→" after button text, as on the rest of the site. */
export const Arrow = () => (
  <span className="pub-arrow" aria-hidden="true">
    →
  </span>
)

export function Logo({ light }: { light?: boolean }) {
  return (
    <Link to="/" className={`pub-logo${light ? ' light' : ''}`} aria-label={`${APP_NAME} home`}>
      <span className="pub-logo-mark" aria-hidden="true">
        W
      </span>
      <span className="pub-logo-name">{APP_NAME}</span>
    </Link>
  )
}

/** The public website's frame: sticky top menu (☰ on phones) and footer. */
export function PublicShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return (
    <div className="pub">
      <header className="pub-header">
        <div className="pub-wrap pub-header-row">
          <Logo />
          <button type="button" className="pub-burger" aria-expanded={open} aria-controls="pub-nav" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((o) => !o)}>
            <i className={`bi bi-${open ? 'x-lg' : 'list'}`} aria-hidden="true" />
          </button>
          <nav id="pub-nav" className={`pub-nav${open ? ' open' : ''}`} aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} onClick={close}>
                {n.label}
              </NavLink>
            ))}
            <NavLink to="/login" onClick={close}>
              Login
            </NavLink>
            <Link to="/signup" className="pub-btn sm" onClick={close}>
              Start free trial <Arrow />
            </Link>
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer className="pub-footer">
        <div className="pub-wrap pub-footer-grid">
          <div>
            <Logo light />
            <p className="pub-footer-tag">Photo selection for wedding studios: upload, share on WhatsApp, get the couple's picks.</p>
          </div>
          <div>
            <h2>Quick links</h2>
            <ul>
              <li>
                <Link to="/">Home</Link>
              </li>
              <li>
                <Link to="/about">About Us</Link>
              </li>
              <li>
                <Link to="/pricing">Plans &amp; Pricing</Link>
              </li>
              <li>
                <Link to="/login">Login</Link>
              </li>
              <li>
                <Link to="/signup">Start free trial</Link>
              </li>
            </ul>
          </div>
          <div>
            <h2>Contact</h2>
            <ul>
              <li>
                <i className="bi bi-telephone" aria-hidden="true" /> Phone: [Owner to add]
              </li>
              <li>
                <i className="bi bi-whatsapp" aria-hidden="true" /> WhatsApp: [Owner to add]
              </li>
              <li>
                <i className="bi bi-envelope" aria-hidden="true" /> Email: [Owner to add]
              </li>
              <li>
                <i className="bi bi-geo-alt" aria-hidden="true" /> Address: [Owner to add]
              </li>
            </ul>
          </div>
          <div>
            <h2>Follow us</h2>
            <div className="pub-social">
              <a href="#" aria-label="Instagram (link to be added)">
                <i className="bi bi-instagram" aria-hidden="true" />
              </a>
              <a href="#" aria-label="Facebook (link to be added)">
                <i className="bi bi-facebook" aria-hidden="true" />
              </a>
              <a href="#" aria-label="YouTube (link to be added)">
                <i className="bi bi-youtube" aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>
        <p className="pub-wrap pub-copy">
          © {new Date().getFullYear()} {APP_NAME}. All rights reserved.
        </p>
      </footer>
    </div>
  )
}

/** Section heading with the short accent line under it. */
export function SectionTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 className="pub-h2" id={id}>
      {children}
    </h2>
  )
}
