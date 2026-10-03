import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  EVENT_TYPE_LABELS,
  isSelectionLocked,
  isSelectionUnshared,
  SELECTION_STATUS_LABELS,
  type Paginated,
  type SelectionDto,
  type SendResultDto,
} from '@weddyzone/shared'
import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useConfirm } from '../components/Modal'
import { NewSelectionModal } from '../components/selection/NewSelectionModal'
import { SELECTION_TONE, selectionPath } from '../components/selection/selectionUi'
import { StudioDefaultsCard } from '../components/selection/StudioDefaults'
import { EmptyState, ErrorState, Skeleton, TableSkeleton } from '../components/ui'
import { useDebouncedUrlSearch, useUrlState } from '../hooks/useUrlState'
import { api } from '../lib/api'
import { toastError } from '../lib/query'
import { sendViaWhatsApp } from '../lib/whatsapp'
import { formatDate, formatNumber, timeAgo } from '../utils/format'

const PAGE_SIZES = ['10', '25', '50', '100']

interface Summary {
  selections: number
  photos: number
  active: number
  completed: number
  picked: number
  avgTurnaroundDays: number | null
}

const statusFilterLabel: Record<string, string> = {
  SUBMITTED: 'Submitted selections',
  DELIVERED: 'Delivered',
  active: 'Active selections',
  DRAFT: 'Drafts',
  UPLOADING: 'Uploading',
  SENT: 'Shared, waiting for the client',
  IN_PROGRESS: 'In progress',
  EXPIRED: 'Expired',
}

/** Column header that sorts the table: click once for ascending, again for descending. */
function SortHeader({ label, field, sort, onSort }: { label: string; field: string; sort: string; onSort: (s: string) => void }) {
  const dir = sort === field ? 'asc' : sort === `-${field}` ? 'desc' : null
  return (
    <th aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}>
      <button type="button" className="sort-head" onClick={() => onSort(dir === 'asc' ? `-${field}` : field)}>
        {label}
        <i className={`bi bi-${dir === 'asc' ? 'sort-up' : dir === 'desc' ? 'sort-down' : 'arrow-down-up'}`} aria-hidden="true" />
      </button>
    </th>
  )
}

function OverviewTile({ icon, label, value }: { icon: string; label: string; value: number | undefined }) {
  return (
    <div className="ps-tile">
      <i className={`bi bi-${icon}`} aria-hidden="true" />
      <div>
        <span>{label}</span>
        <strong>{value === undefined ? <Skeleton width={36} height={18} /> : formatNumber(value)}</strong>
      </div>
    </div>
  )
}

