import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { ERROR_CODES, type ClientItemResult, type ClientItemsPage, type ClientSelectionDto, type MediaItem } from '@weddyzone/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { isApiError } from '../../../lib/api'
import { clientApi, clientFileUrl } from '../../../lib/clientSession'
import { APP_NAME } from '../../../lib/env'
import { toastError } from '../../../lib/query'
import { clientKey, ClientGate, itemsKey, noSave, SelectedCounter, SubmitSelection, SubmittedBanner } from './ClientParts'

type Change = Partial<Pick<MediaItem, 'selected' | 'favorite' | 'note'>>

const nf = new Intl.NumberFormat('en-IN')

/**
 * Heart / check / note on one item, saved straight away: the screen changes first, the server's
 * answer then sets the exact counts, and a failure puts things back.
 */
function useItemPatch(selectionId: string, folderId: string) {
  const qc = useQueryClient()

  const apply = useCallback(
    (itemId: string, change: Change, d: { selected: number; favorites: number }) => {
      qc.setQueryData<InfiniteData<ClientItemsPage>>(itemsKey(selectionId, folderId), (data) =>
        data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((it) => (it.id === itemId ? { ...it, ...change } : it)) })) } : data,
      )
      qc.setQueryData<ClientSelectionDto>(clientKey(selectionId), (s) =>
        s
          ? {
              ...s,
              counts: { ...s.counts, selected: s.counts.selected + d.selected, favorites: s.counts.favorites + d.favorites },
              folders: s.folders.map((f) => (f.id === folderId ? { ...f, selected: f.selected + d.selected } : f)),
            }
          : s,
      )
    },
    [qc, selectionId, folderId],
  )

  return useCallback(
    async (item: MediaItem, change: Change) => {
      const s = qc.getQueryData<ClientSelectionDto>(clientKey(selectionId))
      if (!s || s.readOnly) return
      if (change.selected && !item.selected && s.selectionLimit !== null && s.counts.selected >= s.selectionLimit) {
        toast.error(`You can select up to ${s.selectionLimit} photos`)
        return
      }
      const step = (to: boolean | undefined, from: boolean) => (to === undefined || to === from ? 0 : to ? 1 : -1)
      const d = { selected: step(change.selected, item.selected), favorites: step(change.favorite, item.favorite) }
      apply(item.id, change, d)
      try {
        const r = await clientApi(selectionId).patch<ClientItemResult>(`/public/selection/${selectionId}/items/${item.id}`, change)
        qc.setQueryData<InfiniteData<ClientItemsPage>>(itemsKey(selectionId, folderId), (data) =>
          data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((it) => (it.id === item.id ? r.item : it)) })) } : data,
        )
        qc.setQueryData<ClientSelectionDto>(clientKey(selectionId), (cur) =>
          cur
            ? {
                ...cur,
                counts: { ...cur.counts, ...r.counts },
                folders: cur.folders.map((f) => (r.folder && f.id === r.folder.id ? { ...f, selected: r.folder.selected } : f)),
              }
            : cur,
        )
        if (change.note !== undefined) toast.success(r.item.note ? 'Note saved' : 'Note removed')
      } catch (e) {
        const back: Change = {}
        if (change.selected !== undefined) back.selected = item.selected
        if (change.favorite !== undefined) back.favorite = item.favorite
        if (change.note !== undefined) back.note = item.note
        apply(item.id, back, { selected: -d.selected, favorites: -d.favorites })
        if (isApiError(e) && e.code === ERROR_CODES.QUOTA_LOCKED) toast.error(e.message)
        else if (isApiError(e) && [ERROR_CODES.CLIENT_AUTH, ERROR_CODES.GALLERY_CLOSED, ERROR_CODES.GALLERY_EXPIRED, ERROR_CODES.READ_ONLY].includes(e.code as never)) {
          toastError(e)
          qc.invalidateQueries({ queryKey: clientKey(selectionId) })
        } else toastError(e)
      }
    },
    [qc, apply, selectionId, folderId],
  )
}

