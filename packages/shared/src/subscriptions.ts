// Subscription deadline maths, shared by the API (hourly job, access checks) and the web app
// (days-left badges). Dates are stored in UTC; every calendar decision ("which day is it",
// "add one month") is made in India Standard Time (UTC+05:30, no daylight saving).

import type { BillingCycle } from './enums'

export const IST_OFFSET_MS = 330 * 60_000
const DAY_MS = 86_400_000

export const SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'EXPIRING_SOON', 'GRACE', 'EXPIRED', 'CANCELLED', 'PAYMENT_FAILED'] as const
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]
export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  TRIAL: 'Trial',
  ACTIVE: 'Active',
  EXPIRING_SOON: 'Expiring soon',
  GRACE: 'Grace period',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
  PAYMENT_FAILED: 'Payment failed',
}

export const SUBSCRIPTION_EVENT_TYPES = [
  'CREATED',
  'RENEWED',
  'UPGRADED',
  'DOWNGRADED',
  'CANCELLED',
  'EXPIRED',
  'GRACE_STARTED',
  'PAYMENT_FAILED',
  'EXTENDED_BY_ADMIN',
  'PLAN_CHANGED_BY_ADMIN',
  'AUTO_RENEW_CHANGED',
] as const
export type SubscriptionEventType = (typeof SUBSCRIPTION_EVENT_TYPES)[number]

export const CANCEL_REASONS = ['TOO_EXPENSIVE', 'NOT_ENOUGH_WORK', 'MISSING_FEATURES', 'SWITCHING_TOOL', 'TECHNICAL_ISSUES', 'OTHER'] as const
export type CancelReason = (typeof CANCEL_REASONS)[number]
export const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  TOO_EXPENSIVE: 'Too expensive',
  NOT_ENOUGH_WORK: 'Not enough bookings right now',
  MISSING_FEATURES: 'Missing features I need',
  SWITCHING_TOOL: 'Switching to another tool',
  TECHNICAL_ISSUES: 'Technical problems',
  OTHER: 'Something else',
}

/** Plan prices exclude GST; platform subscriptions are charged 18% GST on top. */
export const PLATFORM_GST_RATE = 18
export function gstOn(basePaise: number): number {
  return Math.round((basePaise * PLATFORM_GST_RATE) / 100)
}

export interface AlertSettings {
  /** Days before the deadline when studios are reminded, e.g. [7, 3, 1]. */
  reminderDays: number[]
  /** Days of full access after the deadline before the account turns read-only. */
  graceDays: number
  /** Admin digest time, "HH:MM" in IST. */
  digestTime: string
  /** Send a win-back coupon this many days after a plan expires (null = off). */
  winbackAfterDays: number | null
  winbackPercentOff: number
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  reminderDays: [7, 3, 1],
  graceDays: 3,
  digestTime: '09:00',
  winbackAfterDays: 7,
  winbackPercentOff: 20,
}

// ------------------------------------------------------------------ IST calendar helpers

export interface IstParts {
  year: number
  /** 1–12 */
  month: number
  day: number
  hour: number
  minute: number
  second: number
  ms: number
}

export function istParts(d: Date): IstParts {
  const t = new Date(d.getTime() + IST_OFFSET_MS)
  return {
    year: t.getUTCFullYear(),
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
    second: t.getUTCSeconds(),
    ms: t.getUTCMilliseconds(),
  }
}

/** The UTC instant of an IST wall-clock time. */
export function fromIst(p: Pick<IstParts, 'year' | 'month' | 'day'> & Partial<IstParts>): Date {
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour ?? 0, p.minute ?? 0, p.second ?? 0, p.ms ?? 0) - IST_OFFSET_MS)
}

