import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Paginated, SelectionDto } from '@weddyzone/shared'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useConfirm } from '../components/Modal'
import { EventDetailsModal } from '../components/selection/EventDetailsModal'
import { ResetSelectionModal } from '../components/selection/ResetSelectionModal'
import { LIVE_POLL_MS, refreshSelection, selectionPath } from '../components/selection/selectionUi'
import { SelectionStatusPill } from '../components/selection/SelectionStatusPill'
import { copyToClipboard, ShareModal } from '../components/selection/ShareModal'
import { StudioDefaultsCard } from '../components/selection/StudioDefaults'
import { EmptyState, ErrorState, Skeleton, TableSkeleton } from '../components/ui'
import { useDebouncedUrlSearch, useUrlState } from '../hooks/useUrlState'
import { api } from '../lib/api'
import { toastError } from '../lib/query'
import { formatNumber } from '../utils/format'

const PAGE_SIZES = ['10', '25', '50', '100']

interface Summary {
  selections: number
  photos: number
  active: number
  completed: number
  picked: number
  videos?: number
  avgTurnaroundDays: number | null
}


const statusFilterLabel: Record<string, string> = {
  SUBMITTED: 'Selected (submitted by the client)',
  DELIVERED: 'Delivered',
  active: 'Active selections',
  DRAFT: 'Drafts',
  UPLOADING: 'Uploading',
  SENT: 'Shared, waiting for the client',
  IN_PROGRESS: 'In progress',
  EXPIRED: 'Expired',
}

/** Column header that sorts the table: click once for ascending, again for descending. */
function SortHeader({ label, field, sort, onSort, className }: { label: string; field: string; sort: string; onSort: (s: string) => void; className?: string }) {
  const dir = sort === field ? 'asc' : sort === `-${field}` ? 'desc' : null
  return (
    <th className={className} aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}>
      <button type="button" className="pl-sort" onClick={() => onSort(dir === 'asc' ? `-${field}` : field)}>
        {label}
        <i className={`bi bi-${dir === 'asc' ? 'sort-up' : dir === 'desc' ? 'sort-down' : 'arrow-down-up'}`} aria-hidden="true" />
      </button>
    </th>
  )
}

function OverviewTile({ icon, label, value }: { icon: string; label: string; value: number | undefined }) {
  return (
    <div className="pl-tile">
      <i className={`bi bi-${icon}`} aria-hidden="true" />
      <div>
        <span>{label}</span>
        <strong>{value === undefined ? <Skeleton width={36} height={20} /> : formatNumber(value)}</strong>
      </div>
    </div>
  )
}

/** One small count in CONTENT, e.g. "7 🖼", with its name as a tooltip. */
function CountChip({ kind, icon, value, label }: { kind: string; icon: string; value: number; label: string }) {
  return (
    <span className={`pl-chip ${kind}`} title={label}>
      {formatNumber(value)} <i className={`bi bi-${icon}`} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  )
}

