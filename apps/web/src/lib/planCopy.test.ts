import type { PlanDto, UsageMeterDto } from '@weddyzone/shared'
import { describe, expect, it } from 'vitest'
import { limitNote, meterText } from './billing'
import { planLimitLines } from './planCopy'

// The plan rows' limits, as seeded (prisma/seed/reference.ts).
const plan = (limits: Record<string, unknown>) => ({ limits }) as unknown as PlanDto
const TRIAL = plan({ eventsPerMonth: null, eventsTotal: 5, photosPerEvent: 3500, uploadGbPerMonth: null, uploadGbTotal: 50, trialDays: 14, galleryDays: 7, favourites: false })
const PRO = plan({ eventsPerMonth: 10, eventsTotal: null, photosPerEvent: 3500, uploadGbPerMonth: 500, uploadGbTotal: null, addonEvents: 5, addonEventsPricePaise: 49_900, favourites: false })
const VIP = plan({ eventsPerMonth: null, eventsTotal: null, fairUseEventsPerMonth: 300, photosPerEvent: 7000, uploadGbPerMonth: 1024, uploadGbTotal: null, favourites: true })
const ist = (s: string) => new Date(`${s}+05:30`)

describe('plan cards', () => {
  it('Trial in November: 5 events in November + 5 in December, 50 GB each month', () => {
    expect(planLimitLines(TRIAL, ist('2026-11-02T10:00:00'))).toEqual([
      '5 customer events in November + 5 in December',
      'Up to 3,500 photos per event',
      '50 GB of uploads each month (about 5,000 photos)',
      'Customer gallery open 7 days',
      'No card needed',
      'Customers pick with a heart',
    ])
  })

  it('Trial in December: December only', () => {
    const lines = planLimitLines(TRIAL, ist('2026-12-05T10:00:00'))
    expect(lines[0]).toBe('5 customer events in December')
    expect(lines[2]).toBe('50 GB of uploads in December (about 5,000 photos)')
  })

  it('Trial after the offer: one allowance for the 14-day trial', () => {
    const lines = planLimitLines(TRIAL, ist('2027-02-01T10:00:00'))
    expect(lines[0]).toBe('5 customer events in total')
    expect(lines[2]).toBe('50 GB of uploads (about 5,000 photos)')
  })

  it('Pro: "500 GB of uploads a month (all events)"; VIP unchanged', () => {
    expect(planLimitLines(PRO)).toEqual(['10 new customer events a month', 'Up to 3,500 photos per event', '500 GB of uploads a month (all events)', '+5 events add-on any month', 'Customers pick with a heart'])
    expect(planLimitLines(VIP)).toEqual(['Unlimited customer events (fair use)', 'Up to 7,000 photos per event', '1 TB of uploads a month', 'Customer favourites (tick + heart)'])
  })
})

describe('usage meter', () => {
  const GB = 1024 ** 3
  const meter = (over: Partial<UsageMeterDto>): UsageMeterDto => ({
    planCode: 'STARTER',
    planName: 'Free Subscription',
    isTrial: true,
    lifetime: true,
    period: { name: 'November', next: 'December' },
    events: { used: 2, limit: 5, addon: 0 },
    uploads: { usedBytes: 12 * GB, limitBytes: 50 * GB },
    photosPerEvent: 3500,
    windowStart: '1970-01-01T00:00:00.000Z',
    resetsOn: '2026-11-30T18:30:00.000Z', // 1 Dec, 00:00 IST
    addon: null,
    favourites: false,
    blocked: false,
    warn: false,
    ...over,
  })

  it('Trial: "Events X/5 (November)", the uploads and the reset date', () => {
    expect(meterText(meter({}))).toBe('Events 2/5 (November) · Uploads 12 GB of 50 GB · resets on 1 Dec')
    expect(meterText(meter({ period: { name: 'December', next: null }, resetsOn: '2026-12-31T18:29:59.000Z' }))).toBe('Events 2/5 (December) · Uploads 12 GB of 50 GB · trial ends 31 Dec')
  })

  it('Trial: what a full period says', () => {
    const nov = meter({ events: { used: 5, limit: 5, addon: 0 }, uploads: { usedBytes: 50 * GB, limitBytes: 50 * GB } })
    expect(limitNote(nov, 'events')).toBe("You've used your 5 trial events for November. 5 more unlock on 1 Dec.")
    expect(limitNote(nov, 'uploads')).toBe("You've used your 50 GB of uploads for November. 50 GB more on 1 Dec.")
    const dec = { ...nov, period: { name: 'December', next: null }, resetsOn: '2026-12-31T18:29:59.000Z' }
    expect(limitNote(dec, 'events')).toBe("You've used your 5 trial events for December. Upgrade to Pro to keep creating events.")
    expect(limitNote(dec, 'uploads')).toBe("You've used your 50 GB of uploads for December. Upgrade to Pro to upload more.")
  })

  it('Pro reads as before', () => {
    const pro = meter({ planCode: 'PRO', planName: 'Pro', isTrial: false, lifetime: false, period: null, events: { used: 7, limit: 10, addon: 0 }, uploads: { usedBytes: 320 * GB, limitBytes: 500 * GB }, resetsOn: '2026-12-08T04:30:00.000Z' })
    expect(meterText(pro)).toBe('Events 7/10 · Uploads 320 GB of 500 GB · resets on 8 Dec')
    expect(limitNote(pro, 'events')).toBe("You've used all your events this month.")
  })
})
