import { createHash } from 'node:crypto'
import type { INestApplication } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import { createTestApp, resetDb, signup, type SignedUp } from './helpers'

// The free trial in two allowance periods: November 2026 and December 2026, each with 5 customer
// events and 500 GB of uploads (unused ones don't carry over), free until 31 Dec 2026 23:59:59 IST.
//
// The clock is moved with a Date that runs `offset` ahead of the real one and keeps ticking, so the
// server, the login tokens and the test's cookie jar all see the same time. After each move the
// studio logs in again (its old 15-minute login has expired by then).

const RealDate = Date
let offset = 0
class TravelDate extends RealDate {
  constructor(...args: unknown[]) {
    super(...((args.length ? args : [RealDate.now() + offset]) as [number]))
  }
  static now() {
    return RealDate.now() + offset
  }
  // Dates made before the clock moved are still dates.
  static [Symbol.hasInstance](v: unknown) {
    return v instanceof RealDate
  }
}
globalThis.Date = TravelDate as unknown as DateConstructor
/** Moves "now" to an IST wall-clock moment, e.g. travelTo('2026-12-01T00:00:05'). */
const travelTo = (ist: string) => {
  offset = new RealDate(`${ist}+05:30`).getTime() - RealDate.now()
}

const GB = 1024 ** 3
const DEC_1 = '2026-11-30T18:30:00.000Z' // 1 Dec 2026, 00:00 IST
const TRIAL_END = '2026-12-31T18:29:59.000Z' // 31 Dec 2026, 23:59:59 IST
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const NOV_FULL = "You've used your 5 trial events for November. 5 more unlock on 1 Dec."
const DEC_FULL = "You've used your 5 trial events for December. Upgrade to Pro to keep creating events."

