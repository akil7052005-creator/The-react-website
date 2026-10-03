import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  EVENT_TYPE_LABELS,
  isSelectionLocked,
  pickedLabel,
  SELECTION_STATUS_LABELS,
  type SelectionOverviewDto,
} from '@weddyzone/shared'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Modal, useConfirm } from '../components/Modal'
import { EventPhotos } from '../components/selection/EventPhotos'
import { ActivityLog, EventSettings } from '../components/selection/EventSettings'
import { EventShare } from '../components/selection/EventShare'
import { count, refreshSelection, SELECTION_TONE } from '../components/selection/selectionUi'
import { useUploadGuard } from '../components/selection/useUploadGuard'
import { EmptyState, ErrorState, Progress, Skeleton, Spinner } from '../components/ui'
import { useUrlState } from '../hooks/useUrlState'
import { api, download, isApiError } from '../lib/api'
import { fileUrl } from '../lib/env'
import { toastError } from '../lib/query'
import { formatDate, timeAgo } from '../utils/format'

type Tab = 'photos' | 'share' | 'settings' | 'activity'
const TABS: [Tab, string, string][] = [
  ['photos', 'Photos', 'images'],
  ['share', 'Share', 'send'],
  ['settings', 'Settings', 'sliders'],
  ['activity', 'Activity', 'clock-history'],
]

