import { useState } from 'react'
import { PageHeader, Card, StatCard, StatusPill, Toggle, FeatureTooltip, FeatureBar } from '../components/ui'
import db from '../data'
import { formatNumber } from '../utils/format'
import { featureInfo } from '../data/featureInfo'
import poster from '../assets/wedding-poster-horizontal.png'

const websiteFeatures = [
  {
    title: 'Custom Domain White-Label',
    badge: 'SSL Included',
    icon: 'globe',
    summary: 'Connect your own domain (e.g. goldenhour.studio) with automated Cloudflare SSL certificates.',
    highlights: ['Zero Weddingz branding in footer on Pro/All-Access', 'Sub-second page speeds anywhere in India', 'Automated DNS records setup guide'],
    tip: 'White-label domains establish you as a premier luxury studio.'
  },
  {
    title: 'WhatsApp Lead Capture',
    badge: 'Instant Alert',
    icon: 'whatsapp',
    summary: 'High-intent enquiry form collects bride/groom name, wedding date, venue city, and budget range.',
    highlights: ['Sends instant lead alert to your WhatsApp', 'Auto-creates draft client in your dashboard', 'Pre-fills WhatsApp chat for the bride'],
    tip: 'Responding within 15 minutes increases booking closure rate by 70%.'
  },
  {
    title: 'Google Local SEO Optimized',
    badge: 'Rank #1',
    icon: 'search',
    summary: 'Pre-configured with wedding photographer schema markup to rank on Google Local Maps.',
    highlights: ['Generates localized city landing pages', 'Optimized WebP image delivery', 'Mobile responsive design scores 98/100 on Google Lighthouse'],
    tip: 'Add your primary city in page titles for higher local search placement.'
  },
  {
    title: 'Cinematic Video Embeds',
    badge: '4K Support',
    icon: 'play-btn',
    summary: 'Embed your Vimeo or YouTube 4K wedding highlight films with luxury borderless players.',
    highlights: ['Smooth autoplay on mobile scroll', 'Custom thumbnail overlays', 'Zero intrusive video ads'],
    tip: 'Place a 60-second teaser video at the top of your homepage.'
  }
]

const sectionTooltips = {
  hero: {
    title: 'Hero Banner Section',
    summary: 'High-impact full-screen visual welcoming visitors with your studio tagline and booking CTA.'
  },
  gallery: {
    title: 'Featured Wedding Stories',
    summary: 'Curated photo albums highlighting your finest couple portraits, haldis, and receptions.'
  },
  services: {
    title: 'Services & Investment',
    summary: 'Clear package breakdowns for Pre-wedding, Wedding Day, Traditional & Candid coverage.'
  },
  about: {
    title: 'About the Photographer',
    summary: 'Your studio story, shooting philosophy, awards, and team introductions.'
  },
  reviews: {
    title: 'Bride & Groom Testimonials',
    summary: 'Verified 5-star Google and direct client reviews building trust with prospective couples.'
  },
  contact: {
    title: 'Direct Enquiry Form',
    summary: 'Lead capture form connected directly to your studio WhatsApp and event calendar.'
  }
}

function MyWebsite() {
  const { website, studio } = db
  const [sections, setSections] = useState(website.sections)

  const flip = (key) => setSections((list) => list.map((s) => (s.key === key ? { ...s, on: !s.on } : s)))

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Business Suite"
        featureBadge="White-label Portfolio Builder"
        title="My Studio Website"
        subtitle="Your modern photography portfolio — where couples discover your style, browse previous weddings, and send booking enquiries."
        actions={
          <>
            <FeatureTooltip
              title="Visit Live Website"
              summary={`Open ${studio.website} in a new tab to see how couples view your portfolio.`}
              position="bottom"
              width={260}
            >
              <a
                href={`https://${studio.website}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost"
              >
                <i className="bi bi-box-arrow-up-right" />Visit Site
              </a>
            </FeatureTooltip>

            <FeatureTooltip
              title="Visual Theme Customizer"
              summary="Change color palettes, fonts, layouts, and header styles to match your studio branding."
              position="bottom"
              width={280}
            >
              <button className="btn btn-primary">
                <i className="bi bi-brush" />Edit Design
              </button>
            </FeatureTooltip>
          </>
        }
      />

      {/* Feature Capabilities Ribbon */}
      <FeatureBar items={websiteFeatures} />

      <div className="grid grid-3">
        <StatCard
          icon="broadcast"
          label="Website Status"
          value={<StatusPill status={website.status} />}
          tone="green"
          tooltip={{
            title: 'Website Health & CDN Status',
            badge: 'Online',
            icon: 'broadcast',
            summary: 'Your custom portfolio is live, protected by SSL certificate, and served from regional edge servers.',
            highlights: ['Fast load speed: < 0.8s in India', '100% uptime monitoring active']
          }}
        />
        <StatCard
          icon="eye"
          label="Visits This Month"
          value={formatNumber(website.visits)}
          trend={14}
          tone="blue"
          tooltip={{
            title: 'Monthly Unique Visitors',
            badge: `${formatNumber(website.visits)} Views`,
            icon: 'eye',
            summary: 'Total unique couples and guests who visited your photography portfolio this month.',
            highlights: ['+14% increase vs last month', '62% of traffic comes from Instagram & wedding guests'],
            tip: 'Keep your Instagram bio link updated with this URL.'
          }}
        />
        <StatCard
          icon="envelope-heart"
          label="Bridal Enquiries"
          value={website.enquiries}
          trend={9}
          tone="wine"
          tooltip={{
            title: 'Direct High-Intent Enquiries',
            badge: `${website.enquiries} Leads`,
            icon: 'envelope-heart',
            summary: 'Number of verified booking inquiries submitted through your website contact forms.',
            highlights: ['Average enquiry package value: ₹1.8L', 'Leads automatically sent to WhatsApp'],
            tip: 'Fast replies close bookings before competitors respond.'
          }}
        />
      </div>

      <div className="grid grid-2-1">
        <FeatureTooltip
          title="Interactive Live Browser Preview"
          badge={website.theme}
          summary={`Your live portfolio theme is currently '${website.theme}' — a warm, editorial layout tailored for luxury weddings.`}
          position="right"
          width={300}
        >
          <Card title="Live Preview" subtitle={`Theme: ${website.theme} · Responsive viewport`}>
            <div className="browser browser-catchy">
              <div className="browser-bar">
                <i /><i /><i />
                <span>
                  <i className="bi bi-lock-fill" style={{ background: 'none', width: 'auto', height: 'auto', color: 'var(--success)' }} />
                  https://{studio.website}
                </span>
                <span className="live-badge">LIVE</span>
              </div>
              <img src={poster} alt="Website homepage preview" />
            </div>
          </Card>
        </FeatureTooltip>

        <Card
          title="Page Sections"
          subtitle="Point cursor at any section to see its content"
          feature={featureInfo.myWebsite}
        >
          {sections.map((s) => (
            <Toggle
              key={s.key}
              label={s.label}
              checked={s.on}
              onChange={() => flip(s.key)}
              feature={sectionTooltips[s.key]}
            />
          ))}
        </Card>
      </div>
    </div>
  )
}

export default MyWebsite
