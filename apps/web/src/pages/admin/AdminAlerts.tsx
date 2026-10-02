import { Link } from 'react-router-dom'
import { Card, EmptyState, ErrorState, PageHeader, Pagination, TableSkeleton } from '../../components/ui'
import { useUrlState } from '../../hooks/useUrlState'
import { formatIstDateTime, useAdminNotificationActions, useAdminNotifications } from '../../lib/admin'

const LIMIT = 25

/** Every platform alert: purchases, deadlines, grace, expiry, failed payments, heavy usage, digests. */
export default function AdminAlerts() {
  const [url, setUrl] = useUrlState({ show: 'all', page: '1' })
  const page = Number(url.page) || 1
  const q = useAdminNotifications({ page, limit: LIMIT, unread: url.show === 'unread' })
  const { readOne, readAll } = useAdminNotificationActions()
  const rows = q.data?.data ?? []
  const unread = q.data?.unreadCount ?? 0

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Platform admin"
        title="Alerts"
        subtitle="New purchases, upcoming deadlines, expiries, failed payments and studios near their limits."
        actions={
          unread > 0 && (
            <button className="btn btn-ghost" onClick={() => readAll.mutate()} disabled={readAll.isPending}>
              <i className="bi bi-check2-all" /> Mark all read
            </button>
          )
        }
      />
      <Card
        flush
        title={unread ? `${unread} unread` : 'All caught up'}
        action={
          <div className="tabs" role="tablist">
            {[
              { key: 'all', label: 'All' },
              { key: 'unread', label: 'Unread' },
            ].map((t) => (
              <button key={t.key} role="tab" aria-selected={url.show === t.key} className={url.show === t.key ? 'on' : ''} onClick={() => setUrl({ show: t.key })}>
                {t.label}
              </button>
            ))}
          </div>
        }
      >
        {q.isPending ? (
          <TableSkeleton rows={6} cols={3} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon="bell" title={url.show === 'unread' ? 'No unread alerts' : 'No alerts yet'} text="New purchases and deadline alerts appear here within seconds." />
        ) : (
          <>
            <ul className="alert-feed">
              {rows.map((n) => (
                <li key={n.id} className={n.readAt ? '' : 'unread'}>
                  <span className="stat-icon tone-wine">
                    <i className="bi bi-bell" />
                  </span>
                  <div>
                    {n.link ? (
                      <Link to={n.link} className="link" onClick={() => !n.readAt && readOne.mutate(n.id)}>
                        <strong>{n.title}</strong>
                      </Link>
                    ) : (
                      <strong>{n.title}</strong>
                    )}
                    <p>{n.message}</p>
                    {!n.readAt && (
                      <button className="link" style={{ fontSize: 12.5 }} onClick={() => readOne.mutate(n.id)}>
                        Mark read
                      </button>
                    )}
                  </div>
                  <time dateTime={n.createdAt}>{formatIstDateTime(n.createdAt)}</time>
                </li>
              ))}
            </ul>
            <Pagination page={page} limit={LIMIT} total={q.data!.meta.total} onPage={(p) => setUrl({ page: String(p) })} />
          </>
        )}
      </Card>
    </div>
  )
}
