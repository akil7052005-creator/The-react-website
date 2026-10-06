import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ERROR_CODES, type ClientSelectionDto, type ClientShowcaseCard } from '@weddyzone/shared'
import { useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Modal } from '../../../components/Modal'
import { isApiError } from '../../../lib/api'
import { clientApi, clientAuthPath, clientSession, hasClientToken } from '../../../lib/clientSession'
import { APP_NAME, fileUrl } from '../../../lib/env'
import { toastError } from '../../../lib/query'
import showcaseCouple from '../../../assets/showcase-couple.jpg'
import showcaseHands from '../../../assets/showcase-hands.jpg'
import showcaseMandap from '../../../assets/showcase-mandap.jpg'

export const clientKey = (id: string) => ['client-selection', id] as const
export const itemsKey = (id: string, folderId: string) => ['client-items', id, folderId] as const

/** The app's own mark (as in the favicon), used where no studio logo is known yet. */
export function AppMark({ className }: { className?: string }) {
  return (
    <span className={`cp-app-mark ${className ?? ''}`} role="img" aria-label={APP_NAME}>
      W
    </span>
  )
}

/** The studio's logo, else the app mark. */
export function StudioLogo({ selection, className }: { selection: ClientSelectionDto; className?: string }) {
  return selection.studio.logoUrl ? <img className={className} src={fileUrl(selection.studio.logoUrl)} alt={selection.studio.name} /> : <AppMark className={className} />
}

export function useClientSelection(id: string) {
  return useQuery({
    queryKey: clientKey(id),
    queryFn: () => clientApi(id).get<ClientSelectionDto>(`/public/selection/${id}`),
    enabled: hasClientToken(id),
    staleTime: 15_000,
    retry: (n, e) => !isApiError(e) && n < 2,
  })
}

/** Handles the states every portal page shares: no token, gallery closed or expired, loading. */
export function ClientGate({ id, children }: { id: string; children: (s: ClientSelectionDto) => ReactNode }) {
  const q = useClientSelection(id)
  if (!hasClientToken(id)) return <Navigate to={clientAuthPath(id)} replace />
  if (q.isError) {
    const e = q.error
    if (isApiError(e) && (e.code === ERROR_CODES.CLIENT_AUTH || e.code === ERROR_CODES.NOT_FOUND)) {
      const back = clientAuthPath(id)
      clientSession.clear(id)
      return <Navigate to={back} replace />
    }
    const closed = isApiError(e) && (e.code === ERROR_CODES.GALLERY_CLOSED || e.code === ERROR_CODES.GALLERY_EXPIRED)
    return (
      <div className="cp-message">
        <AppMark className="cp-message-mark" />
        <h1>{isApiError(e) && e.code === ERROR_CODES.GALLERY_EXPIRED ? 'This gallery has expired' : closed ? 'This gallery is not available' : 'We couldn’t load your gallery'}</h1>
        <p>{closed ? 'Please contact your photographer.' : isApiError(e) ? e.message : 'Check your connection and try again.'}</p>
        {closed ? (
          <Link to={clientAuthPath(id)} className="cp-pill">
            Back
          </Link>
        ) : (
          <button type="button" className="cp-pill" onClick={() => q.refetch()}>
            Try again
          </button>
        )}
      </div>
    )
  }
  if (!q.data) {
    return (
      <div className="cp-loading" role="status">
        <span className="cp-spinner" aria-hidden="true" /> Loading your photos…
      </div>
    )
  }
  return <>{children(q.data)}</>
}

