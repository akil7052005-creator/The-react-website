import type { INestApplication } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import { WEBSITE_SECTION_KEYS } from '@weddyzone/shared'
import bcrypt from 'bcryptjs'
import request from 'supertest'
import { createTestApp, expectError, isoDaysFromToday, pngBuffer, resetDb, signup, type SignedUp } from './helpers'

describe('Phase 4 — referrals, website, banners, help, support, admin', () => {
  let app: INestApplication
  let prisma: PrismaClient
  let A: SignedUp
  let B: SignedUp
  let slugA: string

  const sections = WEBSITE_SECTION_KEYS.map((key) => ({ key, on: key !== 'blog' }))
  const settings = { sections, theme: 'Ivory Classic', primaryColor: '#8B1E3F', font: 'Manrope' }

  beforeAll(async () => {
    ;({ app, prisma } = await createTestApp())
    await resetDb(prisma)
    A = await signup(app)
    B = await signup(app)
    slugA = (await prisma.studio.findUniqueOrThrow({ where: { id: A.studioId } })).slug
  })
  afterAll(() => app.close())

  it('shows the referral code, link, share text and referred studios', async () => {
    const code = (await prisma.studio.findUniqueOrThrow({ where: { id: A.studioId } })).referralCode
    await signup(app, { referralCode: code })
    const res = await A.agent.get('/api/v1/referrals').expect(200)
    expect(res.body).toMatchObject({ code, walletBalancePaise: 0, totalEarnedPaise: 0 })
    expect(res.body.link).toMatch(new RegExp(`/signup\\?ref=${code}$`))
    expect(res.body.shareText).toContain(code)
    expect(res.body.referrals).toHaveLength(1)
    expect(res.body.referrals[0].status).toBe('PENDING')
  })

  describe('website & leads', () => {
    it('saves settings with validation', async () => {
      const bad = await A.agent
        .put('/api/v1/website')
        .send({ ...settings, primaryColor: 'red', customDomain: 'https://studio.com', videoUrl: 'https://example.com/v', seoTitle: 'x'.repeat(61) })
        .expect(400)
      expect(Object.keys(bad.body.error.fields).sort()).toEqual(['customDomain', 'primaryColor', 'seoTitle', 'videoUrl'])

      const ok = await A.agent
        .put('/api/v1/website')
        .send({ ...settings, customDomain: 'Gallery.GoldenHour.Studio', videoUrl: 'https://youtu.be/dQw4w9WgXcQ', seoTitle: 'Golden Hour' })
        .expect(200)
      expect(ok.body).toMatchObject({ customDomain: 'gallery.goldenhour.studio', seoTitle: 'Golden Hour', status: 'Live' })
      expect(ok.body.sections.find((s: { key: string }) => s.key === 'blog').on).toBe(false)

      const taken = await B.agent.put('/api/v1/website').send({ ...settings, customDomain: 'gallery.goldenhour.studio' }).expect(400)
      expect(taken.body.error.fields.customDomain).toMatch(/another studio/)
    })

    it('serves the public site, counts visits and captures leads', async () => {
      const server = app.getHttpServer()
      const site = await request(server).get(`/api/v1/public/sites/${slugA}`).expect(200)
      expect(site.body.settings.theme).toBe('Ivory Classic')
      expect(site.body).not.toHaveProperty('settings.visits')
      await request(server).post(`/api/v1/public/sites/${slugA}/visit`).expect(200)
      expect((await A.agent.get('/api/v1/website').expect(200)).body.visits).toBe(1)

      const bad = await request(server).post(`/api/v1/public/sites/${slugA}/leads`).send({ name: 'P', phone: '12' }).expect(400)
      expect(Object.keys(bad.body.error.fields).sort()).toEqual(['name', 'phone'])
      const spam = await request(server)
        .post(`/api/v1/public/sites/${slugA}/leads`)
        .send({ name: 'Bot Person', phone: '9840012345', company: 'spam inc' })
        .expect(400)
      expect(spam.body.error.fields.company).toBeDefined()

      await request(server)
        .post(`/api/v1/public/sites/${slugA}/leads`)
        .send({ name: 'Keerthi Rao', phone: '9840012345', eventDate: isoDaysFromToday(60), city: 'Chennai', message: 'Packages please' })
        .expect(201)
      const leads = await A.agent.get('/api/v1/website/leads').expect(200)
      expect(leads.body.data[0]).toMatchObject({ name: 'Keerthi Rao', phone: '+919840012345' })
      expect(await prisma.notification.count({ where: { studioId: A.studioId, type: 'LEAD_RECEIVED' } })).toBe(1)
      expect((await B.agent.get('/api/v1/website/leads').expect(200)).body.meta.total).toBe(0)
      await request(server).get('/api/v1/public/sites/no-such-studio').expect(404)
    })

    it('refuses leads when the enquiry section is off', async () => {
      await A.agent.put('/api/v1/website').send({ ...settings, sections: sections.map((s) => ({ ...s, on: s.key !== 'enquiry' })) }).expect(200)
      await request(app.getHttpServer()).post(`/api/v1/public/sites/${slugA}/leads`).send({ name: 'Late Lead', phone: '9840012345' }).expect(404)
    })
  })

  describe('gallery banners', () => {
    let first: string
    let second: string

    it('uploads banners with type, size and date validation', async () => {
      const fake = await A.agent.post('/api/v1/banners').field('title', 'Fake').field('placement', 'GALLERY_HERO').attach('file', Buffer.from('GIF89a…'), 'x.gif').expect(422)
      expectError(fake.body, 'FILE_INVALID')
      const big = Buffer.concat([pngBuffer(), Buffer.alloc(5 * 1024 * 1024 + 10)])
      const tooBig = await A.agent.post('/api/v1/banners').field('title', 'Big').field('placement', 'GALLERY_HERO').attach('file', big, 'big.png')
      expect([413, 422]).toContain(tooBig.status)
      const dates = await A.agent
        .post('/api/v1/banners')
        .field('title', 'Dates')
        .field('placement', 'GALLERY_HERO')
        .field('startDate', '2026-10-10')
        .field('endDate', '2026-10-01')
        .attach('file', pngBuffer(), 'b.png')
        .expect(400)
      expect(dates.body.error.fields.endDate).toBeDefined()

      first = (
        await A.agent
          .post('/api/v1/banners')
          .field('title', 'Forever Begins Here')
          .field('placement', 'GALLERY_HERO')
          .field('ctaText', 'Book now')
          .field('ctaUrl', 'https://goldenhour.studio/book')
          .attach('file', pngBuffer(20), 'hero.png')
          .expect(201)
      ).body.id
      const scheduled = await A.agent
        .post('/api/v1/banners')
        .field('title', 'Season Sale')
        .field('placement', 'WEBSITE_POPUP')
        .field('startDate', isoDaysFromToday(10))
        .attach('file', pngBuffer(40), 'sale.png')
        .expect(201)
      second = scheduled.body.id
      expect(scheduled.body.status).toBe('Scheduled')
    })

    it('toggles, reorders and deletes', async () => {
      const off = await A.agent.patch(`/api/v1/banners/${first}/active`).send({ active: false }).expect(200)
      expect(off.body.status).toBe('Draft')
      const bad = await A.agent.put('/api/v1/banners/order').send({ ids: [second] }).expect(400)
      expect(bad.body.error.fields.ids).toBeDefined()
      const ordered = await A.agent.put('/api/v1/banners/order').send({ ids: [second, first] }).expect(200)
      expect(ordered.body.map((b: { id: string }) => b.id)).toEqual([second, first])
      await B.agent.delete(`/api/v1/banners/${first}`).expect(404)
      await B.agent.put('/api/v1/banners/order').send({ ids: [second, first] }).expect(400)
      await A.agent.delete(`/api/v1/banners/${first}`).expect(200)
      expect((await A.agent.get('/api/v1/banners').expect(200)).body).toHaveLength(1)
    })
  })

  describe('help center', () => {
    it('searches FAQs and records one vote per user', async () => {
      const all = await A.agent.get('/api/v1/faqs').expect(200)
      expect(all.body.length).toBeGreaterThan(5)
      const gst = await A.agent.get('/api/v1/faqs').query({ search: 'CGST' }).expect(200)
      expect(gst.body.length).toBeGreaterThan(0)
      expect(gst.body.every((f: { answer: string; question: string }) => /CGST/i.test(f.answer + f.question))).toBe(true)

      const id = all.body[0].id
      await A.agent.post(`/api/v1/faqs/${id}/feedback`).send({ helpful: true }).expect(200)
      await A.agent.post(`/api/v1/faqs/${id}/feedback`).send({ helpful: true }).expect(200)
      await A.agent.post(`/api/v1/faqs/${id}/feedback`).send({ helpful: false }).expect(200)
      await B.agent.post(`/api/v1/faqs/${id}/feedback`).send({ helpful: true }).expect(200)
      const faq = await prisma.faq.findUniqueOrThrow({ where: { id } })
      expect([faq.helpfulYes, faq.helpfulNo]).toEqual([1, 1])
      const mine = await A.agent.get('/api/v1/faqs').expect(200)
      expect(mine.body.find((f: { id: string }) => f.id === id).myVote).toBe(false)
    })
  })

  describe('support tickets & admin', () => {
    let ticketId: string
    let admin: ReturnType<typeof request.agent>

    beforeAll(async () => {
      await prisma.user.create({
        data: { name: 'Support', email: 'admin@test.dev', role: 'SUPER_ADMIN', passwordHash: await bcrypt.hash('Admin12345', 4) },
      })
      admin = request.agent(app.getHttpServer())
      await admin.post('/api/v1/auth/login').send({ email: 'admin@test.dev', password: 'Admin12345' }).expect(200)
    })

    it('creates a ticket with an attachment and validates fields', async () => {
      const bad = await A.agent.post('/api/v1/tickets').field('subject', 'Hi').field('category', 'NOPE').field('priority', 'LOW').field('description', 'short').expect(400)
      expect(Object.keys(bad.body.error.fields).sort()).toEqual(['category', 'description', 'subject'])
      const res = await A.agent
        .post('/api/v1/tickets')
        .field('subject', 'Selection link not loading')
        .field('category', 'TECHNICAL')
        .field('priority', 'HIGH')
        .field('description', 'My client sees a blank page on iPhone.')
        .attach('attachment', Buffer.from('%PDF-1.4\n%fake but valid header\n'), 'screenshot.pdf')
        .expect(201)
      ticketId = res.body.id
      expect(res.body).toMatchObject({ status: 'OPEN', priority: 'HIGH' })
      expect(res.body.code).toMatch(/^TKT-\d+$/)
      const detail = await A.agent.get(`/api/v1/tickets/${ticketId}`).expect(200)
      expect(detail.body.messages[0]).toMatchObject({ fromSupport: false, attachmentName: 'screenshot.pdf' })
      await A.agent.get(detail.body.messages[0].attachmentUrl).expect(200).expect('Content-Type', 'application/pdf')
    })

    it('keeps tickets private and admin endpoints locked', async () => {
      await B.agent.get(`/api/v1/tickets/${ticketId}`).expect(404)
      await B.agent.post(`/api/v1/tickets/${ticketId}/messages`).field('body', 'hello').expect(404)
      const forbidden = await A.agent.get('/api/v1/admin/tickets').expect(403)
      expectError(forbidden.body, 'FORBIDDEN')
    })

    it('lets support reply, notifying the studio, and the studio resolve/reopen', async () => {
      const list = await admin.get('/api/v1/admin/tickets').expect(200)
      expect(list.body.data.find((t: { id: string }) => t.id === ticketId).studioName).toBeDefined()
      const replied = await admin.post(`/api/v1/admin/tickets/${ticketId}/messages`).send({ body: 'We are looking into it.' }).expect(201)
      expect(replied.body).toMatchObject({ status: 'IN_PROGRESS' })
      expect(replied.body.messages[1]).toMatchObject({ fromSupport: true, authorName: 'Weddyzone Support' })
      expect(await prisma.notification.count({ where: { studioId: A.studioId, type: 'TICKET_REPLY' } })).toBe(1)

      const resolved = await A.agent.patch(`/api/v1/tickets/${ticketId}/status`).send({ status: 'RESOLVED' }).expect(200)
      expect(resolved.body.status).toBe('RESOLVED')
      const reopened = await A.agent.post(`/api/v1/tickets/${ticketId}/messages`).field('body', 'It happened again').expect(201)
      expect(reopened.body.status).toBe('OPEN')
      const filtered = await A.agent.get('/api/v1/tickets').query({ status: 'OPEN' }).expect(200)
      expect(filtered.body.meta.total).toBe(1)
    })

    it('lets admins manage FAQs and plans', async () => {
      const faq = await admin
        .post('/api/v1/admin/faqs')
        .send({ category: 'Website', question: 'How do I add a blog post?', answer: 'Blogs are coming soon to My Website.' })
        .expect(201)
      expect((await A.agent.get('/api/v1/faqs').query({ search: 'blog post' }).expect(200)).body).toHaveLength(1)
      await admin.delete(`/api/v1/admin/faqs/${faq.body.id}`).expect(200)

      const plan = await admin
        .patch('/api/v1/admin/plans/STARTER')
        .send({
          name: 'Starter',
          tagline: 'For new photographers',
          monthlyPrice: 1099,
          yearlyPrice: 10990,
          limits: { eventsPerMonth: 12, albums: 10, storageGb: 100, teamSeats: 1, includedCredits: 0 },
          features: ['12 events / month', '100 GB storage'],
          popular: false,
          isActive: true,
        })
        .expect(200)
      expect(plan.body).toMatchObject({ monthlyPricePaise: 109_900, limits: { eventsPerMonth: 12 } })
      await A.agent.patch('/api/v1/admin/plans/STARTER').send({}).expect(403)
    })
  })
})
