import type { BillingCycle } from '@prisma/client'
import { istParts } from '@weddyzone/shared'
import { config } from '../config'

/** ₹29,488.20 — paise shown with decimals only when there are any. */
export function inr(paise: number): string {
  const rupees = paise / 100
  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2, maximumFractionDigits: 2 })}`
}

// Fixed names: Intl's en-GB gives "Sept", which reads oddly next to the other three-letter months.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "02 Oct 2027", in IST. */
export function istDay(d: Date): string {
  const p = istParts(d)
  return `${String(p.day).padStart(2, '0')} ${MONTHS[p.month - 1]} ${p.year}`
}

export const cycleLabel = (c: BillingCycle) => (c === 'YEARLY' ? 'Yearly' : 'Monthly')

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** One-click renewal: opens the plans page with this plan's confirm dialog. */
export function renewPath(planCode: string, cycle: BillingCycle): string {
  return `/subscriptions?renew=${planCode}&cycle=${cycle}`
}

export function absoluteUrl(path: string): string {
  return `${config().APP_URL.replace(/\/$/, '')}${path}`
}
