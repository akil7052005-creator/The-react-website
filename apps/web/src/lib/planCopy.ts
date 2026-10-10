// How plans read on the pricing pages (in the app and on the public site): the limits as short
// lines, from the plan's own limits so an admin's change shows everywhere.

import { quotaOf, type PlanDto } from '@weddyzone/shared'

const n = (v: number) => v.toLocaleString('en-IN')
const gb = (v: number) => (v >= 1024 ? `${v % 1024 === 0 ? v / 1024 : (v / 1024).toFixed(1)} TB` : `${n(v)} GB`)

/** "10 new customer events a month", "2,000 photos per event", … */
export function planLimitLines(plan: PlanDto): string[] {
  const q = quotaOf(plan.limits)
  const lines: string[] = []
  if (q.eventsTotal !== null) lines.push(`${n(q.eventsTotal)} customer events in total`)
  else if (q.eventsPerMonth !== null) lines.push(`${n(q.eventsPerMonth)} new customer events a month`)
  else lines.push('Unlimited customer events (fair use)')
  if (q.photosPerEvent !== null) lines.push(`Up to ${n(q.photosPerEvent)} photos per event`)
  if (q.uploadGbTotal !== null) lines.push(`About ${gb(q.uploadGbTotal)} of uploads`)
  else if (q.uploadGbPerMonth !== null) lines.push(`${gb(q.uploadGbPerMonth)} of uploads a month`)
  if (q.galleryDays !== null) lines.push(`Customer gallery open ${q.galleryDays} days`)
  if (q.trialDays !== null) lines.push(`Free for ${q.trialDays} days`)
  if (q.addonEvents) lines.push(`+${q.addonEvents} events add-on any month`)
  lines.push(q.favourites ? 'Customer favourites (tick + heart)' : 'Customers pick with a heart')
  return lines
}

/** Is this the free trial plan (no price for any period)? */
export const isTrialPlan = (plan: PlanDto) => quotaOf(plan.limits).trialDays !== null && Object.values(plan.prices ?? {}).every((p) => !p)