/** Drawn here (no image file): a stack of photos with a check, in the app's crimson. */
function EmptyArt() {
  return (
    <svg className="pl-empty-art" viewBox="0 0 160 120" aria-hidden="true">
      <rect x="28" y="22" width="84" height="64" rx="10" fill="#fdecef" transform="rotate(-8 70 54)" />
      <rect x="44" y="28" width="88" height="66" rx="10" fill="#fff" stroke="#f6cdd5" strokeWidth="2" />
      <circle cx="68" cy="50" r="7" fill="#f6cdd5" />
      <path d="M50 86l22-22 14 14 10-10 30 18v4a6 6 0 0 1-6 6H56a6 6 0 0 1-6-6z" fill="#f8b4c3" />
      <circle cx="126" cy="90" r="16" fill="#e8174a" />
      <path d="M119 90l5 5 9-10" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PhotoSelection() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [url, setUrl] = useUrlState({ search: '', status: '', page: '1', sort: '', limit: '10', selection: '', tab: '', new: '', create: '' })
  const [search, setSearch] = useDebouncedUrlSearch(url.search, (v) => setUrl({ search: v, page: '1' }))
  const [sharing, setSharing] = useState<SelectionDto | null>(null)
  const [reopening, setReopening] = useState<SelectionDto | null>(null)
  const page = Math.max(1, Number(url.page) || 1)
  const limit = PAGE_SIZES.includes(url.limit) ? Number(url.limit) : 10

  const list = useQuery({
    queryKey: ['selections', { search: url.search, status: url.status, page, sort: url.sort, limit }],
    queryFn: () => api.get<Paginated<SelectionDto>>('/selections', { search: url.search, status: url.status, page, limit, sort: url.sort }),
    placeholderData: (prev) => prev,
    // The customer submits from their phone: the status changes here without a refresh.
    refetchInterval: LIVE_POLL_MS,
    refetchOnWindowFocus: true,
  })
  const summary = useQuery({ queryKey: ['selections-summary'], queryFn: () => api.get<Summary>('/selections/summary'), refetchInterval: LIVE_POLL_MS, refetchOnWindowFocus: true })

  const rows = list.data?.data ?? []
  const total = list.data?.meta.total ?? 0
  const pages = Math.max(1, Math.ceil(total / limit))
  const from = total === 0 ? 0 : (page - 1) * limit + 1
  const to = Math.min(page * limit, total)

  // Old links (?selection=<id>&tab=…) open the selection's event page.
  useEffect(() => {
    if (url.selection) navigate(`${selectionPath(url.selection)}${url.tab === 'settings' ? '?tab=settings' : url.tab === 'share' ? '?tab=share' : ''}`, { replace: true })
  }, [url.selection, url.tab, navigate])

  // After a delete empties the last page, step back to the page before it.
  useEffect(() => {
    if (list.data && !list.isFetching && rows.length === 0 && page > 1) setUrl({ page: String(page - 1) })
  }, [list.data, list.isFetching, rows.length, page, setUrl])

  const remove = (s: SelectionDto) =>
    confirm({
      title: 'Delete this event?',
      message: 'This will remove all its photos and selections.',
      confirmLabel: 'Delete',
      tone: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/selections/${s.id}`)
          toast.success(`${s.event.title} deleted`)
          refreshSelection(qc, s.id)
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    })

  const sum = summary.data
  const filtered = Boolean(url.search || url.status)
  const addOpen = url.new === '1' || url.create === '1'

  const copyCode = async (code: string) => {
    if (await copyToClipboard(code)) toast.success('Code copied')
    else toast.error('Could not copy — your browser blocked the clipboard')
  }
  const sortBy = (s: string) => setUrl({ sort: s })

  return (
    <div className="stack ps-page pl-page">
      <div className="pl-head">
        <h1>Photo Selection</h1>
        <button type="button" className="pl-add" onClick={() => setUrl({ new: '1' })}>
          <i className="bi bi-plus-lg" /> Add Photo Selection
        </button>
      </div>

      <section className="pl-card" aria-labelledby="pl-overview">
        <h2 id="pl-overview" className="pl-title">
          Studio snapshot
        </h2>
        {summary.isError ? (
          <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
        ) : (
          <div className="pl-tiles" data-testid="overview">
            <OverviewTile icon="calendar-event" label="Total Events" value={sum?.selections} />
            <OverviewTile icon="image" label="Total Images" value={sum?.photos} />
            <OverviewTile icon="check-circle" label="Total Selected" value={sum?.picked} />
            <OverviewTile icon="camera-video" label="Total Videos" value={sum ? (sum.videos ?? 0) : undefined} />
          </div>
        )}
      </section>

      <section className="pl-card pl-table-card" aria-label="All photo selections">
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
          <label className="pl-search">
            <i className="bi bi-search" aria-hidden="true" />
            <input type="search" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search by project, customer or code" />
          </label>
        </div>

        {url.status && (
          <p className="pl-filter">
            Showing <strong>{statusFilterLabel[url.status] ?? url.status}</strong>
            <button className="link" onClick={() => setUrl({ status: '' })}>
              Show all
            </button>
          </p>
        )}

        {list.isPending ? (
          <TableSkeleton rows={5} cols={6} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : rows.length === 0 ? (
          filtered ? (
            <EmptyState
              icon="search"
              title="No events match"
              text="Try a different project, customer or code."
              action={
                <button className="btn btn-ghost" onClick={() => setUrl({ search: '', status: '', page: '1' })}>
                  Clear search
                </button>
              }
            />
          ) : (
            <div className="pl-empty">
              <EmptyArt />
              <p>No photo selections yet</p>
              <button type="button" className="pl-add" onClick={() => setUrl({ new: '1' })}>
                <i className="bi bi-plus-lg" /> Add Photo Selection
              </button>
            </div>
          )
        ) : (
          <div className="pl-scroll">
            <table className="pl-table" data-testid="selections-table">
              <thead>
                <tr>
                  <SortHeader label="S.No" field="created" sort={url.sort} onSort={sortBy} className="pl-c-sno" />
                  <SortHeader label="Project" field="project" sort={url.sort} onSort={sortBy} className="pl-c-project" />
                  <SortHeader label="Content" field="photos" sort={url.sort} onSort={sortBy} className="pl-c-data" />
                  <SortHeader label="Code" field="code" sort={url.sort} onSort={sortBy} className="pl-c-code" />
                  <SortHeader label="Status" field="status" sort={url.sort} onSort={sortBy} className="pl-c-status" />
                  <th className="pl-c-action">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s, i) => {
                  return (
                    <tr key={s.id}>
                      <td className="pl-c-sno">{from + i}</td>
                      <td className="pl-c-project">
                        <strong className="pl-name" title={s.client.name}>
                          {s.client.name}
                        </strong>
                        <span className="pl-event" title={s.event.title}>
                          {s.event.title}
                        </span>
                      </td>
                      <td className="pl-c-data">
                        <div className="pl-chips">
                          <CountChip kind="folders" icon="folder2" value={s.folderCount ?? 0} label="Folders" />
                          <CountChip kind="images" icon="image" value={s.photoCount} label="Images" />
                          <CountChip kind="selected" icon="check-lg" value={s.pickedCount} label="Selected" />
                          <CountChip kind="videos" icon="camera-video" value={s.videoCount ?? 0} label="Videos" />
                        </div>
                      </td>
                      <td className="pl-c-code">
                        <span className="pl-code">
                          <button type="button" className="pl-code-num" onClick={() => void copyCode(s.code)} title="Copy code" aria-label={`Copy code ${s.code}`}>
                            {s.code}
                          </button>
                          <button type="button" className="pl-code-send" onClick={() => setSharing(s)} aria-label={`Send code ${s.code} to ${s.client.name}`}>
                            Send
                          </button>
                        </span>
                      </td>
                      <td className="pl-c-status">
                        <SelectionStatusPill selection={s} className="pl-status" onReopen={() => setReopening(s)} />
                      </td>
                      <td className="pl-c-action">
                        <div className="pl-actions">
                          <Link className="pl-act upload" to={selectionPath(s.id)} aria-label={`Upload & Download: ${s.event.title}`}>
                            <i className="bi bi-cloud-arrow-up" /> Upload &amp; Download
                          </Link>
                          <Link className="pl-act manage" to={`/photo-selection/${s.id}/settings`} aria-label={`Manage ${s.event.title}`}>
                            <i className="bi bi-gear" /> Manage
                          </Link>
                          <button type="button" className="pl-act delete" onClick={() => void remove(s)} aria-label={`Delete ${s.event.title}`}>
                            <i className="bi bi-trash" /> Delete
                          </button>
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

      <StudioDefaultsCard />

      <EventDetailsModal
        key={addOpen ? 'add-open' : 'add-closed'}
        open={addOpen}
        onClose={() => setUrl({ new: '', create: '' })}
        // Closes the dialog and shows page 1, newest first, so the new event is the top row.
        onCreated={() => {
          setSearch('')
          setUrl({ new: '', create: '', page: '1', sort: '', search: '', status: '' })
        }}
      />
      {sharing && <ShareModal key={sharing.id} selection={sharing} onClose={() => setSharing(null)} />}
      {reopening && <ResetSelectionModal key={reopening.id} selection={reopening} onClose={() => setReopening(null)} />}
    </div>
  )
}

export default PhotoSelection