function ItemButtons({ item, selection, onPatch, big }: { item: MediaItem; selection: ClientSelectionDto; onPatch: (c: Change) => void; big?: boolean }) {
  const off = selection.readOnly
  const what = item.type === 'video' ? 'video' : 'photo'
  return (
    <div className={`cp-item-actions${big ? ' big' : ''}`}>
      {selection.permissions.favorites && (
        <button
          type="button"
          className={`cp-round cp-heart${item.favorite ? ' on' : ''}`}
          aria-pressed={item.favorite}
          aria-label={item.favorite ? `Remove ${what} from favourites` : `Add ${what} to favourites`}
          disabled={off}
          onClick={() => onPatch({ favorite: !item.favorite })}
        >
          <i className={`bi bi-heart${item.favorite ? '-fill' : ''}`} aria-hidden="true" />
        </button>
      )}
      {(item.selectable || item.selected) && (
        <button
          type="button"
          className={`cp-round cp-check${item.selected ? ' on' : ''}`}
          aria-pressed={item.selected}
          aria-label={item.selected ? `Unselect ${what}` : `Select ${what}`}
          disabled={off}
          onClick={() => onPatch({ selected: !item.selected })}
        >
          <i className="bi bi-check-lg" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

function Tile({ item, index, selection, onOpen, onPatch }: { item: MediaItem; index: number; selection: ClientSelectionDto; onOpen: () => void; onPatch: (c: Change) => void }) {
  const src = clientFileUrl(selection.id, item.thumbUrl)
  return (
    <div className={`cp-tile${item.selected ? ' is-selected' : ''}`} data-testid="cp-tile">
      <button type="button" className="cp-tile-open" onClick={onOpen} aria-label={`Open ${item.type === 'video' ? 'video' : 'photo'} ${index + 1}`}>
        {item.type === 'photo' ? (
          <img src={src} alt="" loading="lazy" onLoad={(e) => e.currentTarget.classList.add('loaded')} {...noSave} />
        ) : (
          <>
            <video src={`${src}#t=0.1`} preload="metadata" muted playsInline tabIndex={-1} {...noSave} />
            <span className="cp-play" aria-hidden="true">
              <i className="bi bi-play-fill" />
            </span>
          </>
        )}
      </button>
      {item.downloadUrl && (
        <a className="cp-round cp-dl" href={clientFileUrl(selection.id, item.downloadUrl)} download aria-label={`Download ${item.type} ${index + 1}`}>
          <i className="bi bi-download" aria-hidden="true" />
        </a>
      )}
      <ItemButtons item={item} selection={selection} onPatch={onPatch} />
    </div>
  )
}

function NoteBox({ item, onSave, disabled }: { item: MediaItem; onSave: (note: string | null) => void; disabled: boolean }) {
  const [draft, setDraft] = useState(item.note ?? '')
  const changed = draft.trim() !== (item.note ?? '')
  return (
    <div className="cp-note">
      <label htmlFor={`note-${item.id}`}>Add note</label>
      <textarea
        id={`note-${item.id}`}
        rows={2}
        maxLength={500}
        placeholder="e.g. Please brighten this one"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button type="button" className="cp-note-save" disabled={disabled || !changed} onClick={() => onSave(draft.trim() || null)}>
        Save note
      </button>
    </div>
  )
}

function Lightbox({
  items,
  index,
  selection,
  onIndex,
  onClose,
  onPatch,
  onNeedMore,
}: {
  items: MediaItem[]
  index: number
  selection: ClientSelectionDto
  onIndex: (i: number) => void
  onClose: () => void
  onPatch: (item: MediaItem, c: Change) => void
  onNeedMore: () => void
}) {
  const item = items[index]
  const closeRef = useRef<HTMLButtonElement>(null)
  const touchX = useRef<number | null>(null)
  const prev = useCallback(() => index > 0 && onIndex(index - 1), [index, onIndex])
  const next = useCallback(() => index < items.length - 1 && onIndex(index + 1), [index, items.length, onIndex])

  useEffect(() => {
    if (index >= items.length - 3) onNeedMore()
  }, [index, items.length, onNeedMore])

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
      opener?.focus?.()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'TEXTAREA') return
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, prev, next])

  if (!item) return null
  const src = clientFileUrl(selection.id, item.url)
  return (
    <div
      className="cp-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`${item.type === 'video' ? 'Video' : 'Photo'} ${index + 1} of ${items.length}`}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return
        const dx = e.changedTouches[0].clientX - touchX.current
        touchX.current = null
        if (dx > 50) prev()
        else if (dx < -50) next()
      }}
    >
      <div className="cp-lb-top">
        <span className="cp-lb-count">
          {index + 1} / {items.length}
        </span>
        <button ref={closeRef} type="button" className="cp-lb-close" onClick={onClose} aria-label="Close">
          <i className="bi bi-x-lg" aria-hidden="true" />
        </button>
      </div>
      <div className={`cp-lb-stage${item.selected ? ' is-selected' : ''}`}>
        {item.type === 'photo' ? (
          <img key={item.id} src={src} alt={`Photo ${index + 1}`} {...noSave} />
        ) : (
          <video key={item.id} src={src} controls autoPlay playsInline controlsList="nodownload noplaybackrate" disablePictureInPicture {...noSave} />
        )}
        <ItemButtons item={item} selection={selection} onPatch={(c) => onPatch(item, c)} big />
      </div>
      <button type="button" className="cp-lb-nav prev" onClick={prev} disabled={index === 0} aria-label="Previous">
        <i className="bi bi-chevron-left" aria-hidden="true" />
      </button>
      <button type="button" className="cp-lb-nav next" onClick={next} disabled={index >= items.length - 1} aria-label="Next">
        <i className="bi bi-chevron-right" aria-hidden="true" />
      </button>
      {selection.permissions.notes && <NoteBox key={item.id} item={item} disabled={selection.readOnly} onSave={(note) => onPatch(item, { note })} />}
    </div>
  )
}

