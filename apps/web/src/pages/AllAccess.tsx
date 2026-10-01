import type { PlanDto } from '@weddyzone/shared'
import { PageHeader, Card, ComingSoonTag, FeatureTooltip, Skeleton } from '../components/ui'
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
    text: '5 TB storage',
    summary: 'Room for tens of thousands of high-resolution event photos (JPG, PNG or WebP) across all your selections and albums.',
  },
  {
    title: '10,000 Annual WhatsApp Credits',
    text: '10,000 WhatsApp credits every year',
    summary: 'Send client reminders, gallery links and invoices on WhatsApp all year without buying extra packs.',
  },
  {
    title: 'Custom Domain',
    text: 'Custom domain for your website',
    summary: 'Your portfolio on your own branded URL (e.g. gallery.yourstudio.com).',
    comingSoon: true,
  },
  {
    title: 'Dedicated Studio Concierge',
    text: 'Dedicated account manager',
    summary: 'A named Weddyzone contact for your studio.',
    comingSoon: true,
  },
]
const perks = allPerks.filter((p) => !p.flag || features[p.flag])

const storage = (gb: number | null) => (gb === null ? 'Unlimited' : gb >= 1024 ? `${gb / 1024} TB` : `${gb} GB`)
// Every plan gets support tickets today; priority handling and a dedicated manager are not built yet.
const support: Record<string, string> = {
  STARTER: 'Support tickets',
  PRO: 'Support tickets',
  STUDIO: 'Support tickets',
  ALL_ACCESS: 'Support tickets',
}

function compareRows(current: PlanDto, all: PlanDto) {
  const events = (p: PlanDto) => (p.limits.eventsPerMonth === null ? 'Unlimited' : String(p.limits.eventsPerMonth))
  const credits = (p: PlanDto) => (p.limits.includedCredits ? `${formatNumber(p.limits.includedCredits)} included` : 'Pay as you go')
  const seats = (p: PlanDto) => `${p.limits.teamSeats} ${p.limits.teamSeats === 1 ? 'account' : 'seats'}`
  return [
    { feature: 'Events per month', cur: events(current), all: events(all), summary: 'Shoot as many weddings, sangeets, haldis, and pre-shoots as your schedule allows.' },
    { feature: 'Cloud Storage', cur: storage(current.limits.storageGb), all: storage(all.limits.storageGb), summary: 'Space for your uploaded JPG, PNG and WebP event photos.' },
    { feature: 'Digital albums', cur: current.limits.albums === null ? 'Unlimited' : String(current.limits.albums), all: all.limits.albums === null ? 'Unlimited' : String(all.limits.albums), summary: 'Flipbook albums you can keep live for clients at once.' },
    { feature: 'WhatsApp credits', cur: credits(current), all: `${credits(all)} / yr`, summary: 'Client message credits included at no extra cost.' },
    { feature: 'Team seats', cur: seats(current), all: seats(all), summary: 'Separate logins for your lead photographers, second shooters, and editing team.', comingSoon: true },
    { feature: 'Support', cur: support[current.code], all: `${support.ALL_ACCESS} + dedicated manager`, summary: 'Raise and follow support tickets from the Support page. A dedicated manager is coming soon.', comingSoon: true },
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
        featureBadge="Top Tier · Studio Freedom"
        title="Weddyzone All-Access"
        subtitle="One yearly plan with unlimited events and albums, 5 TB storage and 10,000 WhatsApp credits."
      />

      <div className="lux lux-catchy">
        <div className="grid grid-2" style={{ alignItems: 'center' }}>
          <div>
            <p className="eyebrow">
              <i className="bi bi-stars" /> All-Access · Yearly Studio Pass
            </p>
            <h2>
              Unlimited events and albums, <em>all season.</em>
            </h2>
            <p>
              Built for busy production houses shooting dozens of weddings every season. Pay once a year and never worry about event or album limits.
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
                  <li className={`perk-item${p.comingSoon ? ' is-coming-soon' : ''}`}>
                    {p.comingSoon ? <i className="bi bi-clock" /> : <i className="bi bi-check-circle-fill" />}
                    <span>{p.text}</span>
                    {p.comingSoon && <ComingSoonTag />}
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
                      {row.comingSoon ? (
                        <>
                          {row.all} <ComingSoonTag />
                        </>
                      ) : (
                        <>
                          <i className="bi bi-check2-circle" style={{ color: 'var(--gold)' }} /> {row.all}
                        </>
                      )}
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
