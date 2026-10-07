import { useQueryClient } from '@tanstack/react-query'
import type { SelectionDto, SelectionFolderDto, StudioSelectionPhotoDto } from '@weddyzone/shared'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { API_BASE } from '../../lib/env'
import { toastError } from '../../lib/query'
import { Modal } from '../Modal'
import { fetchVerified, safeName, uniqueName, type CloudPick } from './cloudReturn'
import { refreshSelection } from './selectionUi'
import '../../styles/mobile-download.css'

// Download Selected on a phone or tablet. Phones have no folder picker, so "Download from cloud"
// saves the picks' full-quality originals to the phone itself: through the share sheet (iPhone
// "Save Images" / "Save to Files", Android Gallery / Files) in batches of 10, or as separate
// downloads where sharing files isn't supported. Same originals, checks and "mark as downloaded"
// call as on a computer; DownloadSelectedModal opens this only when isPhone().

/** A phone or tablet: no folder picker, and a touch screen or a narrow window. */
export function isPhone() {
  if (typeof window === 'undefined') return false
  return !('showDirectoryPicker' in window) && (window.matchMedia?.('(pointer:coarse)').matches || window.innerWidth < 900)
}

const BATCH = 10
const DOWNLOAD_GAP_MS = 400
const WIFI_WARN_BYTES = 300 * 1024 * 1024
const HINT_KEY = 'wz-multi-download-hint'

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  gif: 'image/gif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
}
const mimeOf = (name: string) => MIME[(name.split('.').pop() ?? '').toLowerCase()] ?? 'application/octet-stream'

const formatMb = (bytes: number) => `${Math.round(bytes / (1024 * 1024)).toLocaleString('en-IN')} MB`

/** The share sheet can take these files (iPhone Safari, most Android browsers). */
function canShareFiles(files: File[]) {
  try {
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files })
  } catch {
    return false
  }
}

function downloadFile(file: File) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file)
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Step =
  | { at: 'choose' }
  | { at: 'wifi'; picks: CloudPick[]; notInCloud: CloudPick[]; bytes: number }
  | { at: 'saving'; done: number; total: number; paused: boolean }
  /** A batch is ready: the share sheet needs a tap of its own. */
  | { at: 'tap'; batch: number; batches: number; retry: boolean; done: number; total: number }
  | { at: 'done'; saved: number; failed: CloudPick[]; notInCloud: CloudPick[] }

type TapResult = 'shared' | 'dismissed' | 'unsupported' | 'cancel'