function FolderPage({ selection, folderId }: { selection: ClientSelectionDto; folderId: string }) {
  const folder = selection.folders.find((f) => f.id === folderId)
  const patch = useItemPatch(selection.id, folderId)
  const [open, setOpen] = useState<number | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const items = useInfiniteQuery({
    queryKey: itemsKey(selection.id, folderId),
    queryFn: ({ pageParam }) => clientApi(selection.id).get<ClientItemsPage>(`/public/selection/${selection.id}/folders/${folderId}/items`, { page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: !!folder,
  })
  const list = items.data?.pages.flatMap((p) => p.items) ?? []
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = items
  const more = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  // Infinite scroll: the next page loads as the end of the grid comes into view.
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((e) => e[0].isIntersecting && more(), { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [more])

  if (!folder) return <Navigate to={`/selection/${selection.id}`} replace />
  const c = selection.counts

  return (
    <div className="cp-page cp-folder-page">
      <header className="cp-bar">
        <Link to={`/selection/${selection.id}`} className="cp-back">
          ← Albums
        </Link>
        <div className="cp-bar-stats" aria-live="polite">
          <span>
            <i className="bi bi-image" aria-hidden="true" /> {nf.format(c.photos)} Photos
          </span>
          {selection.permissions.favorites && (
            <span>
              <i className="bi bi-heart" aria-hidden="true" /> {nf.format(c.favorites)} Favorites
            </span>
          )}
          <span className="cp-bar-selected">
            <i className="bi bi-check-lg" aria-hidden="true" /> {nf.format(c.selected)}
            {selection.selectionLimit !== null && ` / ${nf.format(selection.selectionLimit)}`} Selected Photos
          </span>
        </div>
        <SubmitSelection selection={selection} compact />
      </header>
      <SubmittedBanner selection={selection} />
      <main className="cp-main">
        <div className="cp-folder-head">
          <h1 className="cp-folder-title">
            <i className={`bi bi-${folder.type === 'video' ? 'camera-reels' : 'folder2-open'}`} aria-hidden="true" />
            <span className="cp-folder-name" title={folder.name}>
              {folder.name}
            </span>
          </h1>
          {folder.zipUrl && (
            <a className="cp-zip" href={clientFileUrl(selection.id, folder.zipUrl)} download>
              <i className="bi bi-file-earmark-zip" aria-hidden="true" /> Download folder
            </a>
          )}
        </div>
        {items.isPending ? (
          <div className="cp-loading" role="status">
            <span className="cp-spinner" aria-hidden="true" /> Loading photos…
          </div>
        ) : items.isError ? (
          <p className="cp-empty">
            We couldn’t load this folder.{' '}
            <button type="button" className="link" onClick={() => items.refetch()}>
              Try again
            </button>
          </p>
        ) : list.length === 0 ? (
          <p className="cp-empty">This folder is empty.</p>
        ) : (
          <div className="cp-grid">
            {list.map((it, i) => (
              <Tile key={it.id} item={it} index={i} selection={selection} onOpen={() => setOpen(i)} onPatch={(ch) => void patch(it, ch)} />
            ))}
          </div>
        )}
        <div ref={sentinel} className="cp-sentinel" aria-hidden="true" />
        {isFetchingNextPage && (
          <div className="cp-loading small" role="status">
            <span className="cp-spinner" aria-hidden="true" /> Loading more…
          </div>
        )}
      </main>
      <footer className="cp-foot">🔒 Secure access · Powered by {APP_NAME}</footer>
      {selection.permissions.select && <SelectedCounter selection={selection} />}
      {open !== null && (
        <Lightbox
          items={list}
          index={Math.min(open, list.length - 1)}
          selection={selection}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          onPatch={(item, ch) => void patch(item, ch)}
          onNeedMore={more}
        />
      )}
    </div>
  )
}

/** /selection/:eventId/folders/:folderId: pick (✓) and favourite (♥) photos and videos. */
export default function ClientFolder() {
  const { eventId = '', folderId = '' } = useParams()
  return <ClientGate id={eventId}>{(s) => <FolderPage selection={s} folderId={folderId} />}</ClientGate>
}
