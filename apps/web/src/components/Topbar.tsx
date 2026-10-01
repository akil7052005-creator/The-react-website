import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { NotificationDto, SearchResultDto } from '@weddyzone/shared'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Avatar, FeatureTooltip, Spinner } from './ui'
import { formatNumber, timeAgo } from '../utils/format'
import { liveFeatureInfo } from '../lib/liveFeatures'
import { useMe } from '../auth/AuthProvider'
import { api } from '../lib/api'
import { useDebounced } from '../hooks/useUrlState'

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void) {
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside()
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [ref, onOutside])
}

const resultIcons: Record<SearchResultDto['type'], string> = {
  client: 'person',
  event: 'calendar-heart',
  album: 'journal-album',
  invoice: 'receipt',
}

function GlobalSearch() {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const debounced = useDebounced(q.trim(), 250)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  useClickOutside(boxRef, () => setOpen(false))

  const results = useQuery({
    queryKey: ['search', debounced],
    queryFn: ({ signal }) => api.get<SearchResultDto[]>('/search', { q: debounced }, signal),
    enabled: debounced.length >= 2,
    staleTime: 10_000,
  })

  // Press "/" anywhere to jump into search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const items = results.data ?? []
  const go = (r: SearchResultDto) => {
    setOpen(false)
    setQ('')
    navigate(r.link)
  }

  return (
    <div className="global-search" ref={boxRef}>
      <FeatureTooltip
        title="Universal Studio Search"
        badge="Quick Nav"
        icon="search"
        summary="Search across your events, couple names, digital albums, and invoices in milliseconds."
        highlights={['Instant matching across client names and phone numbers', 'Jump directly into events, albums and invoices', 'Press / to search anytime']}
        position="bottom"
        width={300}
        delay={150}
      >
        <label className="search">
          <i className="bi bi-search" />
          <input
            ref={inputRef}
            type="search"
            placeholder="Search events, clients, albums… (hover for info)"
            value={q}
            aria-label="Search events, clients, albums and invoices"
            aria-expanded={open && debounced.length >= 2}
            aria-controls="global-search-results"
            onChange={(e) => {
              setQ(e.target.value)
              setOpen(true)
              setActive(0)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
              if (e.key === 'ArrowDown') setActive((a) => Math.min(items.length - 1, a + 1))
              if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1))
              if (e.key === 'Enter' && items[active]) go(items[active])
            }}
          />
          {results.isFetching ? <Spinner size={14} /> : <kbd className="search-kbd">/</kbd>}
        </label>
      </FeatureTooltip>
      {open && debounced.length >= 2 && (
        <div className="menu search-results" id="global-search-results" role="listbox">
          {results.isError && <p className="menu-note">Search is unavailable right now.</p>}
          {results.isSuccess && items.length === 0 && <p className="menu-note">No matches for “{debounced}”.</p>}
          {items.map((r, i) => (
            <button
              key={`${r.type}-${r.id}`}
              role="option"
              aria-selected={i === active}
              className={`search-result${i === active ? ' active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r)}
            >
              <i className={`bi bi-${resultIcons[r.type]}`} />
              <span>
                <strong>{r.title}</strong>
                <small>{r.subtitle}</small>
              </span>
              <em>{r.type}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function NotificationsMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()
  const navigate = useNavigate()
  useClickOutside(ref, () => setOpen(false))

  const q = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ data: NotificationDto[]; unreadCount: number }>('/notifications', { limit: 8 }),
    refetchInterval: 60_000,
  })
  const readAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const readOne = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const unread = q.data?.unreadCount ?? 0

  return (
    <div className="notif" ref={ref}>
      <FeatureTooltip
        title="Studio Activity Feed"
        badge="Live Alerts"
        icon="bell"
        summary="Alerts whenever a client completes a photo selection, comments on an album, sends an enquiry or pays an invoice."
        position="bottom"
        width={280}
      >
        <button
          className="icon-btn"
          aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <i className="bi bi-bell" />
          {unread > 0 && <span className="dot" />}
          {unread > 0 && <span className="notif-count">{unread > 9 ? '9+' : unread}</span>}
        </button>
      </FeatureTooltip>
      {open && (
        <div className="menu notif-menu">
          <div className="notif-head">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button className="link" onClick={() => readAll.mutate()} disabled={readAll.isPending}>
                Mark all read
              </button>
            )}
          </div>
          {q.isPending && <p className="menu-note">Loading…</p>}
          {q.isError && (
            <p className="menu-note">
              Could not load notifications.{' '}
              <button className="link" onClick={() => q.refetch()}>
                Retry
              </button>
            </p>
          )}
          {q.data?.data.length === 0 && <p className="menu-note">You're all caught up.</p>}
          {q.data?.data.map((n) => (
            <button
              key={n.id}
              className={`notif-item${n.readAt ? '' : ' unread'}`}
              onClick={() => {
                if (!n.readAt) readOne.mutate(n.id)
                setOpen(false)
                if (n.link) navigate(n.link)
              }}
            >
              <span className="stat-icon tone-wine">
                <i className={`bi bi-${n.icon}`} />
              </span>
              <span>
                <strong>{n.title}</strong> {n.body}
                <time>{timeAgo(n.createdAt)}</time>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const me = useMe()
  const { user, studio } = me
  const featureInfo = liveFeatureInfo(me)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useClickOutside(menuRef, () => setMenuOpen(false))

  return (
    <header className="topbar">
      <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Open menu">
        <i className="bi bi-list" />
      </button>

      <GlobalSearch />

      <div className="topbar-actions">
        <FeatureTooltip feature={featureInfo.whatsappCredit} position="bottom" width={310}>
          <Link to="/whatsapp-credit" className="credit-chip" title="WhatsApp credits" data-testid="credit-chip">
            <i className="bi bi-whatsapp" />
            <span>{formatNumber(studio.creditBalance)}</span>
            <small>Credits</small>
          </Link>
        </FeatureTooltip>

        <NotificationsMenu />

        <FeatureTooltip feature={featureInfo.help} position="bottom" width={290}>
          <Link to="/help" className="icon-btn" aria-label="Help">
            <i className="bi bi-question-circle" />
          </Link>
        </FeatureTooltip>

        <div className="profile" ref={menuRef}>
          <button className="profile-btn" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen}>
            <Avatar name={user.name} src={studio.logoUrl} />
            <span className="profile-text">
              <strong>{user.name}</strong>
              <small>
                {studio.name} · <span className="pro-pill">{studio.plan.code === 'ALL_ACCESS' ? 'VIP' : studio.plan.name.toUpperCase()}</span>
              </small>
            </span>
            <i className="bi bi-chevron-down" />
          </button>
          {menuOpen && (
            <div className="menu" onClick={() => setMenuOpen(false)}>
              <Link to="/profile">
                <i className="bi bi-person" />
                My Profile
              </Link>
              <Link to="/my-subscription">
                <i className="bi bi-patch-check" />
                My Subscription
              </Link>
              <Link to="/billing">
                <i className="bi bi-receipt" />
                Billing
              </Link>
              <hr />
              <Link to="/logout" className="danger">
                <i className="bi bi-box-arrow-left" />
                Logout
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

export default Topbar
