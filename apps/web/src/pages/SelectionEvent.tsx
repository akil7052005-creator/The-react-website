import { useQuery } from '@tanstack/react-query'
import type { SelectionFolderDto, SelectionOverviewDto } from '@weddyzone/shared'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CreateFolderModal } from '../components/selection/CreateFolderModal'
import { DownloadSelectedModal } from '../components/selection/DownloadSelectedModal'
import { FolderView } from '../components/selection/FolderView'
import { SelectedPhotosView } from '../components/selection/SelectedPhotosView'
import { count, hasSubmitted, LIVE_POLL_MS } from '../components/selection/selectionUi'
import { SelectionStatusPill } from '../components/selection/SelectionStatusPill'
import { ResetSelectionModal } from '../components/selection/ResetSelectionModal'
import { ShareModal } from '../components/selection/ShareModal'
import { UploadFoldersModal, type UploadFoldersHandle } from '../components/selection/UploadFoldersModal'
import { EmptyState, ErrorState, Skeleton } from '../components/ui'
import { useUrlState } from '../hooks/useUrlState'
import { api, isApiError } from '../lib/api'

/** A yellow folder with a pink photo (or video camera) badge, drawn here, no image files. */
function FolderArt({ video }: { video: boolean }) {
  return (
    <svg className="ef-art" viewBox="0 0 120 92" aria-hidden="true" data-kind={video ? 'video' : 'photo'}>
      <path d="M6 18a8 8 0 0 1 8-8h30l10 10h52a8 8 0 0 1 8 8v52a8 8 0 0 1-8 8H14a8 8 0 0 1-8-8z" fill="#f6b73c" />
      <path d="M6 32a8 8 0 0 1 8-8h92a8 8 0 0 1 8 8v48a8 8 0 0 1-8 8H14a8 8 0 0 1-8-8z" fill="#ffcf5c" />
      <rect x="44" y="40" width="32" height="26" rx="5" fill="#fff" />
      {video ? (
        <>
          <rect x="47" y="45" width="18" height="16" rx="3" fill="#e8174a" />
          <path d="M66 49l7-4v16l-7-4z" fill="#e8174a" />
        </>
      ) : (
        <>
          <rect x="47" y="43" width="26" height="20" rx="3" fill="#f7c6d3" />
          <circle cx="54" cy="49" r="3" fill="#fff" />
          <path d="M47 63l9-9 6 6 4-4 7 7z" fill="#e8174a" />
        </>
      )}
    </svg>
  )
}

function FolderCard({ folder, onOpen }: { folder: SelectionFolderDto; onOpen: () => void }) {
  const video = folder.type === 'video'
  const n = video ? (folder.videoCount ?? 0) : folder.photoCount
  const unit = video ? 'Videos' : 'Images'
  return (
    <button type="button" className="ef-card" onClick={onOpen} aria-label={`Open ${video ? 'video' : 'photo'} folder ${folder.name}, ${n} ${unit.toLowerCase()}`}>
      <FolderArt video={video} />
      <span className="ef-name">
        <i className={`bi bi-${video ? 'camera-video' : 'image'}`} aria-hidden="true" /> <span title={folder.name} aria-label={folder.name}>
          {folder.name}
        </span>
      </span>
      <span className="ef-count">
        {count(n)} {unit}
      </span>
    </button>
  )
}

/**
 * The event's folder page (Upload & Download): its folders as cards, uploading whole folders,
 * new folder, settings and reset; a folder opens its photos.
 */
