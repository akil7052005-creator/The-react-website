// Upload progress kept in IndexedDB, so a closed tab or a dropped connection can resume: which files
// of an event's upload are already done, and the photo id given to each file still in flight (a
// resumed file reuses it, so its copies land on the same keys and it is never recorded twice).
// Browsers can't keep the picked files themselves, so resuming asks for the same folder again and
// skips what is done. Everything here is best effort: without IndexedDB the upload still works.

export interface SavedUpload {
  selectionId: string
  /** Files in the upload when it started. */
  total: number
  /** fileKey of every file that is uploaded, already online, or skipped. */
  done: string[]
  /** fileKey → photo id for files that were signed but not finished. */
  inflight: Record<string, string>
  /** The picked folders' names, to remind the studio which folder to choose again. */
  folders: string[]
  updatedAt: number
}

const DB = 'wz-uploads'
const STORE = 'uploads'

/** A file as the upload knows it: its path under the picked folder, size and last-modified time. */
export const fileKey = (f: { relativePath: string; size: number; lastModified: number }) => `${f.relativePath}|${f.size}|${f.lastModified}`

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'selectionId' })
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | null> {
  const db = await open()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode)
      const req = fn(t.objectStore(STORE))
      t.oncomplete = () => {
        resolve(req ? (req.result as T) : null)
        db.close()
      }
      t.onerror = () => {
        resolve(null)
        db.close()
      }
    } catch {
      resolve(null)
      db.close()
    }
  })
}

export const uploadStore = {
  async get(selectionId: string): Promise<SavedUpload | null> {
    return (await tx<SavedUpload | undefined>('readonly', (s) => s.get(selectionId))) ?? null
  },
  async put(u: SavedUpload): Promise<void> {
    await tx('readwrite', (s) => s.put({ ...u, updatedAt: Date.now() }))
  },
  async clear(selectionId: string): Promise<void> {
    await tx('readwrite', (s) => s.delete(selectionId))
  },
}

/**
 * Writes progress at most every `ms` (and on flush), so a 1,000-photo upload doesn't write 1,000
 * times a minute.
 */
export function progressWriter(base: Omit<SavedUpload, 'updatedAt'>, ms = 1500) {
  const state = { ...base, done: [...base.done], inflight: { ...base.inflight } }
  const seen = new Set(state.done)
  let timer: ReturnType<typeof setTimeout> | null = null
  const write = () => {
    timer = null
    void uploadStore.put({ ...state, done: [...state.done], inflight: { ...state.inflight }, updatedAt: Date.now() })
  }
  const soon = () => {
    timer ??= setTimeout(write, ms)
  }
  return {
    state,
    signed(key: string, photoId: string) {
      state.inflight[key] = photoId
      soon()
    },
    finished(key: string) {
      delete state.inflight[key]
      if (!seen.has(key)) {
        seen.add(key)
        state.done.push(key)
      }
      soon()
    },
    flush() {
      if (timer) clearTimeout(timer)
      write()
    },
  }
}
