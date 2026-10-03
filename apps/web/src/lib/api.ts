import type { ApiErrorBody } from '@weddyzone/shared'
import { API_BASE } from './env'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError

// Listeners are told when the session is gone (refresh failed) so the app can redirect to /login.
type Listener = () => void
const sessionExpiredListeners = new Set<Listener>()
export function onSessionExpired(fn: Listener) {
  sessionExpiredListeners.add(fn)
  return () => {
    sessionExpiredListeners.delete(fn)
  }
}

let refreshing: Promise<boolean> | null = null

/** One refresh at a time: concurrent 401s wait for the same refresh call. */
function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${API_BASE}/api/v1/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      setTimeout(() => (refreshing = null), 0)
    })
  return refreshing
}

async function toError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> & { error?: { details?: Record<string, unknown> } } = {}
  try {
    body = await res.json()
  } catch {
    /* not JSON (e.g. proxy error page) */
  }
  const e = body.error
  if (e?.code) return new ApiError(res.status, e.code, e.message, e.fields, e.details)
  if (res.status === 0 || res.status >= 502) {
    return new ApiError(res.status, 'NETWORK', 'We could not reach the server. Check your connection and try again.')
  }
  return new ApiError(res.status, 'HTTP_ERROR', `Request failed (${res.status})`)
}

const AUTH_PATHS = ['/auth/login', '/auth/signup', '/auth/refresh', '/auth/logout', '/auth/forgot-password', '/auth/reset-password']

interface RequestOptions {
  body?: unknown
  query?: Record<string, string | number | boolean | undefined | null>
  signal?: AbortSignal
  /** Extra request headers (e.g. the gallery access key on public pages). */
  headers?: Record<string, string>
}

function buildUrl(path: string, query?: RequestOptions['query']) {
  const url = `${API_BASE}/api/v1${path}`
  if (!query) return url
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  }
  const s = qs.toString()
  return s ? `${url}?${s}` : url
}

export async function request<T>(method: string, path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData
  let res: Response
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      credentials: 'include',
      signal: opts.signal,
      headers: { ...(opts.body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(0, 'NETWORK', 'We could not reach the server. Check your connection and try again.')
  }

  if (res.status === 401 && !retried && !AUTH_PATHS.some((p) => path.startsWith(p))) {
    if (await refreshSession()) return request<T>(method, path, opts, true)
    sessionExpiredListeners.forEach((fn) => fn())
  }
  if (!res.ok) throw await toError(res)
  if (res.status === 204) return undefined as T
  const type = res.headers.get('content-type') ?? ''
  return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) => request<T>('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body: body ?? {} }),
  delete: <T>(path: string) => request<T>('DELETE', path),
}

/**
 * Multipart upload with progress (fetch cannot report upload progress, XHR can).
 * Retries once after a silent refresh, like `request`.
 */
export function upload<T>(
  path: string,
  form: FormData,
  onProgress?: (pct: number) => void,
  retried = false,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', buildUrl(path))
    xhr.withCredentials = true
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK', 'Upload failed — check your connection and try again.'))
    xhr.onload = async () => {
      if (xhr.status === 401 && !retried) {
        if (await refreshSession()) {
          upload<T>(path, form, onProgress, true).then(resolve, reject)
          return
        }
        sessionExpiredListeners.forEach((fn) => fn())
      }
      let body: unknown = null
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body as T)
      const e = (body as Partial<ApiErrorBody> | null)?.error
      reject(
        e?.code
          ? new ApiError(xhr.status, e.code, e.message, e.fields)
          : new ApiError(xhr.status, 'HTTP_ERROR', xhr.status === 413 ? 'File is too large' : `Upload failed (${xhr.status})`),
      )
    }
    xhr.send(form)
  })
}

/** Downloads an authenticated file (e.g. CSV export) and saves it with the given name. */
export async function download(path: string, filename: string) {
  const res = await fetch(buildUrl(path), { credentials: 'include' })
  if (res.status === 401 && (await refreshSession())) return download(path, filename)
  if (!res.ok) throw await toError(res)
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
