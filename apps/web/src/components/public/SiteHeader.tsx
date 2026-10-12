import { createContext, useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { planFromParams, type SignupPlan } from '../../pages/auth/Signup'
import { APP_NAME } from '../../lib/brand'
import { AboutPanel, arrowNav, LoginPanel, PricingPanel, type PanelId } from './headerPanels'

const OPEN_DELAY = 150
const CLOSE_GRACE = 300
const PHONE_QUERY = '(max-width: 899.98px)'
const FORM_PANELS: PanelId[] = ['login']
const LABELS: Record<PanelId, string> = { about: 'About Us', pricing: 'Plans & Pricing', login: 'Login' }

/** How the page was reached: an old link's panel, or /signup (the Create your studio card, focused). */
export type Arrival = PanelId | 'signup'

const isPhoneNow = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(PHONE_QUERY).matches)

function useIsPhone() {
  const [phone, setPhone] = useState(isPhoneNow)
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE_QUERY)
    if (!mq) return
    const on = () => setPhone(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return Boolean(phone)
}

/** Keeps Tab / Shift+Tab inside a form panel, drawer or sheet. */
function trapTab(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'Tab') return
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
    (el) => el.offsetParent !== null,
  )
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

const focusFirstField = (el: HTMLElement | null) => el?.querySelector<HTMLElement>('button, a[href]')?.focus()

const smooth = (): ScrollBehavior => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth')
export const scrollToSection = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: smooth() })

/** The id of the home page's Create your studio card. */
export const SIGNUP_CARD_ID = 'signup-card'

/** Brings the Create your studio card into view and puts the cursor in its first field. False when it isn't on the page. */
function focusSignupCard() {
  const card = document.getElementById(SIGNUP_CARD_ID)
  if (!card) return false
  const r = card.getBoundingClientRect()
  if (r.top < 64 || r.bottom > window.innerHeight) card.scrollIntoView({ behavior: smooth(), block: isPhoneNow() ? 'start' : 'center' })
  card.querySelector<HTMLInputElement>('input:not([type="hidden"])')?.focus({ preventScroll: true })
  return true
}

interface Menu {
  open: PanelId | null
  openPanel: (id: PanelId) => void
  close: (returnFocus?: boolean) => void
  /** The plan on the Create your studio card (null = Trial). */
  signupPlan: SignupPlan
  setSignupPlan: (p: SignupPlan) => void
  /** Start Free Trial / Choose: (optionally pick a plan,) close menus and go to the card's first field. */
  startTrial: (plan?: SignupPlan) => void
}
const MenuContext = createContext<Menu | null>(null)

/** For buttons on the page (hero, pricing cards, footer) that open a header panel. */
export function usePublicMenu() {
  const m = useContext(MenuContext)
  if (!m) throw new Error('usePublicMenu must be used inside <PublicShell>')
  return m
}

/**
 * The public site's top menu. About Us and Plans & Pricing open mega panels under the header, Login
 * a form panel (hover after 150 ms, or click / Enter). Signing up is the home page's Create your
 * studio card. On phones: ☰ opens a drawer with accordions; Login opens as a bottom sheet.
 */
