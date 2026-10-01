import type { PlanDto } from '@weddyzone/shared'
import { PageHeader, Card, FeatureTooltip, Skeleton } from '../components/ui'
import { formatMoney, formatNumber } from '../utils/format'
import { featureInfo } from '../data/featureInfo'
import { features } from '../lib/env'
import { usePlanActions, usePlans, useSubscription } from '../lib/billing'

const allPerks = [
  {
    title: 'Unlimited Events & Selections',
    text: 'Unlimited events & photo selections',
    summary: 'Never worry about per-event limits or extra billing tiers during peak wedding seasons (Oct - Feb). Shoot unconstrained.',
  },
  {
    title: 'Unlimited AI Face Scans',
    text: 'Unlimited AI face recognition scans',
    summary: 'Every guest at every wedding can search and download their photos without worrying about monthly scan caps.',
    flag: 'faceRecognition' as const,
  },
  {
    title: '5 TB Studio Cloud Vault',
    text: '5 TB storage with original-quality downloads',
    summary: 'Store raw uncompressed files, high-res deliverables, and client selections safely on enterprise cloud storage.',
  },
  {
    title: '10,000 Annual WhatsApp Credits',
    text: '10,000 WhatsApp credits every year',
    summary: 'Automate all client reminders, gallery links, and invoice delivery on WhatsApp without ever buying extra packs.',
  },
  {
    title: 'White-Label Portfolio & Domain',
    text: 'Premium website themes & custom domain',
    summary: 'Your own branded URL (e.g. gallery.yourstudio.com) with bespoke luxury typography and lightning-fast speed.',
  },
  {
    title: 'Dedicated Studio Concierge',
    text: 'Dedicated account manager',
    summary: 'Direct WhatsApp and phone access to our senior photography engineer for instant weekend priority help.',
  },
]
const perks = allPerks.filter((p) => !p.flag || features[p.flag])

const storage = (gb: number | null) => (gb === null ? 'Unlimited' : gb >= 1024 ? `${gb / 1024} TB` : `${gb} GB`)
const support: Record<string, string> = {
  STARTER: 'Standard Email (< 12h)',
  PRO: 'Standard Email (< 12h)',
  STUDIO: 'Priority support (< 4h)',
  ALL_ACCESS: 'Dedicated Manager (< 15m)',
}

function compareRows(current: PlanDto, all: PlanDto) {
  const events = (p: PlanDto) => (p.limits.eventsPerMonth === null ? 'Unlimited' : String(p.limits.eventsPerMonth))
  const credits = (p: PlanDto) => (p.limits.includedCredits ? `${formatNumber(p.limits.includedCredits)} included` : 'Pay as you go')
  const seats = (p: PlanDto) => `${p.limits.teamSeats} ${p.limits.teamSeats === 1 ? 'account' : 'seats'}`
  return [
    { feature: 'Events per month', cur: events(current), all: events(all), summary: 'Shoot as many weddings, sangeets, haldis, and pre-shoots as your schedule allows.' },
    { feature: 'Cloud Storage', cur: storage(current.limits.storageGb), all: `${storage(all.limits.storageGb)} Vault`, summary: 'Massive capacity to store original camera RAW files and high-bitrate video clips.' },
    { feature: 'Digital albums', cur: current.limits.albums === null ? 'Unlimited' : String(current.limits.albums), all: all.limits.albums === null ? 'Unlimited' : String(all.limits.albums), summary: 'Flipbook albums you can keep live for clients at once.' },
    { feature: 'WhatsApp credits', cur: credits(current), all: `${credits(all)} / yr`, summary: 'Automated client notifications included at zero extra cost.' },
    { feature: 'Team seats', cur: seats(current), all: `${seats(all)}`, summary: 'Give separate logins to your lead photographers, second shooters, and editing team.' },
    { feature: 'Support SLA', cur: support[current.code], all: support.ALL_ACCESS, summary: 'Direct phone line and dedicated WhatsApp group for rapid shoot support.' },
  ]
}

function AllAccess() {
  const plans = usePlans()
  const sub = useSubscription()
  const { change } = usePlanActions()
  const all = plans.data?.find((p) => p.code === 'ALL_ACCESS')
  const current = sub.data?.subscription
  const onAllAccess = current?.plan.code === 'ALL_ACCESS' && current.status === 'ACTIVE'
  // "Saves ₹21,989 compared to a la carte": 12 months of Studio minus the All-Access price.
  const studio = plans.data?.find((p) => p.code === 'STUDIO')
  const saving = all && studio?.monthlyPricePaise ? studio.monthlyPricePaise * 12 - all.yearlyPricePaise : null

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
            <p className="eyebrow">
              <i className="bi bi-stars" /> All-Access · Yearly Studio Pass
            </p>
            <h2>
              Everything Weddingz offers, <em>without limits.</em>
            </h2>
            <p>
              Built specifically for busy production houses shooting dozens of weddings every season. Pay once a year and never worry about quotas or storage upgrades
              again.
            </p>
            <div className="price-tag-group">
              <p className="big-number">
                {all ? formatMoney(all.yearlyPricePaise) : <Skeleton width={180} height={40} />}
                <small style={{ fontSize: 16, fontWeight: 500, opacity: 0.8 }}> / year</small>
              </p>
              {saving !== null && saving > 0 && <span className="save-badge">Saves {formatMoney(saving)} compared to a la carte</span>}
            </div>
            <div className="store-btns" style={{ marginTop: 22 }}>
              <button className="btn btn-gold btn-lg" disabled={!all || !current || onAllAccess} onClick={() => all && change(all, 'YEARLY', current)}>
                <i className="bi bi-lightning-charge-fill" /> {onAllAccess ? "You're on All-Access" : 'Upgrade to All-Access Now'}
              </button>
            </div>
          </div>

          <div>
            <p className="perks-hint">
              <i className="bi bi-cursor-fill" /> Point cursor on any benefit to inspect details:
            </p>
            <ul className="checklist checklist-catchy" style={{ marginBottom: 0 }}>
              {perks.map((p) => (
                <FeatureTooltip key={p.title} title={p.title} summary={p.summary} badge="All-Access Perk" position="left" width={300}>
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
        title={`${current?.plan.name ?? 'Your plan'} vs All-Access Comparison`}
        subtitle="Point cursor at any feature row to understand the differences"
        feature={featureInfo.allAccess}
        flush
      >
        {!all || !current ? (
          <div className="card-body">
            <Skeleton height={220} />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Feature Capability</th>
                  <th>{current.plan.name} (Current Plan)</th>
                  <th>All-Access (VIP)</th>
                </tr>
              </thead>
              <tbody>
                {compareRows(current.plan, all).map((row) => (
                  <tr key={row.feature}>
                    <td>
                      <FeatureTooltip title={row.feature} summary={row.summary} position="top" width={280}>
                        <span className="table-th-interactive">
                          {row.feature} <i className="bi bi-info-circle" />
                        </span>
                      </FeatureTooltip>
                    </td>
                    <td>{row.cur}</td>
                    <td style={{ color: 'var(--wine)', fontWeight: 700 }}>
                      <i className="bi bi-check2-circle" style={{ color: 'var(--gold)' }} /> {row.all}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

export default AllAccess