/** "Submit Selection" with its confirm dialog. After submitting, the event page shows the thank-you. */
export function SubmitSelection({ selection, compact }: { selection: ClientSelectionDto; compact?: boolean }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const n = selection.counts.selected
  if (selection.readOnly) return null

  const submit = async () => {
    setBusy(true)
    try {
      const s = await clientApi(selection.id).post<ClientSelectionDto>(`/public/selection/${selection.id}/submit`)
      qc.setQueryData(clientKey(selection.id), s)
      qc.invalidateQueries({ queryKey: ['client-items', selection.id] })
      setOpen(false)
      navigate(`/selection/${selection.id}?submitted=1`)
    } catch (e) {
      toastError(e)
      qc.invalidateQueries({ queryKey: clientKey(selection.id) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className={`cp-submit${compact ? ' compact' : ''}`} onClick={() => setOpen(true)}>
        <i className="bi bi-send-fill" aria-hidden="true" /> Submit Selection
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Submit selection"
        busy={busy}
        className="cp-submit-modal"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || n === 0}>
              {busy ? 'Submitting…' : 'Submit'}
            </button>
          </>
        }
      >
        {n === 0 ? (
          <p className="cp-submit-hint">Select at least one photo before you submit — tap the ✓ on the photos you want.</p>
        ) : (
          <p>
            Submit {n} selected {n === 1 ? 'photo' : 'photos'}? After submitting you can't change your selection.
          </p>
        )}
      </Modal>
    </>
  )
}

/** Albums | My Selection (N): the gallery home and the Selection tab. */
export function ClientTabs({ selection, active }: { selection: ClientSelectionDto; active: 'albums' | 'selected' }) {
  return (
    <nav className="cp-tabs" aria-label="Gallery">
      <Link to={`/selection/${selection.id}`} className={active === 'albums' ? 'on' : ''} aria-current={active === 'albums' ? 'page' : undefined}>
        <i className="bi bi-grid-3x3-gap" aria-hidden="true" /> Albums
      </Link>
      <Link to={`/selection/${selection.id}/selected`} className={active === 'selected' ? 'on' : ''} aria-current={active === 'selected' ? 'page' : undefined}>
        <i className="bi bi-check2-square" aria-hidden="true" /> My Selection ({selection.counts.selected})
      </Link>
    </nav>
  )
}

/** "Selected: N" (of the limit), kept on screen while scrolling a folder. */
export function SelectedCounter({ selection }: { selection: ClientSelectionDto }) {
  const { selected } = selection.counts
  return (
    <Link to={`/selection/${selection.id}/selected`} className="cp-counter" aria-live="polite" aria-label={`Selected: ${selected}. Open my selection`}>
      <i className="bi bi-check-circle-fill" aria-hidden="true" /> Selected: {selected}
      {selection.selectionLimit !== null && <span> / {selection.selectionLimit}</span>}
    </Link>
  )
}

export function SubmittedBanner({ selection }: { selection: ClientSelectionDto }) {
  if (!selection.readOnly) return null
  return (
    <div className="cp-submitted" role="status">
      <i className="bi bi-check-circle-fill" aria-hidden="true" /> Selection submitted — your photographer has your picks. You can still look through your photos.
    </div>
  )
}

export function ThankYou({ selection, onContinue }: { selection: ClientSelectionDto; onContinue: () => void }) {
  const { selected, favorites } = selection.counts
  return (
    <main className="cp-thanks">
      <div className="cp-thanks-check" aria-hidden="true">
        <i className="bi bi-check-lg" />
      </div>
      <h1>
        Thank you, {selection.customerName}! Your selection has been sent to {selection.studio.name}.
      </h1>
      <p>
        {selected} {selected === 1 ? 'photo' : 'photos'} selected • {favorites} {favorites === 1 ? 'favourite' : 'favourites'}
      </p>
      <button type="button" className="cp-pill" onClick={onContinue} autoFocus>
        View my photos
      </button>
    </main>
  )
}

/** Shown when the studio hasn't added three Gallery Banners of its own. */
const DEFAULT_SHOWCASE: ClientShowcaseCard[] = [
  { imageUrl: showcaseCouple, title: 'Your Wedding', subtitle: 'In Every Frame' },
  { imageUrl: showcaseMandap, title: 'Cinematic Films', subtitle: 'Made to Remember' },
  { imageUrl: showcaseHands, title: 'Fine Art Albums', subtitle: 'Crafted with Love' },
]

/** The studio's showcase, scrolling sideways forever (pauses on hover; still when motion is reduced). */
export function ShowcaseStrip({ selection }: { selection: ClientSelectionDto }) {
  const own = selection.showcase.map((c) => ({ ...c, imageUrl: fileUrl(c.imageUrl)! }))
  let cards = [...own, ...DEFAULT_SHOWCASE.slice(0, Math.max(0, 3 - own.length))]
  // Enough cards to fill a wide screen before the loop repeats.
  while (cards.length < 6) cards = [...cards, ...cards]
  const card = (c: ClientShowcaseCard, i: number, hidden: boolean) => (
    <figure className="cp-show-card" key={`${hidden ? 'b' : 'a'}${i}`} aria-hidden={hidden || undefined}>
      <img src={c.imageUrl} alt="" loading="lazy" draggable={false} />
      <figcaption>
        <span>{c.title}</span>
        {c.subtitle && <strong>{c.subtitle}</strong>}
      </figcaption>
    </figure>
  )
  return (
    <section className="cp-showcase" aria-label={`${selection.studio.name} showcase`}>
      <div className="cp-show-track">
        {cards.map((c, i) => card(c, i, false))}
        {cards.map((c, i) => card(c, i, true))}
      </div>
    </section>
  )
}

/** Stops "Save image as…" and dragging photos out (a deterrent, not protection: previews are watermarked). */
export const noSave = {
  onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  onDragStart: (e: { preventDefault: () => void }) => e.preventDefault(),
  draggable: false,
}
