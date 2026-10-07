import { useQueryClient } from '@tanstack/react-query'
import type { SelectionDto, SelectionFolderDto, StudioSelectionPhotoDto } from '@weddyzone/shared'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api, isApiError } from '../../lib/api'
import { API_BASE } from '../../lib/env'
import { toastError } from '../../lib/query'
import { Modal } from '../Modal'
import {
  canCopyLocally,
  copyFolderName,
  copyMatches,
  matchSelected,
  missingListText,
  PermissionNeeded,
  pickOriginalsFolder,
  saveText,
  scanFolder,
  wantedNames,
  type SelectedPhoto,
} from './localCopy'
import { returnOriginals, type CloudPick, type ReturnResult } from './cloudReturn'
import { isPhone, MobileDownload } from './MobileDownload'
import { refreshSelection } from './selectionUi'

type Step =
  | { at: 'choose' }
  | { at: 'local' }
  | { at: 'scanning'; found: number }
  | { at: 'copying'; done: number; total: number }
  | { at: 'copied'; copied: number; missing: SelectedPhoto[]; folder: string }
  | { at: 'online'; done: number; total: number }
  | { at: 'online-failed'; message: string }
  | { at: 'online-done'; result: ReturnResult; folder: string | null }

const PERMISSION_MSG = 'Permission needed to copy selected photos'

