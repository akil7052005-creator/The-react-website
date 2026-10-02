import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAdminNotificationActions, useAdminNotifications } from '../lib/admin'
import { timeAgo } from '../utils/format'

/** Bell in the admin top bar: platform alerts (purchases, deadlines, failed payments) with an unread count. */
export function AdminBell() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const q = useAdminNotifications({ limit: 8 })
  const { readOne, readAll } = useAdminNotificationActions()
  const unread = q.data?.unreadCount ?? 0

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="notif" ref={ref}>
      <button className="icon-btn" aria-label={unread ? `Alerts, ${unread} unread` : 'Alerts'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <i className="bi bi-bell" />
        {unread > 0 && <span className="dot" />}
        {unread > 0 && <span className="notif-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="menu notif-menu">
          <div className="notif-head">
            <strong>Alerts</strong>
            {unread > 0 && (
              <button className="link" onClick={() => readAll.mutate()} disabled={readAll.isPending}>
                Mark all read
              </button>
            )}
          </div>
          {q.isPending && <p className="menu-note">Loading…</p>}
          {q.isError && (
            <p className="menu-note">
              Could not load alerts.{' '}
              <button className="link" onClick={() => q.refetch()}>
                Retry
              </button>
            </p>
          )}
          {q.data?.data.length === 0 && <p className="menu-note">No alerts yet.</p>}
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
                <i className="bi bi-bell" />
              </span>
              <span>
                <strong>{n.title}</strong> {n.message}
                <time>{timeAgo(n.createdAt)}</time>
              </span>
            </button>
          ))}
          <p className="menu-note">
            <Link to="/admin/alerts" className="link" onClick={() => setOpen(false)}>
              See all alerts
            </Link>
          </p>
        </div>
      )}
    </div>
  )
}
