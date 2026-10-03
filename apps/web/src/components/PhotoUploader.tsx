import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { upload, isApiError } from '../lib/api'
import { toastError } from '../lib/query'
import { formatBytes } from '../utils/format'

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp']
const CONCURRENCY = 3

/** System clutter that comes along with folders: .DS_Store and other dotfiles, Thumbs.db, desktop.ini. */
function isJunk(name: string): boolean {
  const n = name.toLowerCase()
  return n.startsWith('.') || n === 'thumbs.db' || n === 'desktop.ini'
}

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

async function filesIn(entry: FileSystemEntry): Promise<File[]> {
  try {
    if (entry.isFile) return [await fileOf(entry as FileSystemFileEntry)]
    if (entry.isDirectory) {
      const children = await readAll(entry as FileSystemDirectoryEntry)
      return (await Promise.all(children.map(filesIn))).flat()
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
 * Files from a drop, walking dropped folders and their subfolders. Reads the entries before its
 * first await, so call it straight from the drop handler. Falls back to the plain file list when
 * the browser gives no entries.
 */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = dropEntries(dt)
  const loose = Array.from(dt.files)
  if (!entries.length) return loose
  return (await Promise.all(entries.map(filesIn))).flat()
}

interface Item {
  key: string
  file: File
  progress: number
  state: 'queued' | 'uploading' | 'done' | 'error'
  error?: string
}

/**
 * Multi-file photo upload with per-file progress and per-file errors.
 * Files are checked in the browser first (type/size) and again on the server
 * (real content type, size, duplicate by checksum).
 */
export function PhotoUploader({
  endpoint,
  maxMb = 20,
  onUploaded,
  label = 'Drop wedding photos here, or click to browse',
}: {
  endpoint: string
  maxMb?: number
  onUploaded?: () => void
  label?: string
}) {
  const [items, setItems] = useState<Item[]>([])
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement | null>(null)
  const counter = useRef(0)

  const patch = (key: string, p: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)))

  const runQueue = async (queue: Item[]) => {
    let next = 0
    const worker = async () => {
      while (next < queue.length) {
        const item = queue[next++]
        patch(item.key, { state: 'uploading', progress: 0, error: undefined })
        const fd = new FormData()
        fd.append('file', item.file)
        try {
          await upload(endpoint, fd, (pct) => patch(item.key, { progress: pct }))
          patch(item.key, { state: 'done', progress: 100 })
          onUploaded?.()
        } catch (e) {
          const msg = isApiError(e) ? (e.fields?.file ?? e.message) : 'Upload failed'
          patch(item.key, { state: 'error', error: msg })
          // Plan limit / session problems: stop the rest of the queue.
          if (isApiError(e) && (e.code === 'PLAN_LIMIT' || e.status === 401)) {
            if (e.code === 'PLAN_LIMIT') toastError(e) // opens the upgrade dialog
            next = queue.length
          }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
  }

  /**
   * Queues files for upload. From a folder, anything that isn't a JPEG/PNG/WebP (and system junk
   * like .DS_Store) is skipped quietly; files picked one by one get an error instead.
   */
  const addFiles = (files: FileList | File[], fromFolder = false) => {
    const fresh: Item[] = []
    for (const file of Array.from(files)) {
      if (fromFolder && (isJunk(file.name) || !ACCEPT.includes(file.type))) continue
      const key = `${++counter.current}-${file.name}`
      let error: string | undefined
      if (!ACCEPT.includes(file.type)) error = 'Only JPEG, PNG or WebP images'
      else if (file.size > maxMb * 1024 * 1024) error = `Larger than ${maxMb} MB`
      fresh.push({ key, file, progress: 0, state: error ? 'error' : 'queued', error })
    }
    if (!fresh.length) {
      // Quiet per file, but an empty result needs saying.
      if (fromFolder) toast.info('No JPEG, PNG or WebP photos found in that folder')
      return
    }
    setItems((list) => [...fresh, ...list])
    void runQueue(fresh.filter((i) => i.state === 'queued'))
  }

  // React's types don't know webkitdirectory/directory, so they are set on the element directly.
  const folderRef = (el: HTMLInputElement | null) => {
    folderInput.current = el
    el?.setAttribute('webkitdirectory', '')
    el?.setAttribute('directory', '')
  }

  const retry = (item: Item) => void runQueue([item])

  const done = items.filter((i) => i.state === 'done').length
  const failed = items.filter((i) => i.state === 'error').length
  const active = items.filter((i) => i.state === 'uploading' || i.state === 'queued').length

  return (
    <div className="uploader">
      <label
        className={`dropzone dropzone-catchy${dragging ? ' is-dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          // Everything is read from dataTransfer now, before any await: the browser clears it after this event.
          const dt = e.dataTransfer
          const hasDirectory = dropEntries(dt).some((entry) => entry.isDirectory)
          void filesFromDrop(dt).then((files) => {
            if (files.length) addFiles(files, hasDirectory)
          })
        }}
      >
        <input
          ref={input}
          type="file"
          accept={ACCEPT.join(',')}
          multiple
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files)
            e.target.value = ''
          }}
          aria-label="Choose photos to upload"
        />
        <i className="bi bi-cloud-arrow-up" />
        <strong>{label}</strong>
        <span className="muted">JPEG, PNG or WebP · up to {maxMb} MB each · duplicates are skipped</span>
      </label>

      {/* Outside the <label>, so clicking it doesn't also open the file picker. */}
      <div className="uploader-folder">
        <button type="button" className="btn btn-light btn-sm" onClick={() => folderInput.current?.click()}>
          <i className="bi bi-folder-plus" /> Select folder
        </button>
        <input
          ref={folderRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files, true)
            e.target.value = ''
          }}
          aria-label="Choose a folder of photos to upload"
        />
      </div>

      {items.length > 0 && (
        <>
          <p className="uploader-summary" aria-live="polite">
            {active > 0 ? `Uploading ${active} file${active > 1 ? 's' : ''}… ` : ''}
            {done} uploaded{failed ? ` · ${failed} failed` : ''}
          </p>
          <ul className="upload-list">
            {items.map((i) => (
              <li key={i.key} className={`upload-item is-${i.state}`}>
                <i
                  className={`bi bi-${i.state === 'done' ? 'check-circle-fill' : i.state === 'error' ? 'exclamation-circle-fill' : 'image'}`}
                  aria-hidden="true"
                />
                <div className="upload-meta">
                  <div className="upload-name">
                    <span title={i.file.name}>{i.file.name}</span>
                    <small>{formatBytes(i.file.size)}</small>
                  </div>
                  {i.state === 'error' ? (
                    <p className="field-error">{i.error}</p>
                  ) : (
                    <div className="progress" role="progressbar" aria-valuenow={i.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${i.file.name} upload`}>
                      <span style={{ width: `${i.progress}%` }} />
                    </div>
                  )}
                </div>
                {i.state === 'error' && ACCEPT.includes(i.file.type) && i.file.size <= maxMb * 1024 * 1024 && !/Duplicate/i.test(i.error ?? '') && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => retry(i)}>
                    Retry
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
