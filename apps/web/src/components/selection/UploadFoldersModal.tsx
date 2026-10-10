import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ONLINE_BYTES_PER_PHOTO, type SelectionFolderDto, type UploadCompleteDto, type UploadLimitsDto, type UploadSign, type UploadSignDto } from '@weddyzone/shared'
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { api, isApiError } from '../../lib/api'
import { fileUrl } from '../../lib/env'
import { Modal } from '../Modal'
import { Spinner } from '../ui'
import { rejectReason, relativePathOf, scanInputFiles, targetsOf, toRow, type FolderRow, type PickedFolder, type SkippedFile } from './folderUpload'
import { refreshSelection } from './selectionUi'
import { copiesOf, stopCopyPool, uploadConcurrency } from './upload/copyPool'
import { etaLabel, UploadQueue, type ItemResult, type QueueItem, type QueueProgress } from './upload/uploadQueue'
import { fileKey, progressWriter, uploadStore, type SavedUpload } from './upload/uploadStore'

export const UPLOAD_LIMITS_KEY = ['upload-limits'] as const

/** "1.2 GB", "96 MB", "480 KB". */
export function formatBytes(n: number) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

/** The reminder shown in the upload box and on the event page. */
export const ORIGINALS_REMINDER = 'Originals are not stored online. Keep your original folder on this computer until delivery.'

interface RowProgress {
  done: number
  uploaded: number
  failed: { name: string; error: string }[]
  skipped: SkippedFile[]
}
const emptyRow = (): RowProgress => ({ done: 0, uploaded: 0, failed: [], skipped: [] })

/** PUT to a signed link (storage, or the API itself without a bucket). Rejects with { status }. */
async function putBlob(url: string, blob: Blob, headers: Record<string, string>) {
  let res: Response
  try {
    res = await fetch(url.startsWith('http') ? url : fileUrl(url)!, { method: 'PUT', body: blob, headers })
  } catch {
    throw { status: 0, message: 'Network error' }
  }
  if (!res.ok) throw { status: res.status, message: `Upload failed (${res.status})` }
}

const waitOnline = () => new Promise<void>((resolve) => window.addEventListener('online', () => resolve(), { once: true }))

export interface UploadFoldersHandle {
  /** Opens the folder picker. Call it straight from the click that opens the dialog. */
  pick: () => void
}

/**
 * "Select Folders to Upload": pick a folder (its subfolders become albums), see each album with its
 * photo count and the size online, then upload. Each photo becomes a 2048 px preview and a 400 px
 * thumbnail in the browser (Web Workers), uploaded straight to storage with signed links; the
 * original never leaves this computer. Pause, resume, cancel; offline pauses on its own; a closed
 * tab can resume (progress is kept in IndexedDB, the folder is picked again).
 */