function PhotoSelection() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [url, setUrl] = useUrlState({ search: '', status: '', page: '1', sort: '', limit: '10', selection: '', tab: '', new: '' })
  const [search, setSearch] = useDebouncedUrlSearch(url.search, (v) => setUrl({ search: v }))
  const page = Math.max(1, Number(url.page) || 1)
  const limit = PAGE_SIZES.includes(url.limit) ? Number(url.limit) : 10

  const list = useQuery({
    queryKey: ['selections', { search: url.search, status: url.status, page, sort: url.sort, limit }],
    queryFn: () => api.get<Paginated<SelectionDto>>('/selections', { search: url.search, status: url.status, page, limit, sort: url.sort }),
    placeholderData: (prev) => prev,
  })
  const summary = useQuery({ queryKey: ['selections-summary'], queryFn: () => api.get<Summary>('/selections/summary') })

  const rows = list.data?.data ?? []
  const total = list.data?.meta.total ?? 0
  const pages = Math.max(1, Math.ceil(total / limit))
  const from = total === 0 ? 0 : (page - 1) * limit + 1
  const to = Math.min(page * limit, total)

  // Old links (?selection=<id>&tab=…) open the selection's event page.
  useEffect(() => {
    if (url.selection) navigate(`${selectionPath(url.selection)}${url.tab === 'settings' ? '?tab=settings' : url.tab === 'share' ? '?tab=share' : ''}`, { replace: true })
  }, [url.selection, url.tab, navigate])

  /** "Send": the first time it shares the selection link, after that it sends a reminder. */
  const send = (s: SelectionDto) => {
    if (s.photoCount === 0) {
      toast.error('Upload photos first', { description: 'Use “Upload & Download” to add the event photos, then send the link.' })
      return
    }
    const invite = isSelectionUnshared(s.status)
    void confirm({
      title: invite ? `Send ${s.code} to ${s.client.name}?` : `Remind ${s.client.name}?`,
      message: (
        <>
          We'll open WhatsApp with {invite ? 'the private selection link' : 'a reminder'} for <strong>{s.event.title}</strong>
          {invite ? '' : ` (${s.pickedCount} of ${s.quota} picked, deadline ${formatDate(s.deadline)})`}. This uses <strong>1 credit</strong>.
        </>
      ),
      confirmLabel: invite ? 'Send on WhatsApp' : 'Send reminder',
      icon: 'whatsapp',
      onConfirm: () =>
        sendViaWhatsApp(
          () => api.post<SendResultDto>(`/selections/${s.id}/${invite ? 'send' : 'remind'}`),
          qc,
          invite ? `Selection ${s.code} sent to ${s.client.name}` : `Reminder sent to ${s.client.name}`,
        )
          .then(() => qc.invalidateQueries({ queryKey: ['selections'] }))
          .catch((e) => {
            toastError(e)
            throw e
          }),
    })
  }

  const sum = summary.data
  const filtered = Boolean(url.search || url.status)

  return (
    <div className="stack ps-page">
      <div className="ps-head">
        <h1>Photo Selection</h1>
        <button className="btn btn-primary" onClick={() => setUrl({ new: '1' })}>
          <i className="bi bi-plus-lg" /> Add Photo Selection
        </button>
      </div>

      <StudioDefaultsCard />

      <section className="card ps-card" aria-labelledby="ps-overview">
        <h2 id="ps-overview" className="ps-section-title">
          Overview
        </h2>
        <div className="ps-tiles">
          <OverviewTile icon="calendar-event" label="Total Selections" value={sum?.selections} />
          <OverviewTile icon="image" label="Total Images" value={sum?.photos} />
          <OverviewTile icon="check-circle" label="Total Selected" value={sum?.picked} />
          <OverviewTile icon="patch-check" label="Completed" value={sum?.completed} />
        </div>
      </section>

      <section className="card ps-card" aria-label="All client selections">
        <div className="ps-toolbar">
          <label className="ps-page-size">
            <select aria-label="Entries per page" value={String(limit)} onChange={(e) => setUrl({ limit: e.target.value })}>
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span>entries per page</span>
          </label>
          <label className="ps-search">
            <input type="search" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search selections" />
          </label>
        </div>

        {url.status && (
          <p className="ps-filter">
            Showing <strong>{statusFilterLabel[url.status] ?? url.status}</strong>
            <button className="link" onClick={() => setUrl({ status: '' })}>
              Show all
            </button>
          </p>
        )}

        {list.isPending ? (
          <TableSkeleton rows={4} cols={6} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : rows.length === 0 ? (
          filtered ? (
            <EmptyState
              icon="search"
              title="No selections match"
              text="Try a different search."
              action={
                <button className="btn btn-ghost" onClick={() => setUrl({ search: '', status: '' })}>
                  Clear search
                </button>
              }
            />
          ) : (
            <EmptyState
              icon="images"
              title="No photo selections yet"
              text="Add a selection, upload the event photos, and send the private link to your client."
              action={
                <button className="btn btn-primary" onClick={() => setUrl({ new: '1' })}>
                  <i className="bi bi-plus-lg" /> Add Photo Selection
                </button>
              }
            />
          )
        ) : (
          <div className="table-wrap">
            <table className="table ps-table">
              <thead>
                <tr>
                  <SortHeader label="S.No" field="created" sort={url.sort} onSort={(s) => setUrl({ sort: s })} />
                  <SortHeader label="Project" field="project" sort={url.sort} onSort={(s) => setUrl({ sort: s })} />
                  <SortHeader label="All Data" field="photos" sort={url.sort} onSort={(s) => setUrl({ sort: s })} />
                  <SortHeader label="Code" field="code" sort={url.sort} onSort={(s) => setUrl({ sort: s })} />
                  <SortHeader label="Status" field="status" sort={url.sort} onSort={(s) => setUrl({ sort: s })} />
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s, i) => {
                  const closed = isSelectionLocked(s.status) || s.status === 'EXPIRED'
                  return (
                    <tr key={s.id}>
                      <td className="ps-sno">{from + i}</td>
                      <td>
                        <Link to={selectionPath(s.id)} className="cell-main ps-project-link" title={`Open ${s.event.title}`}>
                          {s.client.name}
                        </Link>
                        <div className="cell-sub ps-type">
                          {EVENT_TYPE_LABELS[s.event.type]}
                          {s.lastClientVisitAt ? ` · visited ${timeAgo(s.lastClientVisitAt)}` : ''}
                        </div>
                      </td>
                      <td>
                        <div className="ps-chips">
                          <span className="ps-chip images" title={`${s.photoCount} photos uploaded`}>
                            {formatNumber(s.photoCount)} <i className="bi bi-image" aria-hidden="true" />
                            <span className="sr-only">photos</span>
                          </span>
                          <span className="ps-chip selected" title={`${s.pickedCount} of ${s.quota} picked`}>
                            {formatNumber(s.pickedCount)} <i className="bi bi-check-circle" aria-hidden="true" />
                            <span className="sr-only">selected</span>
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="ps-code">
                          <span className="mono">{s.code}</span>
                          <button
                            type="button"
                            onClick={() => send(s)}
                            disabled={closed}
                            title={closed ? 'This selection is closed' : isSelectionUnshared(s.status) ? 'Send the selection link on WhatsApp' : 'Send a reminder on WhatsApp'}
                            aria-label={`Send ${s.code} to ${s.client.name}`}
                          >
                            Send
                          </button>
                        </div>
                      </td>
                      <td>
                        <span className={`ps-status ${SELECTION_TONE[s.status]}`}>{SELECTION_STATUS_LABELS[s.status]}</span>
                      </td>
                      <td>
                        <div className="ps-actions">
                          <Link className="ps-upload" to={selectionPath(s.id)}>
                            <i className="bi bi-folder2-open" /> Open
                          </Link>
                          <Link className="ps-gear" to={`${selectionPath(s.id)}?tab=settings`} aria-label={`Settings for ${s.code}`} title="Limit, expiry, gallery access">
                            <i className="bi bi-gear" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {list.data && total > 0 && (
          <div className="ps-foot">
            <span>
              Showing {from} to {to} of {total} {total === 1 ? 'entry' : 'entries'}
            </span>
            <nav className="ps-pager" aria-label="Pages">
              <button type="button" onClick={() => setUrl({ page: String(page - 1) })} disabled={page <= 1}>
                Previous
              </button>
              {Array.from({ length: pages }, (_, n) => n + 1)
                .filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 1)
                .map((n, idx, shown) => (
                  <span key={n} className="ps-pager-group">
                    {idx > 0 && n - shown[idx - 1] > 1 && <span className="ps-gap">…</span>}
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

      <NewSelectionModal open={url.new === '1'} onClose={() => setUrl({ new: '' })} />
    </div>
  )
}

export default PhotoSelection
