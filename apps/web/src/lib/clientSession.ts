import { request } from './api'
import { fileUrl } from './env'

// The customer portal keeps its token (one selection only, a few hours) in sessionStorage: it ends
// with the tab, and never mixes with a studio login on the same browser.

const key = (selectionId: string) => `wz-client-${selectionId}`

export const clientSession = {
  get(selectionId: string): string | null {
    try {
      return sessionStorage.getItem(key(selectionId))
    } catch {
      return null
    }
  },
  set(selectionId: string, token: string) {
    try {
      sessionStorage.setItem(key(selectionId), token)
    } catch {
      /* private mode: the gallery works until the page is reloaded */
    }
    memory.set(selectionId, token)
  },
  clear(selectionId: string) {
    try {
      sessionStorage.removeItem(key(selectionId))
    } catch {
      /* ignore */
    }
    memory.delete(selectionId)
  },
  /** The share link the customer came in by, so an ended session goes back to its code screen. */
  setLink(selectionId: string, shareToken: string) {
    try {
      sessionStorage.setItem(`${key(selectionId)}-link`, shareToken)
    } catch {
      /* private mode */
    }
    memory.set(`${selectionId}-link`, shareToken)
  },
  linkOf(selectionId: string): string | null {
    try {
      return sessionStorage.getItem(`${key(selectionId)}-link`) ?? memory.get(`${selectionId}-link`) ?? null
    } catch {
      return memory.get(`${selectionId}-link`) ?? null
    }
  },
}

/** Where to enter the code again: the share link's screen, else the code-only page. */
export const clientAuthPath = (selectionId: string) => {
  const link = clientSession.linkOf(selectionId)
  return link ? `/select/${link}` : '/selection/auth'
}

/** Fallback when sessionStorage is blocked. */
const memory = new Map<string, string>()
const tokenOf = (selectionId: string) => clientSession.get(selectionId) ?? memory.get(selectionId) ?? ''

/** API calls for one selection, sending its token. */
export function clientApi(selectionId: string) {
  const headers = () => ({ 'X-Client-Token': tokenOf(selectionId) })
  return {
    get: <T>(path: string, query?: Record<string, string | number | undefined>) => request<T>('GET', path, { query, headers: headers() }),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {}, headers: headers() }),
    patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body: body ?? {}, headers: headers() }),
  }
}

export const hasClientToken = (selectionId: string) => !!tokenOf(selectionId)

/** A portal file URL (photo, video, download, ZIP) with the token, since <img> can't send headers. */
export function clientFileUrl(selectionId: string, path: string) {
  return fileUrl(`${path}${path.includes('?') ? '&' : '?'}t=${encodeURIComponent(tokenOf(selectionId))}`)!
}
