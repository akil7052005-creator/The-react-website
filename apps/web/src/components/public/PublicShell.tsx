import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { APP_NAME } from '../../lib/brand'
import { CONTACT, contactLinkProps } from '../../lib/contact'
import { PublicMenu, scrollToSection, usePublicMenu, type Arrival } from './SiteHeader'

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

/** The public website's frame: sticky top menu with its panels (drawer on phones) and footer. */
export function PublicShell({ children, panel }: { children: ReactNode; panel?: Arrival }) {
  return (
    <PublicMenu initial={panel}>
      {(menu) => (
        <div className="pub">
          {menu}
          <main>{children}</main>
          <Footer />
        </div>
      )}
    </PublicMenu>
  )
}

function Footer() {
  const { openPanel, startTrial } = usePublicMenu()
  return (
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
              <Link to="/" onClick={() => window.scrollTo({ top: 0 })}>
                Home
              </Link>
            </li>
            <li>
              <button type="button" onClick={() => scrollToSection('about')}>
                About Us
              </button>
            </li>
            <li>
              <button type="button" onClick={() => scrollToSection('pricing')}>
                Plans &amp; Pricing
              </button>
            </li>
            <li>
              <button type="button" onClick={() => openPanel('login')}>
                Login
              </button>
            </li>
            <li>
              <button type="button" onClick={() => startTrial(null)}>
                Start free trial
              </button>
            </li>
          </ul>
        </div>
        <div>
          <h2>Contact</h2>
          <ul>
            {CONTACT.map((c) => (
              <li key={c.label}>
                <i className={`bi bi-${c.icon}`} aria-hidden="true" /> {c.label}:{' '}
                {c.href ? (
                  <a href={c.href} {...contactLinkProps(c)}>
                    {c.value}
                  </a>
                ) : (
                  c.value
                )}
              </li>
            ))}
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
