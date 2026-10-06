import { describe, expect, it } from 'vitest'
import {
  addCycle,
  addMonthsIst,
  alertDedupeKey,
  computeStatus,
  daysLeft,
  deadlineTone,
  DEFAULT_ALERT_SETTINGS,
  dueStage,
  fromIst,
  gstOn,
  istDate,
  isReadOnlyStatus,
  platformInvoiceNumber,
  type SubscriptionState,
} from './subscriptions'

/** An instant given as IST wall-clock time, e.g. ist('2026-01-31 10:00'). */
function ist(s: string): Date {
  const [d, t = '00:00'] = s.split(' ')
  const [year, month, day] = d.split('-').map(Number)
  const [hour, minute] = t.split(':').map(Number)
  return fromIst({ year, month, day, hour, minute })
}

const settings = DEFAULT_ALERT_SETTINGS

function sub(over: Partial<SubscriptionState> = {}): SubscriptionState {
  return {
    status: 'ACTIVE',
    isTrial: false,
    startDate: ist('2026-09-02 10:00'),
    endDate: ist('2026-10-02 10:00'),
    graceEndsAt: null,
    cancelAtPeriodEnd: false,
    autoRenew: false,
    gatewaySubscriptionId: null,
    lastPaymentFailedAt: null,
    ...over,
  }
}

describe('deadline maths', () => {
  it('adds a month keeping the IST wall-clock time', () => {
    expect(addCycle(ist('2026-10-02 09:30'), 'MONTHLY')).toEqual(ist('2026-11-02 09:30'))
    expect(addCycle(ist('2026-12-15 23:59'), 'MONTHLY')).toEqual(ist('2027-01-15 23:59'))
  })

  it('adds a year', () => {
    expect(addCycle(ist('2026-10-02 12:00'), 'YEARLY')).toEqual(ist('2027-10-02 12:00'))
  })

  it('clamps month-end dates to the last day of a shorter month', () => {
    expect(addCycle(ist('2026-01-31 10:00'), 'MONTHLY')).toEqual(ist('2026-02-28 10:00'))
    expect(addCycle(ist('2028-01-31 10:00'), 'MONTHLY')).toEqual(ist('2028-02-29 10:00')) // leap year
    expect(addCycle(ist('2026-03-31 10:00'), 'MONTHLY')).toEqual(ist('2026-04-30 10:00'))
    expect(addCycle(ist('2028-02-29 10:00'), 'YEARLY')).toEqual(ist('2029-02-28 10:00'))
  })

  it('returns to the anchor day after a short month instead of drifting', () => {
    const feb = addCycle(ist('2026-01-31 10:00'), 'MONTHLY', 31)
    expect(feb).toEqual(ist('2026-02-28 10:00'))
    expect(addCycle(feb, 'MONTHLY', 31)).toEqual(ist('2026-03-31 10:00'))
    expect(addCycle(ist('2029-02-28 10:00'), 'YEARLY', 29)).toEqual(ist('2030-02-28 10:00'))
    expect(addCycle(ist('2031-02-28 10:00'), 'YEARLY', 29)).toEqual(ist('2032-02-29 10:00'))
  })

  it('handles a month added across a year boundary and many months at once', () => {
    expect(addMonthsIst(ist('2026-11-30 08:00'), 3)).toEqual(ist('2027-02-28 08:00'))
    expect(addMonthsIst(ist('2026-10-31 08:00'), 1)).toEqual(ist('2026-11-30 08:00'))
  })

  it('does calendar maths in IST, not UTC', () => {
    // 31 Jan 02:00 IST is still 30 Jan in UTC; a UTC month-add would land on 2 Mar.
    const start = ist('2026-01-31 02:00')
    expect(start.toISOString()).toBe('2026-01-30T20:30:00.000Z')
    expect(istDate(addCycle(start, 'MONTHLY'))).toBe('2026-02-28')
  })
})

