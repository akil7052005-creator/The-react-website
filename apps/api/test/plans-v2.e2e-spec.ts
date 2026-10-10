import { createHash } from 'node:crypto'
import type { INestApplication } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import { addDays } from '@weddyzone/shared'
import request from 'supertest'
import { createTestApp, isoDaysFromToday, pngBuffer, putOnPlan, resetDb, signup, type SignedUp } from './helpers'

// Update 2: Trial / Pro / VIP. Limits are enforced on the server (event creation, upload sign and
// complete), shown in the meter, and whichever is reached first applies. Favourites are VIP only.

const GB = 1024 ** 3
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

describe('Plans: Trial, Pro, VIP', () => {
  let app: INestApplication
  let prisma: PrismaClient
  const http = () => request(app.getHttpServer())

  beforeAll(async () => {
    ;({ app, prisma } = await createTestApp())
    await resetDb(prisma)
  })
  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300))
    await app?.close()
  })

  const newEvent = (S: SignedUp, n: number) => S.agent.post('/api/v1/selections/details').send({ customerName: `Customer ${n}`, customerPhone: '98400 12345', eventName: `Event ${n}`, quota: 5 })
  const meter = async (S: SignedUp) => (await S.agent.get('/api/v1/me/usage').expect(200)).body
  /** Signs one preview upload (no bytes needed to test the limits). */
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

  describe('Trial', () => {
    let T: SignedUp
    beforeAll(async () => {
      T = await signup(app, { plan: 'trial' })
    })

    it('allows 2 customer events in total, then asks to upgrade', async () => {
      expect(await meter(T)).toMatchObject({ planCode: 'STARTER', planName: 'Trial', isTrial: true, lifetime: true, events: { used: 0, limit: 2 }, photosPerEvent: 100, favourites: false, addon: null })
      await newEvent(T, 1).expect(201)
      await newEvent(T, 2).expect(201)
      const res = await newEvent(T, 3).expect(402)
      expect(res.body.error).toMatchObject({ code: 'PLAN_LIMIT', message: 'Your Trial includes 2 customer events. Upgrade to add more.' })
      expect(res.body.error.details).toMatchObject({ resource: 'events', limit: 2, used: 2, plan: 'STARTER', addon: null })
      // Deleting an event doesn't give it back: events are counted when created.
      const list = (await T.agent.get('/api/v1/selections').expect(200)).body.data
      await T.agent.delete(`/api/v1/selections/${list[0].id}`).expect(200)
      await newEvent(T, 4).expect(402)
    })

    it('galleries stay open at most 7 days', async () => {
      const [sel] = (await T.agent.get('/api/v1/selections').expect(200)).body.data
      const settings = (await T.agent.get(`/api/v1/selections/${sel.id}/settings`).expect(200)).body
      expect(settings.galleryExpiresOn).toBe(isoDaysFromToday(7))
      expect(settings.addons).toMatchObject({ favourites: false, galleryDaysMax: 7 })
      await T.agent.patch(`/api/v1/selections/${sel.id}/settings`).send({ galleryExpiry: 30 }).expect(400)
      await T.agent.patch(`/api/v1/selections/${sel.id}/settings`).send({ galleryExpiry: null }).expect(400)
      await T.agent.patch(`/api/v1/selections/${sel.id}/settings`).send({ galleryExpiry: 7 }).expect(200)
    })

    it('100 photos per event and about 2 GB of uploads', async () => {
      const [sel] = (await T.agent.get('/api/v1/selections').expect(200)).body.data
      // A 3 GB original is more than the whole trial allows.
      const big = await sign(T, sel.id, 1, 3 * GB).expect(402)
      expect(big.body.error.details).toMatchObject({ resource: 'uploads', limit: 2 })
      await prisma.plan.update({ where: { code: 'STARTER' }, data: { limits: { ...((await prisma.plan.findUniqueOrThrow({ where: { code: 'STARTER' } })).limits as object), photosPerEvent: 1 } } })
      const one = (await sign(T, sel.id, 2).expect(200)).body
      // Upload it (local storage) and record it: the second photo is then over the per-event limit.
      await http().put(one.preview.url).set('Content-Type', 'image/webp').send(Buffer.alloc(300_000)).expect(200)
      await http().put(one.thumb.url).set('Content-Type', 'image/webp').send(Buffer.alloc(30_000)).expect(200)
      await T.agent
        .post('/api/v1/uploads/complete')
        .send({ selectionId: sel.id, photoId: one.photoId, relativePath: 'Album/IMG_2.JPG', originalName: 'IMG_2.JPG', originalSize: 5_000_000, sha256: sha(`photo 2 ${sel.id}`), format: 'webp', previewSize: 300_000, thumbSize: 30_000 })
        .expect(200)
      const over = await sign(T, sel.id, 3).expect(402)
      expect(over.body.error.details).toMatchObject({ resource: 'photos', limit: 1, used: 1 })
      expect(over.body.error.message).toMatch(/Upgrade for more photos per event/)
      await prisma.plan.update({ where: { code: 'STARTER' }, data: { limits: { ...((await prisma.plan.findUniqueOrThrow({ where: { code: 'STARTER' } })).limits as object), photosPerEvent: 100 } } })
    })
  })

  describe('Pro', () => {
    let P: SignedUp
    beforeAll(async () => {
      P = await signup(app, { plan: 'PRO' })
    })

    it('10 new events a month, a warning at 8, then "Upgrade" or "Buy +5 events"', async () => {
      for (let i = 1; i <= 8; i++) await newEvent(P, i).expect(201)
      const m = await meter(P)
      expect(m).toMatchObject({ planName: 'Pro', lifetime: false, events: { used: 8, limit: 10, addon: 0 }, warn: true, addon: { events: 5, pricePaise: 49_900 }, favourites: false })
      expect(m.uploads.limitBytes).toBe(500 * GB)
      expect(new Date(m.resetsOn).getTime() - new Date(m.windowStart).getTime()).toBe(30 * 86_400_000)
      await newEvent(P, 9).expect(201)
      await newEvent(P, 10).expect(201)
      const res = await newEvent(P, 11).expect(402)
      expect(res.body.error.message).toMatch(/^You've used all 10 events this month on Pro\. Upgrade or buy \+5 events to add more\. Resets on /)
      expect(res.body.error.details).toMatchObject({ resource: 'events', limit: 10, used: 10, addon: { events: 5, pricePaise: 49_900 } })
    })

    it('"+5 events" is paid (GST on top) and lasts for this month only', async () => {
      const bought = (await P.agent.post('/api/v1/subscription/addon-events').expect(200)).body
      expect(bought.payment).toMatchObject({ purpose: 'EVENT_ADDON', amountPaise: 49_900 + 8_982, status: 'SUCCESS' })
      expect(bought.usage.events).toMatchObject({ used: 10, limit: 15, addon: 5 })
      for (let i = 11; i <= 15; i++) await newEvent(P, i).expect(201)
      await newEvent(P, 16).expect(402)
      // 30 days later a new window starts: 10 again, the add-on doesn't carry over.
      const back = (d: Date) => addDays(d, -31)
      await prisma.subscription.update({ where: { studioId: P.studioId }, data: { usageAnchor: back(new Date()), currentPeriodStart: back(new Date()) } })
      await prisma.$executeRaw`UPDATE selections SET created_at = created_at - interval '31 days' WHERE studio_id = ${P.studioId}::uuid`
      await prisma.$executeRaw`UPDATE usage_addons SET window_start = window_start - interval '31 days' WHERE studio_id = ${P.studioId}::uuid`
      expect((await meter(P)).events).toMatchObject({ used: 0, limit: 10, addon: 0 })
      await newEvent(P, 17).expect(201)
    })

    it('uploads are counted in original size: 500 GB a month', async () => {
      const [sel] = (await P.agent.get('/api/v1/selections').expect(200)).body.data
      await sign(P, sel.id, 1, 499 * GB).expect(200)
      const res = await sign(P, sel.id, 2, 501 * GB).expect(402)
      expect(res.body.error.details).toMatchObject({ resource: 'uploads', limit: 500 })
      expect(res.body.error.message).toMatch(/0 GB of 500 GB this month on Pro/)
    })

    it('customers pick with a heart and have no favourites; the setting is locked', async () => {
      const [sel] = (await P.agent.get('/api/v1/selections').expect(200)).body.data
      const verify = (await http().post('/api/v1/public/selection/verify').send({ code: sel.code }).expect(200)).body
      const view = (await http().get(`/api/v1/public/selection/${sel.id}`).set('X-Client-Token', verify.token).expect(200)).body
      expect(view.pickIcon).toBe('heart')
      expect(view.permissions.favorites).toBe(false)
      expect((await P.agent.patch(`/api/v1/selections/${sel.id}/settings`).send({ favoriteOption: true }).expect(402)).body.error.message).toBe('Customer favourites come with the VIP plan.')
    })
  })

  describe('VIP', () => {
    let V: SignedUp
    beforeAll(async () => {
      V = await signup(app, { plan: 'ALL_ACCESS' })
    })

    it('unlimited events (fair use), 5,000 photos per event, 1 TB a month; tick + heart for customers', async () => {
      const m = await meter(V)
      expect(m).toMatchObject({ planName: 'VIP', events: { limit: 300 }, photosPerEvent: 5000, favourites: true, addon: null })
      expect(m.uploads.limitBytes).toBe(1024 * GB)
      const sel = (await newEvent(V, 1).expect(201)).body
      await V.agent.post(`/api/v1/selections/${sel.id}/photos`).attach('file', pngBuffer(30), 'a.png').expect(201)
      const verify = (await http().post('/api/v1/public/selection/verify').send({ code: sel.code }).expect(200)).body
      const view = (await http().get(`/api/v1/public/selection/${sel.id}`).set('X-Client-Token', verify.token).expect(200)).body
      expect(view.pickIcon).toBe('tick')
      expect(view.permissions.favorites).toBe(true)
      const [folder] = view.folders
      const items = (await http().get(`/api/v1/public/selection/${sel.id}/folders/${folder.id}/items`).set('X-Client-Token', verify.token).expect(200)).body.items
      await http().patch(`/api/v1/public/selection/${sel.id}/items/${items[0].id}`).set('X-Client-Token', verify.token).send({ favorite: true }).expect(200)
    })
  })

  describe('when a plan ends', () => {
    it('grace (7 days): no new events or uploads, galleries still open; after grace they close; nothing is deleted', async () => {
      const S = await signup(app, { plan: 'PRO' })
      const sel = (await newEvent(S, 1).expect(201)).body
      const end = addDays(new Date(), -2)
      await prisma.subscription.update({ where: { studioId: S.studioId }, data: { currentPeriodEnd: end, currentPeriodStart: addDays(end, -30), status: 'GRACE' } })
      expect((await meter(S)).blocked).toBe(true)
      expect((await newEvent(S, 2).expect(402)).body.error.code).toBe('SUBSCRIPTION_READ_ONLY')
      expect((await sign(S, sel.id, 1).expect(403)).body.error.message).toBe('Renew your plan to upload')
      await http().post('/api/v1/public/selection/verify').send({ code: sel.code }).expect(200)

      await prisma.subscription.update({ where: { studioId: S.studioId }, data: { currentPeriodEnd: addDays(new Date(), -9), status: 'EXPIRED' } })
      expect((await http().post('/api/v1/public/selection/verify').send({ code: sel.code }).expect(403)).body.error.code).toBe('GALLERY_CLOSED')
      // The studio still sees everything; renewing reopens the galleries.
      await S.agent.get(`/api/v1/selections/${sel.id}`).expect(200)
      await putOnPlan(prisma, S.studioId, 'PRO')
      await http().post('/api/v1/public/selection/verify').send({ code: sel.code }).expect(200)
    })
  })
})
