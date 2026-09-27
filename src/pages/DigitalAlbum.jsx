import { useState } from 'react'
import { PageHeader, EmptyState } from '../components/ui'
import AlbumCard from '../components/AlbumCard'
import db from '../data'

const filters = ['All', 'Published', 'In Review', 'Draft']

function DigitalAlbum() {
  const [filter, setFilter] = useState('All')
  const albums = filter === 'All' ? db.albums : db.albums.filter((a) => a.status === filter)

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Services"
        title="Digital Albums"
        subtitle="Beautiful flipbook albums your couples can share with family anywhere in the world."
        actions={<button className="btn btn-primary"><i className="bi bi-plus-lg" />Create Album</button>}
      />

      <div className="tabs" role="tablist">
        {filters.map((f) => (
          <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)} role="tab" aria-selected={filter === f}>
            {f}
          </button>
        ))}
      </div>

      {albums.length > 0 ? (
        <div className="album-grid">
          {albums.map((a) => (
            <AlbumCard key={a.id} album={a} />
          ))}
        </div>
      ) : (
        <div className="card">
          <EmptyState icon="journal-album" title="No albums here yet" text="Albums you move into this stage will show up here." />
        </div>
      )}
    </div>
  )
}

export default DigitalAlbum
