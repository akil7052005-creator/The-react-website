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
  GST_RATE,
  istDate,
  isReadOnlyStatus,
  platformInvoiceNumber,
  splitInclusiveGst,
  splitInclusiveGstPaise,
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
  it('takes 18% GST out of a GST-inclusive price, never adds it', () => {
    expect(splitInclusiveGst(600)).toEqual({ totalPaise: 60_000, basePaise: 50_847, gstPaise: 9_153 }) // ₹508.47 + ₹91.53
    expect(splitInclusiveGst(1200)).toEqual({ totalPaise: 120_000, basePaise: 101_695, gstPaise: 18_305 }) // ₹1,016.95 + ₹183.05
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

describe('trial offer: free until 31 Dec 2026, then 14 days', () => {
  it('a trial started before the offer ends runs until 31 Dec 2026, 23:59:59 IST', async () => {
    const { trialEndsAt, TRIAL_OFFER_END } = await import('./subscriptions')
    expect(TRIAL_OFFER_END.toISOString()).toBe('2026-12-31T18:29:59.000Z')
    for (const start of ['2026-11-02T10:00:00+05:30', '2026-12-30T08:00:00+05:30', '2026-12-31T23:59:58+05:30']) {
      expect(trialEndsAt(new Date(start), 14).toISOString()).toBe('2026-12-31T18:29:59.000Z')
    }
  })

  it('a trial started after it gets the plan\'s trial days', async () => {
    const { trialEndsAt } = await import('./subscriptions')
    expect(trialEndsAt(new Date('2027-01-01T00:00:00+05:30'), 14).toISOString()).toBe('2027-01-14T18:30:00.000Z')
    expect(trialEndsAt(new Date('2027-03-10T12:00:00Z')).toISOString()).toBe('2027-03-24T12:00:00.000Z')
  })

  it('reads "Free until 31 Dec" while it lasts and "14 days" after', async () => {
    const { trialOffer } = await import('./subscriptions')
    expect(trialOffer(14, new Date('2026-11-02T10:00:00+05:30'))).toEqual({ on: true, line: 'Free until 31 Dec 2026', lower: 'free until 31 Dec 2026', note: 'Free until 31 Dec', span: 'until 31 Dec' })
    expect(trialOffer(14, new Date('2027-01-01T00:00:00+05:30'))).toEqual({ on: false, line: 'Free for 14 days', lower: 'free for 14 days', note: '14-day free trial', span: '14 days' })
  })
})

describe('trial periods: November, then December (IST)', () => {
  const at = async (iso: string) => (await import('./subscriptions')).trialPeriodAt(new Date(iso))
  const DEC_1 = '2026-11-30T18:30:00.000Z' // 1 Dec 2026, 00:00 IST

  it('November runs to 30 Nov 23:59:59 IST and counts everything before it; 5 more unlock on 1 Dec', async () => {
    for (const iso of ['2026-10-20T10:00:00+05:30', '2026-11-02T10:00:00+05:30', '2026-11-30T23:59:59.999+05:30']) {
      const p = await at(iso)
      expect(p.name).toBe('November')
      expect(p.start.getTime()).toBe(0)
      expect(p.next).toEqual({ name: 'December', start: new Date(DEC_1), label: '1 Dec' })
    }
  })

  it('December starts at 1 Dec 00:00 IST (a fresh allowance) and is the last period', async () => {
    for (const iso of ['2026-12-01T00:00:00+05:30', '2026-12-15T12:00:00+05:30', '2026-12-31T23:59:59+05:30']) {
      const p = await at(iso)
      expect(p).toEqual({ name: 'December', start: new Date(DEC_1), next: null })
    }
  })

  it('after the offer there are no named periods: a 14-day trial is one period', async () => {
    const p = await at('2027-01-05T10:00:00+05:30')
    expect(p).toEqual({ name: null, start: new Date('2026-12-31T18:30:00.000Z'), next: null })
  })

  it('a studio signing up in November gets both periods, in December only December, after it none', async () => {
    const { trialPeriodsAhead } = await import('./subscriptions')
    expect(trialPeriodsAhead(new Date('2026-11-02T10:00:00+05:30'))).toEqual(['November', 'December'])
    expect(trialPeriodsAhead(new Date('2026-12-01T00:00:00+05:30'))).toEqual(['December'])
    expect(trialPeriodsAhead(new Date('2027-01-01T00:00:00+05:30'))).toEqual([])
  })

  it('the offer\'s end and labels come from the last period\'s date', async () => {
    const { TRIAL_OFFER_END, TRIAL_OFFER_END_LABEL } = await import('./subscriptions')
    expect(TRIAL_OFFER_END.toISOString()).toBe('2026-12-31T18:29:59.000Z')
    expect(TRIAL_OFFER_END_LABEL).toEqual({ short: '31 Dec', long: '31 Dec 2026' })
  })
})

describe('splitInclusiveGst: every price includes 18% GST', () => {
  // [item, price in rupees (GST included), taxable value in paise, GST in paise]. Plan and add-on
  // prices as seeded (prisma/seed/reference.ts); credit packs from CREDIT_PACKS.
  const prices: [string, number, number, number][] = [
    ['Pro · 1 month', 600, 50_847, 9_153],
    ['Pro · 6 months', 3_000, 254_237, 45_763],
    ['Pro · 1 year', 5_000, 423_729, 76_271],
    ['VIP · 1 month', 1_200, 101_695, 18_305],
    ['VIP · 6 months', 6_000, 508_475, 91_525],
    ['VIP · 1 year', 10_000, 847_458, 152_542],
    ['+5 events add-on', 499, 42_288, 7_612],
    ['500 WhatsApp credits', 399, 33_814, 6_086],
    ['2,000 WhatsApp credits', 1_399, 118_559, 21_341],
    ['5,000 WhatsApp credits', 2_999, 254_153, 45_747],
    ['a prorated upgrade (₹437.33)', 437.33, 37_062, 6_671],
  ]

  it.each(prices)('%s: ₹%s is the total, with the GST inside it', (_item, rupees, base, gst) => {
    const s = splitInclusiveGst(rupees)
    expect(s).toEqual({ totalPaise: Math.round(rupees * 100), basePaise: base, gstPaise: gst })
    // Nothing is added on top: base + GST is the price, to the paisa.
    expect(s.basePaise + s.gstPaise).toBe(s.totalPaise)
    // The paise version gives the same, and matches base = total / 1.18.
    expect(splitInclusiveGstPaise(s.totalPaise)).toEqual(s)
    expect(s.basePaise).toBe(Math.round(s.totalPaise / (1 + GST_RATE)))
  })

  it('adds up exactly for every amount from ₹1 to ₹20,000, with the GST 18% of the taxable value (to the paisa)', () => {
    const wrong: number[] = []
    for (let total = 100; total <= 2_000_000; total++) {
      const { basePaise, gstPaise } = splitInclusiveGstPaise(total)
      if (basePaise + gstPaise !== total || Math.abs(gstPaise - basePaise * GST_RATE) > 1) wrong.push(total)
    }
    expect(wrong).toEqual([])
  })
})
