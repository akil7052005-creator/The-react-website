import type { INestApplication } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { createAdmin } from '../prisma/create-admin'
import { createTestApp, resetDb, signup, type SignedUp } from './helpers'

type Agent = ReturnType<typeof request.agent>

const starterBody = {
  name: 'Starter',
  tagline: 'For new photographers',
  monthlyPrice: 999,
  yearlyPrice: 9990,
  limits: { eventsPerMonth: 10, albums: 10, storageGb: 100, teamSeats: 1, includedCredits: 0 },
  features: ['10 events / month', '100 GB storage', 'Custom domain'],
  comingSoon: ['Custom domain'],
  popular: false,
  isActive: true,
}

/** Max-Age (seconds) of the refresh cookie a login response set. */
function refreshCookieMaxAge(res: request.Response): number {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? [])
  const refresh = cookies.find((c) => c.startsWith('wz_rt='))!
  return Number(/Max-Age=(\d+)/.exec(refresh)![1])
}

describe('Platform admin area', () => {
  let app: INestApplication
  let prisma: PrismaClient
  let studio: SignedUp
  let admin: Agent
  let adminId: string
  let adminLogin: request.Response

  beforeAll(async () => {
    ;({ app, prisma } = await createTestApp())
    await resetDb(prisma)
    studio = await signup(app)
    const created = await createAdmin(prisma, { email: 'Ops@Weddyzone.test', name: 'Priya Ops' })
    adminId = (await prisma.user.findUniqueOrThrow({ where: { email: 'ops@weddyzone.test' } })).id
    admin = request.agent(app.getHttpServer())
    adminLogin = await admin.post('/api/v1/auth/login').send({ email: created.email, password: created.password }).expect(200)
  })
  afterAll(() => app.close())

  const auditFor = (action: string) => prisma.adminAuditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } })

  describe('security', () => {
    it('creates admins with a strong random password, never a studio', async () => {
      expect(adminLogin.body.user).toMatchObject({ role: 'SUPER_ADMIN', email: 'ops@weddyzone.test' })
      expect(adminLogin.body.studio).toBeNull()
      const again = await createAdmin(prisma, { email: 'second@weddyzone.test', name: 'Second Admin' })
      expect(again.password).toMatch(/^[A-Za-z0-9_-]{24}$/)
      await expect(createAdmin(prisma, { email: studio.email, name: 'Hijack' })).rejects.toThrow(/studio account/)
      await expect(createAdmin(prisma, { email: 'ops@weddyzone.test', name: 'Priya Ops' })).rejects.toThrow(/already an admin/)
      await expect(createAdmin(prisma, { email: 'nobody@weddyzone.test' })).rejects.toThrow(/--name/)
    })

    it('a password reset signs the admin out everywhere and the old password stops working', async () => {
      const other = request.agent(app.getHttpServer())
      const first = await createAdmin(prisma, { email: 'reset@weddyzone.test', name: 'Reset Me' })
      await other.post('/api/v1/auth/login').send({ email: first.email, password: first.password }).expect(200)
      const reset = await createAdmin(prisma, { email: 'reset@weddyzone.test', resetPassword: true })
      expect(reset.created).toBe(false)
      await other.post('/api/v1/auth/refresh').expect(401)
      await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: first.email, password: first.password }).expect(401)
      await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: reset.email, password: reset.password }).expect(200)
    })

    it('admin sessions last 8 hours, studio sessions 30 days', async () => {
      expect(refreshCookieMaxAge(adminLogin)).toBe(8 * 3600)
      const token = await prisma.refreshToken.findFirstOrThrow({ where: { userId: adminId }, orderBy: { createdAt: 'desc' } })
      expect(token.expiresAt.getTime() - token.createdAt.getTime()).toBeLessThanOrEqual(8 * 3600_000 + 5_000)

      const owner = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: studio.email, password: studio.password }).expect(200)
      expect(refreshCookieMaxAge(owner)).toBe(30 * 86_400)
    })

    it('records every admin sign-in', async () => {
      const logins = await auditFor('auth.login')
      expect(logins.some((l) => l.actorUserId === adminId && l.summary.includes('ops@weddyzone.test'))).toBe(true)
      // Studio sign-ins are not admin actions.
      expect(logins.every((l) => !l.summary.includes(studio.email))).toBe(true)
    })

    it.each([
      ['get', '/api/v1/admin/tickets'],
      ['get', '/api/v1/admin/faqs'],
      ['get', '/api/v1/admin/plans'],
      ['post', '/api/v1/admin/faqs'],
      ['patch', '/api/v1/admin/plans/STARTER'],
    ] as const)('refuses studio users: %s %s', async (method, path) => {
      const res = await studio.agent[method](path).send({})
      expect(res.status).toBe(403)
      expect(await prisma.adminAuditLog.count({ where: { actorUserId: studio.userId } })).toBe(0)
    })

    it('refuses visitors who are not logged in', async () => {
      await request(app.getHttpServer()).get('/api/v1/admin/plans').expect(401)
    })
  })

  describe('plans', () => {
    it('lists every plan, hidden ones included, with its coming-soon features', async () => {
      await prisma.plan.update({ where: { code: 'PRO' }, data: { isActive: false } })
      const res = await admin.get('/api/v1/admin/plans').expect(200)
      // Trial, Pro, VIP, then the retired (hidden) Studio plan.
      expect(res.body.map((p: { code: string }) => p.code)).toEqual(['STARTER', 'PRO', 'ALL_ACCESS', 'STUDIO'])
      expect(res.body.find((p: { code: string }) => p.code === 'PRO')).toMatchObject({ isActive: false, comingSoon: [] })
      expect(res.body.find((p: { code: string }) => p.code === 'STUDIO')).toMatchObject({ isActive: false })
      const studioView = await studio.agent.get('/api/v1/plans').expect(200)
      expect(studioView.body.map((p: { code: string }) => p.code)).not.toContain('PRO')
      await prisma.plan.update({ where: { code: 'PRO' }, data: { isActive: true } })
    })

    it('rejects a coming-soon feature that is not on the plan', async () => {
      const res = await admin
        .patch('/api/v1/admin/plans/STARTER')
        .send({ ...starterBody, comingSoon: ['Teleportation'] })
        .expect(400)
      expect(res.body.error.fields.comingSoon).toMatch(/Teleportation/)
    })

    it('saves a plan, shows it to studios and records what changed', async () => {
      const res = await admin.patch('/api/v1/admin/plans/STARTER').send(starterBody).expect(200)
      expect(res.body).toMatchObject({ monthlyPricePaise: 99_900, comingSoon: ['Custom domain'], isActive: true })

      const studioView = await studio.agent.get('/api/v1/plans').expect(200)
      expect(studioView.body.find((p: { code: string }) => p.code === 'STARTER')).toMatchObject({ comingSoon: ['Custom domain'] })

      const [entry] = await auditFor('plan.update')
      expect(entry).toMatchObject({ actorUserId: adminId, targetType: 'plan' })
      expect(entry.summary).toContain('features')
      expect(entry.summary).toContain('coming soon: Custom domain')
    })
  })

  describe('FAQs', () => {
    it('adds, edits, hides and deletes FAQs, with an audit entry for each', async () => {
      const created = await admin
        .post('/api/v1/admin/faqs')
        .send({ category: 'Website', question: 'Can I add a blog?', answer: 'Blogs are coming soon to My Website.', isPublished: false })
        .expect(201)
      expect(created.body).toMatchObject({ isPublished: false, helpfulYes: 0, helpfulNo: 0 })
      // Drafts are not shown to studios.
      expect((await studio.agent.get('/api/v1/faqs').query({ search: 'add a blog' }).expect(200)).body).toHaveLength(0)

      await admin
        .patch(`/api/v1/admin/faqs/${created.body.id}`)
        .send({ category: 'Website', question: 'Can I add a blog?', answer: 'Blogs are coming soon.', isPublished: true })
        .expect(200)
      expect((await studio.agent.get('/api/v1/faqs').query({ search: 'add a blog' }).expect(200)).body).toHaveLength(1)

      const all = await admin.get('/api/v1/admin/faqs').expect(200)
      expect(all.body.find((f: { id: string }) => f.id === created.body.id)).toMatchObject({ isPublished: true })

      await admin.delete(`/api/v1/admin/faqs/${created.body.id}`).expect(200)
      expect((await auditFor('faq.create'))[0].summary).toBe('Added FAQ "Can I add a blog?"')
      expect((await auditFor('faq.update'))[0].summary).toBe('Edited FAQ "Can I add a blog?" (published)')
      expect((await auditFor('faq.delete'))[0].summary).toBe('Deleted FAQ "Can I add a blog?"')
    })
  })

  describe('support inbox', () => {
    it('replies and changes status on any studio ticket, with audit entries', async () => {
      const t = await studio.agent
        .post('/api/v1/tickets')
        .field('subject', 'Invoice numbering')
        .field('category', 'BILLING')
        .field('priority', 'MEDIUM')
        .field('description', 'Can I restart numbering for a new branch?')
        .expect(201)
      await admin.post(`/api/v1/admin/tickets/${t.body.id}/messages`).send({ body: 'Yes, from Billing settings.' }).expect(201)
      const resolved = await admin.patch(`/api/v1/admin/tickets/${t.body.id}/status`).send({ status: 'RESOLVED' }).expect(200)
      expect(resolved.body.status).toBe('RESOLVED')

      expect((await auditFor('ticket.reply'))[0]).toMatchObject({ targetId: t.body.id, summary: expect.stringContaining(t.body.code) })
      expect((await auditFor('ticket.status'))[0].summary).toBe(`Set ${t.body.code} from IN_PROGRESS to RESOLVED`)
    })
  })
})
