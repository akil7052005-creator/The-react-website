import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isSelectionLocked, SUGGESTED_FOLDERS, type SelectionDto, type SelectionFolderDto, type StudioSelectionPhotoDto } from '@weddyzone/shared'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import { fileUrl } from '../../lib/env'
import { toastError } from '../../lib/query'
import { formatBytes } from '../../utils/format'
import { Modal, useConfirm } from '../Modal'
import { PhotoUploader } from '../PhotoUploader'
import { RowMenu } from '../RowMenu'
import { EmptyState, ErrorState, Skeleton, Spinner } from '../ui'
import { count, refreshSelection } from './selectionUi'

type Filter = 'all' | 'picked' | 'notes'
/** Tiles drawn at first; "Show more" adds the next batch, so 3,000-photo events stay quick. */
const PAGE = 120

function FolderModal({
  open,
  onClose,
  selectionId,
  folder,
  existing,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  selectionId: string
  /** Rename this folder; create a new one when absent. */
  folder?: SelectionFolderDto | null
  existing: string[]
  onSaved: (f: SelectionFolderDto) => void
}) {
  // Mounted fresh for each opening (see the key where it's used), so this starts from the folder.
  const [name, setName] = useState(folder?.name ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (value = name) => {
    const v = value.trim()
    if (!v) return setError('Enter a folder name')
    if (v.length > 60) return setError('At most 60 characters')
    setBusy(true)
    try {
      const f = folder
        ? await api.patch<SelectionFolderDto>(`/selections/${selectionId}/folders/${folder.id}`, { name: v })
        : await api.post<SelectionFolderDto>(`/selections/${selectionId}/folders`, { name: v })
      onSaved(f)
      onClose()
    } catch (e) {
      const fields = (e as { fields?: Record<string, string> }).fields
      if (fields?.name) setError((e as Error).message)
      else toastError(e)
    } finally {
      setBusy(false)
    }
  }

  const suggestions = SUGGESTED_FOLDERS.filter((s) => !existing.some((e) => e.toLowerCase() === s.toLowerCase()))
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={folder ? `Rename ${folder.name}` : 'New folder'}
      subtitle={folder ? undefined : 'Group the photos the way the client remembers the day'}
      icon="folder-plus"
      busy={busy}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => save()} disabled={busy}>
            {busy ? <Spinner size={14} /> : <i className="bi bi-check2" />} {folder ? 'Rename' : 'Create folder'}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        noValidate
      >
        <div className={`field${error ? ' has-error' : ''}`}>
          <label htmlFor="folder-name">
            Folder name <span className="req">*</span>
          </label>
          <input
            id="folder-name"
            className="input"
            value={name}
            maxLength={60}
            autoFocus
            onChange={(e) => {
              setName(e.target.value)
              setError('')
            }}
            aria-invalid={!!error}
            aria-describedby={error ? 'folder-name-error' : undefined}
            placeholder="e.g. Haldi"
          />
          {error && (
            <p className="field-error" id="folder-name-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </form>
      {!folder && suggestions.length > 0 && (
        <div className="sw-suggest">
          <span className="muted">Quick add:</span>
          {suggestions.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => save(s)} disabled={busy}>
              <i className="bi bi-plus" /> {s}
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}

/** One photo, large, with its picks and notes, and studio actions (move, remove). */
function PhotoPanel({
  s,
  photo,
  folders,
  onClose,
  onPrev,
  onNext,
}: {
  s: SelectionDto
  photo: StudioSelectionPhotoDto
  folders: SelectionFolderDto[]
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
}) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const locked = isSelectionLocked(s.status)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') onPrev?.()
      else if (e.key === 'ArrowRight') onNext?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onPrev, onNext])

  const move = async (folderId: string) => {
    try {
      await api.post(`/selections/${s.id}/photos/move`, { photoIds: [photo.id], folderId })
      toast.success(`Moved to ${folders.find((f) => f.id === folderId)?.name}`)
      refreshSelection(qc, s.id)
    } catch (e) {
      toastError(e)
    }
  }

  const remove = () =>
    confirm({
      title: 'Remove photo?',
      message: (
        <>
          <strong>{photo.originalName}</strong> will be removed from the gallery{photo.pickedBy.length ? ` and its ${photo.pickedBy.length} pick(s) cleared` : ''}.
        </>
      ),
      confirmLabel: 'Remove photo',
      tone: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/selections/${s.id}/photos/${photo.id}`)
          toast.success(`${photo.originalName} removed`)
          refreshSelection(qc, s.id)
          onClose()
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    })

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={photo.originalName} onClick={onClose}>
      <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn lb-close" onClick={onClose} aria-label="Close">
          <i className="bi bi-x-lg" />
        </button>
        <div className="lb-stage">
          <button className="icon-btn lb-nav" onClick={onPrev} disabled={!onPrev} aria-label="Previous photo">
            <i className="bi bi-chevron-left" />
          </button>
          <img src={fileUrl(photo.previewUrl ?? photo.url)} alt={photo.originalName} />
          <button className="icon-btn lb-nav" onClick={onNext} disabled={!onNext} aria-label="Next photo">
            <i className="bi bi-chevron-right" />
          </button>
        </div>
        <aside className="lb-side">
          <strong className="sw-ellipsis" title={photo.originalName}>
            {photo.originalName}
          </strong>
          <p className="muted">{formatBytes(photo.size)}</p>
          <p>
            {photo.pickedBy.length ? (
              <>
                <i className="bi bi-heart-fill sw-heart" /> Picked by {photo.pickedBy.join(', ')}
              </>
            ) : (
              <span className="muted">Not picked</span>
            )}
          </p>
          <div>
            <strong>Notes</strong>
            <ul className="lb-comments">
              {photo.comments.length === 0 && <li className="muted">No notes from the client.</li>}
              {photo.comments.map((c, i) => (
                <li key={i}>
                  <strong>{c.memberName}</strong> {c.text}
                </li>
              ))}
            </ul>
          </div>
          {folders.length > 1 && (
            <label className="field">
              <span>Folder</span>
              <select className="input" value={photo.folderId ?? ''} onChange={(e) => void move(e.target.value)}>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="row-actions">
            <a className="btn btn-sm btn-ghost" href={fileUrl(photo.url)} target="_blank" rel="noreferrer">
              <i className="bi bi-box-arrow-up-right" /> Original
            </a>
            {!locked && (
              <button className="btn btn-sm btn-ghost sw-danger" onClick={remove}>
                <i className="bi bi-trash" /> Remove
              </button>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

export function EventPhotos({
  s,
  folders,
  uploadOpen,
  setUploadOpen,
  onBusyChange,
}: {
  s: SelectionDto
  folders: SelectionFolderDto[]
  uploadOpen: boolean
  setUploadOpen: (v: boolean) => void
  onBusyChange: (busy: boolean) => void
}) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [folderId, setFolderIdRaw] = useState<string>('')
  const [filter, setFilterRaw] = useState<Filter>('all')
  const [shown, setShown] = useState(PAGE)
  // Changing folder or filter starts again from the first page of tiles.
  const setFolderId = (v: string) => {
    setFolderIdRaw(v)
    setShown(PAGE)
  }
  const setFilter = (v: Filter) => {
    setFilterRaw(v)
    setShown(PAGE)
  }
  const [open, setOpen] = useState<number | null>(null)
  const [folderModal, setFolderModal] = useState<{ open: boolean; folder?: SelectionFolderDto | null }>({ open: false })
  const locked = isSelectionLocked(s.status)

  const photosQ = useQuery({
    queryKey: ['selection-photos', s.id],
    queryFn: () => api.get<StudioSelectionPhotoDto[]>(`/selections/${s.id}/photos`),
  })
  // A folder created a moment ago may not be in the list yet; it shows once the list refreshes.
  const current = folders.find((f) => f.id === folderId) ?? null

  const all = useMemo(() => photosQ.data ?? [], [photosQ.data])
  const inFolder = useMemo(() => (folderId ? all.filter((p) => p.folderId === folderId) : all), [all, folderId])
  const list = useMemo(
    () => inFolder.filter((p) => (filter === 'picked' ? p.pickedBy.length > 0 : filter === 'notes' ? p.comments.length > 0 : true)),
    [inFolder, filter],
  )
  const pickedHere = inFolder.filter((p) => p.pickedBy.length > 0).length
  const notesHere = inFolder.filter((p) => p.comments.length > 0).length
  const photo = open !== null ? list[open] : null

  const deleteFolder = (f: SelectionFolderDto) =>
    confirm({
      title: `Delete folder ${f.name}?`,
      message: f.photoCount ? (
        <>
          Its <strong>{f.photoCount}</strong> photos are kept and move to <strong>General</strong>.
        </>
      ) : (
        'The folder is empty.'
      ),
      confirmLabel: 'Delete folder',
      tone: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/selections/${s.id}/folders/${f.id}`)
          toast.success(`Folder ${f.name} deleted`)
          setFolderId('')
          refreshSelection(qc, s.id)
        } catch (e) {
          toastError(e)
          throw e
        }
      },
    })

  return (
    <div className="stack sw-photos">
      <div className="sw-folders" role="tablist" aria-label="Folders">
        <button role="tab" aria-selected={!folderId} className={`sw-folder${!folderId ? ' on' : ''}`} onClick={() => setFolderId('')}>
          <i className="bi bi-images" /> All <small>{count(s.photoCount)}</small>
        </button>
        {folders.map((f) => (
          <button key={f.id} role="tab" aria-selected={folderId === f.id} className={`sw-folder${folderId === f.id ? ' on' : ''}`} onClick={() => setFolderId(f.id)}>
            <i className="bi bi-folder2" /> {f.name} <small>{count(f.photoCount)}</small>
            {f.pickedCount > 0 && (
              <small className="sw-folder-picked" title={`${f.pickedCount} picked`}>
                <i className="bi bi-heart-fill" /> {count(f.pickedCount)}
              </small>
            )}
          </button>
        ))}
        <button className="sw-folder sw-folder-add" onClick={() => setFolderModal({ open: true })}>
          <i className="bi bi-folder-plus" /> New folder
        </button>
      </div>

      {uploadOpen && !locked && (
        <section className="sw-upload card" aria-label="Upload photos">
          <div className="row-between">
            <p className="sw-upload-hint">
              {current ? (
                <>
                  Uploading into <strong>{current.name}</strong>.
                </>
              ) : (
                <>Drop a whole folder: each top folder (Haldi, Wedding…) becomes a folder here. Loose photos go to General.</>
              )}{' '}
              Duplicates are skipped and previews are made automatically.
            </p>
            <button className="icon-btn" onClick={() => setUploadOpen(false)} aria-label="Hide uploader">
              <i className="bi bi-chevron-up" />
            </button>
          </div>
          <PhotoUploader
            endpoint={`/selections/${s.id}/photos`}
            fields={current ? { folderId: current.id } : undefined}
            onBusyChange={onBusyChange}
            onUploaded={() => refreshSelection(qc, s.id)}
            label={current ? `Drop photos for ${current.name}, or click to browse` : 'Drop photos or a whole folder here, or click to browse'}
          />
        </section>
      )}

      <div className="row-between sw-photo-bar">
        <div className="tabs" role="tablist" aria-label="Show">
          {(
            [
              ['all', `All (${count(inFolder.length)})`],
              ['picked', `Picked (${count(pickedHere)})`],
              ['notes', `With notes (${count(notesHere)})`],
            ] as [Filter, string][]
          ).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
        {current && (
          <RowMenu
            label={`Folder ${current.name} actions`}
            items={[
              { label: 'Rename folder', icon: 'pencil', onSelect: () => setFolderModal({ open: true, folder: current }) },
              { label: 'Delete folder', icon: 'trash', danger: true, onSelect: () => void deleteFolder(current) },
            ]}
          />
        )}
      </div>

      {photosQ.isPending ? (
        <div className="photo-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} height={140} radius={12} />
          ))}
        </div>
      ) : photosQ.isError ? (
        <ErrorState error={photosQ.error} onRetry={() => photosQ.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={filter === 'all' ? 'images' : filter === 'picked' ? 'heart' : 'chat'}
          title={filter === 'all' ? (current ? `No photos in ${current.name} yet` : 'No photos yet') : filter === 'picked' ? 'Nothing picked here yet' : 'No notes here'}
          text={filter === 'all' ? 'Upload the event photos for the couple to choose from.' : undefined}
          action={
            filter === 'all' && !locked && !uploadOpen ? (
              <button className="btn btn-primary" onClick={() => setUploadOpen(true)}>
                <i className="bi bi-cloud-arrow-up" /> Upload photos
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="photo-grid sw-grid">
            {list.slice(0, shown).map((p, i) => (
              <figure key={p.id} className={`photo-tile${p.pickedBy.length ? ' is-picked' : ''}`}>
                <button className="photo-open" onClick={() => setOpen(i)} aria-label={`Open ${p.originalName}`}>
                  <img src={fileUrl(p.previewUrl ?? p.url)} alt={p.originalName} loading="lazy" decoding="async" />
                </button>
                {p.pickedBy.length > 0 && (
                  <span className="photo-badge" title={`Picked by ${p.pickedBy.join(', ')}`}>
                    <i className="bi bi-heart-fill" /> {p.pickedBy.length}
                  </span>
                )}
                {p.comments.length > 0 && (
                  <span className="photo-badge photo-badge-left" title={p.comments.map((c) => `${c.memberName}: ${c.text}`).join('\n')}>
                    <i className="bi bi-chat-fill" /> {p.comments.length}
                  </span>
                )}
                <figcaption>
                  <span title={p.originalName}>{p.originalName}</span>
                </figcaption>
              </figure>
            ))}
          </div>
          {list.length > shown && (
            <div className="sw-more">
              <button className="btn btn-ghost" onClick={() => setShown((n) => n + PAGE)}>
                Show more ({count(list.length - shown)} left)
              </button>
            </div>
          )}
        </>
      )}

      {photo && (
        <PhotoPanel
          s={s}
          photo={photo}
          folders={folders}
          onClose={() => setOpen(null)}
          onPrev={open! > 0 ? () => setOpen(open! - 1) : undefined}
          onNext={open! < list.length - 1 ? () => setOpen(open! + 1) : undefined}
        />
      )}
      <FolderModal
        key={folderModal.open ? (folderModal.folder?.id ?? 'new') : 'closed'}
        open={folderModal.open}
        folder={folderModal.folder}
        onClose={() => setFolderModal({ open: false })}
        selectionId={s.id}
        existing={folders.map((f) => f.name)}
        onSaved={(f) => {
          toast.success(folderModal.folder ? `Folder renamed to ${f.name}` : `Folder ${f.name} created`)
          if (!folderModal.folder) setFolderId(f.id)
          refreshSelection(qc, s.id)
        }}
      />
    </div>
  )
}