export default function SelectionEvent() {
  const { selectionId = '' } = useParams()
  const [url, setUrl] = useUrlState({ folder: '', view: '' })
  const [uploadOpen, setUploadOpen] = useState(false)
  const [newFolder, setNewFolder] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [resetting, setResetting] = useState(false)
  const navigate = useNavigate()
  const uploader = useRef<UploadFoldersHandle>(null)

  const q = useQuery({
    queryKey: ['selection-overview', selectionId],
    queryFn: () => api.get<SelectionOverviewDto>(`/selections/${selectionId}/overview`),
    // The customer picks and submits from their phone: the badge and counts follow without a refresh.
    refetchInterval: LIVE_POLL_MS,
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    if (q.data) document.title = `${q.data.selection.event.title} · Photo Selection`
  }, [q.data])

  if (q.isPending) {
    return (
      <div className="stack ef-page">
        <Skeleton width={220} height={30} />
        <div className="ef-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={190} radius={12} />
          ))}
        </div>
      </div>
    )
  }
  if (q.isError) {
    const missing = isApiError(q.error) && (q.error.status === 404 || q.error.status === 400)
    return (
      <div className="stack ef-page">
        <Link to="/photo-selection" className="sw-back">
          <i className="bi bi-arrow-left" /> All events
        </Link>
        <div className="card">
          {missing ? (
            <EmptyState icon="images" title="Event not found" text="It may have been deleted." action={<Link className="btn btn-primary" to="/photo-selection">Back to Photo Selection</Link>} />
          ) : (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          )}
        </div>
      </div>
    )
  }

  const overview = q.data
  const { selection: s, folders } = overview
  const open = folders.find((f) => f.id === url.folder) ?? null
  const images = folders.reduce((n, f) => n + f.photoCount, 0)
  const videos = folders.reduce((n, f) => n + (f.videoCount ?? 0), 0)

  /** Opens the dialog and, in the same click, the folder picker. */
  const startUpload = () => {
    setUploadOpen(true)
    uploader.current?.pick()
  }

  const submitted = hasSubmitted(s.status)

  return (
    <div className="stack ef-page">
      <Link to="/photo-selection" className="sw-back">
        <i className="bi bi-arrow-left" /> All events
      </Link>
      <header className="ef-head">
        <h1>Photo Selection</h1>
        <div className="ef-actions">
          <span className="ef-tip-wrap" title={submitted ? undefined : 'No photos selected by the client yet'}>
            <button type="button" className="ef-btn solid" onClick={() => setDownloading(true)} disabled={!submitted} data-testid="download-selected">
              <i className="bi bi-download" /> Download Selected ({count(s.pickedCount)})
            </button>
          </span>
          <button type="button" className="ef-btn solid" onClick={startUpload}>
            <i className="bi bi-cloud-arrow-up" /> Upload Folder
          </button>
          <button type="button" className="ef-btn solid" onClick={() => setNewFolder(true)}>
            <i className="bi bi-folder-plus" /> New Folder
          </button>
          <button type="button" className="ef-btn outline" onClick={() => navigate(`/photo-selection/${s.id}/settings`)}>
            <i className="bi bi-gear" /> Settings
          </button>
          <button
            type="button"
            className="ef-btn outline"
            onClick={() => setResetting(true)}
            disabled={s.pickedCount === 0 || s.status === 'DELIVERED'}
            title={s.status === 'DELIVERED' ? 'Already downloaded' : s.pickedCount === 0 ? 'Nothing picked yet' : undefined}
          >
            <i className="bi bi-arrow-counterclockwise" /> Reset Selection
          </button>
        </div>
      </header>
      <p className="ef-info" data-testid="event-info">
        <span>
          <i className="bi bi-folder2" /> {count(folders.length)} Folders
        </span>
        <span className="ef-sep">|</span>
        <span>
          <i className="bi bi-image" /> {count(images)} Images
        </span>
        <span className="ef-sep">|</span>
        <span>
          <i className="bi bi-camera-video" /> {count(videos)} Videos
        </span>
        <span className="ef-sep">|</span>
        <span>
          Customer : <strong>{s.client.name}</strong>
        </span>
        <span className="ef-sep">|</span>
        <span>
          Event : <strong>{s.event.title}</strong>
        </span>
        <span className="ef-info-end">
          <SelectionStatusPill selection={s} className="psx-status" onReopen={() => setResetting(true)} />
          {submitted && (
            <button type="button" className="ef-link" onClick={() => setUrl({ view: 'selected', folder: '' })}>
              <i className="bi bi-check2-square" /> Selected Photos
            </button>
          )}
          <button type="button" className="ef-link" onClick={() => setSharing(true)}>
            <i className="bi bi-share" /> Share
          </button>
        </span>
      </p>

      {url.view === 'selected' && submitted ? (
        <SelectedPhotosView s={s} folders={folders} onBack={() => setUrl({ view: '' })} />
      ) : open ? (
        <FolderView s={s} folder={open} folders={folders} onBack={() => setUrl({ folder: '' })} />
      ) : folders.length === 0 ? (
        <div className="card ef-empty">
          <EmptyState
            icon="folder2-open"
            title="No folders yet — click Upload Folder"
            action={
              <button type="button" className="ef-btn solid" onClick={startUpload}>
                <i className="bi bi-cloud-arrow-up" /> Upload Folder
              </button>
            }
          />
        </div>
      ) : (
        <div className="ef-grid" data-testid="folder-grid">
          {folders.map((f) => (
            <FolderCard key={f.id} folder={f} onOpen={() => setUrl({ folder: f.id })} />
          ))}
        </div>
      )}

      <UploadFoldersModal ref={uploader} open={uploadOpen} onClose={() => setUploadOpen(false)} selectionId={s.id} folders={folders} />
      <CreateFolderModal key={newFolder ? 'new-open' : 'new-closed'} open={newFolder} onClose={() => setNewFolder(false)} selectionId={s.id} existing={folders.map((f) => f.name)} />
      {downloading && <DownloadSelectedModal selection={s} folders={folders} onClose={() => setDownloading(false)} onDone={() => setUrl({ view: 'selected', folder: '' })} />}
      {sharing && <ShareModal selection={s} onClose={() => setSharing(false)} />}
      {resetting && <ResetSelectionModal selection={s} onClose={() => setResetting(false)} onDone={() => setUrl({ view: '' })} />}
    </div>
  )
}
