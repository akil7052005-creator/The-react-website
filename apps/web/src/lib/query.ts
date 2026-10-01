import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ApiError, isApiError } from './api'

// Errors that open a dedicated dialog (upgrade / top-up) instead of a toast.
type GlobalErrorKind = 'PLAN_LIMIT' | 'INSUFFICIENT_CREDITS'
type Handler = (e: ApiError) => void
const handlers = new Map<GlobalErrorKind, Set<Handler>>()

export function onGlobalError(kind: GlobalErrorKind, fn: Handler) {
  if (!handlers.has(kind)) handlers.set(kind, new Set())
  handlers.get(kind)!.add(fn)
  return () => {
    handlers.get(kind)!.delete(fn)
  }
}

function dispatchGlobal(e: unknown): boolean {
  if (isApiError(e) && (e.code === 'PLAN_LIMIT' || e.code === 'INSUFFICIENT_CREDITS')) {
    handlers.get(e.code)?.forEach((fn) => fn(e))
    return true
  }
  return false
}

/** Shows the API's message as an error toast (unless a global dialog handles it). */
export function toastError(e: unknown, fallback = 'Something went wrong. Please try again.') {
  if (dispatchGlobal(e)) return
  if (isApiError(e) && (e.code === 'UNAUTHENTICATED' || e.code === 'TOKEN_EXPIRED')) return
  toast.error(e instanceof Error && e.message ? e.message : fallback)
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (e) => {
      dispatchGlobal(e)
    },
  }),
  mutationCache: new MutationCache({
    onError: (e, _vars, _ctx, mutation) => {
      // Mutations without their own onError still tell the user what happened.
      if (!mutation.options.onError) toastError(e)
      else dispatchGlobal(e)
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, e) => (isApiError(e) && e.status > 0 && e.status < 500 ? false : count < 1),
    },
    mutations: { retry: false },
  },
})
