// How plans read on the pricing pages (in the app and on the public site): the limits as short
// lines, from the plan's own limits so an admin's change shows everywhere.

import { quotaOf, trialPeriodsAhead, type PlanDto } from '@weddyzone/shared'

const n = (v: number) => v.toLocaleString('en-IN')
const gb = (v: number) => (v >= 1024 ? `${v % 1024 === 0 ? v / 1024 : (v / 1024).toFixed(1)} TB` : `${n(v)} GB`)

/**
 * "10 new customer events a month", "Up to 3,500 photos per event", … The Trial's events and uploads
 * are per trial period: "5 customer events in November + 5 in December" while the launch offer has
 * both months ahead, "… in December" during December, and for the whole trial after the offer.
 */
export function planLimitLines(plan: PlanDto, now = new Date()): string[] {
  const q = quotaOf(plan.limits)
  const ahead = trialPeriodsAhead(now)
  const lines: string[] = []
  if (q.eventsTotal !== null) lines.push(ahead.length ? `${n(q.eventsTotal)} customer events in ${ahead.join(` + ${n(q.eventsTotal)} in `)}` : `${n(q.eventsTotal)} customer events in total`)
  else if (q.eventsPerMonth !== null) lines.push(`${n(q.eventsPerMonth)} new customer events a month`)
  else lines.push('Unlimited customer events (fair use)')
  if (q.photosPerEvent !== null) lines.push(`Up to ${n(q.photosPerEvent)} photos per event`)
  if (q.uploadGbTotal !== null) {
    const when = ahead.length > 1 ? ' each month' : ahead.length === 1 ? ` in ${ahead[0]}` : ''
    lines.push(`${gb(q.uploadGbTotal)} of uploads${when}`)
  } else if (q.uploadGbPerMonth !== null) {
    // Pro: the monthly uploads are shared by all of the month's events, not per event.
    lines.push(`${gb(q.uploadGbPerMonth)} of uploads a month${q.eventsPerMonth !== null ? ' (all events)' : ''}`)
  }
  if (q.galleryDays !== null) lines.push(`Customer gallery open ${q.galleryDays} days`)
  if (q.trialDays !== null) lines.push('No card needed')
  if (q.addonEvents) lines.push(`+${q.addonEvents} events add-on any month`)
  lines.push(q.favourites ? 'Customer favourites (tick + heart)' : 'Customers pick with a heart')
  return lines
}

/** Is this the free trial plan (no price for any period)? */
export const isTrialPlan = (plan: PlanDto) => quotaOf(plan.limits).trialDays !== null && Object.values(plan.prices ?? {}).every((p) => !p)
