import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { MeDto } from '@weddyzone/shared'
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api, isApiError, onSessionExpired } from '../lib/api'
import { PageSkeleton } from '../components/ui'

export const ME_KEY = ['me'] as const

const AuthContext = createContext<MeDto | null>(null)

export function useMeQuery() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: () => api.get<MeDto>('/auth/me'),
    staleTime: 60_000,
    retry: false,
  })
}

/** The logged-in user + studio. Only use inside <RequireAuth>. */
export function useMe(): MeDto & { studio: NonNullable<MeDto['studio']> } {
  const me = useContext(AuthContext)
  if (!me?.studio) throw new Error('useMe() used outside an authenticated studio route')
  return me as MeDto & { studio: NonNullable<MeDto['studio']> }
}

/** Redirects to /login when there is no session; shows a skeleton while checking. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMeQuery()
  const location = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const hadSession = useRef(false)
  const loggedIn = Boolean(me.data?.studio)
  useEffect(() => {
    if (loggedIn) hadSession.current = true
  }, [loggedIn])

  useEffect(
    () =>
      onSessionExpired(() => {
        // First visit without a session: the redirect below handles it quietly.
        if (!hadSession.current) return
        hadSession.current = false
        qc.clear()
        toast.error('Session expired, please log in again', { id: 'session-expired' })
        navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true })
      }),
    [navigate, qc, location.pathname, location.search],
  )

  if (me.isPending) return <PageSkeleton />
  if (me.isError) {
    if (isApiError(me.error) && me.error.status === 401) {
      return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
    }
    return <Navigate to="/login" replace />
  }
  if (!me.data.studio) {
    // Platform admins have no studio dashboard in v1 (they use the admin API).
    return <Navigate to="/login?admin=1" replace />
  }
  return <AuthContext.Provider value={me.data}>{children}</AuthContext.Provider>
}

/** For login/signup pages: already logged-in users go straight to the dashboard. */
export function RedirectIfAuthed({ children, to = '/' }: { children: ReactNode; to?: string }) {
  const me = useMeQuery()
  const location = useLocation()
  if (me.isPending) return <PageSkeleton />
  if (me.data?.studio) {
    const next = new URLSearchParams(location.search).get('next')
    return <Navigate to={next && next.startsWith('/') && !next.startsWith('//') ? next : to} replace />
  }
  return <>{children}</>
}
