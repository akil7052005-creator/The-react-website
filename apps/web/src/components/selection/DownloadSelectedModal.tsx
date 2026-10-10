import { useQueryClient } from '@tanstack/react-query'
import type { SelectionDto, SelectionFolderDto, StudioSelectionPhotoDto } from '@weddyzone/shared'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import { toastError } from '../../lib/query'
import { Modal } from '../Modal'
import {
  canCopyLocally,
  copyFolderName,
  copyMatches,
  hashFile,
  matchExact,
  missingListText,
  PermissionNeeded,
  pickedListText,
  pickOriginalsFolder,
  saveText,
  scanFolder,
  type SelectedPhoto,
} from './localCopy'
import { refreshSelection } from './selectionUi'

type Step =
  | { at: 'choose' }
  | { at: 'scanning'; found: number }
  | { at: 'matching'; done: number; total: number }
  | { at: 'copying'; done: number; total: number }
  | { at: 'copied'; copied: number; missing: SelectedPhoto[]; folder: string }

const PERMISSION_MSG = 'Permission needed to copy selected photos'

/** The client's picks, with what was recorded about each original when it was uploaded. */
async function selectedPhotos(selection: SelectionDto, folders: SelectionFolderDto[]): Promise<SelectedPhoto[]> {
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
      relativePath: p.relativePath ?? null,
      sha256: p.sha256 ?? null,
    }))
}

/**
 * Download Selected. Originals are never stored online, so they come from the studio's own
 * computer: on desktop Chrome / Edge, "Copy from my computer" finds each pick in the original folder
 * (by fingerprint first) and copies the exact file into "Selected - <Customer> - <Event> - <date>".
 * Elsewhere (phones, tablets, other browsers) it explains that and offers the list of picked file
 * names. A copy marks the selection Downloaded.
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
  /** After a copy: open the Selected Photos view. */
  onDone: () => void
}) {
  const qc = useQueryClient()
  const [step, setStep] = useState<Step>({ at: 'choose' })
  const local = canCopyLocally()
  const stop = useRef({ cancelled: false })
  const busy = step.at === 'scanning' || step.at === 'matching' || step.at === 'copying'

  const markDownloaded = async () => {
    try {
      await api.post(`/selections/${selection.id}/deliver`)
    } catch (e) {
      toastError(e)
    }
    refreshSelection(qc, selection.id)
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
      const selected = await selectedPhotos(selection, folders)
      const files = await scanFolder(root, (found) => setStep({ at: 'scanning', found }))
      let hashed = 0
      setStep({ at: 'matching', done: 0, total: selected.length })
      const { matched, missing } = await matchExact(selected, files, async (f) => {
        const h = await hashFile(f.handle)
        setStep({ at: 'matching', done: Math.min(++hashed, selected.length), total: selected.length })
        return h
      })
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
      setStep({ at: 'choose' })
    }
  }

  /** Phones and unsupported browsers: the picked file names, to find them on the computer later. */
  const copyList = async () => {
    try {
      const text = pickedListText(selection.event.title, await selectedPhotos(selection, folders))
      try {
        await navigator.clipboard.writeText(text)
        toast.success('List of picked file names copied')
      } catch {
        saveText(`${selection.event.title} - picked photos.txt`.replace(/[\\/:*?"<>|]+/g, '-'), text)
      }
    } catch (e) {
      toastError(e)
    }
  }

  const finish = () => {
    onClose()
    onDone()
  }

  return (
    <Modal open onClose={busy ? () => undefined : onClose} title={step.at === 'choose' ? 'Get selected files' : 'Copy from my computer'} size="md" className="dl-modal" busy={busy}>
      {step.at === 'choose' && (
        <div className="dl-choices">
          {local ? (
            <>
              <p className="dl-sub">Choose the main folder where this shoot’s originals are saved</p>
              <button type="button" className="dl-choice primary" onClick={() => void copyLocal()} data-testid="select-original-folder">
                <i className="bi bi-hdd" aria-hidden="true" />
                <span>
                  <strong>Copy from my computer</strong>
                  <small>Pick the top folder. We look inside every subfolder.</small>
                </span>
              </button>
              <p className="dl-fine">The exact originals are copied into a new “Selected - …” folder inside it. Your originals are never moved or changed.</p>
            </>
          ) : (
            <>
              <p className="dl-note" role="note" data-testid="copy-desktop-only">
                <i className="bi bi-info-circle" /> Copying the original photos works on a laptop/desktop (Chrome or Edge) where the original folder is saved.
              </p>
              <button type="button" className="dl-choice outline" onClick={() => void copyList()} data-testid="copy-picked-list">
                <i className="bi bi-clipboard" aria-hidden="true" />
                <span>
                  <strong>Copy list of picked file names</strong>
                  <small>To find them on your computer later</small>
                </span>
              </button>
            </>
          )}
          <p className="dl-count">
            {selection.pickedCount} selected {selection.pickedCount === 1 ? 'photo' : 'photos'}
          </p>
        </div>
      )}

      {step.at === 'scanning' && (
        <div className="dl-progress" role="status">
          <span className="cp-spinner" aria-hidden="true" />
          <p>Looking through the folder… {step.found.toLocaleString('en-IN')} files</p>
        </div>
      )}

      {step.at === 'matching' && (
        <div className="dl-progress" role="status">
          <span className="cp-spinner" aria-hidden="true" />
          <p>Matching the picks to your originals…</p>
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
          {step.missing.length > 0 && (
            <ul className="dl-missing" data-testid="missing-list">
              {step.missing.slice(0, 8).map((p) => (
                <li key={p.id}>{p.relativePath ?? (p.folder ? `${p.folder}/${p.originalName}` : p.originalName)}</li>
              ))}
              {step.missing.length > 8 && <li>…and {step.missing.length - 8} more</li>}
            </ul>
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
              <button type="button" className="ef-btn solid" onClick={() => setStep({ at: 'choose' })}>
                Choose another folder
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
