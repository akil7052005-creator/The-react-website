import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { EventSettings, SelectionFolderDto, UploadLimitsDto } from '@weddyzone/shared'
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { toast } from 'sonner'
import { api, isApiError, upload } from '../../lib/api'
import { Modal } from '../Modal'
import { withRetries } from '../photoUpload'
import { Spinner } from '../ui'
import { compressForUpload, formatBytes, type UploadCopy } from './compressForUpload'
import { folderPathOf, groupInputFiles, isHeic, isRaw, mediaOf, rejectReason, targetsOf, toRow, type FolderRow, type PickedFolder } from './folderUpload'
import { Undecodable } from './imageCompress'
import { refreshSelection } from './selectionUi'

export const UPLOAD_LIMITS_KEY = ['upload-limits'] as const
/** Files sent at the same time. */
const CONCURRENCY = 4
const MB = 1024 * 1024

interface Progress {
  done: number
  failed: { name: string; error: string; index: number }[]
  /** Files that can't be uploaded at all (e.g. a RAW file without a readable preview). */
  skipped: { name: string; reason: string }[]
  state: 'ready' | 'uploading' | 'done' | 'error'
  /** The event folders this picked folder goes into: photos and videos are kept apart. */
  folderIds?: { photo?: string; video?: string }
}

const emptyProgress = (): Progress => ({ done: 0, failed: [], skipped: [], state: 'ready' })

/** Thrown for a file to leave out (listed at the end), not retry. */
class Skip extends Error {}

