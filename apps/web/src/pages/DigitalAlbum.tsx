import { useQuery } from '@tanstack/react-query'
import { type AlbumDto, type AlbumStatus, type Paginated } from '@weddyzone/shared'
import {
  PageHeader,
  EmptyState,
  ErrorState,
  FeatureTooltip,
  FeatureBar,
  StatCard,
  Skeleton,
  Pagination,
  type FeatureBarItem,
} from '../components/ui'
import AlbumCard from '../components/AlbumCard'
import { AlbumViewer } from '../components/AlbumViewer'
import { CreateAlbumModal } from '../components/album/CreateAlbumModal'
import { useDebouncedUrlSearch, useUrlState } from '../hooks/useUrlState'
import { api } from '../lib/api'

const filters: { key: '' | AlbumStatus; label: string; count: keyof Summary }[] = [
  { key: '', label: 'All', count: 'all' },
  { key: 'PUBLISHED', label: 'Published', count: 'PUBLISHED' },
  { key: 'IN_REVIEW', label: 'In Review', count: 'IN_REVIEW' },
  { key: 'DRAFT', label: 'Draft', count: 'DRAFT' },
]

interface Summary {
  all: number
  PUBLISHED: number
  IN_REVIEW: number
  DRAFT: number
}

const albumFeatures: FeatureBarItem[] = [
  {
    title: 'Client Spread Feedback',
    badge: 'Annotations',
    icon: 'chat-square-quote',
    summary: 'Couples and parents can leave comments on any page spread of the album.',
    highlights: ['Pinpoint photo swaps without ambiguous email threads', 'Studio is notified of new feedback', 'One-click client approval for each spread'],
    tip: 'Eliminates miscommunication before sending albums to expensive print labs.'
  }
]

function DigitalAlbum() {
  const [url, setUrl] = useUrlState({ status: '', search: '', page: '1', album: '', create: '' })
  const [search, setSearch] = useDebouncedUrlSearch(url.search, (v) => setUrl({ search: v }))
  const page = Math.max(1, Number(url.page) || 1)

  const summary = useQuery({ queryKey: ['albums-summary'], queryFn: () => api.get<Summary>('/albums/summary') })
  const list = useQuery({
    queryKey: ['albums', { status: url.status, search: url.search, page }],
    queryFn: () => api.get<Paginated<AlbumDto>>('/albums', { status: url.status, search: url.search, page, limit: 12 }),
    placeholderData: (prev) => prev,
  })
  const counts = summary.data
  const albums = list.data?.data ?? []
  const current = filters.find((f) => f.key === url.status) ?? filters[0]

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Services"
        featureBadge="Flipbook & Client Proofing"
        title="Digital Albums Studio"
        subtitle="Flipbook albums your couples can preview, comment on and share with family before printing."
        actions={
          <FeatureTooltip
            title="Create Digital Album"
            badge="Layout Studio"
            icon="plus-circle"
            summary="Pick an event's photos in page order to build a flipbook album in seconds."
            position="bottom"
            width={280}
          >
            <button className="btn btn-primary" onClick={() => setUrl({ create: '1' })}>
              <i className="bi bi-plus-lg" />
              Create Album
            </button>
          </FeatureTooltip>
        }
      />

      {/* Feature Capabilities Ribbon */}
      <FeatureBar items={albumFeatures} />

      {/* Quick Album Stats */}
      <div className="grid grid-3">
        <StatCard
          icon="check-circle"
          label="Published Albums"
          value={counts ? counts.PUBLISHED : '—'}
          tone="green"
          tooltip={{
            title: 'Live Published Flipbooks',
            badge: `${counts?.PUBLISHED ?? 0} Live`,
            icon: 'check-circle',
            summary: 'Albums that have completed client review and can be opened by anyone with the link.',
            highlights: ['Active CDN streaming', 'Worldwide family access enabled'],
          }}
        />
        <StatCard
          icon="chat-left-dots"
          label="In Review"
          value={counts ? counts.IN_REVIEW : '—'}
          tone="gold"
          tooltip={{
            title: 'Albums Awaiting Client Sign-Off',
            badge: `${counts?.IN_REVIEW ?? 0} Reviewing`,
            icon: 'chat-left-dots',
            summary: 'Couples are currently reviewing spreads, leaving revision notes, or approving final print files.',
            highlights: ['Pinpoint revision notes active', 'Print lab export locks until client signs off'],
          }}
        />
        <StatCard
          icon="pencil-square"
          label="Draft Layouts"
          value={counts ? counts.DRAFT : '—'}
          tone="wine"
          tooltip={{
            title: 'Studio Draft Layouts',
            badge: `${counts?.DRAFT ?? 0} Drafts`,
            icon: 'pencil-square',
            summary: 'Albums being assembled by your design team; private to studio until published to client.',
            highlights: ['Internal spread culling', 'Drag and drop page reordering'],
          }}
        />
      </div>

      <div className="row-between" style={{ alignItems: 'center', marginTop: 4, flexWrap: 'wrap', gap: 12 }}>
        <div className="tabs" role="tablist">
          {filters.map((f) => (
            <button key={f.label} className={url.status === f.key ? 'on' : ''} onClick={() => setUrl({ status: f.key })} role="tab" aria-selected={url.status === f.key}>
              {f.label}
              <span className="tab-count">({counts ? counts[f.count] : '…'})</span>
            </button>
          ))}
        </div>

        <label className="search" style={{ maxWidth: 300 }}>
          <i className="bi bi-search" />
          <input type="search" placeholder="Search albums" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search albums" />
        </label>
      </div>

      {list.isPending ? (
        <div className="album-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={260} radius={16} />
          ))}
        </div>
      ) : list.isError ? (
        <div className="card">
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        </div>
      ) : albums.length > 0 ? (
        <>
          <div className="album-grid">
            {albums.map((a) => (
              <AlbumCard key={a.id} album={a} onOpen={(x) => setUrl({ album: x.id })} />
            ))}
          </div>
          <Pagination page={page} limit={list.data.meta.limit} total={list.data.meta.total} onPage={(p) => setUrl({ page: String(p) })} />
        </>
      ) : (
        <div className="card">
          <EmptyState
            icon="journal-album"
            title={url.search ? 'No albums match your search' : url.status ? `No ${current.label.toLowerCase()} albums here yet` : 'No albums yet'}
            text={url.status ? 'Albums you move into this stage will show up here automatically.' : 'Create a flipbook from an event’s photos.'}
            action={
              <button className="btn btn-primary" onClick={() => setUrl({ create: '1' })}>
                <i className="bi bi-plus-lg" /> Create Album
              </button>
            }
          />
        </div>
      )}

      <CreateAlbumModal open={url.create === '1'} onClose={() => setUrl({ create: '' })} onCreated={(a) => setUrl({ create: '', album: a.id })} />
      {url.album && <AlbumViewer albumId={url.album} onClose={() => setUrl({ album: '' })} />}
    </div>
  )
}

export default DigitalAlbum
