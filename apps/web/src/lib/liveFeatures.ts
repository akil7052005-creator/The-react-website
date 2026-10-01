import type { MeDto } from '@weddyzone/shared'
import type { FeatureInfo } from '../components/FeatureTooltip'
import { featureInfo } from '../data/featureInfo'
import { formatMoney, formatNumber } from '../utils/format'

/** featureInfo with the studio-specific metric lines filled from the logged-in studio. */
export function liveFeatureInfo(me: MeDto & { studio: NonNullable<MeDto['studio']> }): Record<string, FeatureInfo> {
  const base = featureInfo as unknown as Record<string, FeatureInfo>
  const s = me.studio
  const live: Record<string, string> = {
    whatsappCredit: `${formatNumber(s.creditBalance)} credits available (≈ ${Math.floor(s.creditBalance / 200)} full weddings)`,
    mySubscription: `${s.plan.name} plan`,
    referAndEarn: `Wallet balance ${formatMoney(s.walletBalancePaise)} · code ${s.referralCode}`,
    profile: [s.name, s.city].filter(Boolean).join(' · '),
  }
  return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, live[k] ? { ...v, metric: live[k] } : v]))
}
