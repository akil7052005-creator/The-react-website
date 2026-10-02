import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  ADMIN_SUBSCRIPTION_TABS,
  SUBSCRIPTION_STATUS_LABELS,
  SUBSCRIPTION_STATUSES,
  type AdminPlanDto,
  type AdminSubscriptionRowDto,
  type AdminSubscriptionTab,
  type Paginated,
} from '@weddyzone/shared'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { SubscriptionActionDialog, type SubscriptionAction } from '../../components/SubscriptionActions'
import { Card, EmptyState, ErrorState, PageHeader, Pagination, TableSkeleton } from '../../components/ui'
import { useDebouncedUrlSearch, useUrlState } from '../../hooks/useUrlState'
import { DaysLeftBadge, formatIstDate, SubscriptionStatusPill } from '../../lib/admin'
import { api, download } from '../../lib/api'
import { toastError } from '../../lib/query'
import { formatMoney } from '../../utils/format'

const LIMIT = 25
const TAB_LABELS: Record<AdminSubscriptionTab, string> = {
  all: 'All',
  expiring: 'Expiring soon',
  grace: 'Grace',
  expired: 'Expired',
  cancelled: 'Cancelled',
  failed: 'Failed',
}
const SORTS = [
  { value: 'endDate', label: 'Soonest deadline' },
  { value: '-endDate', label: 'Latest deadline' },
  { value: '-createdAt', label: 'Newest' },
  { value: '-amount', label: 'Highest amount' },
  { value: 'studio', label: 'Studio A–Z' },
]

