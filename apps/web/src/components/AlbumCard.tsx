import { ALBUM_STATUS_LABELS, type AlbumDto } from '@weddyzone/shared'
import { StatusPill, FeatureTooltip } from './ui'
import { formatDate } from '../utils/format'

function AlbumCard({ album, onOpen }: { album: AlbumDto; onOpen: (album: AlbumDto) => void }) {
  const spreads = Math.ceil(album.pageCount / 2)
  const status = ALBUM_STATUS_LABELS[album.status]

  return (
    <FeatureTooltip
      title={`${album.title} — Flipbook`}
      badge={`${spreads} Spreads`}
      icon="journal-album"
      summary={`Wedding collection with ${album.pageCount} photos across ${spreads} spreads. Status is currently ${status}.${
        album.openFeedbackCount ? ` ${album.openFeedbackCount} open client note(s).` : ''
      } Click to open the flipbook.`}
      highlights={[
        'Interactive page turning with spread-by-spread navigation',
        'Bridal zoom mode for intricate jewelry & textile details',
        'Client sign-off per spread before print',
      ]}
      metric={`Last updated: ${formatDate(album.updatedAt)}`}
      tip="Click anywhere on this album to open the flipbook."
      position="top"
      width={300}
      delay={120}
    >
      <article
        className="album album-catchy"
        onClick={() => onOpen(album)}
        tabIndex={0}
        role="button"
        aria-label={`Open Flipbook for ${album.title}`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen(album)
          }
        }}
      >
        <div className="cover" style={{ '--h': album.hue } as React.CSSProperties}>
          <span className="cover-title">{album.title}</span>
          <StatusPill status={status} />
          <div className="cover-overlay-glow" />
          <span className="cover-hover-prompt">
            <i className="bi bi-eye" /> Click to Open Album
          </span>
        </div>
        <div className="album-body">
          <div className="album-body-top">
            <h3>{album.title}</h3>
            <span className="album-id mono">{album.code}</span>
          </div>
          <p className="cell-sub">{album.subtitle || album.event.title}</p>
          <div className="album-meta">
            <span>
              <i className="bi bi-image" />
              {album.pageCount} photos
            </span>
            <span>
              <i className="bi bi-book" />
              {album.pageCount} pages
            </span>
            {album.openFeedbackCount > 0 ? (
              <span className="album-interactive-tag">
                <i className="bi bi-chat-square-quote" /> {album.openFeedbackCount} note{album.openFeedbackCount > 1 ? 's' : ''}
              </span>
            ) : (
              <span className="album-interactive-tag">
                <i className="bi bi-magic" /> Click to View
              </span>
            )}
          </div>
        </div>
      </article>
    </FeatureTooltip>
  )
}

export default AlbumCard