/** A labelled button with a small dropdown of actions (closes on outside click and Esc). */
function MenuButton({ label, icon, items }: { label: string; icon: string; items: { label: string; icon: string; onSelect: () => void; disabled?: boolean; hint?: string }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="sw-menu-wrap" ref={ref}>
      <button className="btn btn-ghost" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <i className={`bi bi-${icon}`} /> {label} <i className="bi bi-chevron-down sw-caret" />
      </button>
      {open && (
        <div className="sw-menu" role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              className="sw-menu-item"
              disabled={it.disabled}
              title={it.hint}
              onClick={() => {
                setOpen(false)
                it.onSelect()
              }}
            >
              <i className={`bi bi-${it.icon}`} /> {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function UnlockModal({ open, onClose, id, code }: { open: boolean; onClose: () => void; id: string; code: string }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const unlock = async () => {
    setBusy(true)
    try {
      await api.post(`/selections/${id}/unlock`, { reason: reason.trim() || undefined })
      toast.success(`${code} unlocked — the client can change their picks again`)
      refreshSelection(qc, id)
      setReason('')
      onClose()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Unlock selection?"
      subtitle="The client can change and submit their picks again. Their current picks are kept."
      icon="unlock"
      busy={busy}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={unlock} disabled={busy}>
            {busy ? <Spinner size={14} /> : <i className="bi bi-unlock" />} Unlock
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="unlock-reason">Reason (for the change log)</label>
        <input id="unlock-reason" className="input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Couple wants to swap two photos" />
      </div>
    </Modal>
  )
}

export default function SelectionEvent() {
  const { selectionId = '' } = useParams()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [url, setUrl] = useUrlState({ tab: '', upload: '' })
  const tab: Tab = (TABS.find(([t]) => t === url.tab)?.[0] ?? 'photos') as Tab
  const [unlockOpen, setUnlockOpen] = useState(false)
  const { setUploading } = useUploadGuard()

  const q = useQuery({
    queryKey: ['selection-overview', selectionId],
    queryFn: () => api.get<SelectionOverviewDto>(`/selections/${selectionId}/overview`),
    refetchInterval: 60_000,
  })

  useEffect(() => {
    if (q.data) document.title = `${q.data.selection.event.title} · Photo Selection`
  }, [q.data])

  if (q.isPending) {
    return (
      <div className="stack sw-page">
        <Skeleton width={180} height={16} />
        <Skeleton height={150} radius={16} />
        <Skeleton height={320} radius={16} />
      </div>
    )
  }
  if (q.isError) {
    const missing = isApiError(q.error) && (q.error.status === 404 || q.error.status === 400)
    return (
      <div className="stack sw-page">
        <Link to="/photo-selection" className="sw-back">
          <i className="bi bi-arrow-left" /> Photo Selection
        </Link>
        <div className="card">
          {missing ? (
            <EmptyState icon="images" title="Selection not found" text="It may have been deleted." action={<Link className="btn btn-primary" to="/photo-selection">Back to Photo Selection</Link>} />
          ) : (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          )}
        </div>
      </div>
    )
  }

  const { selection: s, folders, noteCount, log } = q.data
  const locked = isSelectionLocked(s.status)
  const uploadOpen = url.upload === '1' || (s.photoCount === 0 && !locked)
  const setTab = (t: Tab) => setUrl({ tab: t === 'photos' ? '' : t })

  const exportList = async (format: 'csv' | 'txt') => {
    try {
      await download(`/selections/${s.id}/export?format=${format}`, `${s.code}-${format === 'txt' ? 'lightroom.txt' : 'picks.csv'}`)
      toast.success(format === 'txt' ? 'Lightroom list downloaded' : 'File-name list downloaded')
    } catch (e) {
      toastError(e)
    }
  }
  /** ZIPs stream straight to the browser's downloads (no size limit in memory). */
  const zip = (scope: 'picked' | 'all') => {
    window.location.href = fileUrl(`/api/v1/selections/${s.id}/zip?scope=${scope}`)!
    toast.info(scope === 'picked' ? 'Preparing the ZIP of picked photos…' : 'Preparing the ZIP of all photos…')
  }

  const resetPicks = () =>
    confirm({
      title: 'Reset all picks?',
      message: (
        <>
          All <strong>{s.pickedCount}</strong> picks are cleared so the client can start again. Photos and notes are kept.
        </>
      ),
      confirmLabel: 'Reset picks',
      tone: 'danger',
      onConfirm: async () => {
        try {
          await api.post(`/selections/${s.id}/reset-picks`)
          toast.success('Picks reset')
          refreshSelection(qc, s.id)
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    })

  const deliver = () =>
    confirm({
      title: 'Mark as delivered?',
      message: 'Records that the edited photos were handed over. The selection stays locked.',
      confirmLabel: 'Mark delivered',
      icon: 'box-seam',
      onConfirm: async () => {
        try {
          await api.post(`/selections/${s.id}/deliver`)
          toast.success(`${s.code} delivered`)
          refreshSelection(qc, s.id)
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    })

  const more = [
    ...(s.status === 'SUBMITTED' ? [{ label: 'Unlock selection', icon: 'unlock', onSelect: () => setUnlockOpen(true) }] : []),
    ...(s.status === 'SUBMITTED' ? [{ label: 'Mark delivered', icon: 'box-seam', onSelect: () => void deliver() }] : []),
    ...(!locked ? [{ label: 'Reset picks', icon: 'arrow-counterclockwise', onSelect: () => void resetPicks(), disabled: s.pickedCount === 0 }] : []),
    { label: 'Settings', icon: 'gear', onSelect: () => setTab('settings') },
  ]

  return (
    <div className="stack sw-page">
      <Link to="/photo-selection" className="sw-back">
        <i className="bi bi-arrow-left" /> Photo Selection
      </Link>

      <header className="card sw-head">
        <div className="sw-head-main">
          <div className="sw-title">
            <h1>{s.event.title}</h1>
            <span className={`ps-status ${SELECTION_TONE[s.status]}`} data-testid="selection-status">
              {SELECTION_STATUS_LABELS[s.status]}
            </span>
          </div>
          <p className="sw-meta">
            <span>
              <i className="bi bi-person" /> {s.client.name}
            </span>
            <span>
              <i className="bi bi-tag" /> {EVENT_TYPE_LABELS[s.event.type]}
            </span>
            {s.eventDate && (
              <span>
                <i className="bi bi-calendar-event" /> {formatDate(s.eventDate)}
              </span>
            )}
            <span className="mono">{s.code}</span>
          </p>
        </div>

        <div className="sw-stats">
          <div className="sw-counter">
            <div className="sw-counter-top">
              <strong data-testid="picked-counter">{pickedLabel(s.pickedCount, s.quota)}</strong>
              <span className="muted">{count(s.photoCount)} photos</span>
            </div>
            <Progress value={s.pickedCount} max={s.quota} label="Photos picked" />
          </div>
          <dl className="sw-facts">
            <div>
              <dt>Last client visit</dt>
              <dd>{s.lastClientVisitAt ? timeAgo(s.lastClientVisitAt) : 'Not opened yet'}</dd>
            </div>
            <div>
              <dt>Gallery expires</dt>
              <dd className={s.status === 'EXPIRED' ? 'sw-expired' : undefined}>{formatDate(s.deadline)}</dd>
            </div>
            <div>
              <dt>Notes</dt>
              <dd>{count(noteCount)}</dd>
            </div>
          </dl>
        </div>

        <div className="sw-actions">
          <button className="btn btn-primary" onClick={() => setTab('share')}>
            <i className="bi bi-send" /> Share
          </button>
          {!locked && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                setUrl({ tab: '', upload: '1' })
              }}
            >
              <i className="bi bi-cloud-arrow-up" /> Upload photos
            </button>
          )}
          <MenuButton
            label="Export"
            icon="download"
            items={[
              { label: 'ZIP of picked photos', icon: 'file-zip', onSelect: () => zip('picked'), disabled: s.pickedCount === 0 },
              { label: 'ZIP of all photos', icon: 'file-zip', onSelect: () => zip('all'), disabled: s.photoCount === 0 },
              { label: 'Lightroom list (TXT)', icon: 'filetype-txt', onSelect: () => void exportList('txt'), disabled: s.pickedCount === 0 },
              { label: 'File names with notes (CSV)', icon: 'filetype-csv', onSelect: () => void exportList('csv'), disabled: s.pickedCount === 0 },
            ]}
          />
          <MenuButton label="More" icon="three-dots" items={more} />
        </div>
        {s.status === 'SUBMITTED' && (
          <p className="notice success sw-notice">
            <i className="bi bi-check2-circle" /> Submitted {s.submittedAt ? timeAgo(s.submittedAt) : ''}: {s.pickedCount} photos picked. Download the picks, then mark it delivered.
          </p>
        )}
      </header>

      <div className="tabs sw-tabs" role="tablist" aria-label="Selection sections">
        {TABS.map(([t, label, icon]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            <i className={`bi bi-${icon}`} /> {label}
            {t === 'activity' && log.length > 0 && <small className="sw-tab-count">{log.length}</small>}
          </button>
        ))}
      </div>

      {/* Kept mounted on other tabs so uploads in progress carry on. */}
      <div hidden={tab !== 'photos'}>
        <EventPhotos s={s} folders={folders} uploadOpen={uploadOpen} setUploadOpen={(v) => setUrl({ upload: v ? '1' : '' })} onBusyChange={setUploading} />
      </div>
      {tab === 'share' && <EventShare s={s} />}
      {tab === 'settings' && <EventSettings s={s} />}
      {tab === 'activity' && (
        <section className="card sw-card">
          <ActivityLog log={log} />
        </section>
      )}

      <UnlockModal open={unlockOpen} onClose={() => setUnlockOpen(false)} id={s.id} code={s.code} />
    </div>
  )
}