export function MobileDownload({
  selection,
  folders,
  onClose,
  onDone,
}: {
  selection: SelectionDto
  folders: SelectionFolderDto[]
  onClose: () => void
  onDone: () => void
}) {
  const qc = useQueryClient()
  const [step, setStep] = useState<Step>({ at: 'choose' })
  const [hint, setHint] = useState(false)
  const ctrl = useRef({ cancelled: false, paused: false, resume: null as null | (() => void) })
  const abort = useRef<AbortController | null>(null)
  /** The batch waiting for a tap, and how to report what the share sheet did. */
  const pending = useRef<{ files: File[]; resolve: (r: TapResult) => void } | null>(null)
  useEffect(
    () => () => {
      abort.current?.abort()
      pending.current?.resolve('cancel')
    },
    [],
  )

  const busy = step.at === 'saving' || step.at === 'tap' || step.at === 'wifi'

  /** The client's picks with where each original is kept (same list the computer flow uses). */
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

  /** Same "mark as downloaded" call as on a computer. */
  const markDownloaded = async () => {
    try {
      await api.post(`/selections/${selection.id}/deliver`)
    } catch (e) {
      toastError(e)
    }
    refreshSelection(qc, selection.id)
  }

  const waitWhilePaused = async () => {
    while (ctrl.current.paused && !ctrl.current.cancelled) await new Promise<void>((r) => (ctrl.current.resume = r))
  }

  /** Saves `picks` (all in the cloud) to the phone, 10 at a time. */
  const save = async (picks: CloudPick[], notInCloud: CloudPick[]) => {
    ctrl.current = { cancelled: false, paused: false, resume: null }
    const ac = new AbortController()
    abort.current = ac
    const get = async (url: string) => {
      const res = await fetch(`${API_BASE}${url}`, { credentials: 'include', signal: ac.signal })
      if (!res.ok) throw new Error(`Download failed (${res.status})`)
      return res.arrayBuffer()
    }
    const total = picks.length
    const batches = Math.ceil(total / BATCH)
    const taken = new Set<string>()
    const failed: CloudPick[] = []
    let saved = 0
    let done = 0
    for (let b = 0; b < batches && !ctrl.current.cancelled; b++) {
      // 1. Fetch and check this batch's originals.
      const files: File[] = []
      for (const p of picks.slice(b * BATCH, (b + 1) * BATCH)) {
        await waitWhilePaused()
        if (ctrl.current.cancelled) break
        setStep({ at: 'saving', done, total, paused: false })
        try {
          const { data } = await fetchVerified(p.originalUrl!, p.originalChecksum, get)
          const name = uniqueName(safeName(p.originalName), taken)
          files.push(new File([data], name, { type: mimeOf(name) }))
        } catch {
          if (ctrl.current.cancelled) break
          failed.push(p)
        }
        done++
      }
      if (ctrl.current.cancelled || files.length === 0) continue

      // 2. Hand them to the phone: the share sheet (one tap per batch), else separate downloads.
      let outcome: TapResult = canShareFiles(files) ? 'dismissed' : 'unsupported'
      let retry = false
      while (outcome === 'dismissed') {
        setStep({ at: 'tap', batch: b + 1, batches, retry, done, total })
        outcome = await new Promise<TapResult>((resolve) => (pending.current = { files, resolve }))
        pending.current = null
        retry = true
      }
      if (outcome === 'cancel') break
      if (outcome === 'unsupported') {
        try {
          if (!localStorage.getItem(HINT_KEY)) {
            setHint(true)
            localStorage.setItem(HINT_KEY, '1')
          }
        } catch {
          /* private mode: show the hint each time */
          setHint(true)
        }
        for (const f of files) {
          if (ctrl.current.cancelled) break
          downloadFile(f)
          await sleep(DOWNLOAD_GAP_MS)
        }
      }
      saved += files.length
    }
    abort.current = null
    if (ctrl.current.cancelled && saved === 0) {
      setStep({ at: 'choose' })
      return
    }
    setStep({ at: 'done', saved, failed, notInCloud })
    if (saved > 0) await markDownloaded()
  }

  /** "Download from cloud": the picks, a Wi-Fi warning first when they are large. */
  const start = async () => {
    try {
      const all = await selectedPhotos()
      const inCloud = all.filter((p) => p.originalUrl)
      const notInCloud = all.filter((p) => !p.originalUrl)
      const bytes = inCloud.reduce((n, p) => n + (p.size ?? 0), 0)
      if (inCloud.length === 0) {
        setStep({ at: 'done', saved: 0, failed: [], notInCloud })
        return
      }
      if (bytes > WIFI_WARN_BYTES) setStep({ at: 'wifi', picks: inCloud, notInCloud, bytes })
      else await save(inCloud, notInCloud)
    } catch (e) {
      toastError(e)
      setStep({ at: 'choose' })
    }
  }

  /** The tap that opens the share sheet (it must come straight from the tap). */
  const shareBatch = () => {
    const p = pending.current
    if (!p) return
    navigator
      .share({ files: p.files })
      .then(() => p.resolve('shared'))
      .catch((e: Error) => p.resolve(e?.name === 'AbortError' ? 'dismissed' : 'unsupported'))
  }

  const togglePause = () => {
    if (step.at !== 'saving') return
    const paused = !ctrl.current.paused
    ctrl.current.paused = paused
    if (!paused) ctrl.current.resume?.()
    setStep({ ...step, paused })
  }
  const cancel = () => {
    ctrl.current.cancelled = true
    ctrl.current.paused = false
    ctrl.current.resume?.()
    abort.current?.abort()
    pending.current?.resolve('cancel')
  }

  const finish = () => {
    onClose()
    onDone()
  }

  return (
    <Modal open onClose={busy ? () => undefined : onClose} title="Get selected files" size="md" className="dl-modal dl-mobile" busy={busy}>
      {step.at === 'choose' && (
        <div className="dl-choices">
          <button type="button" className="dl-choice primary" disabled aria-describedby="dlm-desktop-only">
            <i className="bi bi-hdd" aria-hidden="true" />
            <span>
              <strong>Copy from my computer</strong>
              <small>Fastest, uses your originals</small>
            </span>
          </button>
          <p className="dl-note" id="dlm-desktop-only" role="note">
            <i className="bi bi-info-circle" /> Available on a laptop/desktop (Chrome or Edge)
          </p>
          <button type="button" className="dl-choice outline" onClick={() => void start()} data-testid="download-from-cloud">
            <i className="bi bi-cloud-arrow-down" aria-hidden="true" />
            <span>
              <strong>Download from cloud</strong>
              <small>Full-quality originals, saved to this phone</small>
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

      {step.at === 'wifi' && (
        <div className="dlm-panel">
          <p className="notice warning" role="note">
            <i className="bi bi-wifi" aria-hidden="true" />
            <span>
              These {step.picks.length} originals are about <strong>{formatMb(step.bytes)}</strong>. Use Wi-Fi if you can.
            </span>
          </p>
          <div className="dlm-actions">
            <button type="button" className="ef-btn outline" onClick={() => setStep({ at: 'choose' })}>
              Back
            </button>
            <button type="button" className="ef-btn solid" onClick={() => void save(step.picks, step.notInCloud)}>
              Continue
            </button>
          </div>
        </div>
      )}

      {step.at === 'saving' && (
        <div className="dl-progress dlm-panel">
          <p aria-live="polite">{step.paused ? `Paused at ${step.done} of ${step.total}` : `Saving ${Math.min(step.done + 1, step.total)} of ${step.total}…`}</p>
          <div className="uf-track big" role="progressbar" aria-valuenow={step.done} aria-valuemin={0} aria-valuemax={step.total} aria-label="Save progress">
            <span style={{ width: `${(step.done / Math.max(1, step.total)) * 100}%` }} />
          </div>
          <div className="dlm-actions">
            <button type="button" className="ef-btn outline" onClick={togglePause}>
              <i className={`bi bi-${step.paused ? 'play-fill' : 'pause-fill'}`} /> {step.paused ? 'Resume' : 'Pause'}
            </button>
            <button type="button" className="ef-btn outline" onClick={cancel}>
              <i className="bi bi-x-lg" /> Cancel
            </button>
          </div>
        </div>
      )}

      {step.at === 'tap' && (
        <div className="dlm-panel">
          <p className="dlm-batch" aria-live="polite">
            {step.retry
              ? `Batch ${step.batch} of ${step.batches} wasn’t saved. Tap to try again`
              : step.batch === 1
                ? `Batch 1 of ${step.batches} ready. Tap to save`
                : `Batch ${step.batch - 1} of ${step.batches} saved. Tap to continue`}
          </p>
          <p className="dl-fine">iPhone: choose “Save Images” (Photos) or “Save to Files”. Android: choose Gallery or Files.</p>
          <div className="uf-track big" role="progressbar" aria-valuenow={step.done} aria-valuemin={0} aria-valuemax={step.total} aria-label="Save progress">
            <span style={{ width: `${(step.done / Math.max(1, step.total)) * 100}%` }} />
          </div>
          <div className="dlm-actions">
            <button type="button" className="ef-btn outline" onClick={cancel}>
              <i className="bi bi-x-lg" /> Cancel
            </button>
            <button type="button" className="ef-btn solid" onClick={shareBatch} data-testid="save-batch">
              <i className="bi bi-download" /> Save batch {step.batch} of {step.batches}
            </button>
          </div>
        </div>
      )}

      {step.at === 'done' && (
        <div className="dl-summary dlm-panel" data-testid="mobile-summary">
          <i className={`bi bi-${step.saved ? 'check-circle-fill ok' : 'exclamation-circle warn'}`} aria-hidden="true" />
          <p className="dl-result">
            <strong>
              {step.saved} {step.saved === 1 ? 'photo' : 'photos'} saved to this phone
            </strong>
          </p>
          {step.notInCloud.length > 0 && (
            <p className="dl-fine">
              {step.notInCloud.length} {step.notInCloud.length === 1 ? 'original isn’t' : 'originals aren’t'} in the cloud: get{' '}
              {step.notInCloud.length === 1 ? 'it' : 'them'} with Copy from my computer on a laptop/desktop.
            </p>
          )}
          {step.failed.length > 0 && <p className="dl-fine">{step.failed.length} didn’t download or didn’t match the uploaded original.</p>}
          <div className="dlm-actions">
            {step.failed.length > 0 && (
              <button type="button" className="ef-btn outline" onClick={() => void save(step.failed, step.notInCloud)}>
                <i className="bi bi-arrow-clockwise" /> Retry failed
              </button>
            )}
            <button type="button" className="ef-btn solid" onClick={finish}>
              View Selected Photos
            </button>
          </div>
        </div>
      )}

      {hint && step.at !== 'choose' && (
        <p className="notice" role="note" data-testid="multi-download-hint" style={{ marginTop: 12 }}>
          <i className="bi bi-info-circle" aria-hidden="true" />
          <span>If your browser asks, tap “Allow” to download multiple files. Photos go to your Downloads folder.</span>
        </p>
      )}
    </Modal>
  )
}
