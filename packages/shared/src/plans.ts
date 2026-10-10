// Plans: Trial, Pro and VIP, billed for 1, 3, 6 or 12 months. Limits and prices live in the plan
// rows (editable by platform admins); this file holds their shape, defaults and the usage-window
// maths shared by the API (enforcement) and the web app (meters, pricing).
//
// "Event" = one customer's photo selection, counted when it is created (a deleted one still
// counts). Monthly limits reset every 30 days from the plan's start date, whatever period was bought.

import type { BillingCycle, PlanCode } from './enums'

/** Months in each billing period. */
export const CYCLE_MONTHS: Record<BillingCycle, number> = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 }
export const CYCLE_LABELS: Record<BillingCycle, string> = { MONTHLY: '1 month', QUARTERLY: '3 months', HALF_YEARLY: '6 months', YEARLY: '1 year' }
/** The order the pricing switch shows them in. */
export const PRICING_CYCLES: BillingCycle[] = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY']

/** Display names: the codes stay as they are in the database (Starter → Trial, All-Access → VIP). */
export const PLAN_NAMES: Record<PlanCode, string> = { STARTER: 'Trial', PRO: 'Pro', STUDIO: 'Studio', ALL_ACCESS: 'VIP' }

/** Price of each billing period in paise (GST extra); null = not offered. */
export type PlanPrices = Partial<Record<BillingCycle, number | null>>

/** Days in one usage window. */
export const USAGE_WINDOW_DAYS = 30
const DAY_MS = 86_400_000

/**
 * The usage window `now` falls in: windows of 30 days from `anchor` (the plan's start date).
 * `resetsOn` is when the next one starts.
 */
export function usageWindow(anchor: Date, now = new Date()): { start: Date; resetsOn: Date } {
  const span = USAGE_WINDOW_DAYS * DAY_MS
  const k = Math.max(0, Math.floor((now.getTime() - anchor.getTime()) / span))
  const start = new Date(anchor.getTime() + k * span)
  return { start, resetsOn: new Date(start.getTime() + span) }
}

/** Pro-rated credit for the unused part of a paid period (paise, GST excluded). */
export function proratedCredit(paidPaise: number, periodStart: Date, periodEnd: Date, now = new Date()): number {
  const total = periodEnd.getTime() - periodStart.getTime()
  if (total <= 0 || paidPaise <= 0 || now >= periodEnd) return 0
  const left = periodEnd.getTime() - Math.max(now.getTime(), periodStart.getTime())
  return Math.max(0, Math.floor((paidPaise * left) / total))
}

/** The parts of a plan's limits that Update 2 added (all optional: older rows fall back to these). */
export interface PlanQuota {
  /** New events per 30-day window; null = no monthly cap. */
  eventsPerMonth: number | null
  /** Events over the whole plan (Trial); null = none. */
  eventsTotal: number | null
  /** VIP fair use: the monthly ceiling behind "unlimited". */
  fairUseEventsPerMonth: number | null
  photosPerEvent: number | null
  /** Upload allowance per window, measured in original file size; null = none. */
  uploadGbPerMonth: number | null
  /** Upload allowance over the whole plan (Trial). */
  uploadGbTotal: number | null
  /** How long a trial lasts. */
  trialDays: number | null
  /** Customer galleries stay open at most this long (Trial); null = the studio decides. */
  galleryDays: number | null
  /** Events in the paid "+N events" add-on, and its price (paise); null = no add-on. */
  addonEvents: number | null
  addonEventsPricePaise: number | null
  /** Customers can mark favourites (VIP). */
  favourites: boolean
}

export const DEFAULT_QUOTA: PlanQuota = {
  eventsPerMonth: null,
  eventsTotal: null,
  fairUseEventsPerMonth: null,
  photosPerEvent: null,
  uploadGbPerMonth: null,
  uploadGbTotal: null,
  trialDays: null,
  galleryDays: null,
  addonEvents: null,
  addonEventsPricePaise: null,
  favourites: false,
}

/** The quota from a plan's `limits` JSON, defaults filled in. */
export function quotaOf(limits: unknown): PlanQuota {
  const l = (limits && typeof limits === 'object' ? limits : {}) as Record<string, unknown>
  const num = (k: keyof PlanQuota) => (typeof l[k] === 'number' && Number.isFinite(l[k]) && (l[k] as number) >= 0 ? (l[k] as number) : null)
  return {
    eventsPerMonth: num('eventsPerMonth'),
    eventsTotal: num('eventsTotal'),
    fairUseEventsPerMonth: num('fairUseEventsPerMonth'),
    photosPerEvent: num('photosPerEvent'),
    uploadGbPerMonth: num('uploadGbPerMonth'),
    uploadGbTotal: num('uploadGbTotal'),
    trialDays: num('trialDays'),
    galleryDays: num('galleryDays'),
    addonEvents: num('addonEvents'),
    addonEventsPricePaise: num('addonEventsPricePaise'),
    favourites: l.favourites === true,
  }
}

/** Warn when this share of a limit is used (8 of 10 events). */
export const LIMIT_WARN_RATIO = 0.8

/** GET /me/usage: the dashboard meter. */
export interface UsageMeterDto {
  planCode: PlanCode
  planName: string
  isTrial: boolean
  /** Whole-plan limits (Trial) instead of monthly ones. */
  lifetime: boolean
  events: { used: number; limit: number | null; addon: number }
  uploads: { usedBytes: number; limitBytes: number | null }
  photosPerEvent: number | null
  windowStart: string
  resetsOn: string
  /** "+5 events" can be bought now; its size and price. */
  addon: { events: number; pricePaise: number } | null
  favourites: boolean
  /** New events and uploads are blocked (grace, expired or cancelled). */
  blocked: boolean
  /** Close to a limit (≥ 80 %). */
  warn: boolean
}
