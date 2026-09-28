import { PageHeader, Card, FeatureTooltip } from '../components/ui'
import { formatINR } from '../utils/format'
import { featureInfo } from '../data/featureInfo'

const perks = [
  {
    title: 'Unlimited Events & Selections',
    text: 'Unlimited events & photo selections',
    summary: 'Never worry about per-event limits or extra billing tiers during peak wedding seasons (Oct - Feb). Shoot unconstrained.'
  },
  {
    title: 'Unlimited AI Face Scans',
    text: 'Unlimited AI face recognition scans',
    summary: 'Every guest at every wedding can search and download their photos without worrying about monthly scan caps.'
  },
  {
    title: '5 TB Studio Cloud Vault',
    text: '5 TB storage with original-quality downloads',
    summary: 'Store raw uncompressed files, high-res deliverables, and client selections safely on enterprise cloud storage.'
  },
  {
    title: '10,000 Annual WhatsApp Credits',
    text: '10,000 WhatsApp credits every year',
    summary: 'Automate all client reminders, gallery links, and invoice delivery on WhatsApp without ever buying extra packs.'
  },
  {
    title: 'White-Label Portfolio & Domain',
    text: 'Premium website themes & custom domain',
    summary: 'Your own branded URL (e.g. gallery.yourstudio.com) with bespoke luxury typography and lightning-fast speed.'
  },
  {
    title: 'Dedicated Studio Concierge',
    text: 'Dedicated account manager',
    summary: 'Direct WhatsApp and phone access to our senior photography engineer for instant weekend priority help.'
  }
]

const compare = [
  {
    feature: 'Events per month',
    pro: '30',
    all: 'Unlimited',
    summary: 'Shoot as many weddings, sangeets, haldis, and pre-shoots as your schedule allows.'
  },
  {
    feature: 'Cloud Storage',
    pro: '500 GB',
    all: '5 TB Vault (10× capacity)',
    summary: 'Massive capacity to store original camera RAW files and high-bitrate video clips.'
  },
  {
    feature: 'Face recognition scans',
    pro: '10,000 / mo',
    all: 'Unlimited (zero caps)',
    summary: 'Accommodate multi-day destination weddings with 2,000+ guests with zero throttling.'
  },
  {
    feature: 'WhatsApp credits',
    pro: 'Pay as you go',
    all: '10,000 / yr included free',
    summary: 'Worth ₹7,999 in automated client notifications included at zero extra cost.'
  },
  {
    feature: 'Team seats',
    pro: '1 account',
    all: '10 multi-shooter seats',
    summary: 'Give separate logins to your lead photographers, second shooters, and editing team.'
  },
  {
    feature: 'Support SLA',
    pro: 'Standard Email (< 12h)',
    all: 'Dedicated Manager (< 15m)',
    summary: 'Direct phone line and dedicated WhatsApp group for rapid shoot support.'
  }
]

function AllAccess() {
  return (
    <div className="stack">
      <PageHeader
        eyebrow="Plans"
        featureBadge="VIP Tier · Studio Freedom"
        title="Weddingz All-Access"
        subtitle="One plan. Every feature. Zero quotas holding your photography studio back."
      />

      <div className="lux lux-catchy">
        <div className="grid grid-2" style={{ alignItems: 'center' }}>
          <div>
            <p className="eyebrow"><i className="bi bi-stars" /> All-Access · Yearly Studio Pass</p>
            <h2>Everything Weddingz offers, <em>without limits.</em></h2>
            <p>
              Built specifically for busy production houses shooting dozens of weddings every season.
              Pay once a year and never worry about quotas or storage upgrades again.
            </p>
            <div className="price-tag-group">
              <p className="big-number">
                {formatINR(49999)}
                <small style={{ fontSize: 16, fontWeight: 500, opacity: 0.8 }}> / year</small>
              </p>
              <span className="save-badge">Saves ₹21,989 compared to a la carte</span>
            </div>
            <div className="store-btns" style={{ marginTop: 22 }}>
              <button className="btn btn-gold btn-lg">
                <i className="bi bi-lightning-charge-fill" /> Upgrade to All-Access Now
              </button>
            </div>
          </div>

          <div>
            <p className="perks-hint"><i className="bi bi-cursor-fill" /> Point cursor on any benefit to inspect details:</p>
            <ul className="checklist checklist-catchy" style={{ marginBottom: 0 }}>
              {perks.map((p) => (
                <FeatureTooltip
                  key={p.title}
                  title={p.title}
                  summary={p.summary}
                  badge="All-Access Perk"
                  position="left"
                  width={300}
                >
                  <li className="perk-item">
                    <i className="bi bi-check-circle-fill" />
                    <span>{p.text}</span>
                    <i className="bi bi-info-circle perk-info-icon" />
                  </li>
                </FeatureTooltip>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <Card
        title="Pro vs All-Access Comparison"
        subtitle="Point cursor at any feature row to understand the differences"
        feature={featureInfo.allAccess}
        flush
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Feature Capability</th>
                <th>Pro (Current Plan)</th>
                <th>All-Access (VIP)</th>
              </tr>
            </thead>
            <tbody>
              {compare.map((row) => (
                <tr key={row.feature}>
                  <td>
                    <FeatureTooltip
                      title={row.feature}
                      summary={row.summary}
                      position="top"
                      width={280}
                    >
                      <span className="table-th-interactive">
                        {row.feature} <i className="bi bi-info-circle" />
                      </span>
                    </FeatureTooltip>
                  </td>
                  <td>{row.pro}</td>
                  <td style={{ color: 'var(--wine)', fontWeight: 700 }}>
                    <i className="bi bi-check2-circle" style={{ color: 'var(--gold)' }} /> {row.all}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export default AllAccess
