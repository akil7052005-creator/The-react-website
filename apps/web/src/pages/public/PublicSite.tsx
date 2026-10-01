import { useQuery } from '@tanstack/react-query'
import type { PublicWebsiteDto } from '@weddyzone/shared'
import { useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { SiteView } from '../../components/website/SiteView'
import { EmptyState, ErrorState, Skeleton } from '../../components/ui'
import { api, isApiError } from '../../lib/api'

/** The studio's public portfolio website at /w/:slug (no login). */
export default function PublicSite() {
  const { slug = '' } = useParams()
  const counted = useRef(false)
  const q = useQuery({ queryKey: ['public-site', slug], queryFn: () => api.get<PublicWebsiteDto>(`/public/sites/${slug}`), retry: false })

  useEffect(() => {
    if (!q.data) return
    document.title = q.data.settings.seoTitle || q.data.studio.name
    const meta = document.querySelector('meta[name="description"]')
    if (meta && q.data.settings.seoDescription) meta.setAttribute('content', q.data.settings.seoDescription)
    if (!counted.current) {
      counted.current = true
      void api.post(`/public/sites/${slug}/visit`).catch(() => undefined)
    }
  }, [q.data, slug])

  if (q.isPending) return <Skeleton height="100vh" radius={0} />
  if (q.isError || !q.data) {
    return (
      <div className="public-shell">
        <div className="public-wrap" style={{ paddingTop: 40 }}>
          <div className="card">
            {isApiError(q.error) && q.error.status === 404 ? (
              <EmptyState icon="globe2" title="Website not found" text="Check the link and try again." />
            ) : (
              <ErrorState error={q.error} onRetry={() => q.refetch()} />
            )}
          </div>
        </div>
      </div>
    )
  }
  return <SiteView data={q.data} settings={q.data.settings} />
}
