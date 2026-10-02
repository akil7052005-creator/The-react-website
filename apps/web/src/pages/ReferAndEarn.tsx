import { useQuery } from '@tanstack/react-query'
import type { ReferralOverviewDto } from '@weddyzone/shared'
import { useState } from 'react'
import { PageHeader, Card, StatCard, StatusPill, FeatureTooltip, FeatureBar, EmptyState, ErrorState, Skeleton, TableSkeleton, type FeatureBarItem } from '../components/ui'
import { formatDate, formatMoney } from '../utils/format'
import { featureInfo } from '../data/featureInfo'
import { api } from '../lib/api'
import { copyText } from '../lib/whatsapp'

const referralFeatures: FeatureBarItem[] = [
  {
    title: 'Dual ₹1,500 Benefit',
    badge: 'Win-Win',
    icon: 'gift',
    summary: 'When a studio you refer upgrades to its first paid plan, you each receive ₹1,500 in your wallets.',
    highlights: ['Your friend signs up with your referral code or link', 'Both wallets are credited on their first paid upgrade', 'Works with all monthly & yearly tiers'],
    tip: 'Share your code with fellow second shooters and studio owners.',
  },
  {
    title: 'Zero Referral Limits',
    badge: 'Unlimited',
    icon: 'infinity',
    summary: 'There is no upper ceiling on how much you can earn through the Weddyzone partner program.',
    highlights: ['Earn ₹15,000 in wallet credit when 10 referred studios upgrade', 'Real-time referral status tracking'],
    tip: 'Post your referral link alongside your latest wedding gallery on Instagram.',
  },
  {
    title: 'One-Click WhatsApp Sharing',
    badge: 'Easy Share',
    icon: 'whatsapp',
    summary: 'Pre-formatted invitation message ready to send into your city photographer WhatsApp groups.',
    highlights: ['Includes your unique referral link', 'Free: no WhatsApp credits used', 'Automatic tracking when friends sign up'],
    tip: 'Share it in your regional wedding photographer groups.',
  },
]

const reasonLabels: Record<string, string> = {
  REFERRAL_REWARD: 'Referral reward',
  REFERRAL_WELCOME: 'Welcome bonus',
  REDEMPTION: 'Used at checkout',
  ADJUSTMENT: 'Adjustment',
}

