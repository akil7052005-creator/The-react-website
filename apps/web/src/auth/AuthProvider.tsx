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
    // Platform admins have no studio; their home is the admin area.
    return <Navigate to={me.data.user.role === 'SUPER_ADMIN' ? '/admin' : '/login'} replace />
  }
  return <AuthContext.Provider value={me.data}>{children}</AuthContext.Provider>
}

const AdminContext = createContext<MeDto | null>(null)

/** The signed-in platform admin. Only use inside <RequireAdmin>. */
export function useAdmin(): MeDto {
  const me = useContext(AdminContext)
  if (!me) throw new Error('useAdmin() used outside the admin area')
  return me
}

/**
 * Guards the /admin area: only platform admins (SUPER_ADMIN) get in. Anyone else sees
 * "Page not found", so studio users are not told the admin area exists. The API checks
 * the role again on every admin request.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const me = useMeQuery()
  const location = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isAdmin = me.data?.user.role === 'SUPER_ADMIN'

  useEffect(
    () =>
      onSessionExpired(() => {
        if (!isAdmin) return
        qc.clear()
        toast.error('Admin session expired, please log in again', { id: 'session-expired' })
        navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true })
      }),
    [isAdmin, navigate, qc, location.pathname, location.search],
  )

  if (me.isPending) return <PageSkeleton />
  if (me.isError) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (!isAdmin) {
    return (
      <div className="center-page">
        <div className="card">
          <div className="empty">
            <span className="empty-icon">
              <i className="bi bi-signpost-split" />
            </span>
            <h3>Page not found</h3>
            <p>The page you're looking for doesn't exist or has moved.</p>
            <a href="/" className="btn btn-primary">
              Back to dashboard
            </a>
          </div>
        </div>
      </div>
    )
  }
  return <AdminContext.Provider value={me.data}>{children}</AdminContext.Provider>
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
