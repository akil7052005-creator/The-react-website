import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminStudioRowDto, Paginated } from '@weddyzone/shared'
import { useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '../../components/Modal'
import { EmptyState, ErrorState, Spinner, TableSkeleton } from '../../components/ui'
import { useDebouncedUrlSearch, useUrlState } from '../../hooks/useUrlState'
import { api, isApiError } from '../../lib/api'
import { formatIstDate } from '../../lib/admin'
import { toastError } from '../../lib/query'

const PAGE_SIZES = ['10', '25', '50', '100']
const PLAN_FILTERS = [
  { value: 'all', label: 'All plans' },
  { value: 'TRIAL', label: 'Trial' },
  { value: 'PRO', label: 'Pro' },
  { value: 'VIP', label: 'VIP' },
  { value: 'NONE', label: 'Never paid / no plan' },
  { value: 'REMOVED', label: 'Removed' },
]
const KEY = ['admin', 'studios'] as const

/** "12 days left", "Expires today", "Expired 3 days ago". */
export function expiryText(daysLeft: number | null): string {
  if (daysLeft === null) return ''
  if (daysLeft > 1) return `${daysLeft} days left`
  if (daysLeft === 1) return '1 day left'
  if (daysLeft === 0) return 'Expires today'
  return daysLeft === -1 ? 'Expired 1 day ago' : `Expired ${-daysLeft} days ago`
}

const STATUS: Record<AdminStudioRowDto['status'], { label: string; cls: string }> = {
  ACTIVE: { label: 'Active', cls: 'ok' },
  EXPIRING: { label: 'Expiring', cls: 'warn' },
  EXPIRED: { label: 'Expired', cls: 'off' },
  NONE: { label: 'No plan', cls: 'off' },
}

/** Admin → Studios: every registered studio, newest first, with remove (type the name) and restore. */
function AdminStudios() {
  const qc = useQueryClient()
  const [url, setUrl] = useUrlState({ search: '', plan: 'all', page: '1', limit: '25' })
  const [search, setSearch] = useDebouncedUrlSearch(url.search, (v) => setUrl({ search: v, page: '1' }))
  const [removing, setRemoving] = useState<AdminStudioRowDto | null>(null)
  const page = Math.max(1, Number(url.page) || 1)
  const limit = PAGE_SIZES.includes(url.limit) ? Number(url.limit) : 25

  const list = useQuery({
    queryKey: [...KEY, { search: url.search, plan: url.plan, page, limit }],
    queryFn: () => api.get<Paginated<AdminStudioRowDto>>('/admin/studios', { search: url.search, plan: url.plan, page, limit }),
    placeholderData: (prev) => prev,
  })
  const restore = useMutation({
    mutationFn: (s: AdminStudioRowDto) => api.post(`/admin/studios/${s.id}/restore`),
    onSuccess: (_d, s) => {
      toast.success(`${s.name} restored`)
      void qc.invalidateQueries({ queryKey: KEY })
    },
    onError: (e) => toastError(e),
  })

  const rows = list.data?.data ?? []
  const total = list.data?.meta.total ?? 0
  const pages = Math.max(1, Math.ceil(total / limit))
  const from = total === 0 ? 0 : (page - 1) * limit + 1
  const to = Math.min(page * limit, total)

  return (
    <div className="stack pl-page admin-studios">
      <div className="pl-head">
        <h1>Studios</h1>
      </div>

      <section className="pl-card pl-table-card" aria-label="All studios">
        <div className="pl-toolbar">
          <label className="pl-size">
            <select aria-label="Entries per page" value={String(limit)} onChange={(e) => setUrl({ limit: e.target.value, page: '1' })}>
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span>entries per page</span>
          </label>
          <label className="pl-size">
            <select aria-label="Plan" value={url.plan} onChange={(e) => setUrl({ plan: e.target.value, page: '1' })}>
              {PLAN_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="pl-search">
            <i className="bi bi-search" aria-hidden="true" />
            <input type="search" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search studios by name, phone or email" />
          </label>
        </div>

        {list.isPending ? (
          <TableSkeleton rows={6} cols={9} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon="shop" title="No studios match" text="Try a different name, phone, email or plan." />
        ) : (
          <div className="pl-scroll">
            <table className="pl-table" data-testid="studios-table">
              <thead>
                <tr>
                  <th className="pl-c-sno">S.No</th>
                  <th>Studio name</th>
                  <th>Owner &amp; phone</th>
                  <th>Email</th>
                  <th>Plan</th>
                  <th>Start date</th>
                  <th>Expiry date</th>
                  <th>Status</th>
                  <th className="pl-c-action">Remove</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s, i) => (
                  <tr key={s.id} className={s.removed ? 'is-removed' : undefined}>
                    <td className="pl-c-sno">{from + i}</td>
                    <td>
                      <strong className="pl-name" title={s.name}>
                        {s.name}
                      </strong>
                    </td>
                    <td>
                      {s.owner ? (
                        <>
                          <span className="pl-name">{s.owner.name}</span>
                          {s.owner.phone && <span className="pl-event">{s.owner.phone}</span>}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="as-email">{s.email ?? '—'}</td>
                    <td>
                      {s.plan ?? '—'}
                      {s.period && <span className="pl-event">{s.period}</span>}
                    </td>
                    <td>{s.startDate ? formatIstDate(s.startDate) : '—'}</td>
                    <td>
                      {s.expiryDate ? formatIstDate(s.expiryDate) : '—'}
                      {s.daysLeft !== null && <span className="pl-event">{expiryText(s.daysLeft)}</span>}
                    </td>
                    <td>
                      <span className={`as-status ${STATUS[s.status].cls}`}>{STATUS[s.status].label}</span>
                    </td>
                    <td className="pl-c-action">
                      {s.removed ? (
                        <span className="as-removed" title={`Removed ${formatIstDate(s.removed.at)}${s.removed.by ? ` by ${s.removed.by}` : ''}; deleted for good on ${formatIstDate(s.removed.purgeAt)}`}>
                          Removed ·{' '}
                          <button type="button" className="link" onClick={() => restore.mutate(s)} disabled={restore.isPending} aria-label={`Restore ${s.name}`}>
                            Restore
                          </button>
                        </span>
                      ) : (
                        <button type="button" className="pl-act delete" onClick={() => setRemoving(s)} aria-label={`Remove ${s.name}`}>
                          <i className="bi bi-trash" /> Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {list.data && total > 0 && (
          <div className="pl-foot">
            <span>
              Showing {from} to {to} of {total} {total === 1 ? 'entry' : 'entries'}
            </span>
            <nav className="pl-pager" aria-label="Pages">
              <button type="button" onClick={() => setUrl({ page: String(page - 1) })} disabled={page <= 1}>
                Previous
              </button>
              {Array.from({ length: pages }, (_, n) => n + 1)
                .filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 1)
                .map((n, idx, shown) => (
                  <span key={n} className="pl-pager-group">
                    {idx > 0 && n - shown[idx - 1] > 1 && <span className="pl-gap">…</span>}
                    <button type="button" className={n === page ? 'on' : ''} aria-current={n === page ? 'page' : undefined} onClick={() => setUrl({ page: String(n) })}>
                      {n}
                    </button>
                  </span>
                ))}
              <button type="button" onClick={() => setUrl({ page: String(page + 1) })} disabled={page >= pages}>
                Next
              </button>
            </nav>
          </div>
        )}
      </section>

      {removing && <RemoveStudioModal studio={removing} onClose={() => setRemoving(null)} onDone={() => void qc.invalidateQueries({ queryKey: KEY })} />}
    </div>
  )
}

function RemoveStudioModal({ studio, onClose, onDone }: { studio: AdminStudioRowDto; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const matches = name.trim().toLowerCase() === studio.name.trim().toLowerCase()
  const remove = useMutation({
    mutationFn: () => api.post(`/admin/studios/${studio.id}/remove`, { confirmName: name }),
    onSuccess: () => {
      toast.success(`${studio.name} removed`, { description: 'You can restore it for 30 days.' })
      onDone()
      onClose()
    },
    onError: (e) => setError(isApiError(e) ? e.message : 'Could not remove the studio'),
  })
  return (
    <Modal open onClose={onClose} title={`Remove ${studio.name}?`} busy={remove.isPending}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          if (matches) remove.mutate()
        }}
      >
        <p>
          The studio can't log in any more, all its customer links close and renewals stop, straight away. You can restore it for 30 days; after that its users, events, selections and
          photos are deleted for good (invoices and payment records are kept for tax).
        </p>
        <label className="field">
          <span>
            Type <strong>{studio.name}</strong> to confirm
          </span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label="Studio name" autoComplete="off" />
        </label>
        {error && (
          <p className="notice danger" role="alert">
            {error}
          </p>
        )}
        <div className="wz-modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={remove.isPending}>
            Cancel
          </button>
          <button type="submit" className="btn btn-danger" disabled={!matches || remove.isPending} data-testid="confirm-remove-studio">
            {remove.isPending ? <Spinner size={14} /> : <i className="bi bi-trash" />} Remove studio
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default AdminStudios
