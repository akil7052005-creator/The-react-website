import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ClientItemResult, ClientSelectedDto, ClientSelectionDto, MediaItem } from '@weddyzone/shared'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { clientApi, clientFileUrl } from '../../../lib/clientSession'
import { APP_NAME } from '../../../lib/env'
import { toastError } from '../../../lib/query'
import { clientKey, ClientGate, ClientTabs, noSave, SubmitSelection, SubmittedBanner } from './ClientParts'

const selectedKey = (id: string) => ['client-selected', id] as const

/** The Selection tab: only the picked photos, grouped by album. Tapping one removes it (with Undo). */
function SelectedPage({ selection }: { selection: ClientSelectionDto }) {
  const qc = useQueryClient()
  const [busyId, setBusyId] = useState<string | null>(null)
  const q = useQuery({
    queryKey: selectedKey(selection.id),
    queryFn: () => clientApi(selection.id).get<ClientSelectedDto>(`/public/selection/${selection.id}/selected`),
  })

  const setSelected = async (item: MediaItem, selected: boolean) => {
    setBusyId(item.id)
    try {
      const r = await clientApi(selection.id).patch<ClientItemResult>(`/public/selection/${selection.id}/items/${item.id}`, { selected })
      qc.setQueryData<ClientSelectionDto>(clientKey(selection.id), (cur) =>
        cur ? { ...cur, counts: { ...cur.counts, ...r.counts }, folders: cur.folders.map((f) => (r.folder && f.id === r.folder.id ? { ...f, selected: r.folder.selected } : f)) } : cur,
      )
      await qc.invalidateQueries({ queryKey: selectedKey(selection.id) })
      qc.invalidateQueries({ queryKey: ['client-items', selection.id] })
      if (!selected) toast('Removed from your selection', { action: { label: 'Undo', onClick: () => void setSelected(item, true) } })
    } catch (e) {
      toastError(e)
      qc.invalidateQueries({ queryKey: clientKey(selection.id) })
    } finally {
      setBusyId(null)
    }
  }

  const groups = q.data?.groups ?? []
  return (
    <div className="cp-page">
      <SubmittedBanner selection={selection} />
      <main className="cp-main">
        <h1 className="cp-title">My Selection</h1>
        <ClientTabs selection={selection} active="selected" />
        <div className="cp-albums-head">
          <h2>
            {selection.counts.selected} selected
            {selection.selectionLimit !== null && <small> of {selection.selectionLimit}</small>}
          </h2>
          <SubmitSelection selection={selection} />
        </div>
        {!selection.readOnly && groups.length > 0 && <p className="cp-hint">Tap a photo to remove it from your selection.</p>}
        {q.isPending ? (
          <div className="cp-loading" role="status">
            <span className="cp-spinner" aria-hidden="true" /> Loading your selection…
          </div>
        ) : q.isError ? (
          <p className="cp-empty">
            We couldn’t load your selection.{' '}
            <button type="button" className="link" onClick={() => q.refetch()}>
              Try again
            </button>
          </p>
        ) : groups.length === 0 ? (
          <p className="cp-empty">Nothing selected yet. Open an album and tap ✓ on the photos you want.</p>
        ) : (
          groups.map((g) => (
            <section key={g.folderId ?? 'other'} className="cp-sel-group" aria-labelledby={`g-${g.folderId ?? 'other'}`}>
              <h3 id={`g-${g.folderId ?? 'other'}`}>
                {g.folderName} <span>({g.items.length})</span>
              </h3>
              <div className="cp-grid">
                {g.items.map((it, i) => {
                  const src = clientFileUrl(selection.id, it.thumbUrl)
                  return (
                    <button
                      key={it.id}
                      type="button"
                      className="cp-tile is-selected cp-sel-tile"
                      disabled={selection.readOnly || busyId === it.id}
                      onClick={() => void setSelected(it, false)}
                      aria-label={selection.readOnly ? `${g.folderName} ${it.type} ${i + 1}` : `Remove ${g.folderName} ${it.type} ${i + 1} from your selection`}
                    >
                      {it.type === 'photo' ? (
                        <img src={src} alt="" loading="lazy" onLoad={(e) => e.currentTarget.classList.add('loaded')} {...noSave} />
                      ) : (
                        <video src={`${src}#t=0.1`} preload="metadata" muted playsInline tabIndex={-1} {...noSave} />
                      )}
                      {!selection.readOnly && (
                        <span className="cp-sel-x" aria-hidden="true">
                          <i className="bi bi-x-lg" />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </section>
          ))
        )}
      </main>
      <footer className="cp-foot">🔒 Secure access · Powered by {APP_NAME}</footer>
    </div>
  )
}

/** /selection/:eventId/selected */
export default function ClientSelected() {
  const { eventId = '' } = useParams()
  return <ClientGate id={eventId}>{(s) => <SelectedPage selection={s} />}</ClientGate>
}
