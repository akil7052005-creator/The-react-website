import { useState } from 'react'
import { StatusPill, FeatureTooltip } from './ui'
import FlipbookModal from './FlipbookModal'

function AlbumCard({ album }) {
  const [showFlipbook, setShowFlipbook] = useState(false)

  return (
    <>
      <FeatureTooltip
        title={`${album.title} — 3D Flipbook`}
        badge={`${album.pages} Spreads`}
        icon="journal-album"
        summary={`Curated wedding collection containing ${album.photos} photos across ${album.pages} designer pages. Status is currently ${album.status}. Click to open 3D preview!`}
        highlights={[
          'Interactive page curling with realistic paper sound',
          'Bridal zoom mode for intricate jewelry & textile details',
          'One-click client approval for physical print lab output'
        ]}
        metric={`Last updated: ${album.updated || 'Recently'}`}
        tip="Click anywhere on this album to launch the interactive 3D virtual flipbook!"
        position="top"
        width={300}
        delay={120}
      >
        <article
          className="album album-catchy"
          onClick={() => setShowFlipbook(true)}
          tabIndex={0}
          role="button"
          aria-label={`Open 3D Flipbook for ${album.title}`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setShowFlipbook(true)
            }
          }}
        >
          <div className="cover" style={{ '--h': album.hue }}>
            <span className="cover-title">{album.title}</span>
            <StatusPill status={album.status} />
            <div className="cover-overlay-glow" />
            <span className="cover-hover-prompt"><i className="bi bi-eye" /> Click to Open 3D Album</span>
          </div>
          <div className="album-body">
            <div className="album-body-top">
              <h3>{album.title}</h3>
              <span className="album-id mono">{album.id}</span>
            </div>
            <p className="cell-sub">{album.subtitle}</p>
            <div className="album-meta">
              <span><i className="bi bi-image" />{album.photos} photos</span>
              <span><i className="bi bi-book" />{album.pages} pages</span>
              <span className="album-interactive-tag"><i className="bi bi-magic" /> Click to View</span>
            </div>
          </div>
        </article>
      </FeatureTooltip>

      <FlipbookModal
        album={album}
        isOpen={showFlipbook}
        onClose={() => setShowFlipbook(false)}
      />
    </>
  )
}

export default AlbumCard
