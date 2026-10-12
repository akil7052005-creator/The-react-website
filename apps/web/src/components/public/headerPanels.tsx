import { CYCLE_LABELS, PRICING_CYCLES, type BillingCycle } from '@weddyzone/shared'
import { useState, type KeyboardEvent } from 'react'
import { perMonth, priceFor, usePlans } from '../../lib/billing'
import { APP_NAME } from '../../lib/brand'
import { isTrialPlan, planLimitLines } from '../../lib/planCopy'
import { formatMoney } from '../../utils/format'
import { LoginForm } from '../../pages/auth/Login'
import { ForgotForm } from '../../pages/auth/Passwords'
import { SignupForm, type ChosenPlan } from '../../pages/auth/Signup'
import { ErrorState, Skeleton } from '../ui'

export type PanelId = 'about' | 'pricing' | 'login' | 'trial'

export const CYCLE_SHORT: Record<BillingCycle, string> = { MONTHLY: '1 month', QUARTERLY: '3 months', HALF_YEARLY: '6 months', YEARLY: '1 year' }

/** Up/Down (or Left/Right) moves focus between the buttons in `selector` inside the list. */
export function arrowNav(selector: string, axis: 'vertical' | 'horizontal' = 'vertical') {
  return (e: KeyboardEvent<HTMLElement>) => {
    const keys = axis === 'vertical' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']
    if (!keys.includes(e.key)) return
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>(selector)]
    const at = items.indexOf(document.activeElement as HTMLElement)
    if (at < 0) return
    e.preventDefault()
    items[(at + (e.key === keys[1] ? 1 : -1) + items.length) % items.length].focus()
  }
}

const CONTACT = [
  { icon: 'telephone', label: 'Phone' },
  { icon: 'whatsapp', label: 'WhatsApp' },
  { icon: 'envelope', label: 'Email' },
  { icon: 'geo-alt', label: 'Address' },
]

const ABOUT_ITEMS = [
  {
    key: 'story',
    icon: 'book',
    title: 'Our story',
    line: `Who we are and why we built ${APP_NAME}`,
    body: `We build simple tools for wedding studios, so choosing photos becomes the easy part of the job. [Owner to write] Who we are, why we started, and the studios we work with.`,
  },
  {
    key: 'believe',
    icon: 'shield-lock',
    title: 'What we believe',
    line: 'Originals stay with the photographer',
    body: 'Only light previews go online: the full-size photos never leave your computer. Couples pick on their phone, with no app to install.',
  },
  {
    key: 'for',
    icon: 'camera',
    title: "Who it's for",
    line: 'Wedding studios and photographers',
    body: 'Studios of any size that shoot weddings and events and want the couple’s picks back without a long WhatsApp thread.',
  },
  { key: 'contact', icon: 'chat-dots', title: 'Contact', line: 'Phone, WhatsApp and email', body: '' },
] as const

