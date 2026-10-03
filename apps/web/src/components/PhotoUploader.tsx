import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { UploadLimitsDto } from '@weddyzone/shared'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api, upload, isApiError } from '../lib/api'
import { toastError } from '../lib/query'
import { formatBytes } from '../utils/format'
import { fitBatch, folderLabel, folderOf, folderSummary, photoType, PICKER_ACCEPT, sortByPath, triage, withRetries, type Candidate } from './photoUpload'

export { photoType } from './photoUpload'

export const UPLOAD_LIMITS_KEY = ['upload-limits'] as const
/** Rows rendered before "Show all" (big folders can have thousands). */
const ROWS_SHOWN = 50

const fileOf = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject))

/** Every entry in a folder: readEntries returns batches of ~100, so read until it returns none. */
async function readAll(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader()
  const all: FileSystemEntry[] = []
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (!batch.length) return all
    all.push(...batch)
  }
}

async function candidatesIn(entry: FileSystemEntry): Promise<Candidate[]> {
  try {
    if (entry.isFile) return [{ file: await fileOf(entry as FileSystemFileEntry), folder: folderOf(entry.fullPath) }]
    if (entry.isDirectory) {
      const children = await readAll(entry as FileSystemDirectoryEntry)
      return (await Promise.all(children.map(candidatesIn))).flat()
    }
  } catch {
    // An unreadable file or folder (permissions, removed meanwhile) is skipped, not fatal.
  }
  return []
}

/** Entries of a drop. Must run synchronously inside the drop event: the browser empties dataTransfer afterwards. */
function dropEntries(dt: DataTransfer): FileSystemEntry[] {
  return Array.from(dt.items)
    .filter((i) => i.kind === 'file')
    .map((i) => i.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => e !== null)
}

/**
 * Files from a drop with the folder each came from, walking dropped folders and their subfolders.
 * Reads the entries before its first await, so call it straight from the drop handler. Falls back
 * to the plain file list when the browser gives no entries.
 */
export async function candidatesFromDrop(dt: DataTransfer): Promise<Candidate[]> {
  const entries = dropEntries(dt)
  const loose = Array.from(dt.files)
  if (!entries.length) return loose.map((file) => ({ file, folder: null }))
  return (await Promise.all(entries.map(candidatesIn))).flat()
}

/** Files from a drop (folders walked recursively). */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  return (await candidatesFromDrop(dt)).map((c) => c.file)
}

type State = 'queued' | 'uploading' | 'done' | 'error' | 'duplicate'

interface Item {
  key: string
  name: string
  size: number
  folder: string | null
  /** The extra form fields when the file was added. */
  fields?: Record<string, string>
  /** Dropped once the photo is uploaded (or already there), so big folders don't hold every file in memory. */
  file?: File
  progress: number
  state: State
  error?: string
  /** Error about the plan (size, storage, renewal): shown with an upgrade link. */
  planError?: boolean
}

const isPlanMessage = (m?: string) => !!m && /plan|storage full|renew|upgrade/i.test(m)

/**
 * Photo upload with per-file progress, errors and retries. Every limit comes from the studio's plan
 * (GET /me/upload-limits): photo size, photos per upload, uploads at a time and storage left. The
 * server checks all of it again (type by content, size, storage, duplicates, read-only plans).
 */