describe('days left (IST calendar days)', () => {
  it('counts calendar days, not 24-hour blocks', () => {
    const end = ist('2026-10-09 10:00')
    expect(daysLeft(end, ist('2026-10-02 23:59'))).toBe(7)
    expect(daysLeft(end, ist('2026-10-03 00:00'))).toBe(6)
    expect(daysLeft(end, ist('2026-10-09 09:00'))).toBe(0)
    expect(daysLeft(end, ist('2026-10-10 00:01'))).toBe(-1)
  })

  it('flips at midnight IST (18:30 UTC), not midnight UTC', () => {
    const end = ist('2026-10-05 12:00')
    // 18:29 UTC on 1 Oct = 23:59 IST on 1 Oct → 4 days
    expect(daysLeft(end, new Date('2026-10-01T18:29:00Z'))).toBe(4)
    // 18:30 UTC on 1 Oct = 00:00 IST on 2 Oct → 3 days, though it is still 1 Oct in UTC
    expect(daysLeft(end, new Date('2026-10-01T18:30:00Z'))).toBe(3)
  })

  it('treats a deadline just after midnight IST as that day', () => {
    const end = ist('2026-10-05 00:05')
    expect(istDate(end)).toBe('2026-10-05')
    expect(end.toISOString()).toBe('2026-10-04T18:35:00.000Z')
    expect(daysLeft(end, ist('2026-10-04 23:00'))).toBe(1)
  })
})

describe('status', () => {
  const at = (s: string, over: Partial<SubscriptionState> = {}) => computeStatus(sub(over), ist(s), settings)

  it('moves ACTIVE → EXPIRING_SOON → GRACE → EXPIRED', () => {
    expect(at('2026-09-20 10:00')).toBe('ACTIVE')
    expect(at('2026-09-25 10:00')).toBe('EXPIRING_SOON') // T-7
    expect(at('2026-10-02 09:59')).toBe('EXPIRING_SOON')
    expect(at('2026-10-02 10:00')).toBe('GRACE') // deadline reached
    expect(at('2026-10-05 09:59')).toBe('GRACE')
    expect(at('2026-10-05 10:00')).toBe('EXPIRED') // 3 grace days later
  })

  it('uses the stored grace end once set (settings changes do not move it)', () => {
    expect(at('2026-10-06 10:00', { graceEndsAt: ist('2026-10-07 10:00') })).toBe('GRACE')
    expect(computeStatus(sub(), ist('2026-10-03 10:00'), { ...settings, graceDays: 0 })).toBe('EXPIRED')
  })

  it('keeps trials as TRIAL until the deadline, then follows the same grace flow', () => {
    expect(at('2026-09-30 10:00', { isTrial: true })).toBe('TRIAL')
    expect(at('2026-10-03 10:00', { isTrial: true })).toBe('GRACE')
    expect(at('2026-10-06 10:00', { isTrial: true })).toBe('EXPIRED')
  })

  it('shows PAYMENT_FAILED for a failure in the current period only', () => {
    expect(at('2026-09-20 10:00', { lastPaymentFailedAt: ist('2026-09-19 10:00') })).toBe('PAYMENT_FAILED')
    expect(at('2026-09-20 10:00', { lastPaymentFailedAt: ist('2026-08-19 10:00') })).toBe('ACTIVE')
  })

  it('ends a plan cancelled at period end as CANCELLED, with no grace', () => {
    expect(at('2026-09-28 10:00', { cancelAtPeriodEnd: true })).toBe('EXPIRING_SOON')
    expect(at('2026-10-02 10:00', { cancelAtPeriodEnd: true })).toBe('CANCELLED')
  })

  it('keeps an admin cancellation final', () => {
    expect(at('2026-09-01 10:00', { status: 'CANCELLED' })).toBe('CANCELLED')
  })

  it('reopens an expired plan when the deadline is extended', () => {
    expect(at('2026-10-10 10:00', { status: 'EXPIRED', endDate: ist('2026-10-20 10:00') })).toBe('ACTIVE')
  })

  it('does not warn about expiry when the gateway renews automatically', () => {
    const auto = { autoRenew: true, gatewaySubscriptionId: 'sub_123' }
    expect(at('2026-09-30 10:00', auto)).toBe('ACTIVE')
    // Auto-renew without a gateway mandate cannot charge, so the studio is still warned.
    expect(at('2026-09-30 10:00', { autoRenew: true })).toBe('EXPIRING_SOON')
  })

  it('marks expired and cancelled as read-only, grace as full access', () => {
    expect(isReadOnlyStatus('EXPIRED')).toBe(true)
    expect(isReadOnlyStatus('CANCELLED')).toBe(true)
    expect(isReadOnlyStatus('GRACE')).toBe(false)
    expect(isReadOnlyStatus('PAYMENT_FAILED')).toBe(false)
  })
})