/** "2026-10-02" — the IST calendar date of an instant. */
export function istDate(d: Date): string {
  const p = istParts(d)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** Midnight IST at the start of the instant's IST day. */
export function startOfIstDay(d: Date): Date {
  const p = istParts(d)
  return fromIst({ year: p.year, month: p.month, day: p.day })
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function addDays(d: Date, days: number): Date {
  // IST has no daylight saving, so a day is always 24 hours.
  return new Date(d.getTime() + days * DAY_MS)
}

/**
 * Adds whole months in IST, keeping the wall-clock time. A day that doesn't exist in the target
 * month is clamped to its last day (31 Jan + 1 month = 28/29 Feb). `anchorDay` is the day of
 * the month the subscription started on, so a plan that started on the 31st goes back to the
 * 31st after a short month (31 Jan → 28 Feb → 31 Mar) instead of drifting to the 28th.
 */
export function addMonthsIst(d: Date, months: number, anchorDay?: number): Date {
  const p = istParts(d)
  const index = p.year * 12 + (p.month - 1) + months
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  const day = Math.min(anchorDay ?? p.day, daysInMonth(year, month))
  return fromIst({ ...p, year, month, day })
}

/** End of one billing period starting at `from`: +1 month or +1 year, in IST. */
export function addCycle(from: Date, cycle: BillingCycle, anchorDay?: number): Date {
  return addMonthsIst(from, cycle === 'YEARLY' ? 12 : 1, anchorDay)
}

/**
 * Whole IST calendar days from today until the deadline's day: 0 on the deadline day,
 * negative after it. Independent of the time of day, so a reminder never fires twice on
 * the same calendar day or skips one around midnight.
 */
export function daysLeft(endDate: Date, now: Date = new Date()): number {
  return Math.round((startOfIstDay(endDate).getTime() - startOfIstDay(now).getTime()) / DAY_MS)
}

// ------------------------------------------------------------------ status

export interface SubscriptionState {
  /** Status saved by the last job run or admin action. */
  status: SubscriptionStatus
  isTrial: boolean
  endDate: Date
  graceEndsAt: Date | null
  cancelAtPeriodEnd: boolean
  autoRenew: boolean
  gatewaySubscriptionId: string | null
  lastPaymentFailedAt: Date | null
  startDate: Date
}

/** Auto-renew only counts when a gateway subscription exists that will actually charge. */
export function renewsAutomatically(s: Pick<SubscriptionState, 'autoRenew' | 'gatewaySubscriptionId' | 'cancelAtPeriodEnd'>): boolean {
  return s.autoRenew && !!s.gatewaySubscriptionId && !s.cancelAtPeriodEnd
}

export function graceEnd(s: Pick<SubscriptionState, 'endDate' | 'graceEndsAt'>, settings: Pick<AlertSettings, 'graceDays'>): Date {
  return s.graceEndsAt ?? addDays(s.endDate, settings.graceDays)
}

/**
 * What a subscription's status is at `now`. Pure: the hourly job saves the result, and every
 * read (access checks, the admin table) recomputes it, so access is right even between runs.
 *
 *   before the deadline: PAYMENT_FAILED › TRIAL › EXPIRING_SOON (within the first reminder) › ACTIVE
 *   after the deadline:  CANCELLED (cancelled at period end) › GRACE (until grace ends) › EXPIRED
 *
 * CANCELLED set by an admin is final until an admin extends or the studio pays again.
 */
export function computeStatus(s: SubscriptionState, now: Date, settings: Pick<AlertSettings, 'reminderDays' | 'graceDays'>): SubscriptionStatus {
  if (s.status === 'CANCELLED') return 'CANCELLED'
  if (now < s.endDate) {
    if (s.lastPaymentFailedAt && s.lastPaymentFailedAt >= s.startDate) return 'PAYMENT_FAILED'
    if (s.isTrial) return 'TRIAL'
    const firstReminder = Math.max(0, ...settings.reminderDays)
    if (!renewsAutomatically(s) && daysLeft(s.endDate, now) <= firstReminder) return 'EXPIRING_SOON'
    return 'ACTIVE'
  }
  if (s.cancelAtPeriodEnd) return 'CANCELLED'
  return now < graceEnd(s, settings) ? 'GRACE' : 'EXPIRED'
}

/** Expired and cancelled studios can look but not create: no new events, albums or uploads. */
export function isReadOnlyStatus(status: SubscriptionStatus): boolean {
  return status === 'EXPIRED' || status === 'CANCELLED'
}

// ------------------------------------------------------------------ reminders

export type ReminderStage =
  | { kind: 'BEFORE'; days: number; label: string }
  | { kind: 'DEADLINE'; label: 'T' }
  | { kind: 'GRACE_END'; label: 'GRACE_END' }

/**
 * Which alert is due now. Before the deadline it is the closest reminder whose day has been
 * reached (if the job was down on T-7 and it is now T-2, only T-3 goes out, not a burst of
 * stale ones). Sending is made exactly-once by the dedupe key, not by timing.
 */
export function dueStage(s: SubscriptionState, now: Date, settings: Pick<AlertSettings, 'reminderDays' | 'graceDays'>): ReminderStage | null {
  if (s.status === 'CANCELLED') return null
  if (now >= s.endDate) {
    if (s.cancelAtPeriodEnd) return null
    return now >= graceEnd(s, settings) ? { kind: 'GRACE_END', label: 'GRACE_END' } : { kind: 'DEADLINE', label: 'T' }
  }
  if (renewsAutomatically(s)) return null
  const left = daysLeft(s.endDate, now)
  const reached = settings.reminderDays.filter((d) => left <= d).sort((a, b) => a - b)
  if (!reached.length) return null
  return { kind: 'BEFORE', days: reached[0], label: `T-${reached[0]}` }
}

/**
 * Exactly-once key for an alert: one per subscription, billing period (deadline), stage,
 * recipient and channel. A renewal moves the deadline, so the next period alerts again.
 */
export function alertDedupeKey(kind: string, subscriptionId: string, endDate: Date, stage: string): string {
  return `${kind}:${subscriptionId}:${endDate.toISOString()}:${stage}`
}

/** Colour of a "days left" badge: green > 7, amber ≤ 7, red ≤ 1 or in grace, grey when over. */
export function deadlineTone(status: SubscriptionStatus, left: number): 'green' | 'amber' | 'red' | 'grey' {
  if (status === 'EXPIRED' || status === 'CANCELLED') return 'grey'
  if (status === 'GRACE' || left <= 1) return 'red'
  if (left <= 7) return 'amber'
  return 'green'
}

/** Sequential platform invoice number, per Indian financial year: WZ/2026-27/00042. */
export function platformInvoiceNumber(fyStart: number, seq: number): string {
  return `WZ/${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}/${String(seq).padStart(5, '0')}`
}
