import { useQueryClient } from '@tanstack/react-query'
import type { SelectionOverviewDto } from '@weddyzone/shared'
import { useState } from 'react'
import { toast } from 'sonner'
import { api, download } from '../../lib/api'
import { toastError } from '../../lib/query'
import { Modal, useConfirm } from '../Modal'
import { Spinner } from '../ui'
import { ActivityLog } from './ActivityLog'
import { DownloadSelectedModal } from './DownloadSelectedModal'
import { EventShare } from './EventShare'
import { refreshSelection } from './selectionUi'

type Tab = 'share' | 'picks'
const TABS: [Tab, string, string][] = [
  ['share', 'Share & PIN', 'send'],
  ['picks', 'Picks & activity', 'clock-history'],
]

/** Picks: unlock (with a reason), mark delivered, downloads, and the change log. */
function PicksTab({ overview }: { overview: SelectionOverviewDto }) {
  const s = overview.selection
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const unlock = async () => {
    setBusy(true)
    try {
      await api.post(`/selections/${s.id}/unlock`, { reason: reason.trim() || undefined })
      toast.success('Unlocked — the client can change their picks again')
      setReason('')
      refreshSelection(qc, s.id)
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  const deliver = () =>
    confirm({
      title: 'Mark as delivered?',
      message: 'Records that the edited photos were handed over. The selection stays locked.',
      confirmLabel: 'Mark delivered',
      icon: 'box-seam',
      onConfirm: async () => {
        try {
          await api.post(`/selections/${s.id}/deliver`)
          toast.success('Marked delivered')
          refreshSelection(qc, s.id)
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    })
  const exportList = async (format: 'csv' | 'txt') => {
    try {
      await download(`/selections/${s.id}/export?format=${format}`, `${s.code}-${format === 'txt' ? 'lightroom.txt' : 'picks.csv'}`)
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <section className="st-section">
        <h3>Client picks</h3>
        <p className="muted">
          {s.pickedCount} of {s.quota} picked.{' '}
          {s.status === 'SUBMITTED' ? 'The client submitted their selection.' : s.status === 'DELIVERED' ? 'Delivered.' : 'The client is still choosing.'}
        </p>
        {s.status === 'SUBMITTED' && (
          <div className="st-row">
            <input className="input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason to unlock (for the log)" aria-label="Reason to unlock" />
            <button className="btn btn-ghost" onClick={unlock} disabled={busy}>
              {busy ? <Spinner size={14} /> : <i className="bi bi-unlock" />} Unlock
            </button>
            <button className="btn btn-primary" onClick={() => void deliver()}>
              <i className="bi bi-box-seam" /> Mark delivered
            </button>
          </div>
        )}
        <div className="st-row">
          {/* The picks' originals, copied from this computer (the Download Selected dialog). */}
          <button className="btn btn-ghost" onClick={() => setDownloading(true)} disabled={s.pickedCount === 0}>
            <i className="bi bi-download" /> Download picked photos
          </button>
          <button className="btn btn-ghost" onClick={() => void exportList('txt')} disabled={s.pickedCount === 0}>
            <i className="bi bi-filetype-txt" /> Lightroom list
          </button>
          <button className="btn btn-ghost" onClick={() => void exportList('csv')} disabled={s.pickedCount === 0}>
            <i className="bi bi-filetype-csv" /> File names with notes
          </button>
        </div>
      </section>
      <section className="st-section">
        <h3>Activity</h3>
        <ActivityLog log={overview.log} />
      </section>
      {downloading && <DownloadSelectedModal selection={s} folders={overview.folders} onClose={() => setDownloading(false)} onDone={() => undefined} />}
    </div>
  )
}

/** Sharing (link, WhatsApp, QR, PIN) and the client's picks with the change log, from the settings page. */
export function SettingsModal({ open, onClose, overview }: { open: boolean; onClose: () => void; overview: SelectionOverviewDto }) {
  const [tab, setTab] = useState<Tab>('share')
  const s = overview.selection
  return (
    <Modal open={open} onClose={onClose} title="Share & activity" className="ed-modal st-modal" size="xl">
      <div className="tabs st-tabs" role="tablist" aria-label="Settings sections">
        {TABS.map(([t, label, icon]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            <i className={`bi bi-${icon}`} /> {label}
          </button>
        ))}
      </div>
      {tab === 'share' && <EventShare s={s} />}
      {tab === 'picks' && <PicksTab overview={overview} />}
    </Modal>
  )
}
