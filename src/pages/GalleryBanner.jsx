import { PageHeader, Card, StatusPill } from '../components/ui'
import db from '../data'
import poster from '../assets/wedding-poster-horizontal.png'

function GalleryBanner() {
  return (
    <div className="stack">
      <PageHeader
        eyebrow="Business"
        title="Gallery Banners"
        subtitle="Hero banners shown at the top of client galleries and your website. Use 1920 × 1080 images."
      />

      <label className="dropzone">
        <input type="file" accept="image/*" />
        <i className="bi bi-cloud-arrow-up" />
        <strong>Drop a banner here, or click to upload</strong>
        <span className="muted">PNG, JPG or WebP · up to 5 MB</span>
      </label>

      <div className="album-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
        {db.banners.map((b) => (
          <article className="album" key={b.id}>
            {b.image ? (
              <img src={poster} alt={b.title} style={{ aspectRatio: '16 / 9', objectFit: 'cover', width: '100%' }} />
            ) : (
              <div className="cover" style={{ '--h': b.hue, aspectRatio: '16 / 9' }}>
                <span className="cover-title">{b.title}</span>
              </div>
            )}
            <div className="album-body row-between">
              <div>
                <h3>{b.title}</h3>
                <p className="cell-sub">{b.placement}</p>
              </div>
              <StatusPill status={b.status} />
            </div>
          </article>
        ))}
      </div>

      <Card title="Tips for great banners">
        <ul className="checklist" style={{ marginBottom: 0 }}>
          <li><i className="bi bi-check-circle-fill" />Keep text on one side so faces aren't covered on mobile.</li>
          <li><i className="bi bi-check-circle-fill" />Export as WebP — it loads up to 5× faster than PNG.</li>
          <li><i className="bi bi-check-circle-fill" />Schedule seasonal offers so they switch on automatically.</li>
        </ul>
      </Card>
    </div>
  )
}

export default GalleryBanner
