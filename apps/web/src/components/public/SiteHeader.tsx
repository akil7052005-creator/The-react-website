import type { BillingCycle } from '@weddyzone/shared'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { ChosenPlan } from '../../pages/auth/Signup'
import { usePlans } from '../../lib/billing'
import { APP_NAME } from '../../lib/brand'
import { AboutPanel, arrowNav, CYCLE_SHORT, LoginPanel, PricingPanel, TrialPanel, type PanelId } from './headerPanels'

const OPEN_DELAY = 150
const CLOSE_GRACE = 300
const PHONE_QUERY = '(max-width: 899.98px)'
const MONTHS: Record<string, BillingCycle> = { '1': 'MONTHLY', '3': 'QUARTERLY', '6': 'HALF_YEARLY', '12': 'YEARLY' }
const FORM_PANELS: PanelId[] = ['login', 'trial']
const LABELS: Record<PanelId, string> = { about: 'About Us', pricing: 'Plans & Pricing', login: 'Login', trial: 'Start free trial' }

/** A plan from the menu or a /signup?plan=…&months=… link; its name comes from /plans when the link has only the code. */
type PickedPlan = Omit<ChosenPlan, 'name'> & { name?: string }

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

export const scrollToSection = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })

interface Menu {
  open: PanelId | null
  openPanel: (id: PanelId, plan?: PickedPlan | null) => void
  close: (returnFocus?: boolean) => void
}
const MenuContext = createContext<Menu | null>(null)

/** For buttons on the page (hero, pricing cards, footer) that open a header panel. */
export function usePublicMenu() {
  const m = useContext(MenuContext)
  if (!m) throw new Error('usePublicMenu must be used inside <PublicShell>')
  return m
}

/**
 * The public site's top menu. About Us and Plans & Pricing open mega panels under the header,
 * Login and Start free trial open form panels (hover after 150 ms, or click / Enter). On phones:
 * ☰ opens a drawer with accordions; Login and Start free trial open as bottom sheets.
 */
export function PublicMenu({ initial, children }: { initial?: PanelId; children: (menu: ReactNode) => ReactNode }) {
  const [params] = useSearchParams()
  const phone = useIsPhone()
  // Old links (/about, /pricing, /login, /signup) arrive with their panel open; on phones About and
  // Pricing scroll to their section instead (below).
  const [open, setOpen] = useState<PanelId | null>(() => (initial && !(isPhoneNow() && (initial === 'about' || initial === 'pricing')) ? initial : null))
  const [byHover, setByHover] = useState(false)
  // A form panel stays open on mouse leave once the user has typed in it.
  const [typed, setTyped] = useState(false)
  const [plan, setPlan] = useState<PickedPlan | null>(() => {
    const code = params.get('plan')
    const cycle = MONTHS[params.get('months') ?? ''] ?? 'MONTHLY'
    return code === 'PRO' || code === 'ALL_ACCESS' ? { code, cycle, cycleLabel: CYCLE_SHORT[cycle] } : null
  })
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
    (id: PanelId, chosen?: PickedPlan | null) => {
      clearTimers()
      if (chosen !== undefined) setPlan(chosen)
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

  useEffect(() => {
    if (isPhoneNow() && (initial === 'about' || initial === 'pricing')) scrollToSection(initial)
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
    // The header's Start free trial is the Trial plan; Pro/VIP come from Plans & Pricing.
    else openPanel(id, id === 'trial' ? null : undefined)
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
        onChoose={(p) => openPanel('trial', p)}
        onCompare={() => {
          close()
          scrollToSection('pricing')
        }}
      />
    ) : id === 'login' ? (
      <LoginPanel onTrial={() => openPanel('trial')} />
    ) : (
      <ResolvedTrial plan={plan} onLogin={() => openPanel('login')} />
    )

  const menu: Menu = { open, openPanel, close }

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
            <button
              type="button"
              ref={registerTrigger}
              data-panel="trial"
              aria-expanded={open === 'trial'}
              aria-controls="pub-panel-trial"
              onMouseEnter={() => hoverOpen('trial')}
              onMouseLeave={stopOpening}
              onClick={() => clickTrigger('trial')}
              onKeyDown={(e) => arrowIntoPanel('trial', e)}
              className="pub-btn sm pub-menu-item pub-trial-btn"
            >
              Start free trial
            </button>
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
                      {id === 'about' ? <AboutPanel stacked /> : <PricingPanel onChoose={(p) => openPanel('trial', p)} onCompare={() => openPanel('pricing')} />}
                    </div>
                  )}
                </div>
              ))}
              <button type="button" className="pub-drawer-link" onClick={() => openPanel('login')}>
                Login
              </button>
              <button type="button" className="pub-btn block" onClick={() => openPanel('trial', null)}>
                Start free trial
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

/** The sign-up panel, with the chosen plan's name from /plans (a /signup?plan= link only has the code). */
function ResolvedTrial({ plan, onLogin }: { plan: PickedPlan | null; onLogin: () => void }) {
  const plans = usePlans()
  const name = plan ? (plan.name ?? plans.data?.find((p) => p.code === plan.code)?.name ?? (plan.code === 'ALL_ACCESS' ? 'VIP' : 'Pro')) : null
  return <TrialPanel plan={plan && name ? { ...plan, name } : null} onLogin={onLogin} />
}

export type { PickedPlan }