export function UploadFoldersModal({
  ref,
  open,
  onClose,
  selectionId,
  folders,
}: {
  ref?: Ref<UploadFoldersHandle>
  open: boolean
  onClose: () => void
  selectionId: string
  /** The event's folders now, for the duplicate check. */
  folders: SelectionFolderDto[]
}) {
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<FolderRow[]>([])
  const [rowProgress, setRowProgress] = useState<Record<string, RowProgress>>({})
  const [progress, setProgress] = useState<QueueProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [finished, setFinished] = useState<{ uploaded: number; skipped: SkippedFile[]; failed: number } | null>(null)
  const [stopped, setStopped] = useState<{ message: string; upgrade: boolean } | null>(null)
  /** An unfinished upload of this event, offered on opening. */
  const [saved, setSaved] = useState<SavedUpload | null>(null)
  const [resuming, setResuming] = useState<SavedUpload | null>(null)
  const queue = useRef<UploadQueue | null>(null)
  const keySeq = useRef(0)
  const limitsQ = useQuery({ queryKey: UPLOAD_LIMITS_KEY, queryFn: () => api.get<UploadLimitsDto>('/me/upload-limits') })

  // An unfinished upload of this event? Offer to resume it.
  useEffect(() => {
    if (!open || busy) return
    let live = true
    void uploadStore.get(selectionId).then((u) => {
      if (live) setSaved(u && u.done.length < u.total ? u : null)
    })
    return () => {
      live = false
    }
  }, [open, selectionId, busy])

  // Leaving the page mid-upload stops it (it can be resumed later).
  useEffect(() => {
    if (!busy) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    const online = () => queue.current?.setOnline(true)
    const offline = () => queue.current?.setOnline(false)
    window.addEventListener('beforeunload', warn)
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => {
      window.removeEventListener('beforeunload', warn)
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }, [busy])

  useEffect(() => () => stopCopyPool(), [])

  const addFolders = (picked: PickedFolder[], resume: SavedUpload | null) => {
    const limits = limitsQ.data
    setRows((current) => {
      const next = [...current]
      for (const p of picked) {
        const row = toRow(p, `f${++keySeq.current}`)
        // Resuming: the folders from the first attempt already exist in the event, and that's fine.
        const existing = resume ? folders.filter((f) => !resume.folders.includes(f.name)).map((f) => f.name) : folders.map((f) => f.name)
        const reason = rejectReason(
          row,
          next.map((r) => r.name),
          existing,
        )
        if (reason) {
          toast.error(reason.message, { id: `reject-${row.name}`, description: reason.name })
          continue
        }
        if (limits) {
          const total = next.reduce((n, r) => n + r.files.length, 0) + row.files.length
          if (total > limits.maxFilesPerUpload) {
            toast.error(`Your ${limits.planName} plan uploads up to ${limits.maxFilesPerUpload.toLocaleString('en-IN')} photos at a time. Upload '${row.name}' separately.`)
            continue
          }
        }
        next.push(row)
      }
      return next
    })
  }

  /** Opens the folder picker. Called straight from the click, so the browser allows it. */
  const pick = () => {
    if (busy) return
    input.current?.click()
  }
  useImperativeHandle(ref, () => ({ pick }))

  const reset = () => {
    setRows([])
    setRowProgress({})
    setProgress(null)
    setFinished(null)
    setStopped(null)
    setResuming(null)
  }

  const close = () => {
    if (busy) return
    reset()
    onClose()
  }

  /** The event folder for each picked folder: reused when it exists (resume), else created. */
  const folderIds = async (list: FolderRow[]) => {
    const ids: Record<string, string> = {}
    const now = await api.get<SelectionFolderDto[]>(`/selections/${selectionId}/folders`).catch(() => folders)
    for (const r of list) {
      const target = targetsOf(r).find((t) => t.type === 'photo')
      if (!target) continue
      const found = now.find((f) => f.type === 'photo' && f.name.trim().toLowerCase() === target.name.trim().toLowerCase())
      ids[r.key] = found ? found.id : (await api.post<SelectionFolderDto>(`/selections/${selectionId}/folders`, { name: target.name, type: 'photo' })).id
    }
    return ids
  }

  /** Start Upload: any unexpected failure ends the upload with an error toast instead of a stuck dialog. */
  const start = async () => {
    if (!rows.length || busy) return
    setBusy(true)
    setFinished(null)
    setStopped(null)
    try {
      await run()
    } catch (e) {
      toast.error('Upload failed', { description: isApiError(e) ? e.message : (e as Error).message || 'Something went wrong. Please try again.' })
    } finally {
      setBusy(false)
      queue.current = null
      refreshSelection(qc, selectionId)
      void qc.invalidateQueries({ queryKey: UPLOAD_LIMITS_KEY })
    }
  }

  const run = async () => {
    const ids = await folderIds(rows)
    const resume = resuming
    const doneKeys = new Set(resume?.done ?? [])
    const rowOf = new Map<string, string>()
    const items: QueueItem[] = []
    let alreadyDone = 0
    for (const r of rows) {
      for (const f of r.files) {
        const relativePath = relativePathOf(f)
        const key = fileKey({ relativePath, size: f.size, lastModified: f.lastModified })
        if (doneKeys.has(key)) {
          alreadyDone++
          continue
        }
        rowOf.set(key, r.key)
        items.push({ key, file: f, relativePath, folderId: ids[r.key] ?? null, photoId: resume?.inflight[key] })
      }
    }
    const total = items.length + alreadyDone
    const writer = progressWriter({ selectionId, total, done: [...doneKeys], inflight: { ...(resume?.inflight ?? {}) }, folders: rows.map((r) => r.name) })
    writer.flush()

    const perRow: Record<string, RowProgress> = Object.fromEntries(rows.map((r) => [r.key, emptyRow()]))
    setRowProgress({ ...perRow })
    const skippedAll: SkippedFile[] = []
    const onItem = (r: ItemResult) => {
      const rk = rowOf.get(r.key)!
      const p = perRow[rk]
      const name = r.key.split('|')[0]
      p.done++
      if (r.outcome === 'uploaded') p.uploaded++
      else if (r.outcome === 'skipped') {
        p.skipped.push({ name, reason: r.reason })
        skippedAll.push({ name, reason: r.reason })
      } else p.failed.push({ name, error: r.error })
      if (r.outcome !== 'failed') writer.finished(r.key)
      setRowProgress({ ...perRow, [rk]: { ...p } })
    }

    const q = new UploadQueue({
      selectionId,
      items,
      concurrency: uploadConcurrency(),
      deps: {
        copies: copiesOf,
        sign: (body: UploadSign) => api.post<UploadSignDto>('/uploads/sign', body),
        complete: (body) => api.post<UploadCompleteDto>('/uploads/complete', body),
        put: putBlob,
        isOnline: () => navigator.onLine !== false,
        waitOnline,
      },
      onProgress: (p) => setProgress({ ...p, done: p.done + alreadyDone, total }),
      onItem,
      onSigned: (key, photoId) => writer.signed(key, photoId),
    })
    queue.current = q
    setProgress({ ...q.state, done: alreadyDone, total })
    const outcome = await q.run()
    writer.flush()
    const s = q.state

    if (outcome.cancelled) {
      toast.info(`Upload cancelled — ${s.uploaded} of ${items.length} photos uploaded`, { description: 'Open Upload Folder again to resume.' })
      reset()
      onClose()
      return
    }
    if (outcome.stopped) {
      const upgrade = outcome.stopped.code === 'PLAN_LIMIT'
      setStopped({ message: outcome.stopped.message, upgrade })
      return
    }
    // Files that aren't photos (notes, .xmp sidecars…) are ignored quietly; only photos that couldn't go up are listed.
    const skipped = skippedAll
    setFinished({ uploaded: s.uploaded + alreadyDone, skipped, failed: s.failed })
    if (!s.failed) await uploadStore.clear(selectionId)
    // Retry failed: the next Start Upload skips what is already done.
    else setResuming({ ...writer.state, updatedAt: Date.now() })
    if (!s.failed && !skipped.length) {
      const n = s.uploaded + alreadyDone
      toast.success(`${n.toLocaleString('en-IN')} photo${n === 1 ? '' : 's'} uploaded`)
      reset()
      onClose()
    } else if (s.failed) {
      toast.error(`${s.failed} photo${s.failed === 1 ? '' : 's'} didn't upload`, { description: 'Start the upload again to retry them; the rest are skipped.' })
    }
  }

  const photoCount = rows.reduce((n, r) => n + r.files.length, 0)
  const originalBytes = rows.reduce((n, r) => n + r.files.reduce((m, f) => m + f.size, 0), 0)
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  const anyFailed = Object.values(rowProgress).some((p) => p.failed.length > 0)

  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        // @ts-expect-error non-standard attributes for picking a folder
        webkitdirectory=""
        directory=""
        aria-label="Choose a folder to upload"
        data-testid="folder-input"
        onChange={(e) => {
          if (e.target.files?.length) {
            const { folders: picked } = scanInputFiles(e.target.files)
            if (picked.length) addFolders(picked, resuming)
            else toast.error('No photos to upload', { description: 'Empty folders, hidden files and “Selected - …” folders are skipped.' })
          }
          e.target.value = ''
        }}
      />
      <Modal open={open} onClose={close} title={busy ? 'Uploading' : 'Select Folders to Upload'} className="uf-modal" size="lg" busy={busy}>
        {saved && !busy && !resuming && rows.length === 0 && (
          <div className="uf-resume" role="status" data-testid="upload-resume">
            <i className="bi bi-arrow-repeat" aria-hidden="true" />
            <span>
              <strong>
                Resume {saved.done.length.toLocaleString('en-IN')} of {saved.total.toLocaleString('en-IN')}?
              </strong>{' '}
              Pick the same folder{saved.folders.length ? ` (${saved.folders.slice(0, 3).join(', ')}${saved.folders.length > 3 ? '…' : ''})` : ''} again: photos already uploaded are skipped.
            </span>
            <div className="uf-resume-actions">
              <button
                type="button"
                className="uf-pill"
                onClick={() => {
                  setResuming(saved)
                  pick()
                }}
              >
                Resume
              </button>
              <button
                type="button"
                className="uf-pill ghost"
                onClick={() => {
                  void uploadStore.clear(selectionId)
                  setSaved(null)
                }}
              >
                Discard
              </button>
            </div>
          </div>
        )}

        {busy && progress && (
          <div className="uf-live" data-testid="upload-progress">
            <div className="uf-live-head">
              <strong aria-live="polite">
                Uploading {progress.done.toLocaleString('en-IN')} / {progress.total.toLocaleString('en-IN')}
                {progress.etaSeconds !== null && !progress.paused ? ` · ${etaLabel(progress.etaSeconds)}` : ''}
              </strong>
              <span>{progress.offline ? 'Offline' : progress.paused ? 'Paused' : `${pct}%`}</span>
            </div>
            <div className="uf-track big" role="progressbar" aria-valuenow={progress.done} aria-valuemin={0} aria-valuemax={progress.total} aria-label="Upload progress">
              <span style={{ width: `${pct}%` }} />
            </div>
            {progress.offline && (
              <p className="uf-offline" role="alert">
                <i className="bi bi-wifi-off" aria-hidden="true" /> You’re offline. The upload is paused and continues when you’re back online.
              </p>
            )}
            <div className="uf-live-actions">
              {progress.paused ? (
                <button type="button" className="uf-pill" onClick={() => queue.current?.resume()} disabled={progress.offline}>
                  <i className="bi bi-play-fill" /> Resume
                </button>
              ) : (
                <button type="button" className="uf-pill ghost" onClick={() => queue.current?.pause()}>
                  <i className="bi bi-pause-fill" /> Pause
                </button>
              )}
              <button type="button" className="uf-pill ghost danger" onClick={() => queue.current?.cancel()}>
                <i className="bi bi-x-lg" /> Cancel
              </button>
            </div>
          </div>
        )}

        {stopped && (
          <p className="notice danger" role="alert" data-testid="upload-stopped">
            <i className="bi bi-exclamation-octagon" aria-hidden="true" />
            <span>
              {stopped.message}{' '}
              {stopped.upgrade && (
                <Link to="/subscriptions" className="uf-upgrade">
                  Upgrade
                </Link>
              )}
            </span>
          </p>
        )}

        {finished && (
          <div className="uf-done" data-testid="upload-summary">
            <strong>
              {finished.uploaded.toLocaleString('en-IN')} uploaded · {finished.skipped.length.toLocaleString('en-IN')} skipped
              {finished.failed ? ` · ${finished.failed} failed` : ''}
            </strong>
            {finished.skipped.length > 0 && (
              <details className="uf-skipped">
                <summary>Show list</summary>
                <ul>
                  {finished.skipped.map((f, i) => (
                    <li key={`${f.name}-${i}`}>
                      {f.name}: {f.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        <div className="uf-bar">
          <strong>Albums ({rows.length})</strong>
          <button type="button" className="uf-add" onClick={pick} disabled={busy}>
            <i className="bi bi-images" /> Add Photo Folder
          </button>
        </div>
        <div className="uf-box" data-testid="selected-folders">
          {rows.map((r) => {
            const p = rowProgress[r.key]
            return (
              <div key={r.key} className={`uf-row${p?.failed.length ? ' has-error' : ''}`}>
                <div className="uf-row-main">
                  <i className="bi bi-folder-fill uf-folder" aria-hidden="true" />
                  <strong className="uf-name" title={r.name} aria-label={r.name}>
                    {r.name}
                  </strong>
                  <span className="uf-count">{r.files.length.toLocaleString('en-IN')} photos</span>
                  {p ? (
                    <span className={`uf-progress-text${p.done === r.files.length ? ' ok' : ''}`}>
                      {p.done === r.files.length ? <i className="bi bi-check-circle-fill" /> : null} {p.done}/{r.files.length}
                    </span>
                  ) : (
                    <button type="button" className="uf-remove" onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))} disabled={busy} aria-label={`Remove ${r.name}`}>
                      ✖ Remove
                    </button>
                  )}
                </div>
                {p && (
                  <div className="uf-track" role="progressbar" aria-valuenow={p.done} aria-valuemin={0} aria-valuemax={r.files.length} aria-label={`${r.name} upload`}>
                    <span style={{ width: `${(p.done / Math.max(1, r.files.length)) * 100}%` }} />
                  </div>
                )}
                {p && p.failed.length > 0 && (
                  <ul className="uf-failed">
                    {p.failed.slice(0, 5).map((f) => (
                      <li key={f.name}>
                        <i className="bi bi-exclamation-circle" /> {f.name}: {f.error}
                      </li>
                    ))}
                    {p.failed.length > 5 && <li>…and {p.failed.length - 5} more</li>}
                  </ul>
                )}
              </div>
            )
          })}
        </div>

        {rows.length > 0 && !busy && !finished && (
          <p className="uf-summary" data-testid="upload-estimate">
            <i className="bi bi-cloud-arrow-up" aria-hidden="true" /> {photoCount.toLocaleString('en-IN')} photos · about {formatBytes(photoCount * ONLINE_BYTES_PER_PHOTO)} online (originals{' '}
            {formatBytes(originalBytes)} stay on this computer)
          </p>
        )}
        <p className="uf-hint">
          <i className="bi bi-info-circle" /> Each subfolder becomes an album. Duplicate folder names and already existing folders will be automatically prevented.
        </p>
        <p className="uf-hint uf-mode" data-testid="upload-mode">
          <i className="bi bi-shield-lock" /> {ORIGINALS_REMINDER}
        </p>
        <div className="uf-foot">
          <button type="button" className="uf-pill ghost" onClick={close} disabled={busy}>
            {finished ? 'Close' : 'Cancel'}
          </button>
          <button type="button" className="uf-pill" onClick={() => void start()} disabled={busy || rows.length === 0} data-testid="start-upload">
            {busy ? <Spinner size={14} /> : <i className={`bi bi-${anyFailed ? 'arrow-clockwise' : 'upload'}`} />} {busy ? `Uploading ${pct}%` : anyFailed ? 'Retry failed' : 'Start Upload'}
          </button>
        </div>
      </Modal>
    </>
  )
}