export function PhotoUploader({
  endpoint,
  onUploaded,
  onBusyChange,
  label = 'Drop wedding photos here, or click to browse',
  fields,
}: {
  endpoint: string
  /** No longer used: the studio's plan decides the size limit. Kept so existing callers still compile. */
  maxMb?: number
  onUploaded?: () => void
  /** Told when uploads start and finish, e.g. to confirm before a dialog closes mid-upload. */
  onBusyChange?: (busy: boolean) => void
  label?: string
  /** Extra form fields sent with the photos added from now on (e.g. the folder to file them in). */
  fields?: Record<string, string>
}) {
  const fieldsRef = useRef(fields)
  useEffect(() => {
    fieldsRef.current = fields
  }, [fields])
  const qc = useQueryClient()
  const navigate = useNavigate()
  const limitsQ = useQuery({ queryKey: UPLOAD_LIMITS_KEY, queryFn: () => api.get<UploadLimitsDto>('/me/upload-limits') })
  const limits = limitsQ.data
  const [items, setItems] = useState<Item[]>([])
  const [showAll, setShowAll] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement | null>(null)
  const zone = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const counter = useRef(0)
  // Set when the uploader goes away (dialog closed): queued files are not started.
  const stopped = useRef(false)
  const busyCallback = useRef(onBusyChange)
  useEffect(() => {
    busyCallback.current = onBusyChange
  }, [onBusyChange])

  const blocked = limits?.readOnly === true
  const active = items.filter((i) => i.state === 'uploading' || i.state === 'queued').length

  const patch = (key: string, p: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)))

  useEffect(() => {
    stopped.current = false
    return () => {
      stopped.current = true
    }
  }, [])

  // While uploads run: warn before leaving the page, and tell the parent (it confirms before closing).
  const busy = active > 0
  useEffect(() => {
    busyCallback.current?.(busy)
    if (!busy) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  const getLimits = () => qc.fetchQuery({ queryKey: UPLOAD_LIMITS_KEY, queryFn: () => api.get<UploadLimitsDto>('/me/upload-limits'), staleTime: 30_000 })

  const runQueue = async (queue: Item[], concurrency: number) => {
    let next = 0
    let halted: string | null = null
    const worker = async () => {
      while (next < queue.length && !stopped.current) {
        const item = queue[next++]
        if (halted) {
          patch(item.key, { state: 'error', error: halted, planError: true })
          continue
        }
        if (!item.file) continue
        patch(item.key, { state: 'uploading', progress: 0, error: undefined, planError: false })
        const fd = new FormData()
        if (item.folder) fd.append('folder', item.folder)
        for (const [k, v] of Object.entries(item.fields ?? {})) fd.append(k, v)
        fd.append('file', item.file)
        try {
          await withRetries(
            () => upload(endpoint, fd, (pct) => patch(item.key, { progress: pct })),
            undefined,
            (n) => patch(item.key, { progress: 0, error: `Connection problem, retrying (${n} of 2)…` }),
          )
          patch(item.key, { state: 'done', progress: 100, error: undefined, file: undefined })
          onUploaded?.()
        } catch (e) {
          if (isApiError(e) && e.status === 409 && /Duplicate/i.test(e.fields?.file ?? '')) {
            patch(item.key, { state: 'duplicate', error: undefined, file: undefined })
            continue
          }
          const msg = isApiError(e) ? (e.fields?.file ?? e.message) : 'Upload failed'
          patch(item.key, { state: 'error', error: msg, planError: isPlanMessage(msg) })
          // Plan limit (storage full, renew) or session problems: stop the rest of the queue.
          if (isApiError(e) && (e.code === 'PLAN_LIMIT' || e.status === 401)) {
            if (e.code === 'PLAN_LIMIT') toastError(e) // opens the upgrade dialog
            halted = e.code === 'PLAN_LIMIT' ? `Not uploaded: ${e.message}` : 'Not uploaded: please sign in again'
          }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))
    void qc.invalidateQueries({ queryKey: UPLOAD_LIMITS_KEY })
  }

  const upgradeAction = { label: 'Upgrade', onClick: () => navigate('/subscriptions') }

  /**
   * Queues files under the plan's limits. From a folder, junk, non-photos and oversize photos are
   * skipped quietly and summed up in one message; picked one by one, they show as error rows.
   */
  const addFiles = async (candidates: Candidate[], fromFolder = false) => {
    let l: UploadLimitsDto
    try {
      l = await getLimits()
    } catch (e) {
      toastError(e)
      return
    }
    if (l.readOnly) {
      toast.error('Renew your plan to upload', { action: { label: 'Renew', onClick: () => navigate(l.renewLink) } })
      return
    }
    const sorted = fromFolder ? sortByPath(candidates) : candidates
    const t = triage(sorted, l, fromFolder)
    const fit = fitBatch(t.photos, l)
    if (fit.overCap) {
      toast.warning(`Your ${l.planName} plan allows ${l.maxFilesPerUpload.toLocaleString('en-IN')} photos per upload. Upload the rest in another batch, or upgrade.`, { action: upgradeAction, duration: 10_000 })
    }
    if (fit.noRoom) {
      toast.warning(`Only ${fit.queued.length} photo${fit.queued.length === 1 ? '' : 's'} fit in your remaining storage. Upgrade for more space.`, { action: upgradeAction, duration: 10_000 })
    }
    if (fromFolder) {
      if (!fit.queued.length && !t.skippedLarge && !t.skippedNotPhoto) toast.info('No JPEG, PNG or WebP photos found in that folder')
      else toast.success(folderSummary(fit.queued.length, folderLabel(sorted), t, l), { duration: 8000 })
    }

    const make = (c: Candidate, state: State, error?: string): Item => ({
      key: `${++counter.current}-${c.file.name}`,
      name: c.file.name,
      size: c.file.size,
      folder: c.folder,
      fields: fieldsRef.current,
      file: c.file,
      progress: 0,
      state,
      error,
      planError: isPlanMessage(error),
    })
    const queued = fit.queued.map((c) => make(c, 'queued'))
    const rejected = t.rejected.map((r) => make(r.candidate, 'error', r.error))
    if (!queued.length && !rejected.length) return
    setItems((list) => [...queued, ...rejected, ...list])
    if (queued.length) await runQueue(queued, l.uploadConcurrency)
  }

  // React's types don't know webkitdirectory/directory, so they are set on the element directly.
  const folderRef = (el: HTMLInputElement | null) => {
    folderInput.current = el
    el?.setAttribute('webkitdirectory', '')
    el?.setAttribute('directory', '')
  }

  const retry = (list: Item[]) => {
    const again = list.filter((i) => i.file)
    if (!again.length) return
    again.forEach((i) => patch(i.key, { state: 'queued', error: undefined, planError: false, progress: 0 }))
    void getLimits().then((l) => runQueue(again, l.uploadConcurrency))
  }
  const canRetry = (i: Item) => i.state === 'error' && !!i.file && !!photoType(i.file) && (!limits || i.size <= limits.maxPhotoMb * 1024 * 1024)

  // The box opens a small "Photos / Folder" menu. Focus goes to its first item; Escape or a click
  // anywhere else closes it.
  useEffect(() => {
    if (!menuOpen) return
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !zone.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    // The uploader often sits in a dialog, which closes on Escape from a document-level listener.
    // Catching Escape first (window, capture phase) and marking it handled closes just this menu.
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setMenuOpen(false)
      zone.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onEscape, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onEscape, true)
    }
  }, [menuOpen])

  const pick = (which: 'photos' | 'folder') => {
    setMenuOpen(false)
    ;(which === 'photos' ? input.current : folderInput.current)?.click()
  }
  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const buttons = [...(menu.current?.querySelectorAll('button') ?? [])]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Tab') {
      setMenuOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      buttons[(i + 1) % buttons.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      buttons[(i - 1 + buttons.length) % buttons.length]?.focus()
    }
  }

  const done = items.filter((i) => i.state === 'done').length
  const failed = items.filter((i) => i.state === 'error')
  const duplicates = items.filter((i) => i.state === 'duplicate').length
  const started = items.length - items.filter((i) => i.state === 'queued').length
  const shown = showAll ? items : items.slice(0, ROWS_SHOWN)
  const graceDate = limits?.graceEndsAt ? new Date(limits.graceEndsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : null
  const help = limits
    ? `JPEG, PNG or WebP · up to ${limits.maxPhotoMb} MB each · ${limits.storageLeftBytes === null ? 'unlimited storage' : `${formatBytes(limits.storageLeftBytes)} left`} on ${limits.planName}`
    : 'JPEG, PNG or WebP · duplicates are skipped'

  return (
    <div className="uploader">
      {limits?.status === 'GRACE' && graceDate && (
        <p className="field-hint" role="status" style={{ margin: '0 0 8px', color: 'var(--warning)' }}>
          <i className="bi bi-exclamation-triangle" aria-hidden="true" /> Your plan expired, renew by {graceDate}.{' '}
          <Link to={limits.renewLink} className="link">
            Renew
          </Link>
        </p>
      )}

      {blocked ? (
        <div className="dropzone dropzone-catchy" role="status" style={{ cursor: 'default' }}>
          <i className="bi bi-lock" />
          <strong>Renew your plan to upload</strong>
          <span className="muted">Your photos and albums are safe; renew to add new ones.</span>
          <Link to={limits!.renewLink} className="btn btn-primary btn-sm" style={{ marginTop: 6 }}>
            Renew
          </Link>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <div
            ref={zone}
            role="button"
            tabIndex={0}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className={`dropzone dropzone-catchy${dragging ? ' is-dragging' : ''}`}
            onClick={() => setMenuOpen((open) => !open)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault() // Space would otherwise scroll the page
                setMenuOpen(true)
              }
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              setMenuOpen(false)
              // Everything is read from dataTransfer now, before any await: the browser clears it after this event.
              const dt = e.dataTransfer
              const hasDirectory = dropEntries(dt).some((entry) => entry.isDirectory)
              void candidatesFromDrop(dt).then((list) => {
                if (list.length) void addFiles(list, hasDirectory)
              })
            }}
          >
            <i className="bi bi-cloud-arrow-up" />
            <strong>{label}</strong>
            <span className="muted">{help}</span>
          </div>

          {menuOpen && (
            <div
              ref={menu}
              role="menu"
              aria-label="Upload"
              className="menu"
              onKeyDown={onMenuKeyDown}
              style={{ left: '50%', right: 'auto', top: 'calc(100% - 18px)', width: 200, transform: 'translateX(-50%)', zIndex: 20 }}
            >
              <button type="button" role="menuitem" className="row-menu-item" onClick={() => pick('photos')}>
                <i className="bi bi-images" aria-hidden="true" /> Photos
              </button>
              <button type="button" role="menuitem" className="row-menu-item" onClick={() => pick('folder')}>
                <i className="bi bi-folder2-open" aria-hidden="true" /> Folder
              </button>
            </div>
          )}
        </div>
      )}

      {/* Both pickers are hidden and live outside the box; the menu opens them. */}
      <input
        ref={input}
        type="file"
        accept={PICKER_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length) void addFiles(files.map((file) => ({ file, folder: null })))
        }}
        aria-label="Choose photos to upload"
      />
      <input
        ref={folderRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          // The folder picker gives each file's path inside the picked folder (webkitRelativePath).
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length) void addFiles(files.map((file) => ({ file, folder: folderOf(file.webkitRelativePath) })), true)
        }}
        aria-label="Choose a folder of photos to upload"
      />

      {items.length > 0 && (
        <>
          <div className="row-between" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <p className="uploader-summary" aria-live="polite">
              {busy ? `Uploading ${started} of ${items.length} · ` : ''}
              {done} done{failed.length ? ` · ${failed.length} failed` : ''}
              {duplicates ? ` · ${duplicates} already uploaded` : ''}
            </p>
            {!busy && failed.some(canRetry) && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => retry(failed.filter(canRetry))}>
                <i className="bi bi-arrow-clockwise" /> Retry all failed
              </button>
            )}
          </div>
          <ul className="upload-list">
            {shown.map((i) => (
              <li key={i.key} className={`upload-item is-${i.state === 'duplicate' ? 'done' : i.state}`} style={i.state === 'duplicate' ? { opacity: 0.6 } : undefined}>
                <i
                  className={`bi bi-${i.state === 'done' ? 'check-circle-fill' : i.state === 'duplicate' ? 'dash-circle' : i.state === 'error' ? 'exclamation-circle-fill' : 'image'}`}
                  aria-hidden="true"
                />
                <div className="upload-meta">
                  <div className="upload-name">
                    <span title={i.folder ? `${i.folder}/${i.name}` : i.name}>{i.name}</span>
                    <small>
                      {i.folder ? `${i.folder} · ` : ''}
                      {formatBytes(i.size)}
                    </small>
                  </div>
                  {i.state === 'duplicate' ? (
                    <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
                      Already uploaded
                    </p>
                  ) : i.state === 'error' ? (
                    <p className="field-error">
                      {i.error}{' '}
                      {i.planError && (
                        <Link to="/subscriptions" className="link">
                          Upgrade
                        </Link>
                      )}
                    </p>
                  ) : (
                    <>
                      <div className="progress" role="progressbar" aria-valuenow={i.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${i.name} upload`}>
                        <span style={{ width: `${i.progress}%` }} />
                      </div>
                      {i.error && (
                        <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
                          {i.error}
                        </p>
                      )}
                    </>
                  )}
                </div>
                {canRetry(i) && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => retry([i])}>
                    Retry
                  </button>
                )}
              </li>
            ))}
          </ul>
          {items.length > ROWS_SHOWN && (
            <button type="button" className="link" onClick={() => setShowAll((v) => !v)}>
              {showAll ? `Show first ${ROWS_SHOWN}` : `Show all ${items.length.toLocaleString('en-IN')}`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