function saveBlob(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

/**
 * "Get selected files": copy the client's picks from the original folder on this computer (fast),
 * or download their full-quality originals kept in the cloud, verified, into a folder (no ZIP).
 * Either way the selection then shows as Downloaded.
 */
export function DownloadSelectedModal({
  selection,
  folders,
  onClose,
  onDone,
}: {
  selection: SelectionDto
  folders: SelectionFolderDto[]
  onClose: () => void
  /** After a copy or download: open the Selected Photos view. */
  onDone: () => void
}) {
  const qc = useQueryClient()
  const [step, setStep] = useState<Step>({ at: 'choose' })
  const local = canCopyLocally()
  const stop = useRef({ cancelled: false })
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  // Phones and tablets save to the phone instead (no folder picker); computers continue below unchanged.
  if (isPhone()) return <MobileDownload selection={selection} folders={folders} onClose={onClose} onDone={onDone} />

  const busy = step.at === 'scanning' || step.at === 'copying' || step.at === 'online'

  const markDownloaded = async () => {
    try {
      await api.post(`/selections/${selection.id}/deliver`)
    } catch (e) {
      toastError(e)
    }
    refreshSelection(qc, selection.id)
  }

  /** The client's picks, with the album each is in and where its full-quality original is kept. */
  const selectedPhotos = async (): Promise<CloudPick[]> => {
    const photos = await api.get<StudioSelectionPhotoDto[]>(`/selections/${selection.id}/photos`)
    const album = new Map(folders.map((f) => [f.id, f.name]))
    return photos
      .filter((p) => p.pickedBy.length > 0)
      .map((p) => ({
        id: p.id,
        originalName: p.originalName,
        folder: p.folder ?? null,
        album: (p.folderId && album.get(p.folderId)) || null,
        size: p.originalSize ?? null,
        originalUrl: p.originalUrl ?? null,
        originalChecksum: p.originalChecksum ?? null,
      }))
  }

  const copyLocal = async () => {
    stop.current = { cancelled: false }
    let root
    try {
      // Straight from the click: the browser shows its own folder picker and edit prompt.
      root = await pickOriginalsFolder()
    } catch (e) {
      if (e instanceof PermissionNeeded) toast.error(PERMISSION_MSG)
      else toastError(e)
      return
    }
    try {
      setStep({ at: 'scanning', found: 0 })
      const selected = await selectedPhotos()
      const files = await scanFolder(root, (found) => setStep({ at: 'scanning', found }), wantedNames(selected))
      const { matched, missing } = matchSelected(selected, files)
      const folder = copyFolderName(selection.client.name, selection.event.title)
      if (matched.length === 0) {
        setStep({ at: 'copied', copied: 0, missing, folder })
        return
      }
      setStep({ at: 'copying', done: 0, total: matched.length })
      const { copied, failed } = await copyMatches(root, folder, matched, (done) => setStep({ at: 'copying', done, total: matched.length }), stop.current)
      setStep({ at: 'copied', copied, missing: [...missing, ...failed], folder })
      if (copied > 0) await markDownloaded()
    } catch (e) {
      if ((e as Error).name === 'NotAllowedError' || (e as Error).name === 'SecurityError') toast.error(PERMISSION_MSG)
      else toastError(e)
      setStep({ at: 'local' })
    }
  }

  /** Download from cloud: the picks' full-quality originals, verified, into a folder (no ZIP). */
  const getOnline = async () => {
    stop.current = { cancelled: false }
    let root = null
    if (local) {
      try {
        // Straight from the click: the browser shows its own folder picker and edit prompt.
        root = await pickOriginalsFolder()
      } catch (e) {
        if (e instanceof PermissionNeeded) toast.error('Permission needed to save the selected photos')
        else toastError(e)
        return
      }
    }
    const ctrl = new AbortController()
    abort.current = ctrl
    try {
      const picks = await selectedPhotos()
      setStep({ at: 'online', done: 0, total: picks.length })
      const folder = copyFolderName(selection.client.name, selection.event.title)
      const get = async (url: string) => {
        const res = await fetch(`${API_BASE}${url}`, { credentials: 'include', signal: ctrl.signal })
        if (!res.ok) throw new Error(`Download failed (${res.status})`)
        return res.arrayBuffer()
      }
      const result = await returnOriginals(picks, {
        root,
        folderName: folder,
        get,
        save: (data, name) => saveBlob(new Blob([data]), name),
        onProgress: (done, total) => setStep({ at: 'online', done, total }),
        signal: stop.current,
      })
      if (ctrl.signal.aborted) {
        setStep({ at: 'choose' })
        return
      }
      setStep({ at: 'online-done', result, folder: root ? folder : null })
      if (result.saved > 0) await markDownloaded()
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setStep({ at: 'choose' })
        return
      }
      setStep({ at: 'online-failed', message: isApiError(e) ? e.message : (e as Error).message || 'The download stopped. Check your connection and try again.' })
    } finally {
      abort.current = null
    }
  }

  const cancelOnline = () => {
    stop.current.cancelled = true
    abort.current?.abort()
  }

  const finish = () => {
    onClose()
    onDone()
  }

  const title = step.at === 'choose' ? 'Get selected files' : step.at.startsWith('online') ? 'Download Online' : 'Find your originals'

  return (
    <Modal open onClose={busy ? () => undefined : onClose} title={title} size="md" className="dl-modal" busy={busy}>
      {step.at === 'choose' && (
        <div className="dl-choices">
          {local ? (
            <button type="button" className="dl-choice primary" onClick={() => setStep({ at: 'local' })}>
              <i className="bi bi-hdd" aria-hidden="true" />
              <span>
                <strong>Copy from my computer</strong>
                <small>Fastest, uses your originals</small>
              </span>
            </button>
          ) : (
            <p className="dl-note" role="note">
              <i className="bi bi-info-circle" /> Copying from your computer: use Chrome or Edge on desktop.
            </p>
          )}
          <button type="button" className="dl-choice outline" onClick={() => void getOnline()} data-testid="download-from-cloud">
            <i className="bi bi-cloud-arrow-down" aria-hidden="true" />
            <span>
              <strong>Download from cloud</strong>
              <small>Full-quality originals, into a folder</small>
            </span>
          </button>
          <p className="dl-note-online" data-testid="online-note">
            <i className="bi bi-info-circle" /> The client picked from 80–85% copies; you get the originals, each checked before it is saved.
          </p>
          <p className="dl-count">
            {selection.pickedCount} selected {selection.pickedCount === 1 ? 'photo' : 'photos'}
          </p>
        </div>
      )}

      {step.at === 'local' && (
        <div className="dl-local">
          <p className="dl-sub">Choose the main folder where this shoot’s originals are saved</p>
          <button type="button" className="dl-back" onClick={() => setStep({ at: 'choose' })}>
            <i className="bi bi-arrow-left" /> Back
          </button>
          <p className="dl-hint">Pick the top folder. We’ll look inside every subfolder.</p>
          {local ? (
            <button type="button" className="dl-pick" onClick={() => void copyLocal()} data-testid="select-original-folder">
              <i className="bi bi-folder2-open" /> Choose folder
            </button>
          ) : (
            <p className="dl-note">Use Chrome or Edge on desktop.</p>
          )}
          <p className="dl-fine">
            Matching photos are copied into a new “Selected - …” folder inside it. Your originals are never moved or changed.
          </p>
        </div>
      )}

      {step.at === 'scanning' && (
        <div className="dl-progress" role="status">
          <span className="cp-spinner" aria-hidden="true" />
          <p>Looking through the folder… {step.found.toLocaleString('en-IN')} files</p>
        </div>
      )}

      {step.at === 'copying' && (
        <div className="dl-progress">
          <p aria-live="polite">
            Copying {step.done} of {step.total}…
          </p>
          <div className="uf-track big" role="progressbar" aria-valuenow={step.done} aria-valuemin={0} aria-valuemax={step.total} aria-label="Copy progress">
            <span style={{ width: `${(step.done / Math.max(1, step.total)) * 100}%` }} />
          </div>
          <button type="button" className="dl-text-btn" onClick={() => (stop.current.cancelled = true)}>
            Stop
          </button>
        </div>
      )}

      {step.at === 'copied' && (
        <div className="dl-summary" data-testid="copy-summary">
          <i className={`bi bi-${step.copied ? 'check-circle-fill ok' : 'exclamation-circle warn'}`} aria-hidden="true" />
          <p className="dl-result">
            <strong>{step.copied} copied</strong> · <strong>{step.missing.length} not found</strong>
          </p>
          {step.copied > 0 && (
            <p className="dl-fine dl-saved">
              Saved in the folder{' '}
              <span className="dl-folder-name" title={step.folder}>
                “{step.folder}”
              </span>
            </p>
          )}
          <div className="dl-actions">
            {step.missing.length > 0 && (
              <button
                type="button"
                className="ef-btn outline"
                onClick={() => saveText(`${selection.event.title} - missing photos.txt`.replace(/[\\/:*?"<>|]+/g, '-'), missingListText(selection.event.title, step.missing))}
              >
                <i className="bi bi-file-earmark-text" /> Download missing list (.txt)
              </button>
            )}
            {step.copied > 0 ? (
              <button type="button" className="ef-btn solid" onClick={finish}>
                View Selected Photos
              </button>
            ) : (
              <button type="button" className="ef-btn solid" onClick={() => setStep({ at: 'local' })}>
                Choose another folder
              </button>
            )}
          </div>
        </div>
      )}

      {step.at === 'online' && (
        <div className="dl-progress">
          <p aria-live="polite">
            Downloading and checking originals… {step.done} of {step.total}
          </p>
          <div className="uf-track big" role="progressbar" aria-valuenow={step.done} aria-valuemin={0} aria-valuemax={step.total} aria-label="Download progress">
            <span style={{ width: `${(step.done / Math.max(1, step.total)) * 100}%` }} />
          </div>
          <button type="button" className="dl-text-btn" onClick={cancelOnline}>
            Cancel
          </button>
        </div>
      )}

      {step.at === 'online-failed' && (
        <div className="dl-summary">
          <i className="bi bi-exclamation-triangle warn" aria-hidden="true" />
          <p className="dl-result">The download didn’t finish</p>
          <p className="dl-fine">{step.message}</p>
          <div className="dl-actions">
            <button type="button" className="ef-btn outline" onClick={() => setStep({ at: 'choose' })}>
              <i className="bi bi-arrow-left" /> Back
            </button>
            <button type="button" className="ef-btn solid" onClick={() => void getOnline()}>
              <i className="bi bi-arrow-clockwise" /> Retry
            </button>
          </div>
        </div>
      )}

      {step.at === 'online-done' && (
        <div className="dl-summary" data-testid="cloud-summary">
          <i className={`bi bi-${step.result.saved ? 'check-circle-fill ok' : 'exclamation-circle warn'}`} aria-hidden="true" />
          <p className="dl-result">
            <strong>{step.result.saved} originals saved</strong> · <strong>{step.result.verified} verified</strong>
          </p>
          {step.folder && step.result.saved > 0 && (
            <p className="dl-fine dl-saved">
              Saved in the folder{' '}
              <span className="dl-folder-name" title={step.folder}>
                “{step.folder}”
              </span>
            </p>
          )}
          {step.result.notInCloud.length > 0 && (
            <p className="dl-fine">
              {step.result.notInCloud.length} {step.result.notInCloud.length === 1 ? 'original isn’t' : 'originals aren’t'} in the cloud: use Copy from my computer for{' '}
              {step.result.notInCloud.length === 1 ? 'it' : 'them'}.
            </p>
          )}
          {step.result.failed.length > 0 && (
            <p className="dl-fine">{step.result.failed.length} didn’t download or didn’t match the uploaded original. Try again.</p>
          )}
          <div className="dl-actions">
            {step.result.notInCloud.length + step.result.failed.length > 0 && (
              <button
                type="button"
                className="ef-btn outline"
                onClick={() =>
                  saveText(`${selection.event.title} - missing photos.txt`.replace(/[\\/:*?"<>|]+/g, '-'), missingListText(selection.event.title, [...step.result.notInCloud, ...step.result.failed]))
                }
              >
                <i className="bi bi-file-earmark-text" /> Download missing list (.txt)
              </button>
            )}
            <button type="button" className="ef-btn solid" onClick={finish}>
              View Selected Photos
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
