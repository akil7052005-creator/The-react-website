import { useEffect } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { EmptyState } from '../components/ui'

/**
 * Shown when a page crashes. Replaces React Router's default error screen, which prints the
 * error's stack trace to the user even in production builds. Details go to the console only.
 */
function RouteError() {
  const error = useRouteError()
  useEffect(() => {
    console.error(error)
  }, [error])

  const notFound = isRouteErrorResponse(error) && error.status === 404
  return (
    <div className="center-page">
      <div className="card">
        <EmptyState
          icon={notFound ? 'signpost-split' : 'exclamation-triangle'}
          title={notFound ? 'Page not found' : 'Something went wrong'}
          text={notFound ? "The page you're looking for doesn't exist or has moved." : 'This page ran into a problem. Please reload, or go back to your dashboard.'}
          action={
            <div className="page-actions">
              {!notFound && (
                <button className="btn btn-ghost" onClick={() => window.location.reload()}>
                  Reload
                </button>
              )}
              <a href="/" className="btn btn-primary">
                Back to dashboard
              </a>
            </div>
          }
        />
      </div>
    </div>
  )
}

export default RouteError
