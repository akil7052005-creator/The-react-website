import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

interface Slide {
  kicker: string
  /** The headline, with `accent` shown in red. */
  before: string
  accent: string
  after?: string
  body: string
  cta: string
  to: string
}

const SLIDES: Slide[] = [
  {
    kicker: 'From hundreds of frames to',
    before: 'Their ',
    accent: 'favourites',
    after: ', in one tap',
    body: 'Share a private gallery — the couple hearts the photos they love.',
    cta: 'Start a selection',
    to: '/photo-selection?create=1',
  },
  {
    kicker: 'WhatsApp sharing',
    before: 'Send the gallery ',
    accent: 'where they chat',
    body: 'One message with the link and a reminder when they go quiet.',
    cta: 'Top up credits',
    to: '/whatsapp-credit',
  },
  {
    kicker: 'All-Access',
    before: 'Unlimited events, ',
    accent: 'all season',
    body: 'Every feature and the most storage, for the busiest studios.',
    cta: 'See All-Access',
    to: '/all-access',
  },
]

const INTERVAL_MS = 5000

/** Original illustration: a fan of photo cards, an arrow, and the two picked cards with hearts. */
function PicksIllustration() {
  const card = (x: number, y: number, rot: number, hue: string, key: string) => (
    <g key={key} transform={`translate(${x} ${y}) rotate(${rot})`}>
      <rect x="-46" y="-34" width="92" height="68" rx="8" fill="#fff" stroke="#f1d9df" />
      <rect x="-40" y="-28" width="80" height="48" rx="5" fill={hue} />
      <circle cx="-22" cy="-14" r="6" fill="#fff" opacity="0.75" />
      <path d="M-40 20 L-14 -4 L4 12 L18 0 L40 20 Z" fill="#fff" opacity="0.55" />
    </g>
  )
  const heart = (x: number, y: number) => (
    <g transform={`translate(${x} ${y})`}>
      <circle r="13" fill="#e1062c" />
      <path d="M0 6 C-9 -1 -7 -9 -2 -8 C-1 -8 0 -6 0 -5 C0 -6 1 -8 2 -8 C7 -9 9 -1 0 6 Z" fill="#fff" />
    </g>
  )
  return (
    <svg className="db-hero-art" viewBox="0 0 420 240" role="img" aria-label="Photo cards with two picked favourites">
      <defs>
        <linearGradient id="dbh-a" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#f6c9d2" />
          <stop offset="1" stopColor="#e9a3b2" />
        </linearGradient>
        <linearGradient id="dbh-b" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#f3dfc0" />
          <stop offset="1" stopColor="#d9b67a" />
        </linearGradient>
        <linearGradient id="dbh-c" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#d7c2e8" />
          <stop offset="1" stopColor="#a98cc4" />
        </linearGradient>
      </defs>
      {/* the stack */}
      {card(92, 132, -14, 'url(#dbh-c)', 'c1')}
      {card(112, 118, -4, 'url(#dbh-b)', 'c2')}
      {card(134, 108, 8, 'url(#dbh-a)', 'c3')}
      {/* arrow to the picks */}
      <path d="M190 92 C 228 54, 262 56, 286 82" fill="none" stroke="#e1062c" strokeWidth="3" strokeDasharray="6 6" strokeLinecap="round" />
      <path d="M278 70 L290 86 L272 88" fill="none" stroke="#e1062c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {/* the picks */}
      {card(316, 126, 6, 'url(#dbh-a)', 'p1')}
      {card(352, 176, -5, 'url(#dbh-b)', 'p2')}
      {heart(356, 98)}
      {heart(392, 152)}
    </svg>
  )
}

/** The dashboard's hero: three slides, auto-advancing every 5 s (paused on hover/focus or reduced motion). */
export function HeroCarousel() {
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const go = useCallback((n: number) => setI((n + SLIDES.length) % SLIDES.length), [])

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (paused || reduce) return
    const t = window.setTimeout(() => go(i + 1), INTERVAL_MS)
    return () => window.clearTimeout(t)
  }, [i, paused, go])

  const s = SLIDES[i]
  return (
    <section
      className="db-hero"
      aria-roledescription="carousel"
      aria-label="Highlights"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="db-hero-slide" aria-roledescription="slide" aria-label={`${i + 1} of ${SLIDES.length}`} aria-live={paused ? 'polite' : 'off'} key={i}>
        <div className="db-hero-text">
          <p className="db-hero-kicker">{s.kicker}</p>
          <h2>
            {s.before}
            <em>{s.accent}</em>
            {s.after}
          </h2>
          <p className="db-hero-body">{s.body}</p>
          <Link to={s.to} className="db-hero-cta">
            {s.cta} <i className="bi bi-arrow-right" aria-hidden="true" />
          </Link>
        </div>
        <PicksIllustration />
      </div>
      <button type="button" className="db-hero-arrow prev" onClick={() => go(i - 1)} aria-label="Previous slide">
        <i className="bi bi-chevron-left" />
      </button>
      <button type="button" className="db-hero-arrow next" onClick={() => go(i + 1)} aria-label="Next slide">
        <i className="bi bi-chevron-right" />
      </button>
      <div className="db-hero-dots" role="tablist" aria-label="Choose slide">
        {SLIDES.map((x, n) => (
          <button key={x.cta} type="button" role="tab" aria-selected={n === i} aria-label={`Slide ${n + 1}`} className={n === i ? 'on' : ''} onClick={() => go(n)} />
        ))}
      </div>
    </section>
  )
}
