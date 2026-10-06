import type { UsageItem } from '@weddyzone/shared'
import { describe, expect, it } from 'vitest'
import { daysLeftText, deliveryLabel, durationText, formatIstDate, formatIstDateTime, limitFeature, planCycle, storageText } from './admin'
import { usageMax, usageText } from './billing'

describe('days left badge', () => {
  it('counts down before the deadline', () => {
    expect(daysLeftText({ status: 'ACTIVE', daysLeft: 12 })).toBe('12 days')
    expect(daysLeftText({ status: 'EXPIRING_SOON', daysLeft: 1 })).toBe('1 day')
    expect(daysLeftText({ status: 'EXPIRING_SOON', daysLeft: 0 })).toBe('Today') // deadline later today
  })

  it('says the plan has ended once in grace, not "Today"', () => {
    expect(daysLeftText({ status: 'GRACE', daysLeft: 0 })).toBe('Ended today')
    expect(daysLeftText({ status: 'GRACE', daysLeft: -2 })).toBe('Ended 2d ago')
  })

  it('says ended for expired and cancelled plans', () => {
    expect(daysLeftText({ status: 'EXPIRED', daysLeft: -5 })).toBe('Ended 5d ago')
    expect(daysLeftText({ status: 'CANCELLED', daysLeft: 0 })).toBe('Ended today')
    expect(daysLeftText({ status: 'CANCELLED', daysLeft: 20 })).toBe('Ended') // cancelled by an admin before its deadline
  })
})

describe('alert delivery label', () => {
  it('shows WhatsApp without a provider as skipped, not failed', () => {
    expect(deliveryLabel({ channel: 'WHATSAPP', sentAt: null, error: 'Not delivered: WhatsApp Cloud API is not configured (set WHATSAPP_CLOUD_TOKEN)' })).toBe('Skipped – not configured')
    expect(deliveryLabel({ channel: 'WHATSAPP', sentAt: null, error: 'WhatsApp Cloud API responded 401' })).toBe('Failed')
    expect(deliveryLabel({ channel: 'EMAIL', sentAt: null, error: 'No email address on file' })).toBe('Failed')
    expect(deliveryLabel({ channel: 'EMAIL', sentAt: '2026-10-02T03:30:00.000Z', error: null })).toBe('Sent')
    expect(deliveryLabel({ channel: 'IN_APP', sentAt: null, error: null })).toBe('Pending')
  })
})

describe('usage wording', () => {
  const credits: UsageItem = { key: 'credits', label: 'WhatsApp credits used this month', used: 0, limit: null, remaining: 1839, unit: '' }

  it('shows WhatsApp credits as a balance, not a limit', () => {
    expect(usageText(credits)).toBe('0 used this month · 1,839 left in balance')
    expect(usageMax(credits)).toBe(1839)
    expect(usageText({ ...credits, used: 161 })).toBe('161 used this month · 1,839 left in balance')
  })

  it('shows plan quotas against their limit', () => {
    expect(usageText({ key: 'albums', label: 'Digital albums', used: 6, limit: 50, unit: '' })).toBe('6 / 50 (12%)')
    expect(usageText({ key: 'events', label: 'Events this month', used: 4, limit: null, unit: '' })).toBe('4 · Unlimited')
  })
})

describe('IST dates', () => {
  it('formats in IST with three-letter months', () => {
    expect(formatIstDate('2026-09-10T14:51:00.000Z')).toBe('10 Sep 2026')
    // 18:30 UTC is midnight IST: already the next day.
    expect(formatIstDate('2026-09-30T18:30:00.000Z')).toBe('01 Oct 2026')
    expect(formatIstDateTime('2026-10-05T04:35:00.000Z')).toBe('05 Oct 2026, 10:05 am')
  })
})

describe('countdown text', () => {
  const H = 3_600_000
  it('reads as days and hours, no seconds', () => {
    expect(durationText(2 * 24 * H + 22 * H + 59 * 60_000 + 59_000)).toBe('2 days 22 hrs')
    expect(durationText(24 * H + H)).toBe('1 day 1 hr')
    expect(durationText(3 * 24 * H)).toBe('3 days')
  })
  it('switches to hours and minutes under a day', () => {
    expect(durationText(5 * H + 12 * 60_000)).toBe('5 hrs 12 min')
    expect(durationText(H)).toBe('1 hr')
    expect(durationText(4 * 60_000 + 30_000)).toBe('4 min')
    expect(durationText(30_000)).toBe('under a minute')
  })
  it('works for times in the past', () => {
    expect(durationText(-(26 * H))).toBe('1 day 2 hrs')
  })
})

describe('plan cards', () => {
  it('recognises feature lines that only restate a limit', () => {
    expect(limitFeature('10 events / month')).toBe('eventsPerMonth')
    expect(limitFeature('Unlimited events')).toBe('eventsPerMonth')
    expect(limitFeature('100 GB storage')).toBe('storageGb')
    expect(limitFeature('2 TB storage')).toBe('storageGb')
    expect(limitFeature('5 team seats')).toBe('teamSeats')
    expect(limitFeature('10,000 WhatsApp credits every year')).toBe('includedCredits')
  })
  it('keeps real features', () => {
    for (const f of ['Digital albums', 'Photo selection', 'Custom domain', 'Priority support', 'Dedicated account manager', 'Basic website']) {
      expect(limitFeature(f)).toBeNull()
    }
  })
  it('shows storage in TB from 1 TB up', () => {
    expect(storageText(100)).toBe('100 GB')
    expect(storageText(2048)).toBe('2 TB')
    expect(storageText(null)).toBe('Unlimited')
  })
})

describe('plan and cycle in one column', () => {
  it('reads "Pro · Monthly"', () => {
    expect(planCycle({ plan: { id: 'p', code: 'PRO', name: 'Pro' }, cycle: 'MONTHLY', isTrial: false })).toBe('Pro · Monthly')
    expect(planCycle({ plan: { id: 's', code: 'STARTER', name: 'Starter' }, cycle: 'MONTHLY', isTrial: true })).toBe('Starter trial · Monthly')
  })
})
