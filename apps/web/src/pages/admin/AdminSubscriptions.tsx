import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ADMIN_SUBSCRIPTION_TABS, type AdminPlanDto, type AdminSubscriptionRowDto, type AdminSubscriptionTab, type Paginated } from '@weddyzone/shared'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { RowMenu } from '../../components/RowMenu'
import { SubscriptionActionDialog, type SubscriptionAction } from '../../components/SubscriptionActions'
import { Card, EmptyState, ErrorState, PageHeader, Pagination, TableSkeleton } from '../../components/ui'
import { useDebouncedUrlSearch, useUrlState } from '../../hooks/useUrlState'
import { DaysLeftBadge, formatIstDate, formatIstDateTime, planCycle, SubscriptionStatusPill } from '../../lib/admin'
import { api, download } from '../../lib/api'
import { toastError } from '../../lib/query'
import { formatMoney } from '../../utils/format'

const LIMIT = 25
const TAB_LABELS: Record<AdminSubscriptionTab, string> = {
  all: 'All',
  attention: 'Needs attention',
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
  const [url, setUrl] = useUrlState({ tab: 'all', search: '', planId: '', cycle: '', expiresFrom: '', expiresTo: '', sort: 'endDate', page: '1' })
  const [search, setSearch] = useDebouncedUrlSearch(url.search, (v) => setUrl({ search: v }))
  const [dialog, setDialog] = useState<{ action: SubscriptionAction; row: AdminSubscriptionRowDto } | null>(null)
  const [exporting, setExporting] = useState(false)
  // Less-used filters live behind "More filters"; it opens by itself when one of them is set.
  const moreCount = [url.cycle, url.expiresFrom, url.expiresTo, url.sort !== 'endDate' ? url.sort : ''].filter(Boolean).length
  const [moreOpen, setMoreOpen] = useState(moreCount > 0)
  const page = Number(url.page) || 1
  const filters = {
    tab: url.tab,
    search: url.search || undefined,
    planId: url.planId || undefined,
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
  // When grace ends matters only where plans in grace are listed.
  const showGraceEnds = url.tab === 'grace' || url.tab === 'attention'
  const filtered = Boolean(url.search || url.planId || url.cycle || url.expiresFrom || url.expiresTo)

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
        title="Subscriptions"
        subtitle="Every studio's plan and deadline. Times are in IST."
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
          <label className="search">
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
          <button className="btn btn-sm btn-ghost more-filters-btn" aria-expanded={moreOpen} aria-controls="more-filters" onClick={() => setMoreOpen((o) => !o)}>
            <i className="bi bi-sliders" /> More filters{moreCount ? ` (${moreCount})` : ''}
          </button>
          {filtered && (
            <button className="btn btn-sm btn-ghost" onClick={() => setUrl({ search: '', planId: '', cycle: '', expiresFrom: '', expiresTo: '' })}>
              Clear filters
            </button>
          )}
        </div>
        {moreOpen && (
          <div className="admin-filters admin-more-filters" id="more-filters">
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
          </div>
        )}

        {list.isPending ? (
          <TableSkeleton rows={8} cols={7} />
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
            {/* Scrolls sideways on its own; the page never does. */}
            <div className="admin-table-scroll" role="region" aria-label="Subscriptions table" tabIndex={0}>
              <table className="table admin-subs-table">
                <thead>
                  <tr>
                    <th>Studio</th>
                    <th>Owner</th>
                    <th>Plan</th>
                    <th className="num">Amount</th>
                    <th>Deadline</th>
                    <th>Days left</th>
                    {showGraceEnds && <th>Grace ends (IST)</th>}
                    <th>Status</th>
                    <th>Auto-renew</th>
                    <th className="num" aria-label="Actions" />
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
                      <td>{planCycle(r)}</td>
                      <td className="num">{r.amountPaise ? formatMoney(r.amountPaise) : '—'}</td>
                      <td>{formatIstDate(r.endDate)}</td>
                      <td>
                        <DaysLeftBadge row={r} />
                      </td>
                      {showGraceEnds && <td>{r.graceEndsAt ? formatIstDateTime(r.graceEndsAt) : '—'}</td>}
                      <td>
                        <SubscriptionStatusPill status={r.status} />
                        {r.cancelAtPeriodEnd && r.status !== 'CANCELLED' && <div className="muted" style={{ fontSize: 12 }}>Cancels at end</div>}
                      </td>
                      <td>{r.autoRenew ? <i className="bi bi-check-circle-fill" style={{ color: 'var(--success)' }} aria-label="On" /> : <span className="muted">Off</span>}</td>
                      <td className="num" onClick={(e) => e.stopPropagation()}>
                        <RowMenu
                          label={`Actions for ${r.studio.name}`}
                          items={[
                            { label: 'Send reminder', icon: 'alarm', onSelect: () => setDialog({ action: 'remind', row: r }) },
                            { label: 'Extend', icon: 'calendar-plus', onSelect: () => setDialog({ action: 'extend', row: r }) },
                            { label: 'Change plan', icon: 'arrow-left-right', onSelect: () => setDialog({ action: 'change-plan', row: r }) },
                            { label: 'Cancel', icon: 'x-octagon', danger: true, disabled: r.status === 'CANCELLED', onSelect: () => setDialog({ action: 'cancel', row: r }) },
                          ]}
                        />
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