/** Platform admin: every studio's subscription, soonest deadline first. */
export default function AdminSubscriptions() {
  const navigate = useNavigate()
  const [url, setUrl] = useUrlState({ tab: 'all', search: '', planId: '', status: '', cycle: '', expiresFrom: '', expiresTo: '', sort: 'endDate', page: '1' })
  const [search, setSearch] = useDebouncedUrlSearch(url.search, (v) => setUrl({ search: v }))
  const [dialog, setDialog] = useState<{ action: SubscriptionAction; row: AdminSubscriptionRowDto } | null>(null)
  const [exporting, setExporting] = useState(false)
  const page = Number(url.page) || 1
  const filters = {
    tab: url.tab,
    search: url.search || undefined,
    planId: url.planId || undefined,
    status: url.status || undefined,
    cycle: url.cycle || undefined,
    expiresFrom: url.expiresFrom || undefined,
    expiresTo: url.expiresTo || undefined,
    sort: url.sort,
  }
  const query = { ...filters, page, limit: LIMIT }
  const list = useQuery({
    queryKey: ['admin', 'subscriptions', query],
    queryFn: () => api.get<Paginated<AdminSubscriptionRowDto>>('/admin/subscriptions', query),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  })
  const plans = useQuery({ queryKey: ['admin', 'plans'], queryFn: () => api.get<AdminPlanDto[]>('/admin/plans') })
  const rows = list.data?.data ?? []
  const filtered = Boolean(url.search || url.planId || url.status || url.cycle || url.expiresFrom || url.expiresTo)

  const exportCsv = async () => {
    setExporting(true)
    try {
      const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString()
      await download(`/admin/subscriptions/export.csv?${qs}`, `subscriptions-${new Date().toISOString().slice(0, 10)}.csv`)
    } catch (e) {
      toastError(e)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Platform admin"
        title="Subscriptions"
        subtitle="Every studio's plan and deadline. Times are in IST; amounts include GST."
        actions={
          <button className="btn btn-ghost" onClick={exportCsv} disabled={exporting}>
            <i className="bi bi-download" /> {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        }
      />
      <Card
        flush
        title="Studios"
        action={
          <div className="tabs admin-tabs" role="tablist">
            {ADMIN_SUBSCRIPTION_TABS.map((t) => (
              <button key={t} role="tab" aria-selected={url.tab === t} className={url.tab === t ? 'on' : ''} onClick={() => setUrl({ tab: t })}>
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>
        }
      >
        <div className="admin-filters">
          <label className="search" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="bi bi-search" />
            <input type="search" placeholder="Studio, email or phone" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search studios" />
          </label>
          <label>
            Plan
            <select value={url.planId} onChange={(e) => setUrl({ planId: e.target.value })}>
              <option value="">All plans</option>
              {plans.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={url.status} onChange={(e) => setUrl({ status: e.target.value })}>
              <option value="">Any status</option>
              {SUBSCRIPTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {SUBSCRIPTION_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Cycle
            <select value={url.cycle} onChange={(e) => setUrl({ cycle: e.target.value })}>
              <option value="">Monthly + yearly</option>
              <option value="MONTHLY">Monthly</option>
              <option value="YEARLY">Yearly</option>
            </select>
          </label>
          <label>
            Deadline from
            <input type="date" value={url.expiresFrom} onChange={(e) => setUrl({ expiresFrom: e.target.value })} />
          </label>
          <label>
            Deadline to
            <input type="date" value={url.expiresTo} min={url.expiresFrom || undefined} onChange={(e) => setUrl({ expiresTo: e.target.value })} />
          </label>
          <label>
            Sort
            <select value={url.sort} onChange={(e) => setUrl({ sort: e.target.value })}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {filtered && (
            <button className="btn btn-sm btn-ghost" onClick={() => setUrl({ search: '', planId: '', status: '', cycle: '', expiresFrom: '', expiresTo: '' })}>
              Clear filters
            </button>
          )}
        </div>

        {list.isPending ? (
          <TableSkeleton rows={8} cols={8} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="credit-card-2-front"
            title={filtered ? 'No subscriptions match' : url.tab === 'all' ? 'No subscriptions yet' : `Nothing in ${TAB_LABELS[url.tab as AdminSubscriptionTab].toLowerCase()}`}
            text={filtered ? 'Try other filters.' : url.tab === 'expiring' ? 'No plan expires in the next 7 days.' : undefined}
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table admin-subs-table">
                <thead>
                  <tr>
                    <th>Studio</th>
                    <th>Owner</th>
                    <th>Plan</th>
                    <th>Cycle</th>
                    <th className="num">Amount</th>
                    <th>Start</th>
                    <th>Deadline</th>
                    <th>Days left</th>
                    <th>Status</th>
                    <th>Auto-renew</th>
                    <th className="num">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="row-clickable" onClick={() => navigate(`/admin/subscriptions/${r.id}`)}>
                      <td className="cell-main">
                        <Link to={`/admin/subscriptions/${r.id}`} className="link" onClick={(e) => e.stopPropagation()}>
                          {r.studio.name}
                        </Link>
                      </td>
                      <td>
                        <span className="owner">
                          <strong>{r.owner.name || '—'}</strong>
                          <span>{r.owner.email}</span>
                          {r.owner.phone && <span>{r.owner.phone}</span>}
                        </span>
                      </td>
                      <td>
                        {r.plan.name}
                        {r.isTrial && <span className="muted"> (trial)</span>}
                      </td>
                      <td>{r.cycle === 'YEARLY' ? 'Yearly' : 'Monthly'}</td>
                      <td className="num">{r.amountPaise ? formatMoney(r.amountPaise) : '—'}</td>
                      <td>{formatIstDate(r.startDate)}</td>
                      <td>{formatIstDate(r.endDate)}</td>
                      <td>
                        <DaysLeftBadge row={r} />
                      </td>
                      <td>
                        <SubscriptionStatusPill status={r.status} />
                        {r.cancelAtPeriodEnd && r.status !== 'CANCELLED' && <div className="muted" style={{ fontSize: 12 }}>Cancels at end</div>}
                      </td>
                      <td>{r.autoRenew ? <i className="bi bi-check-circle-fill" style={{ color: 'var(--success)' }} aria-label="On" /> : <span className="muted">Off</span>}</td>
                      <td className="num" onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions">
                          <button className="icon-btn" title="Send reminder now" aria-label={`Send ${r.studio.name} a reminder`} onClick={() => setDialog({ action: 'remind', row: r })}>
                            <i className="bi bi-alarm" />
                          </button>
                          <button className="icon-btn" title="Extend deadline" aria-label={`Extend ${r.studio.name}'s deadline`} onClick={() => setDialog({ action: 'extend', row: r })}>
                            <i className="bi bi-calendar-plus" />
                          </button>
                          <button className="icon-btn" title="Change plan" aria-label={`Change ${r.studio.name}'s plan`} onClick={() => setDialog({ action: 'change-plan', row: r })}>
                            <i className="bi bi-arrow-left-right" />
                          </button>
                          <button
                            className="icon-btn"
                            title="Cancel subscription"
                            aria-label={`Cancel ${r.studio.name}'s subscription`}
                            disabled={r.status === 'CANCELLED'}
                            onClick={() => setDialog({ action: 'cancel', row: r })}
                          >
                            <i className="bi bi-x-octagon" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} limit={LIMIT} total={list.data!.meta.total} onPage={(p) => setUrl({ page: String(p) })} />
          </>
        )}
      </Card>
      {dialog && <SubscriptionActionDialog action={dialog.action} row={dialog.row} onClose={() => setDialog(null)} />}
    </div>
  )
}
