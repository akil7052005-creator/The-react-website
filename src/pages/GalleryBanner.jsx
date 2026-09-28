import { PageHeader, Card, StatusPill, FeatureTooltip, FeatureBar } from '../components/ui'
import db from '../data'
import { featureInfo } from '../data/featureInfo'
import poster from '../assets/wedding-poster-horizontal.png'

const bannerFeatures = [
  {
    title: 'Seasonal Auto-Rotation',
    badge: 'Marketing',
    icon: 'calendar-range',
    summary: 'Schedule promotional banners to automatically swap for winter wedding season, Diwali offers, or monsoon shoots.',
    highlights: ['Set start and end campaign dates', 'Zero manual banner swapping on weekends', 'A/B test different hero images'],
    tip: 'Promote your destination wedding package 6 months in advance.'
  },
  {
    title: 'Mobile Safe-Zone Framing',
    badge: 'Responsive',
    icon: 'phone',
    summary: 'Smart framing algorithm ensures couple portraits are never awkwardly cropped across smartphones and tablets.',
    highlights: ['Automatic focal-point face detection', 'Text stays legible over any photo background', 'Dual aspect-ratio generation (16:9 and 9:16)'],
    tip: 'Leave negative space on the left side of banner images for text overlay.'
  },
  {
    title: 'WebP Cloud Compression',
    badge: '5× Faster',
    icon: 'lightning-charge',
    summary: 'High-definition 1920×1080 banners are compressed into modern WebP format without losing crisp details.',
    highlights: ['Reduces 8 MB files down to 450 KB', 'Loads in under 300ms on 4G/5G mobile connections', 'Retains rich deep shadow and highlight tones'],
    tip: 'Fast-loading banners reduce client bounce rates.'
  },
  {
    title: 'Interactive Action Overlays',
    badge: 'High Conversion',
    icon: 'hand-index-thumb',
    summary: 'Overlay custom CTA buttons like "Check Availability" or "Book Consultation" directly on top of banners.',
    highlights: ['Direct WhatsApp or phone call triggers', 'Custom tracking parameters for marketing ROI', 'Adjustable glassmorphic backdrops'],
    tip: 'Add a seasonal discount code on your hero banner.'
  }
]

function GalleryBanner() {
  return (
    <div className="stack">
      <PageHeader
        eyebrow="Business Suite"
        featureBadge="Visual Merchandising Engine"
        title="Gallery & Website Banners"
        subtitle="Hero banners shown prominently at the top of client galleries and your public portfolio site. Recommended resolution: 1920 × 1080."
      />

      {/* Feature Capabilities Ribbon */}
      <FeatureBar items={bannerFeatures} />

      <FeatureTooltip
        title="Smart Banner Uploader"
        badge="Drag & Drop"
        icon="cloud-upload"
        summary="Upload any PNG, JPG, or WebP photo up to 5 MB. We will automatically optimize and generate responsive mobile crops."
        position="bottom"
        width={310}
      >
        <label className="dropzone dropzone-catchy">
          <input type="file" accept="image/*" />
          <i className="bi bi-cloud-arrow-up" />
          <strong>Drop a new campaign banner here, or click to browse</strong>
          <span className="muted">PNG, JPG or WebP · High-resolution up to 5 MB · 1920 × 1080 recommended</span>
          <span className="dropzone-hint">Point cursor to upload</span>
        </label>
      </FeatureTooltip>

      <div className="album-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        {db.banners.map((b) => (
          <FeatureTooltip
            key={b.id}
            title={b.title}
            badge={b.placement}
            icon="image"
            summary={`Active banner deployed to '${b.placement}'. Status: ${b.status}.`}
            highlights={[
              '1920 × 1080 high-definition display',
              'Automated WebP high compression',
              'Responsive mobile focal alignment'
            ]}
            position="top"
            width={280}
          >
            <article className="album album-catchy">
              {b.image ? (
                <div style={{ position: 'relative' }}>
                  <img src={poster} alt={b.title} style={{ aspectRatio: '16 / 9', objectFit: 'cover', width: '100%' }} />
                  <span className="banner-tag-overlay">{b.placement}</span>
                </div>
              ) : (
                <div className="cover" style={{ '--h': b.hue, aspectRatio: '16 / 9' }}>
                  <span className="cover-title">{b.title}</span>
                  <span className="banner-tag-overlay">{b.placement}</span>
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
          </FeatureTooltip>
        ))}
      </div>

      <Card title="Tips for Award-Winning Banners" feature={featureInfo.galleryBanner}>
        <ul className="checklist" style={{ marginBottom: 0 }}>
          <li>
            <i className="bi bi-check-circle-fill" />
            Keep important subjects and faces in the center or right side so text doesn't cover them on mobile screens.
          </li>
          <li>
            <i className="bi bi-check-circle-fill" />
            Export as modern WebP format — it loads up to 5× faster than standard PNG files with identical color fidelity.
          </li>
          <li>
            <i className="bi bi-check-circle-fill" />
            Schedule seasonal promotions in advance (e.g. Winter Wedding Early Bird) so they switch on automatically.
          </li>
        </ul>
      </Card>
    </div>
  )
}

export default GalleryBanner
