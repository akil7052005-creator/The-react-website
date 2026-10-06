import { useQueryClient } from '@tanstack/react-query'
import type { SelectionDto } from '@weddyzone/shared'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import { toastError } from '../../lib/query'
import { Modal } from '../Modal'
import { refreshSelection } from './selectionUi'

type Mode = 'shortlist' | 'reject'

const OPTIONS: Record<Mode, { icon: string; title: string; text: (n: number) => string; confirm: (n: number, client: string) => string; done: (n: number) => string }> = {
  shortlist: {
    icon: 'list-check',
    title: 'Shortlist',
    text: (n) => `Keep the client’s ${n} pick${n === 1 ? '' : 's'} and unlock the selection so they can change them.`,
    confirm: (n, client) => `${client}’s ${n} pick${n === 1 ? '' : 's'} stay selected. The selection reopens (status Pending) so they can add, remove and submit again.`,
    done: (n) => `Selection reopened — ${n} pick${n === 1 ? '' : 's'} kept`,
  },
  reject: {
    icon: 'x-circle',
    title: 'Reject all',
    text: () => 'Clear every pick so the client starts again.',
    confirm: (n, client) => `All ${n} pick${n === 1 ? '' : 's'} are cleared and ${client} starts again (status Pending). Photos and notes are kept.`,
    done: () => 'Selection reset — 0 photos selected',
  },
}

/** Reset Selection: choose Shortlist or Reject all, then confirm. Both reopen the selection for the client. */
export function ResetSelectionModal({ selection, onClose, onDone }: { selection: SelectionDto; onClose: () => void; onDone?: () => void }) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<Mode | null>(null)
  const [busy, setBusy] = useState(false)
  const n = selection.pickedCount
  const client = selection.client.name

  const run = async () => {
    if (!mode) return
    setBusy(true)
    try {
      await api.post(`/selections/${selection.id}/reset-picks`, { mode })
      toast.success(OPTIONS[mode].done(n))
      refreshSelection(qc, selection.id)
      onDone?.()
      onClose()
    } catch (e) {
      toastError(e)
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={mode ? `${OPTIONS[mode].title}?` : 'Reset Selection'} subtitle={`${selection.event.title} · ${client}`} size="md" busy={busy} className="rs-modal">
      {!mode ? (
        <div className="rs-options" role="group" aria-label="How to reset">
          {(Object.keys(OPTIONS) as Mode[]).map((m) => (
            <button key={m} type="button" className={`rs-option ${m}`} onClick={() => setMode(m)} data-testid={`reset-${m}`}>
              <i className={`bi bi-${OPTIONS[m].icon}`} aria-hidden="true" />
              <span>
                <strong>{OPTIONS[m].title}</strong>
                <small>{OPTIONS[m].text(n)}</small>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="rs-confirm">
          <p>{OPTIONS[mode].confirm(n, client)}</p>
          <div className="rs-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setMode(null)} disabled={busy}>
              <i className="bi bi-arrow-left" /> Back
            </button>
            <button type="button" className={`btn ${mode === 'reject' ? 'btn-danger' : 'btn-primary'}`} onClick={() => void run()} disabled={busy} data-testid="reset-confirm">
              {busy ? 'Working…' : mode === 'reject' ? 'Reject all picks' : 'Keep picks & reopen'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
