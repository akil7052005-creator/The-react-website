import { mrrCalculator } from '../src/subscriptions/admin-subscriptions.service'

const d = (iso: string) => new Date(iso)
let n = 0
const payment = (o: { sub: string | null; amount: number; gst?: number; cycle?: 'MONTHLY' | 'YEARLY'; from: string; to?: string }) => ({
  id: `pay-${++n}`,
  subscriptionId: o.sub,
  amount: o.amount,
  gst: o.gst ?? 0,
  cycle: o.cycle ?? 'MONTHLY',
  periodStart: d(o.from),
  periodEnd: o.to ? d(o.to) : null,
  paidAt: d(o.from),
  createdAt: d(o.from),
})

describe('MRR calculation (dashboard card and trend)', () => {
  it('counts the paid period covering the moment, excluding GST, yearly ÷ 12', () => {
    const mrr = mrrCalculator(
      [
        payment({ sub: 'a', amount: 294_882, gst: 44_982, from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z' }), // ₹2,499 + GST
        payment({ sub: 'b', amount: 2_948_820, gst: 449_820, cycle: 'YEARLY', from: '2026-01-15T00:00:00Z', to: '2027-01-15T00:00:00Z' }), // ₹24,990 / 12
      ],
      new Map(),
    )
    expect(mrr(d('2026-09-15T00:00:00Z'))).toBe(249_900 + 208_250)
    expect(mrr(d('2026-10-01T00:00:00Z'))).toBe(208_250) // a's period ended exactly then
    expect(mrr(d('2025-12-31T00:00:00Z'))).toBe(0)
  })

  it('counts a subscription once when a plan change made two paid periods overlap', () => {
    const mrr = mrrCalculator(
      [
        payment({ sub: 'a', amount: 249_900, from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z' }),
        payment({ sub: 'a', amount: 599_900, from: '2026-09-10T00:00:00Z', to: '2026-10-10T00:00:00Z' }), // upgraded mid-period
      ],
      new Map(),
    )
    expect(mrr(d('2026-09-05T00:00:00Z'))).toBe(249_900)
    expect(mrr(d('2026-09-20T00:00:00Z'))).toBe(599_900) // the newer period only, not both
  })

  it('stops counting a subscription when an admin cancels it', () => {
    const mrr = mrrCalculator([payment({ sub: 'a', amount: 249_900, from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z' })], new Map([['a', d('2026-09-20T00:00:00Z')]]))
    expect(mrr(d('2026-09-19T00:00:00Z'))).toBe(249_900)
    expect(mrr(d('2026-09-21T00:00:00Z'))).toBe(0)
  })

  it('derives a period for old payments that have none', () => {
    const mrr = mrrCalculator([{ ...payment({ sub: 'a', amount: 249_900, from: '2026-07-04T00:00:00Z' }), periodStart: null }], new Map())
    expect(mrr(d('2026-07-20T00:00:00Z'))).toBe(249_900)
    expect(mrr(d('2026-08-05T00:00:00Z'))).toBe(0)
  })
})
