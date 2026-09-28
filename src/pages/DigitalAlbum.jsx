import { useState } from 'react'
import { PageHeader, EmptyState, FeatureTooltip, FeatureBar, StatCard } from '../components/ui'
import AlbumCard from '../components/AlbumCard'
import FlipbookModal from '../components/FlipbookModal'
import db from '../data'
import { featureInfo } from '../data/featureInfo'

const filters = ['All', 'Published', 'In Review', 'Draft']

const albumFeatures = [
  {
    title: '3D Photorealistic Physics',
    badge: '3D Engine',
    icon: 'book',
    summary: 'Turn designed wedding spreads into virtual flipbooks with realistic page curling and paper sounds.',
    highlights: ['Multi-touch gesture support on iPads & phones', 'Double-page panoramic spreads with zero distortion', 'Silk / Gloss / Matte paper texture simulation'],
    tip: 'Clients view 3D flipbooks 4x longer than static PDF proofing links.'
  },
  {
    title: 'Client Spread Feedback',
    badge: 'Live Annotations',
    icon: 'chat-square-quote',
    summary: 'Couples and parents can leave sticky comments directly on any photo or page spread.',
    highlights: ['Pinpoint photo swaps without ambiguous email threads', 'Studio reply notifications in real-time', 'One-click client sign-off when approved'],
    tip: 'Eliminates miscommunication before sending albums to expensive print labs.'
  },
  {
    title: 'Lab Print-Ready Export',
    badge: '300 DPI CMYK',
    icon: 'printer',
    summary: 'Export high-resolution PDF spreads formatted with bleed marks for top print labs across India.',
    highlights: ['Supports Canvera, Photostop, and local lab dimensions', 'Automatic CMYK color profile conversion', 'Bleed & margin safe-zone verification'],
    tip: 'Verifies resolution so images never print blurry.'
  },
  {
    title: 'Family Cloud Access',
    badge: 'Worldwide Sync',
    icon: 'cloud-check',
    summary: 'Share private albums with family and friends anywhere in the world via secure PIN protection.',
    highlights: ['Password & PIN security locks', 'Streamed from CDN with zero buffering', 'Social share preview cards with studio branding'],
    tip: 'Couples love sharing the link with overseas relatives.'
  }
]

function DigitalAlbum() {
  const [filter, setFilter] = useState('All')
  const albums = filter === 'All' ? db.albums : db.albums.filter((a) => a.status === filter)

  const publishedCount = db.albums.filter((a) => a.status === 'Published').length
  const inReviewCount = db.albums.filter((a) => a.status === 'In Review').length
  const draftCount = db.albums.filter((a) => a.status === 'Draft').length

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Services"
        featureBadge="3D Flipbook & Client Proofing"
        title="Digital Albums Studio"
        subtitle="Stunning photorealistic flipbook albums your couples can preview and share with family worldwide before printing."
        actions={
          <FeatureTooltip
            title="Create 3D Digital Album"
            badge="Layout Studio"
            icon="plus-circle"
            summary="Upload designed panoramic spreads to generate an interactive 3D virtual flipbook in seconds."
            position="bottom"
            width={280}
          >
            <button className="btn btn-primary">
              <i className="bi bi-plus-lg" />Create Album
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
          value={publishedCount}
          tone="green"
          tooltip={{
            title: 'Live Published Flipbooks',
            badge: `${publishedCount} Live`,
            icon: 'check-circle',
            summary: 'Albums that have completed client review and are accessible worldwide with interactive 3D controls.',
            highlights: ['Active CDN streaming', 'Worldwide family access enabled']
          }}
        />
        <StatCard
          icon="chat-left-dots"
          label="In Review"
          value={inReviewCount}
          tone="gold"
          tooltip={{
            title: 'Albums Awaiting Client Sign-Off',
            badge: `${inReviewCount} Reviewing`,
            icon: 'chat-left-dots',
            summary: 'Couples are currently reviewing spreads, leaving revision notes, or approving final print files.',
            highlights: ['Pinpoint revision notes active', 'Print lab export locks until client signs off']
          }}
        />
        <StatCard
          icon="pencil-square"
          label="Draft Layouts"
          value={draftCount}
          tone="wine"
          tooltip={{
            title: 'Studio Draft Layouts',
            badge: `${draftCount} Drafts`,
            icon: 'pencil-square',
            summary: 'Albums being assembled by your design team; private to studio until published to client.',
            highlights: ['Internal spread culling', 'Drag and drop page reordering']
          }}
        />
      </div>

      <div className="row-between" style={{ alignItems: 'center', marginTop: 4 }}>
        <div className="tabs" role="tablist">
          {filters.map((f) => (
            <button
              key={f}
              className={filter === f ? 'on' : ''}
              onClick={() => setFilter(f)}
              role="tab"
              aria-selected={filter === f}
            >
              {f}
              <span className="tab-count">
                ({f === 'All' ? db.albums.length : db.albums.filter((a) => a.status === f).length})
              </span>
            </button>
          ))}
        </div>

        <span className="muted" style={{ fontSize: 13 }}>
          <i className="bi bi-mouse" /> Hover cursor on any album to view spread specs & 3D options
        </span>
      </div>

      {albums.length > 0 ? (
        <div className="album-grid">
          {albums.map((a) => (
            <AlbumCard key={a.id} album={a} />
          ))}
        </div>
      ) : (
        <div className="card">
          <EmptyState
            icon="journal-album"
            title={`No ${filter.toLowerCase()} albums here yet`}
            text="Albums you move into this stage will show up here automatically."
          />
        </div>
      )}
    </div>
  )
}

export default DigitalAlbum