describe('reminder stages', () => {
  const stage = (s: string, over: Partial<SubscriptionState> = {}) => dueStage(sub(over), ist(s), settings)?.label ?? null

  it('fires T-7, T-3, T-1 on the right IST days', () => {
    expect(stage('2026-09-24 23:59')).toBeNull() // 8 days left
    expect(stage('2026-09-25 00:00')).toBe('T-7')
    expect(stage('2026-09-28 23:59')).toBe('T-7') // 4 days left
    expect(stage('2026-09-29 00:00')).toBe('T-3')
    expect(stage('2026-10-01 00:00')).toBe('T-1')
    expect(stage('2026-10-02 09:00')).toBe('T-1') // deadline day, before the deadline time
    expect(stage('2026-10-02 10:00')).toBe('T')
    expect(stage('2026-10-05 10:00')).toBe('GRACE_END')
  })

  it('sends only the most urgent reminder after downtime', () => {
    expect(stage('2026-09-30 12:00')).toBe('T-3') // missed T-7, 2 days left
  })

  it('skips expiry reminders when the gateway renews automatically', () => {
    expect(stage('2026-09-30 12:00', { autoRenew: true, gatewaySubscriptionId: 'sub_1' })).toBeNull()
  })

  it('sends nothing for cancelled plans', () => {
    expect(stage('2026-09-30 12:00', { status: 'CANCELLED' })).toBeNull()
    expect(stage('2026-10-03 12:00', { cancelAtPeriodEnd: true })).toBeNull()
  })

  it('honours custom reminder days', () => {
    const custom = { ...settings, reminderDays: [14, 2] }
    expect(dueStage(sub(), ist('2026-09-18 10:00'), custom)?.label).toBe('T-14')
    expect(dueStage(sub(), ist('2026-09-29 10:00'), custom)?.label).toBe('T-14')
    expect(dueStage(sub(), ist('2026-09-30 10:00'), custom)?.label).toBe('T-2')
  })
})

describe('dedupe keys', () => {
  it('is stable within a billing period and changes when the deadline moves', () => {
    const a = alertDedupeKey('expiry', 'sub-1', ist('2026-10-02 10:00'), 'T-7')
    expect(a).toBe(alertDedupeKey('expiry', 'sub-1', ist('2026-10-02 10:00'), 'T-7'))
    expect(a).not.toBe(alertDedupeKey('expiry', 'sub-1', ist('2026-11-02 10:00'), 'T-7'))
    expect(a).not.toBe(alertDedupeKey('expiry', 'sub-1', ist('2026-10-02 10:00'), 'T-3'))
    expect(a).toBe('expiry:sub-1:2026-10-02T04:30:00.000Z:T-7')
  })
})

describe('money and badges', () => {
  it('adds 18% GST', () => {
    expect(gstOn(2_499_000)).toBe(449_820) // Pro yearly ₹24,990 → ₹4,498.20 GST
    expect(gstOn(99_900)).toBe(17_982)
  })

  it('colours the days-left badge', () => {
    expect(deadlineTone('ACTIVE', 30)).toBe('green')
    expect(deadlineTone('EXPIRING_SOON', 7)).toBe('amber')
    expect(deadlineTone('EXPIRING_SOON', 1)).toBe('red')
    expect(deadlineTone('GRACE', -1)).toBe('red')
    expect(deadlineTone('EXPIRED', -5)).toBe('grey')
  })

  it('numbers platform invoices per financial year', () => {
    expect(platformInvoiceNumber(2026, 42)).toBe('WZ/2026-27/00042')
    expect(platformInvoiceNumber(2099, 1)).toBe('WZ/2099-00/00001')
  })
})
