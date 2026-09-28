import { useState } from 'react'
import { PageHeader, Card, StatCard, StatusPill, FeatureTooltip, FeatureBar } from '../components/ui'
import db from '../data'
import { formatDate, formatINR } from '../utils/format'
import { featureInfo } from '../data/featureInfo'

const referralFeatures = [
  {
    title: 'Dual ₹1,500 Benefit',
    badge: 'Win-Win',
    icon: 'gift',
    summary: 'Both you and your referred photography studio receive ₹1,500 instantly in your respective wallets.',
    highlights: ['Friends get ₹1,500 off at checkout', 'You receive ₹1,500 cash in wallet upon activation', 'Works with all monthly & yearly tiers'],
    tip: 'Share your code with fellow second shooters and studio owners.'
  },
  {
    title: 'Zero Referral Limits',
    badge: 'Unlimited',
    icon: 'infinity',
    summary: 'There is no upper ceiling on how much you can earn through the Weddingz partner program.',
    highlights: ['Earn ₹15,000 by inviting 10 studios', 'Covers your entire annual All-Access subscription', 'Real-time referral progress tracking'],
    tip: 'Many studios run Weddingz 100% free purely through referral credits.'
  },
  {
    title: 'Direct Wallet Redemption',
    badge: 'Real Money',
    icon: 'wallet2',
    summary: 'Wallet funds can be used immediately to pay for renewals, buy WhatsApp credits, or add team seats.',
    highlights: ['1 wallet credit = ₹1 Indian Rupee', 'Applies automatically at renewal checkout', 'Zero expiry date on earned rewards'],
    tip: 'Use your wallet balance to buy WhatsApp credit packs.'
  },
  {
    title: 'One-Click WhatsApp Sharing',
    badge: 'Easy Share',
    icon: 'whatsapp',
    summary: 'Pre-formatted invitation message ready to send into your city photographer WhatsApp groups.',
    highlights: ['Includes your unique referral link', 'Explains the ₹1,500 discount for your friend', 'Automatic tracking when friends sign up'],
    tip: 'Post your referral link alongside your latest wedding gallery on Instagram.'
  }
]

function ReferAndEarn() {
  const { wallet } = db
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(wallet.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be blocked; still visible
    }
  }

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Wallet & Partner Program"
        featureBadge="₹1,500 Cash Reward per Studio"
        title="Refer Studios & Earn Cash"
        subtitle="Invite fellow wedding photographers. You both get ₹1,500 in wallet credit when they activate their studio account."
      />

      {/* Feature Capabilities Ribbon */}
      <FeatureBar items={referralFeatures} />

      <div className="grid grid-2-1">
        <div className="lux lux-catchy">
          <p className="eyebrow"><i className="bi bi-gift-fill" /> Partner Referral Code</p>
          <h2>Share the love, <em>earn ₹1,500</em> per studio.</h2>
          <p>
            Give your photographer friends ₹1,500 discount on their plan, and get ₹1,500 credited to your studio wallet.
          </p>
          <div className="code-box code-box-catchy">
            <code>{wallet.code}</code>
            <FeatureTooltip
              title="Copy Referral Code"
              summary="Click to copy your unique referral promo code to clipboard."
              position="top"
              width={200}
            >
              <button className="btn btn-gold btn-sm" onClick={copy}>
                <i className={`bi bi-${copied ? 'check2' : 'copy'}`} />
                {copied ? 'Copied!' : 'Copy Code'}
              </button>
            </FeatureTooltip>
          </div>
        </div>

        <div className="stack">
          <StatCard
            icon="wallet2"
            label="Wallet Balance"
            value={formatINR(wallet.balance)}
            tone="gold"
            tooltip={{
              title: 'Current Wallet Balance',
              badge: `${formatINR(wallet.balance)} Available`,
              icon: 'wallet2',
              summary: 'Funds available to be applied towards your next subscription renewal or WhatsApp packs.',
              highlights: ['Redeemable on all plans', 'Never expires']
            }}
          />
          <StatCard
            icon="gift"
            label="Total Earned"
            value={formatINR(wallet.earned)}
            tone="green"
            tooltip={{
              title: 'Lifetime Referral Earnings',
              badge: `${formatINR(wallet.earned)} Earned`,
              icon: 'gift',
              summary: 'Total cash rewards earned by your studio by inviting 5 fellow photographers.',
              highlights: ['₹1,500 per successful studio onboarding', 'No cap on total earnings']
            }}
          />
        </div>
      </div>

      <Card
        title="Your Referred Studios"
        subtitle="Point cursor at reward or status to view payout milestones"
        feature={featureInfo.referAndEarn}
        flush
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Referred Studio Name</th>
                <th>Joined Date</th>
                <th className="num">Reward Amount</th>
                <th>Payout Status</th>
              </tr>
            </thead>
            <tbody>
              {wallet.referrals.map((r) => (
                <tr key={r.name}>
                  <td className="cell-main">{r.name}</td>
                  <td>{formatDate(r.date)}</td>
                  <td className="num cell-main" style={{ color: 'var(--success)' }}>
                    +{formatINR(r.reward)}
                  </td>
                  <td><StatusPill status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export default ReferAndEarn
