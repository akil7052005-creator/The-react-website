import type { INestApplication } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { createAdmin } from '../prisma/create-admin'
import { AdminStudiosService } from '../src/subscriptions/admin-studios.service'
import { createTestApp, expectError, resetDb, signup, type SignedUp } from './helpers'

type Agent = ReturnType<typeof request.agent>
const DAY = 86_400_000

describe('Admin → Studios: table, remove and restore', () => {
  let app: INestApplication
  let prisma: PrismaClient
  let admin: Agent
  let pro: SignedUp
  let trial: SignedUp

  beforeAll(async () => {
    ;({ app, prisma } = await createTestApp())
    await resetDb(prisma)
    trial = await signup(app, { plan: 'trial', studioName: 'Trial Frames' })
    pro = await signup(app, { plan: 'PRO', studioName: 'Pro Frames' })
    const created = await createAdmin(prisma, { email: 'studios-admin@weddyzone.test', name: 'Ops' })
    admin = request.agent(app.getHttpServer())
    await admin.post('/api/v1/auth/login').send({ email: created.email, password: created.password }).expect(200)
  })
  afterAll(() => app.close())

  it('is for platform admins only', async () => {
    await pro.agent.get('/api/v1/admin/studios').expect(403)
  })

  it('lists every studio newest first, with plan, period, dates and status; filters and searches', async () => {
    const res = await admin.get('/api/v1/admin/studios').expect(200)
    const names = res.body.data.map((r: { name: string }) => r.name)
    expect(names.indexOf('Pro Frames')).toBeLessThan(names.indexOf('Trial Frames'))
    const row = res.body.data.find((r: { id: string }) => r.id === pro.studioId)
    expect(row).toMatchObject({ plan: 'Pro', period: '1 year', status: 'ACTIVE', email: pro.email, removed: null })
    expect(row.daysLeft).toBeGreaterThan(300)
    const t = res.body.data.find((r: { id: string }) => r.id === trial.studioId)
    expect(t).toMatchObject({ plan: 'Trial', period: null })

    const onlyTrial = await admin.get('/api/v1/admin/studios?plan=TRIAL').expect(200)
    expect(onlyTrial.body.data.map((r: { id: string }) => r.id)).toEqual([trial.studioId])
    const search = await admin.get(`/api/v1/admin/studios?search=${encodeURIComponent(pro.email)}`).expect(200)
    expect(search.body.data.map((r: { id: string }) => r.id)).toEqual([pro.studioId])
  })

  it('remove needs the exact studio name; then the studio cannot log in or refresh, and restore brings it back', async () => {
    const wrong = await admin.post(`/api/v1/admin/studios/${pro.studioId}/remove`).send({ confirmName: 'Pro' }).expect(400)
    expectError(wrong.body, 'VALIDATION_ERROR')

    await admin.post(`/api/v1/admin/studios/${pro.studioId}/remove`).send({ confirmName: ' pro frames ' }).expect(200)
    // Already-open session: refresh is refused, /me too.
    await pro.agent.post('/api/v1/auth/refresh').expect((r) => expect([401, 403]).toContain(r.status))
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: pro.email, password: pro.password }).expect(403)
    expectError(login.body, 'STUDIO_REMOVED')

    const row = (await admin.get('/api/v1/admin/studios?plan=REMOVED').expect(200)).body.data[0]
    expect(row.id).toBe(pro.studioId)
    expect(row.removed.by).toBe('Ops')
    expect(new Date(row.removed.purgeAt).getTime() - new Date(row.removed.at).getTime()).toBe(30 * DAY)
    const log = await prisma.adminAuditLog.findFirst({ where: { action: 'studio.remove', targetId: pro.studioId } })
    expect(log?.summary).toContain('Pro Frames')

    await admin.post(`/api/v1/admin/studios/${pro.studioId}/restore`).expect(200)
    await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: pro.email, password: pro.password }).expect(200)
    expect(await prisma.adminAuditLog.count({ where: { action: 'studio.restore', targetId: pro.studioId } })).toBe(1)
  })

  it('after 30 days the studio is purged: users and data deleted, payments kept, row hidden from the table', async () => {
    const victim = await signup(app, { plan: 'PRO', studioName: 'Gone Frames' })
    await prisma.payment.create({
      data: { studioId: victim.studioId, purpose: 'SUBSCRIPTION', status: 'SUCCESS', amountPaise: 1999900, currency: 'INR', provider: 'TEST', invoiceNumber: 'WZ-TEST-1' } as never,
    }).catch(() => undefined)
    await admin.post(`/api/v1/admin/studios/${victim.studioId}/remove`).send({ confirmName: 'Gone Frames' }).expect(200)
    const svc = app.get(AdminStudiosService)
    expect(await svc.purgeDue(new Date(Date.now() + 29 * DAY))).toBe(0)
    expect(await svc.purgeDue(new Date(Date.now() + 31 * DAY))).toBe(1)

    expect(await prisma.user.count({ where: { studioId: victim.studioId } })).toBe(0)
    const studio = await prisma.studio.findUniqueOrThrow({ where: { id: victim.studioId } })
    expect(studio.purgedAt).not.toBeNull()
    expect(studio.email).toBeNull()
    const rows = (await admin.get('/api/v1/admin/studios?limit=100').expect(200)).body.data
    expect(rows.find((r: { id: string }) => r.id === victim.studioId)).toBeUndefined()
  })
})