/** SHA-256 (hex) of a file, so the server can verify the original arrived intact; null where the browser can't (plain http). */
export async function sha256Hex(file: Blob): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The file to send for one picked file, and what to record about its original. */
async function uploadCopyOf(original: File, compress: boolean): Promise<UploadCopy> {
  const asIs: UploadCopy = { file: original, compressed: false, originalName: original.name, originalSize: original.size, originalWidth: null, originalHeight: null }
  if (mediaOf(original.name) === 'video') return asIs
  if (compress) {
    try {
      return await compressForUpload(original)
    } catch (e) {
      if (e instanceof Undecodable) throw new Skip(isRaw(original.name) ? 'No readable preview in this RAW file' : 'This photo could not be read')
      throw e
    }
  }
  // Original quality: browsers can't show RAW files, and HEIC becomes a full-size JPEG.
  if (isRaw(original.name)) throw new Skip('RAW files upload only compressed — turn off “Upload original quality”')
  if (!isHeic(original.name)) return asIs
  const { default: heic2any } = await import('heic2any')
  const out = await heic2any({ blob: original, toType: 'image/jpeg', quality: 0.92 })
  const blob = Array.isArray(out) ? out[0] : out
  return { ...asIs, file: new File([blob], original.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' }) }
}

export interface UploadFoldersHandle {
  /** Opens the folder picker. Call it straight from the click that opens the dialog. */
  pick: () => void
}

/**
 * "Select Folders to Upload": pick a folder (its subfolders become albums), see each album with its
 * file count, then upload them into the event, 4 files at a time, with pause, resume and cancel.
 * Unless the event's "Upload original quality" is on, photos are compressed in the browser first
 * (1600 px JPEG, 80–85%) for the client, and each original is then kept in the cloud for the studio
 * (verified by SHA-256). Each photo keeps its original file name, size and folder path, so Download
 * Selected can return the originals (from the cloud, or from this computer).
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
  const [progress, setProgress] = useState<Record<string, Progress>>({})
  const [busy, setBusy] = useState(false)
  const [paused, setPaused] = useState(false)
  const keySeq = useRef(0)
  // Pause holds the workers before their next file; cancel stops them taking any more.
  const pauseGate = useRef<{ promise: Promise<void>; open: () => void } | null>(null)
  const cancelled = useRef(false)
  const limitsQ = useQuery({ queryKey: UPLOAD_LIMITS_KEY, queryFn: () => api.get<UploadLimitsDto>('/me/upload-limits') })
  const settingsKey = ['selection-settings', selectionId]
  const settingsQ = useQuery({ queryKey: settingsKey, queryFn: () => api.get<EventSettings>(`/selections/${selectionId}/settings`) })
  /** Compressed upload unless the event says "Upload original quality". */
  const compressing = !settingsQ.data?.originalQuality
  // Bytes of the originals sent so far, and of what was actually uploaded.
  const [bytes, setBytes] = useState({ original: 0, sent: 0 })

  // Leaving the page mid-upload would drop the photos not sent yet.
  useEffect(() => {
    if (!busy) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  const addFolders = (picked: PickedFolder[]) => {
    const limits = limitsQ.data
    setRows((current) => {
      const next = [...current]
      for (const p of picked) {
        let row = toRow(p, `f${++keySeq.current}`)
        const reason = rejectReason(
          row,
          next.map((r) => r.name),
          folders.map((f) => f.name),
        )
        if (reason) {
          toast.error(reason.message, { id: `reject-${row.name}`, description: reason.name })
          continue
        }
        if (limits) {
          // Compressed photos end up far below the limit; only what is sent as it is can be too big.
          const sentAsIs = (f: File) => !compressing || mediaOf(f.name) === 'video'
          const tooBig = row.files.filter((f) => sentAsIs(f) && f.size > limits.maxPhotoMb * MB)
          if (tooBig.length) {
            toast.warning(`${tooBig.length} file${tooBig.length === 1 ? '' : 's'} in '${row.name}' over ${limits.maxPhotoMb} MB on your ${limits.planName} plan will be skipped`)
            row = toRow({ name: row.name, files: row.files.filter((f) => !tooBig.includes(f)) }, row.key)
            if (!row.files.length) continue
          }
          const total = next.reduce((n, r) => n + r.files.length, 0) + row.files.length
          if (total > limits.maxFilesPerUpload) {
            toast.error(`Your ${limits.planName} plan uploads up to ${limits.maxFilesPerUpload.toLocaleString('en-IN')} files at a time. Upload '${row.name}' separately.`)
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
    setProgress({})
    setPaused(false)
    setBytes({ original: 0, sent: 0 })
  }

  const pause = () => {
    let open = () => {}
    const promise = new Promise<void>((resolve) => (open = resolve))
    pauseGate.current = { promise, open }
    setPaused(true)
  }
  const resume = () => {
    pauseGate.current?.open()
    pauseGate.current = null
    setPaused(false)
  }
  const cancel = () => {
    cancelled.current = true
    resume()
  }
  const close = () => {
    if (busy) return
    reset()
    onClose()
  }

  const patch = (key: string, p: Partial<Progress>) => setProgress((cur) => ({ ...cur, [key]: { ...(cur[key] ?? emptyProgress()), ...p } }))

  /** Start Upload: any unexpected failure ends the upload with an error toast instead of a stuck dialog. */
  const start = async (retry = false) => {
    if (!rows.length || busy) return
    try {
      await run(retry)
    } catch (e) {
      setBusy(false)
      setPaused(false)
      refreshSelection(qc, selectionId)
      toast.error('Upload failed', { description: isApiError(e) ? e.message : (e as Error).message || 'Something went wrong. Please try again.' })
    }
  }

  /** Uploads every row (or, on retry, only the files that failed). */
  const run = async (retry: boolean) => {
    setBusy(true)
    cancelled.current = false
    // The event's setting decides, read fresh in case it changed since the dialog opened.
    const compress = !(await qc.fetchQuery({ queryKey: settingsKey, queryFn: () => api.get<EventSettings>(`/selections/${selectionId}/settings`), staleTime: 0 }).catch(() => null))?.originalQuality
    const state: Record<string, Progress> = {}
    for (const r of rows) state[r.key] = progress[r.key] ?? emptyProgress()

    // 1. A photo folder and/or a video folder per picked folder (refused if the name exists by now).
    for (const r of rows) {
      if (state[r.key].folderIds) continue
      try {
        const ids: { photo?: string; video?: string } = {}
        for (const t of targetsOf(r)) {
          const f = await api.post<SelectionFolderDto>(`/selections/${selectionId}/folders`, { name: t.name, type: t.type })
          ids[t.type] = f.id
        }
        state[r.key] = { ...state[r.key], folderIds: ids }
      } catch (e) {
        const error = isApiError(e) ? e.message : 'Could not create the folder'
        state[r.key] = { ...state[r.key], state: 'error', failed: r.files.map((f, index) => ({ name: f.name, error, index })) }
      }
      patch(r.key, state[r.key])
    }

    // 2. The files, 4 at a time across all folders.
    const jobs = rows.flatMap((r) => {
      const s = state[r.key]
      if (!s.folderIds) return []
      const indexes = retry ? s.failed.map((f) => f.index) : r.files.map((_, i) => i)
      state[r.key] = { ...s, failed: [], state: 'uploading' }
      patch(r.key, state[r.key])
      return indexes.map((index) => ({ row: r, index }))
    })
    /** Originals that couldn't be kept in the cloud (too large for the plan, or the upload failed). */
    let originalsNotKept = 0
    const maxBytes = (limitsQ.data?.maxPhotoMb ?? Infinity) * MB
    const keepOriginal = async (photoId: string, original: File) => {
      if (original.size > maxBytes) {
        originalsNotKept++
        return
      }
      try {
        const sha = await sha256Hex(original)
        await withRetries(() => {
          const fd = new FormData()
          if (sha) fd.append('sha256', sha)
          fd.append('file', original, original.name)
          return upload(`/selections/${selectionId}/photos/${photoId}/original`, fd)
        })
      } catch {
        originalsNotKept++
      }
    }

    let next = 0
    const worker = async () => {
      while (next < jobs.length) {
        if (pauseGate.current) await pauseGate.current.promise
        if (cancelled.current) return
        const { row, index } = jobs[next++]
        const s = state[row.key]
        const original = row.files[index]
        try {
          const folderPath = folderPathOf(original)
          const copy = await uploadCopyOf(original, compress)
          const photo = await withRetries(() => {
            const fd = new FormData()
            fd.append('folderId', s.folderIds![mediaOf(original.name) === 'video' ? 'video' : 'photo']!)
            if (folderPath) fd.append('folder', folderPath)
            // The original's name (e.g. IMG_1234.CR2), size and pixel size, kept with the photo.
            fd.append('originalName', copy.originalName)
            fd.append('originalSize', String(copy.originalSize))
            if (copy.originalWidth && copy.originalHeight) {
              fd.append('originalWidth', String(copy.originalWidth))
              fd.append('originalHeight', String(copy.originalHeight))
            }
            if (copy.compressed) fd.append('compressed', '1')
            fd.append('file', copy.file)
            return upload<{ id: string }>(`/selections/${selectionId}/photos`, fd)
          })
          s.done++
          setBytes((b) => ({ original: b.original + original.size, sent: b.sent + copy.file.size }))
          // The customer gets the 80–85% copy; the full-quality original is kept in the cloud for the
          // studio, so the picks can be returned at full quality (Download Selected → Download from cloud).
          if (copy.compressed) await keepOriginal(photo.id, original)
        } catch (e) {
          // Same file already in the event: nothing to do.
          if (isApiError(e) && e.status === 409 && /already/i.test(e.message)) s.done++
          else if (e instanceof Skip) s.skipped.push({ name: folderPathOf(original) ? `${folderPathOf(original)}/${original.name}` : original.name, reason: e.message })
          else s.failed.push({ name: original.name, error: isApiError(e) ? (e.fields?.file ?? e.message) : (e as Error).message || 'Upload failed', index })
        }
        patch(row.key, { done: s.done, failed: [...s.failed], skipped: [...s.skipped] })
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker))
    for (const r of rows) {
      const s = state[r.key]
      patch(r.key, { state: s.failed.length ? 'error' : 'done' })
    }
    setBusy(false)
    setPaused(false)
    refreshSelection(qc, selectionId)
    void qc.invalidateQueries({ queryKey: UPLOAD_LIMITS_KEY })

    if (cancelled.current) {
      const sent = rows.reduce((n, r) => n + state[r.key].done, 0)
      toast.info(`Upload cancelled — ${sent} of ${jobs.length} files uploaded`)
      reset()
      onClose()
      return
    }
    if (originalsNotKept > 0) {
      toast.warning(`${originalsNotKept} original${originalsNotKept === 1 ? ' wasn’t' : 's weren’t'} kept in the cloud`, {
        description: `Larger than ${limitsQ.data?.maxPhotoMb ?? 'your plan’s'} MB or the upload failed. Their photos are uploaded; get those originals with Download Selected → Copy from my computer.`,
      })
    }
    const failed = rows.reduce((n, r) => n + state[r.key].failed.length, 0)
    const skipped = rows.reduce((n, r) => n + state[r.key].skipped.length, 0)
    if (!failed && !skipped) {
      toast.success('Upload complete')
      reset()
      onClose()
    } else if (!failed) {
      toast.warning(`Upload complete — ${skipped} file${skipped === 1 ? ' was' : 's were'} skipped`, { description: 'They are listed below.' })
    } else {
      toast.error(`${failed} file${failed === 1 ? '' : 's'} didn't upload`, { description: 'Check the folders below and retry the failed files.' })
    }
  }

  const total = rows.reduce((n, r) => n + r.files.length, 0)
  const finished = rows.reduce((n, r) => n + (progress[r.key]?.done ?? 0) + (progress[r.key]?.failed.length ?? 0) + (progress[r.key]?.skipped.length ?? 0), 0)
  const pct = total ? Math.round((finished / total) * 100) : 0
  const anyFailed = rows.some((r) => (progress[r.key]?.failed.length ?? 0) > 0)

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
            const picked = groupInputFiles(e.target.files)
            if (picked.length) addFolders(picked)
            else toast.error('No photos or videos to upload', { description: 'Empty folders and “Selected - …” folders are skipped.' })
          }
          e.target.value = ''
        }}
      />
      <Modal open={open} onClose={close} title={busy ? 'Uploading' : 'Select Folders to Upload'} className="uf-modal" size="lg" busy={busy}>
        {busy && (
          <div className="uf-live" data-testid="upload-progress">
            <div className="uf-live-head">
              <strong aria-live="polite">
                Uploading {finished} / {total}
              </strong>
              <span>{paused ? 'Paused' : `${pct}%`}</span>
            </div>
            <div className="uf-track big" role="progressbar" aria-valuenow={finished} aria-valuemin={0} aria-valuemax={total} aria-label="Upload progress">
              <span style={{ width: `${pct}%` }} />
            </div>
            <div className="uf-live-actions">
              {paused ? (
                <button type="button" className="uf-pill" onClick={resume}>
                  <i className="bi bi-play-fill" /> Resume
                </button>
              ) : (
                <button type="button" className="uf-pill ghost" onClick={pause}>
                  <i className="bi bi-pause-fill" /> Pause
                </button>
              )}
              <button type="button" className="uf-pill ghost danger" onClick={cancel}>
                <i className="bi bi-x-lg" /> Cancel
              </button>
            </div>
          </div>
        )}
        {bytes.original > 0 && bytes.sent < bytes.original && (
          <p className="uf-saving" data-testid="upload-saving" aria-live="polite">
            <i className="bi bi-arrow-down-circle" aria-hidden="true" /> Compressed {formatBytes(bytes.original)} → {formatBytes(bytes.sent)}
          </p>
        )}
        <div className="uf-bar">
          <strong>Albums ({rows.length})</strong>
          <button type="button" className="uf-add" onClick={pick} disabled={busy}>
            <i className="bi bi-images" /> Add Photo Folder
          </button>
        </div>
        <div className="uf-box" data-testid="selected-folders">
          {rows.map((r) => {
            const p = progress[r.key]
            const done = p ? p.done + p.failed.length + p.skipped.length : 0
            return (
              <div key={r.key} className={`uf-row${p?.state === 'error' ? ' has-error' : ''}`}>
                <div className="uf-row-main">
                  <i className="bi bi-folder-fill uf-folder" aria-hidden="true" />
                  <strong className="uf-name" title={r.name} aria-label={r.name}>
                    {r.name}
                  </strong>
                  <span className="uf-kind">{r.label}</span>
                  <span className="uf-count">
                    {r.files.length} files{r.videos && r.images ? ` · ${r.videos} video${r.videos === 1 ? '' : 's'}` : ''}
                  </span>
                  {p && p.state !== 'ready' ? (
                    <span className={`uf-progress-text${p.state === 'done' ? ' ok' : ''}`}>
                      {p.state === 'done' ? <i className="bi bi-check-circle-fill" /> : null} {p.done}/{r.files.length}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="uf-remove"
                      onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))}
                      disabled={busy}
                      aria-label={`Remove ${r.name}`}
                    >
                      ✖ Remove
                    </button>
                  )}
                </div>
                {p && p.state !== 'ready' && (
                  <div className="uf-track" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={r.files.length} aria-label={`${r.name} upload`}>
                    <span style={{ width: `${(done / Math.max(1, r.files.length)) * 100}%` }} />
                  </div>
                )}
                {p && p.failed.length > 0 && (
                  <ul className="uf-failed">
                    {p.failed.slice(0, 5).map((f) => (
                      <li key={f.index}>
                        <i className="bi bi-exclamation-circle" /> {f.name}: {f.error}
                      </li>
                    ))}
                    {p.failed.length > 5 && <li>…and {p.failed.length - 5} more</li>}
                  </ul>
                )}
                {p && p.skipped.length > 0 && (
                  <details className="uf-skipped" open={p.skipped.length <= 5}>
                    <summary>
                      <i className="bi bi-skip-forward-circle" /> {p.skipped.length} skipped
                    </summary>
                    <ul>
                      {p.skipped.map((f) => (
                        <li key={f.name}>
                          {f.name}: {f.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )
          })}
        </div>
        <p className="uf-hint">
          <i className="bi bi-info-circle" /> Each subfolder becomes an album. Duplicate folder names and already existing folders will be automatically prevented.
        </p>
        <p className="uf-hint uf-mode" data-testid="upload-mode">
          {compressing ? (
            <>
              <i className="bi bi-lightning-charge" /> Photos are compressed to 80–85% quality (1600 px) for fast client viewing. A full-quality copy of each original is also kept in the cloud
              for you (never shown to the client), so their picks come back at full quality with Download Selected.
            </>
          ) : (
            <>
              <i className="bi bi-hdd-stack" /> Uploading original quality (large files), as set in this event’s Settings.
            </>
          )}
        </p>
        <div className="uf-foot">
          <button type="button" className="uf-pill ghost" onClick={close} disabled={busy}>
            Cancel
          </button>
          {anyFailed && !busy ? (
            <button type="button" className="uf-pill" onClick={() => void start(true)}>
              <i className="bi bi-arrow-clockwise" /> Retry failed
            </button>
          ) : (
            <button type="button" className="uf-pill" onClick={() => void start()} disabled={busy || rows.length === 0} data-testid="start-upload">
              {busy ? <Spinner size={14} /> : <i className="bi bi-upload" />} {busy ? `Uploading ${pct}%` : 'Start Upload'}
            </button>
          )}
        </div>
      </Modal>
    </>
  )
}