describe('Free trial: 5 events + 500 GB in November, and again in December', () => {
  let app: INestApplication
  let prisma: PrismaClient

  beforeAll(async () => {
    travelTo('2026-11-10T12:00:00')
    ;({ app, prisma } = await createTestApp())
    await resetDb(prisma)
  })
  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300))
    await app?.close()
    offset = 0
    globalThis.Date = RealDate
  })

  const login = (S: SignedUp) => S.agent.post('/api/v1/auth/login').send({ email: S.email, password: S.password }).expect(200)
  const newEvent = (S: SignedUp, n: number) => S.agent.post('/api/v1/selections/details').send({ customerName: `Customer ${n}`, customerPhone: '98400 12345', eventName: `Event ${n}`, quota: 5 })
  const meter = async (S: SignedUp) => (await S.agent.get('/api/v1/me/usage').expect(200)).body
  const banner = async (S: SignedUp) => (await S.agent.get('/api/v1/me/subscription').expect(200)).body
  const sign = (S: SignedUp, selectionId: string, n: number, originalSize = 5_000_000) =>
    S.agent.post('/api/v1/uploads/sign').send({
      selectionId,
      relativePath: `Album/IMG_${n}.JPG`,
      originalName: `IMG_${n}.JPG`,
      originalSize,
      sha256: sha(`photo ${n} ${selectionId}`),
      format: 'webp',
      previewSize: 300_000,
      thumbSize: 30_000,
    })
  /** `n` photos of `size` bytes each, put straight into the database, uploaded "now". */
  const fillPhotos = async (S: SignedUp, selectionId: string, n: number, size = 1000) => {
    const { eventId } = await prisma.selection.findUniqueOrThrow({ where: { id: selectionId }, select: { eventId: true } })
    const at = new Date()
    await prisma.$executeRaw`
      WITH f AS (
        INSERT INTO files (id, studio_id, kind, storage_key, original_name, mime_type, size, checksum, created_at)
        SELECT gen_random_uuid(), ${S.studioId}::uuid, 'PHOTO'::"FileKind", 'test/fill/' || gen_random_uuid(), 'fill.jpg', 'image/jpeg', 1000, 'fill', ${at}
        FROM generate_series(1, ${n}::int)
        RETURNING id
      )
      INSERT INTO photos (id, studio_id, event_id, selection_id, file_id, original_name, original_size, created_at)
      SELECT gen_random_uuid(), ${S.studioId}::uuid, ${eventId}::uuid, ${selectionId}::uuid, f.id, 'fill.jpg', ${size}::int, ${at} FROM f`
  }
  /** Creates `n` events; each must be allowed. */
  const createEvents = async (S: SignedUp, from: number, n: number) => {
    const ids: string[] = []
    for (let i = from; i < from + n; i++) ids.push((await newEvent(S, i).expect(201)).body.id)
    return ids
  }
  const expectBlocked = async (S: SignedUp, n: number, message: string, period: string) => {
    const res = await newEvent(S, n).expect(402)
    expect(res.body.error).toMatchObject({ code: 'PLAN_LIMIT', message })
    expect(res.body.error.details).toMatchObject({ resource: 'events', limit: 5, used: 5, plan: 'STARTER', period })
  }

  describe('a studio that signs up in November', () => {
    let N: SignedUp
    beforeAll(async () => {
      travelTo('2026-11-10T12:00:00')
      N = await signup(app, { plan: 'trial' })
    })

    it('is free until 31 Dec 2026, 23:59:59 IST', async () => {
      expect(await banner(N)).toMatchObject({ status: 'TRIAL', isTrial: true, endDate: TRIAL_END })
    })

    it('November: 5 events are fine, the 6th is blocked with the November message', async () => {
      expect(await meter(N)).toMatchObject({
        planName: 'Free Subscription',
        isTrial: true,
        lifetime: true,
        period: { name: 'November', next: 'December' },
        events: { used: 0, limit: 5 },
        uploads: { usedBytes: 0, limitBytes: 500 * GB },
        photosPerEvent: 3500,
        resetsOn: DEC_1,
      })
      await createEvents(N, 1, 5)
      await expectBlocked(N, 6, NOV_FULL, 'November')
      expect((await meter(N)).events).toMatchObject({ used: 5, limit: 5 })
      // The last moment of November: still November.
      travelTo('2026-11-30T23:59:58')
      await login(N)
      await expectBlocked(N, 7, NOV_FULL, 'November')
    })

    it('on 1 Dec the counters reset: 5 new events, then the December message', async () => {
      travelTo('2026-12-01T00:00:05')
      await login(N)
      expect(await meter(N)).toMatchObject({ period: { name: 'December', next: null }, events: { used: 0, limit: 5 }, uploads: { usedBytes: 0 }, resetsOn: TRIAL_END })
      await createEvents(N, 11, 5)
      await expectBlocked(N, 16, DEC_FULL, 'December')
      // 10 events in all: 5 in November and 5 in December.
      expect(await prisma.selection.count({ where: { studio: { id: N.studioId } } })).toBe(10)
    })
  })

  it('unused November events do not carry over to December', async () => {
    travelTo('2026-11-15T10:00:00')
    const U = await signup(app, { plan: 'trial' })
    await createEvents(U, 1, 2)
    expect((await meter(U)).events).toMatchObject({ used: 2, limit: 5 })
    travelTo('2026-12-02T09:00:00')
    await login(U)
    // 5 for December, not 5 + the 3 left over from November.
    expect((await meter(U)).events).toMatchObject({ used: 0, limit: 5 })
    await createEvents(U, 3, 5)
    await expectBlocked(U, 8, DEC_FULL, 'December')
  })

  it('500 GB of uploads per period: enforced in November, a fresh 500 GB on 1 Dec', async () => {
    travelTo('2026-11-20T10:00:00')
    const W = await signup(app, { plan: 'trial' })
    const [nov] = await createEvents(W, 1, 1)
    await fillPhotos(W, nov, 450, GB) // 450 GB uploaded in November
    await sign(W, nov, 1, 50 * GB).expect(200) // 450 + 50 = 500: still within
    const over = await sign(W, nov, 2, 51 * GB).expect(402)
    expect(over.body.error.message).toBe("You've uploaded 450 GB of your 500 GB for November. Upgrade to Pro to upload more now, or wait until 1 Dec for 500 GB more.")
    expect(over.body.error.details).toMatchObject({ resource: 'uploads', limit: 500, used: 450, period: 'November', resetsOn: DEC_1 })

    travelTo('2026-12-01T00:00:05')
    await login(W)
    expect((await meter(W)).uploads).toEqual({ usedBytes: 0, limitBytes: 500 * GB })
    const [dec] = await createEvents(W, 2, 1)
    await sign(W, dec, 3, 499 * GB).expect(200)
    await fillPhotos(W, dec, 500, GB) // 500 GB uploaded in December
    const full = await sign(W, dec, 4).expect(402)
    expect(full.body.error.message).toBe("You've uploaded 500 GB of your 500 GB for December. Upgrade to Pro to upload more.")
    expect(full.body.error.details).toMatchObject({ resource: 'uploads', limit: 500, used: 500, period: 'December' })
  })

  it('3,500 photos per event: the 3,500th is fine, the 3,501st is refused', async () => {
    travelTo('2026-12-03T10:00:00')
    const T = await signup(app, { plan: 'trial' })
    const [sel] = await createEvents(T, 1, 1)
    await fillPhotos(T, sel, 3499)
    await sign(T, sel, 1).expect(200)
    await fillPhotos(T, sel, 1)
    const over = await sign(T, sel, 2).expect(402)
    expect(over.body.error.message).toBe('This event has 3,500 photos: Free Subscription allows 3,500 per event. Upgrade for more photos per event.')
  })

  describe('a studio that signs up in December', () => {
    let D: SignedUp
    beforeAll(async () => {
      travelTo('2026-12-05T10:00:00')
      D = await signup(app, { plan: 'trial' })
    })

    it('gets December only: 5 events, then the December message', async () => {
      expect(await banner(D)).toMatchObject({ status: 'TRIAL', endDate: TRIAL_END })
      expect(await meter(D)).toMatchObject({ period: { name: 'December', next: null }, events: { used: 0, limit: 5 }, uploads: { limitBytes: 500 * GB }, resetsOn: TRIAL_END })
      await createEvents(D, 1, 4)
      // The last second of the trial: still on, one event left.
      travelTo('2026-12-31T23:59:58')
      await login(D)
      expect((await banner(D)).status).toBe('TRIAL')
      await createEvents(D, 5, 1)
      await expectBlocked(D, 6, DEC_FULL, 'December')
    })

    it('after 31 Dec 2026, 23:59:59 IST the trial is over: new events and uploads ask to upgrade', async () => {
      travelTo('2027-01-01T00:00:01')
      await login(D)
      expect(await banner(D)).toMatchObject({ status: 'GRACE', isTrial: true, endDate: TRIAL_END })
      expect(await meter(D)).toMatchObject({ blocked: true, isTrial: true })
      const ended = 'Your free trial ended on 31 Dec 2026. Upgrade to Pro or VIP to add new events and uploads.'
      const res = await newEvent(D, 7).expect(402)
      expect(res.body.error).toMatchObject({ code: 'SUBSCRIPTION_READ_ONLY', message: ended, details: { renewLink: '/subscriptions' } })
      const [sel] = (await D.agent.get('/api/v1/selections').expect(200)).body.data
      const upload = await sign(D, sel.id, 1).expect(403)
      expect(upload.body.error).toMatchObject({ code: 'PLAN_LIMIT', message: 'Your free trial has ended. Upgrade to Pro or VIP to upload photos.', details: { renewLink: '/subscriptions' } })
      // A week later the grace days are over: expired, same prompt.
      travelTo('2027-01-09T10:00:00')
      await login(D)
      expect((await banner(D)).status).toBe('EXPIRED')
      expect((await newEvent(D, 8).expect(402)).body.error.message).toBe(ended)
    })
  })

  it('Pro and VIP limits are unchanged, in December too', async () => {
    travelTo('2026-12-10T10:00:00')
    const P = await signup(app, { plan: 'PRO' })
    expect(await meter(P)).toMatchObject({ planName: 'Pro', lifetime: false, period: null, events: { limit: 10 }, uploads: { limitBytes: 500 * GB }, photosPerEvent: 3500, addon: { events: 5, pricePaise: 49_900 }, favourites: false })
    const V = await signup(app, { plan: 'ALL_ACCESS' })
    expect(await meter(V)).toMatchObject({ planName: 'VIP', lifetime: false, period: null, events: { limit: 300 }, uploads: { limitBytes: 1024 * GB }, photosPerEvent: 7000, favourites: true })

    const plans = (await P.agent.get('/api/v1/plans').expect(200)).body as { code: string; prices: object; limits: Record<string, unknown>; features: string[] }[]
    const pro = plans.find((p) => p.code === 'PRO')!
    const vip = plans.find((p) => p.code === 'ALL_ACCESS')!
    const trial = plans.find((p) => p.code === 'STARTER')!
    expect(pro.prices).toEqual({ MONTHLY: 60_000, QUARTERLY: null, HALF_YEARLY: 300_000, YEARLY: 500_000 })
    expect(vip.prices).toEqual({ MONTHLY: 120_000, QUARTERLY: null, HALF_YEARLY: 600_000, YEARLY: 1_000_000 })
    expect(pro.limits).toMatchObject({ eventsPerMonth: 10, photosPerEvent: 3500, uploadGbPerMonth: 500, addonEvents: 5 })
    expect(vip.limits).toMatchObject({ fairUseEventsPerMonth: 300, photosPerEvent: 7000, uploadGbPerMonth: 1024 })
    expect(pro.features).toContain('500 GB of uploads a month (all events)')
    expect(trial.limits).toMatchObject({ eventsTotal: 5, photosPerEvent: 3500, uploadGbTotal: 500, galleryDays: 7 })
    expect(trial.features).toEqual([
      '5 customer events in November + 5 in December',
      'Up to 3,500 photos per event',
      '500 GB of uploads each month',
      'Customer gallery open 7 days',
      'No card needed',
      'Customers pick with a heart',
    ])
  })
})