/** About Us: four topics on the left, the hovered/selected one on the right (stacked on phones). */
export function AboutPanel({ stacked }: { stacked?: boolean }) {
  const [sel, setSel] = useState<(typeof ABOUT_ITEMS)[number]['key']>('story')
  const item = ABOUT_ITEMS.find((i) => i.key === sel)!
  return (
    <div className={`pub-about-panel${stacked ? ' stacked' : ''}`}>
      <ul className="pub-mm-list" role="menu" aria-label="About Us" onKeyDown={arrowNav('[role="menuitem"]')}>
        {ABOUT_ITEMS.map((i) => (
          <li key={i.key} role="none">
            <button
              type="button"
              role="menuitem"
              className={`pub-mm-item${i.key === sel ? ' on' : ''}`}
              aria-current={i.key === sel || undefined}
              onMouseEnter={() => setSel(i.key)}
              onFocus={() => setSel(i.key)}
              onClick={() => setSel(i.key)}
            >
              <span className="pub-mm-icon">
                <i className={`bi bi-${i.icon}`} aria-hidden="true" />
              </span>
              <span>
                <strong>{i.title}</strong>
                <small>{i.line}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="pub-mm-detail" aria-live="polite" data-testid="about-detail">
        <span className="pub-mm-art" aria-hidden="true">
          <i className={`bi bi-${item.icon}`} />
        </span>
        <h3>{item.title}</h3>
        {item.key === 'contact' ? (
          <ul className="pub-mm-contact">
            {CONTACT.map((c) => (
              <li key={c.label}>
                <i className={`bi bi-${c.icon}`} aria-hidden="true" /> {c.label}: [Owner to add]
              </li>
            ))}
          </ul>
        ) : (
          <p>{item.body}</p>
        )}
      </div>
    </div>
  )
}

/** Plans & Pricing: a period switch and the three plans from /plans, each with Choose. */
export function PricingPanel({ onChoose, onCompare }: { onChoose: (plan: ChosenPlan | null) => void; onCompare: () => void }) {
  const [cycle, setCycle] = useState<BillingCycle>('MONTHLY')
  const plans = usePlans()
  return (
    <div className="pub-price-panel">
      <div className="pub-switch" role="tablist" aria-label="Billing period" onKeyDown={arrowNav('[role="tab"]', 'horizontal')}>
        {PRICING_CYCLES.map((c) => (
          <button key={c} type="button" role="tab" aria-selected={c === cycle} tabIndex={c === cycle ? 0 : -1} className={c === cycle ? 'on' : ''} onClick={() => setCycle(c)}>
            {CYCLE_SHORT[c]}
          </button>
        ))}
      </div>
      {plans.isError ? (
        <ErrorState error={plans.error} onRetry={() => plans.refetch()} title="We could not load the plans" />
      ) : (
        <div className="pub-mini-plans" data-testid="menu-plans">
          {plans.isPending
            ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={210} radius={12} />)
            : (plans.data ?? []).map((p) => {
                const trial = isTrialPlan(p)
                const price = priceFor(p, cycle)
                const popular = p.code === 'PRO'
                return (
                  <article key={p.code} className={`pub-mini-plan${popular ? ' popular' : ''}`} data-testid={`menu-plan-${p.code}`}>
                    {popular && <span className="pub-flag">Most popular</span>}
                    <h3>{p.name}</h3>
                    <p className="pub-mini-price">
                      {trial ? 'Free' : price === null ? '—' : formatMoney(price)}
                      <small> {trial ? '· 14 days' : `/ ${CYCLE_LABELS[cycle]}`}</small>
                    </p>
                    {!trial && price !== null && cycle !== 'MONTHLY' && <p className="pub-per-month">{formatMoney(perMonth(price, cycle))} a month</p>}
                    <ul className="pub-limits">
                      {planLimitLines(p)
                        .slice(0, 3)
                        .map((line) => (
                          <li key={line}>
                            <i className="bi bi-check-circle-fill" aria-hidden="true" /> {line}
                          </li>
                        ))}
                    </ul>
                    <button
                      type="button"
                      className={`pub-btn sm block${popular ? '' : ' ghost'}`}
                      onClick={() => onChoose(trial ? null : { code: p.code, name: p.name, cycle, cycleLabel: CYCLE_SHORT[cycle] })}
                    >
                      Choose {p.name}
                    </button>
                  </article>
                )
              })}
        </div>
      )}
      <div className="pub-price-foot">
        <span className="pub-note">All prices exclude 18% GST.</span>
        <button type="button" className="pub-link" onClick={onCompare}>
          Compare all plans →
        </button>
      </div>
    </div>
  )
}

/** Login, or (Forgot password?) the reset-link form, in the same panel. */
export function LoginPanel({ onTrial }: { onTrial: () => void }) {
  const [mode, setMode] = useState<'login' | 'forgot'>('login')
  return mode === 'login' ? (
    <>
      <h2 className="pub-panel-title">Welcome back</h2>
      <LoginForm onForgot={() => setMode('forgot')} onSignup={onTrial} />
    </>
  ) : (
    <>
      <h2 className="pub-panel-title">Forgot your password?</h2>
      <p className="pub-panel-sub">Enter your account email and we'll send you a reset link.</p>
      <ForgotForm />
      <p className="pub-panel-foot">
        <button type="button" className="pub-link" onClick={() => setMode('login')}>
          ← Back to login
        </button>
      </p>
    </>
  )
}

export function TrialPanel({ plan, onLogin }: { plan: ChosenPlan | null; onLogin: () => void }) {
  return (
    <>
      <h2 className="pub-panel-title">Create your studio</h2>
      <p className="pub-panel-sub">Free for 14 days. No card needed.</p>
      <SignupForm plan={plan} onLogin={onLogin} />
    </>
  )
}