export function PublicMenu({ initial, children }: { initial?: Arrival; children: (menu: ReactNode) => ReactNode }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const phone = useIsPhone()
  // Old links (/about, /pricing, /login) arrive with their panel open; on phones About and Pricing
  // scroll to their section instead, and /signup focuses the card (below).
  const [open, setOpen] = useState<PanelId | null>(() =>
    initial && initial !== 'signup' && !(isPhoneNow() && (initial === 'about' || initial === 'pricing')) ? initial : null,
  )
  const [byHover, setByHover] = useState(false)
  // A form panel stays open on mouse leave once the user has typed in it.
  const [typed, setTyped] = useState(false)
  const [signupPlan, setSignupPlan] = useState<SignupPlan>(() => planFromParams(params))
  const [drawer, setDrawer] = useState(false)
  const [section, setSection] = useState<'about' | 'pricing' | null>(null)
  const headerRef = useRef<HTMLElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const triggers = useRef<Partial<Record<PanelId | 'burger', HTMLElement | null>>>({})
  const openTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const clearTimers = () => {
    clearTimeout(openTimer.current)
    clearTimeout(closeTimer.current)
  }

  // The open panel for timers and listeners, which run outside React's render.
  const openRef = useRef<PanelId | null>(null)
  useEffect(() => {
    openRef.current = open
  }, [open])

  const close = useCallback((returnFocus = false) => {
    clearTimers()
    const was = openRef.current
    setOpen(null)
    setTyped(false)
    setByHover(false)
    if (returnFocus && was) (triggers.current[was] ?? triggers.current.burger)?.focus()
  }, [])

  const openPanel = useCallback(
    (id: PanelId) => {
      clearTimers()
      setDrawer(false)
      setTyped(false)
      setByHover(false)
      if (phone && (id === 'about' || id === 'pricing')) {
        setOpen(null)
        scrollToSection(id)
        return
      }
      setOpen(id)
    },
    [phone],
  )

  const startTrial = useCallback(
    (chosen?: SignupPlan) => {
      if (chosen !== undefined) setSignupPlan(chosen)
      close()
      setDrawer(false)
      // After the menus close (and a phone's page can scroll again).
      requestAnimationFrame(() => {
        // Logged in (no card): the plans page instead.
        if (!focusSignupCard()) navigate(chosen ? `/subscriptions?renew=${chosen.code}&cycle=${chosen.cycle}` : '/')
      })
    },
    [close, navigate],
  )

  useEffect(() => {
    if (isPhoneNow() && (initial === 'about' || initial === 'pricing')) scrollToSection(initial)
    if (initial === 'signup') requestAnimationFrame(() => focusSignupCard())
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A form panel (or the sheet) takes focus when opened by click or link, so Tab starts inside it.
  // Not its first field: leaving an untouched field would flash "required" before anything is typed.
  useEffect(() => {
    if (open && FORM_PANELS.includes(open) && !byHover) panelRef.current?.focus()
  }, [open, byHover, phone])

  useEffect(() => {
    if (drawer) focusFirstField(drawerRef.current)
  }, [drawer])

  // Esc closes; a click outside the header and its panel closes (phones use the overlay instead).
  useEffect(() => {
    if (!open && !drawer) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (open) close(true)
      else {
        setDrawer(false)
        triggers.current.burger?.focus()
      }
    }
    const onDown = (e: MouseEvent) => {
      if (phone) return
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) close()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open, drawer, phone, close])

  // Drawer or sheet open on a phone: the page behind doesn't scroll.
  useEffect(() => {
    if (!phone || (!drawer && !open)) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [phone, drawer, open])

  useEffect(() => () => clearTimers(), [])

  const hoverOpen = (id: PanelId) => {
    if (phone) return
    clearTimeout(closeTimer.current)
    if (open && FORM_PANELS.includes(open) && typed) return
    clearTimeout(openTimer.current)
    openTimer.current = setTimeout(() => {
      if (openRef.current === id) return
      setOpen(id)
      setByHover(true)
      setTyped(false)
    }, OPEN_DELAY)
  }
  const leaveHeader = () => {
    clearTimeout(openTimer.current)
    if (!byHover || typed) return
    closeTimer.current = setTimeout(() => close(), CLOSE_GRACE)
  }
  const clickTrigger = (id: PanelId) => {
    clearTimeout(openTimer.current)
    if (open === id && byHover) setByHover(false)
    else if (open === id) close()
    else openPanel(id)
  }

  /** Down arrow on an open item moves into its panel. */
  const arrowIntoPanel = (id: PanelId, e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' || open !== id) return
    e.preventDefault()
    panelRef.current?.querySelector<HTMLElement>('[role="menuitem"], [role="tab"], input, button')?.focus()
  }
  const registerTrigger = (el: HTMLElement | null) => {
    if (el?.dataset.panel) triggers.current[el.dataset.panel as PanelId] = el
  }
  const stopOpening = () => clearTimeout(openTimer.current)

  const onPanelInput = () => {
    if (open && FORM_PANELS.includes(open)) setTyped(true)
  }

  const body = (id: PanelId) =>
    id === 'about' ? (
      <AboutPanel />
    ) : id === 'pricing' ? (
      <PricingPanel
        onChoose={startTrial}
        onCompare={() => {
          close()
          scrollToSection('pricing')
        }}
      />
    ) : (
      <LoginPanel onTrial={() => startTrial(null)} />
    )

  const menu: Menu = { open, openPanel, close, signupPlan, setSignupPlan, startTrial }

  const header = (
    <header className="pub-header" ref={headerRef} onMouseEnter={() => clearTimeout(closeTimer.current)} onMouseLeave={leaveHeader}>
      <div className="pub-wrap pub-header-row">
        <Link to="/" className="pub-logo" aria-label={`${APP_NAME} home`}>
          <span className="pub-logo-mark" aria-hidden="true">
            W
          </span>
          <span className="pub-logo-name">{APP_NAME}</span>
        </Link>
        {!phone && (
          <nav className="pub-menu" aria-label="Main" onKeyDown={arrowNav('.pub-menu-item', 'horizontal')}>
            <Link
              to="/"
              className={`pub-menu-item${open ? '' : ' on'}`}
              onClick={() => {
                close()
                window.scrollTo({ top: 0 })
              }}
            >
              Home
            </Link>
            {(['about', 'pricing', 'login'] as const).map((id) => (
              <button
                key={id}
                type="button"
                ref={registerTrigger}
                data-panel={id}
                aria-expanded={open === id}
                aria-controls={`pub-panel-${id}`}
                onMouseEnter={() => hoverOpen(id)}
                onMouseLeave={stopOpening}
                onClick={() => clickTrigger(id)}
                onKeyDown={(e) => arrowIntoPanel(id, e)}
                className={`pub-menu-item${open === id ? ' on' : ''}`}
              >
                {LABELS[id]} <i className="bi bi-chevron-down pub-caret" aria-hidden="true" />
              </button>
            ))}
          </nav>
        )}
        {phone && (
          <button
            type="button"
            ref={(el) => {
              triggers.current.burger = el
            }}
            className="pub-burger"
            aria-expanded={drawer}
            aria-controls="pub-drawer"
            aria-label="Open menu"
            onClick={() => setDrawer(true)}
          >
            <i className="bi bi-list" aria-hidden="true" />
          </button>
        )}
      </div>

      {!phone && open && (
        <div
          id={`pub-panel-${open}`}
          ref={panelRef}
          key={open}
          className={FORM_PANELS.includes(open) ? 'pub-pop' : 'pub-mega'}
          role={FORM_PANELS.includes(open) ? 'dialog' : 'region'}
          tabIndex={FORM_PANELS.includes(open) ? -1 : undefined}
          aria-label={open === 'login' ? 'Log in' : LABELS[open]}
          onInput={onPanelInput}
          onKeyDown={FORM_PANELS.includes(open) ? trapTab : undefined}
        >
          {FORM_PANELS.includes(open) ? (
            <div className="pub-pop-card">
              <button type="button" className="pub-x" aria-label="Close" onClick={() => close(true)}>
                <i className="bi bi-x-lg" aria-hidden="true" />
              </button>
              {body(open)}
            </div>
          ) : (
            <div className="pub-wrap">{body(open)}</div>
          )}
        </div>
      )}
    </header>
  )

  const phoneLayers = phone && (
    <>
      {drawer && (
        <>
          <div className="pub-overlay" onClick={() => setDrawer(false)} aria-hidden="true" />
          <aside id="pub-drawer" className="pub-drawer" role="dialog" aria-modal="true" aria-label="Menu" onKeyDown={trapTab} ref={drawerRef}>
            <button
              type="button"
              className="pub-x"
              aria-label="Close menu"
              onClick={() => {
                setDrawer(false)
                triggers.current.burger?.focus()
              }}
            >
              <i className="bi bi-x-lg" aria-hidden="true" />
            </button>
            <nav aria-label="Main">
              <Link to="/" className="pub-drawer-link" onClick={() => setDrawer(false)}>
                Home
              </Link>
              {(['about', 'pricing'] as const).map((id) => (
                <div key={id} className="pub-acc">
                  <button type="button" className="pub-drawer-link" aria-expanded={section === id} aria-controls={`pub-acc-${id}`} onClick={() => setSection((s) => (s === id ? null : id))}>
                    {LABELS[id]} <i className="bi bi-chevron-down pub-caret" aria-hidden="true" />
                  </button>
                  {section === id && (
                    <div id={`pub-acc-${id}`} className="pub-acc-body">
                      {id === 'about' ? <AboutPanel stacked /> : <PricingPanel onChoose={startTrial} onCompare={() => openPanel('pricing')} />}
                    </div>
                  )}
                </div>
              ))}
              <button type="button" className="pub-drawer-link" onClick={() => openPanel('login')}>
                Login
              </button>
            </nav>
          </aside>
        </>
      )}
      {open && FORM_PANELS.includes(open) && (
        <>
          <div className="pub-overlay" onClick={() => close()} aria-hidden="true" />
          <div id={`pub-panel-${open}`} ref={panelRef} className="pub-sheet" role="dialog" aria-modal="true" tabIndex={-1} aria-label={open === 'login' ? 'Log in' : LABELS[open]} onKeyDown={trapTab}>
            <button type="button" className="pub-x" aria-label="Close" onClick={() => close(true)}>
              <i className="bi bi-x-lg" aria-hidden="true" />
            </button>
            {body(open)}
          </div>
        </>
      )}
    </>
  )

  return (
    <MenuContext.Provider value={menu}>
      {children(
        <>
          {header}
          {phoneLayers}
        </>,
      )}
    </MenuContext.Provider>
  )
}

