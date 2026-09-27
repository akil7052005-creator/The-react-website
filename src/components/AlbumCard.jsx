import { StatusPill } from './ui'

function AlbumCard({ album }) {
  return (
    <article className="album">
      <div className="cover" style={{ '--h': album.hue }}>
        <span className="cover-title">{album.title}</span>
        <StatusPill status={album.status} />
      </div>
      <div className="album-body">
        <h3>{album.title}</h3>
        <p className="cell-sub">{album.subtitle}</p>
        <div className="album-meta">
          <span><i className="bi bi-image" />{album.photos} photos</span>
          <span><i className="bi bi-book" />{album.pages} pages</span>
        </div>
      </div>
    </article>
  )
}

export default AlbumCard
