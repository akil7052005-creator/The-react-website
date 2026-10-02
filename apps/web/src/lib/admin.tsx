import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  istParts,
  SUBSCRIPTION_STATUS_LABELS,
  type AdminNotificationDto,
  type AdminSubscriptionRowDto,
  type Paginated,
  type SentNotificationDto,
  type SubscriptionStatus,
} from '@weddyzone/shared'
import { StatusPill } from '../components/ui'
import { api } from './api'

export const ADMIN_NOTIFICATIONS_KEY = ['admin', 'notifications'] as const

export function useAdminNotifications(opts: { page?: number; limit?: number; unread?: boolean } = {}) {
  const query = { page: opts.page ?? 1, limit: opts.limit ?? 8, unread: opts.unread ? 'true' : undefined }
  return useQuery({
    queryKey: [...ADMIN_NOTIFICATIONS_KEY, query],
    queryFn: () => api.get<Paginated<AdminNotificationDto> & { unreadCount: number }>('/admin/notifications', query),
    // New purchases and deadline alerts should show up without a reload.
    refetchInterval: 30_000,
  })
}

export function useAdminNotificationActions() {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ADMIN_NOTIFICATIONS_KEY })
  const readOne = useMutation({ mutationFn: (id: string) => api.patch(`/admin/notifications/${id}/read`), onSuccess: refresh })
  const readAll = useMutation({ mutationFn: () => api.post('/admin/notifications/read-all'), onSuccess: refresh })
  return { readOne, readAll }
}

export function SubscriptionStatusPill({ status }: { status: SubscriptionStatus }) {
  return <StatusPill status={SUBSCRIPTION_STATUS_LABELS[status]} />
}

export type PlanLimitKey = 'eventsPerMonth' | 'albums' | 'storageGb' | 'teamSeats' | 'includedCredits'

/**
 * The plan limit a feature line merely restates ("10 events / month", "2 TB storage", "5 team seats",
 * "10,000 WhatsApp credits every year"), or null for a real feature ("Digital albums", "Custom domain").
 * A line restates a limit when it starts with a number or "Unlimited".
 */
export function limitFeature(feature: string): PlanLimitKey | null {
  const f = feature.trim().toLowerCase()
  if (!/^(unlimited|\d[\d,.]*)\b/.test(f)) return null
  if (/\bevents?\b/.test(f)) return 'eventsPerMonth'
  if (/\balbums?\b/.test(f)) return 'albums'
  if (/\b(storage|gb|tb)\b/.test(f)) return 'storageGb'
  if (/\bseats?\b/.test(f)) return 'teamSeats'
  if (/\bcredits?\b/.test(f)) return 'includedCredits'
  return null
}

/** 100 → "100 GB", 2048 → "2 TB". */
export function storageText(gb: number | null): string {
  if (gb === null) return 'Unlimited'
  return gb >= 1024 && gb % 1024 === 0 ? `${gb / 1024} TB` : `${gb.toLocaleString('en-IN')} GB`
}

const unit = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** A duration in words, two units at most: "2 days 22 hrs", "5 hrs 12 min", "4 min", "under a minute". */
export function durationText(ms: number): string {
  const min = Math.floor(Math.abs(ms) / 60_000)
  const days = Math.floor(min / 1440)
  const hrs = Math.floor((min % 1440) / 60)
  const mins = min % 60
  if (days) return hrs ? `${unit(days, 'day', 'days')} ${unit(hrs, 'hr', 'hrs')}` : unit(days, 'day', 'days')
  if (hrs) return mins ? `${unit(hrs, 'hr', 'hrs')} ${mins} min` : unit(hrs, 'hr', 'hrs')
  return mins ? `${mins} min` : 'under a minute'
}

/** "Pro · Monthly", "Starter trial · Monthly". */
export function planCycle(r: Pick<AdminSubscriptionRowDto, 'plan' | 'cycle' | 'isTrial'>): string {
  return `${r.plan.name}${r.isTrial ? ' trial' : ''} · ${r.cycle === 'YEARLY' ? 'Yearly' : 'Monthly'}`
}

type DaysLeftRow = Pick<AdminSubscriptionRowDto, 'daysLeft' | 'tone' | 'status'>

/**
 * Text of the "Days left" badge. Once the deadline has passed (grace, expired, cancelled) the plan
 * has ended: "Ended today" / "Ended 3d ago". Before it: "Today" (deadline later today) or "N days".
 */
export function daysLeftText({ daysLeft: d, status }: Pick<DaysLeftRow, 'daysLeft' | 'status'>): string {
  const ended = status === 'GRACE' || status === 'EXPIRED' || status === 'CANCELLED' || d < 0
  if (ended) return d < 0 ? `Ended ${-d}d ago` : status === 'CANCELLED' && d > 0 ? 'Ended' : 'Ended today'
  return d === 0 ? 'Today' : `${d} day${d === 1 ? '' : 's'}`
}

/** "12 days" badge: green > 7, amber ≤ 7, red ≤ 1 or in grace, grey when over. */
export function DaysLeftBadge({ row }: { row: DaysLeftRow }) {
  return <span className={`days-badge days-${row.tone}`}>{daysLeftText(row)}</span>
}

/** Delivery state of a sent alert. WhatsApp alerts with no provider configured were skipped, not failed. */
export function deliveryLabel(n: Pick<SentNotificationDto, 'sentAt' | 'error' | 'channel'>): string {
  if (n.sentAt) return 'Sent'
  if (n.channel === 'WHATSAPP' && n.error && /not configured/i.test(n.error)) return 'Skipped – not configured'
  return n.error ? 'Failed' : 'Pending'
}

// Fixed month names: Intl gives "Sept" in some locales, unlike the alerts and emails.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "02 Oct 2027" (IST), matching the dates in alerts and emails. */
export function formatIstDate(iso: string): string {
  const p = istParts(new Date(iso))
  return `${String(p.day).padStart(2, '0')} ${MONTHS[p.month - 1]} ${p.year}`
}

/** "02 Oct 2027, 9:05 am" (IST). */
export function formatIstDateTime(iso: string): string {
  const p = istParts(new Date(iso))
  const h = p.hour % 12 || 12
  return `${formatIstDate(iso)}, ${h}:${String(p.minute).padStart(2, '0')} ${p.hour < 12 ? 'am' : 'pm'}`
}