function ReferAndEarn() {
  const q = useQuery({ queryKey: ['referrals'], queryFn: () => api.get<ReferralOverviewDto>('/referrals') })
  const [copied, setCopied] = useState(false)
  const d = q.data

  const copyCode = async () => {
    if (!d) return
    if (await copyText(d.code, 'Referral code')) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // Sharing a referral goes to groups/contacts the studio picks in WhatsApp, so it costs no credits.
  const waShare = d ? `https://wa.me/?text=${encodeURIComponent(d.shareText)}` : undefined

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Wallet & Partner Program"
        featureBadge="₹1,500 Wallet Reward per Studio"
        title="Refer Studios & Earn Wallet Credit"
        subtitle="Invite fellow wedding photographers. You both get ₹1,500 in wallet credit when they upgrade to their first paid plan."
      />

      {/* Feature Capabilities Ribbon */}
      <FeatureBar items={referralFeatures} />

      {q.isError ? (
        <div className="card">
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </div>
      ) : (
        <>
          <div className="grid grid-2-1">
            <div className="lux lux-catchy">
              <p className="eyebrow">
                <i className="bi bi-gift-fill" /> Partner Referral Code
              </p>
              <h2>
                Share the love, <em>earn ₹1,500 credit</em> per studio.
              </h2>
              <p>When a photographer friend joins with your code and upgrades to a paid plan, you each get ₹1,500 credited to your studio wallets.</p>
              <p className="wallet-note">
                <i className="bi bi-info-circle" /> Wallet credit can't be spent yet. Using it for plan renewals and WhatsApp packs is coming soon.
              </p>
              <div className="code-box code-box-catchy">
                <code data-testid="referral-code">{d ? d.code : '········'}</code>
                <FeatureTooltip title="Copy Referral Code" summary="Click to copy your unique referral promo code to clipboard." position="top" width={200}>
                  <button className="btn btn-gold btn-sm" onClick={copyCode} disabled={!d}>
                    <i className={`bi bi-${copied ? 'check2' : 'copy'}`} />
                    {copied ? 'Copied!' : 'Copy Code'}
                  </button>
                </FeatureTooltip>
              </div>
              <div className="store-btns" style={{ marginTop: 14 }}>
                <button className="store-btn" onClick={() => d && copyText(d.link, 'Referral link')} disabled={!d}>
                  <i className="bi bi-link-45deg" /> Copy invite link
                </button>
                <a className="store-btn" href={waShare} target="_blank" rel="noreferrer" aria-disabled={!d}>
                  <i className="bi bi-whatsapp" /> Share on WhatsApp
                </a>
              </div>
            </div>

            <div className="stack">
              <StatCard
                icon="wallet2"
                label="Wallet Balance"
                value={d ? formatMoney(d.walletBalancePaise) : <Skeleton width={120} height={28} />}
                tone="gold"
                tooltip={{
                  title: 'Current Wallet Balance',
                  badge: d ? `${formatMoney(d.walletBalancePaise)} in wallet` : undefined,
                  icon: 'wallet2',
                  summary: 'Referral rewards credited to your studio wallet. Spending wallet credit on renewals and WhatsApp packs is coming soon.',
                  highlights: ['Spending wallet credit is coming soon', 'Credit never expires'],
                }}
              />
              <StatCard
                icon="gift"
                label="Total Earned"
                value={d ? formatMoney(d.totalEarnedPaise) : <Skeleton width={120} height={28} />}
                tone="green"
                tooltip={{
                  title: 'Lifetime Referral Earnings',
                  badge: d ? `${formatMoney(d.totalEarnedPaise)} Earned` : undefined,
                  icon: 'gift',
                  summary: `Total wallet credit earned by your studio${d ? ` from ${d.referrals.filter((r) => r.status === 'REWARDED').length} upgraded referral(s)` : ''}.`,
                  highlights: ['₹1,500 for each referred studio that upgrades', 'No cap on total credit earned'],
                }}
              />
            </div>
          </div>

          <Card title="Your Referred Studios" subtitle="Point cursor at reward or status to see when credit is added" feature={featureInfo.referAndEarn} flush>
            {q.isPending ? (
              <TableSkeleton rows={4} cols={4} />
            ) : d!.referrals.length === 0 ? (
              <EmptyState
                icon="people"
                title="No referrals yet"
                text="Share your code — when a studio you invite upgrades to a paid plan, you both get ₹1,500."
                action={
                  <button className="btn btn-primary" onClick={copyCode}>
                    <i className="bi bi-copy" /> Copy my code
                  </button>
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Referred Studio Name</th>
                      <th>Joined Date</th>
                      <th className="num">Reward Amount</th>
                      <th>Reward Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d!.referrals.map((r) => (
                      <tr key={r.id}>
                        <td className="cell-main">{r.studioName}</td>
                        <td>{formatDate(r.joinedAt)}</td>
                        <td className="num cell-main" style={{ color: 'var(--success)' }}>
                          +{formatMoney(r.rewardPaise)}
                        </td>
                        <td>
                          <FeatureTooltip
                            title={r.status === 'REWARDED' ? 'Reward credited' : 'Waiting for their first upgrade'}
                            summary={
                              r.status === 'REWARDED'
                                ? `₹1,500 credit was added to your wallet on ${formatDate(r.rewardedAt)}.`
                                : 'You both get ₹1,500 wallet credit as soon as this studio pays for its first plan.'
                            }
                            position="top"
                            width={240}
                          >
                            <StatusPill status={r.status === 'REWARDED' ? 'Paid' : 'Pending'} />
                          </FeatureTooltip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {d && d.transactions.length > 0 && (
            <Card title="Wallet History" subtitle="Every credit and debit on your studio wallet" flush>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th className="num">Amount</th>
                      <th className="num">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.transactions.map((t) => (
                      <tr key={t.id}>
                        <td>{formatDate(t.createdAt)}</td>
                        <td>{reasonLabels[t.reason] ?? t.reason}</td>
                        <td className="num cell-main" style={{ color: t.deltaPaise >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                          {t.deltaPaise >= 0 ? '+' : '−'}
                          {formatMoney(Math.abs(t.deltaPaise))}
                        </td>
                        <td className="num">{formatMoney(t.balanceAfterPaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

export default ReferAndEarn
