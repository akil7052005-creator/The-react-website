import type { INestApplication } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { resetConfigCache } from '../src/config'
import { SelectionRemindersService } from '../src/selections/selection-reminders.service'
import { createTestApp, isoDaysFromToday, pngBuffer, resetDb, signup, type SignedUp } from './helpers'

const DAY = 86_400_000

describe('Dashboard workflow and automatic reminders', () => {
  let app: INestApplication
  let prisma: PrismaClient
  let A: SignedUp
  let B: SignedUp
  let clientId: string
  let hue = 0

  const pub = () => request(app.getHttpServer())
  const workflow = async (who: SignedUp = A) => (await who.agent.get('/api/v1/dashboard').expect(200)).body.workflow
  const event = async (days: number, title = `Event ${days}`) =>
    (await A.agent.post('/api/v1/events').send({ clientId, title, type: 'WEDDING', date: isoDaysFromToday(days), venue: 'Hall', city: 'Chennai' }).expect(201)).body
  const selection = async (deadlineDays: number, title?: string) => {
    const e = await event(Math.max(deadlineDays, 0) + 1, title)
    const s = (await A.agent.post('/api/v1/selections').send({ eventId: e.id, quota: 5, deadline: isoDaysFromToday(deadlineDays) }).expect(201)).body
    await A.agent.post(`/api/v1/selections/${s.id}/photos`).attach('file', pngBuffer((hue += 17) % 360), `P${hue}.png`).expect(201)
    return s
  }

  beforeAll(async () => {
    ;({ app, prisma } = await createTestApp())
    await resetDb(prisma)
    A = await signup(app)
    B = await signup(app)
    clientId = (await A.agent.post('/api/v1/clients').send({ name: 'Meera Iyer', phone: '98400 12345' }).expect(201)).body.id
  })
  afterAll(async () => {
    delete process.env.WHATSAPP_CLOUD_TOKEN
    delete process.env.WHATSAPP_PHONE_NUMBER_ID
    resetConfigCache()
    await new Promise((r) => setTimeout(r, 300))
    await app?.close()
  })

  it('counts the events and selections added this month', async () => {
    expect((await workflow()).createdThisMonth).toEqual({ events: 0, selections: 0 })
    await selection(10, 'Counted wedding')
    expect((await workflow()).createdThisMonth).toEqual({ events: 1, selections: 1 })
  })

  it('client activity: opened, started picking, submitted — each with the status at that time', async () => {
    const s = await selection(20, 'Submitted wedding')
    const view = (await pub().get(`/api/v1/public/selections/${s.publicToken}`).expect(200)).body
    await pub().post(`/api/v1/public/selections/${s.publicToken}/picks`).send({ photoId: view.photos[0].id, memberId: view.members[0].id, picked: true }).expect(200)
    await pub().post(`/api/v1/public/selections/${s.publicToken}/submit`).send({ memberId: view.members[0].id }).expect(200)
    const w = await workflow()
    const mine = w.activity.filter((a: { selectionId: string }) => a.selectionId === s.id)
    expect(mine.map((a: { action: string }) => a.action)).toEqual(['Submitted', 'Started picking', 'Opened the gallery'])
    expect(mine[0]).toMatchObject({ clientName: 'Meera Iyer', eventTitle: 'Submitted wedding', status: 'SUBMITTED' })
    // Opened and started picking keep In Progress after the submit.
    expect(mine.map((a: { status: string }) => a.status)).toEqual(['SUBMITTED', 'IN_PROGRESS', 'IN_PROGRESS'])
    // A deleted selection drops out of the feed.
    await A.agent.delete(`/api/v1/selections/${s.id}`).expect(200)
    expect((await workflow()).activity.some((a: { selectionId: string }) => a.selectionId === s.id)).toBe(false)
  })

  it("another studio's dashboard shows none of it", async () => {
    const w = await workflow(B)
    expect(w.activity).toEqual([])
    expect(w.createdThisMonth).toEqual({ events: 0, selections: 0 })
  })

  describe('automatic reminders', () => {
    let reminders: SelectionRemindersService
    let fetchSpy: jest.SpyInstance
    let s: { id: string }

    beforeAll(async () => {
      reminders = app.get(SelectionRemindersService)
      s = await selection(30, 'Quiet wedding')
      await A.agent.post(`/api/v1/selections/${s.id}/mark-shared`).expect(200)
    })
    afterEach(() => fetchSpy?.mockRestore())

    const configure = () => {
      process.env.WHATSAPP_CLOUD_TOKEN = 'test-token'
      process.env.WHATSAPP_PHONE_NUMBER_ID = '12345'
      resetConfigCache()
    }
    const mockGraph = (ok = true) => {
      const real = global.fetch
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
        if (String(url).startsWith('https://graph.facebook.com')) {
          return new Response(JSON.stringify(ok ? { messages: [{ id: 'wamid.1' }] } : { error: { message: 'Template not approved' } }), { status: ok ? 200 : 400 })
        }
        return real(url, init)
      })
    }
    const sharedDaysAgo = (days: number) => prisma.selection.update({ where: { id: s.id }, data: { sharedAt: new Date(Date.now() - days * DAY), lastClientVisitAt: null, lastRemindedAt: null } })
    const credits = async () => (await prisma.studio.findUniqueOrThrow({ where: { id: A.studioId } })).creditBalance

    it('does nothing while the WhatsApp Cloud API is not set up', async () => {
      await sharedDaysAgo(10)
      const r = await reminders.run()
      expect(r).toMatchObject({ skipped: 'whatsapp-not-configured', sent: 0 })
      expect((await prisma.selection.findUniqueOrThrow({ where: { id: s.id } })).autoReminders).toBe(0)
    })

    it('waits 3 quiet days, sends, then waits for 7, and never sends a third', async () => {
      configure()
      mockGraph()
      await sharedDaysAgo(2)
      expect((await reminders.run()).sent).toBe(0)

      await sharedDaysAgo(4)
      const before = await credits()
      const r1 = await reminders.run()
      expect(r1.sent).toBeGreaterThanOrEqual(1)
      expect(await credits()).toBeLessThan(before)
      const graphCalls = fetchSpy.mock.calls.filter(([u]) => String(u).startsWith('https://graph.facebook.com'))
      const body = JSON.parse(String(graphCalls.at(-1)![1]!.body))
      expect(body).toMatchObject({ to: '919840012345', template: { name: 'selection_reminder' } })
      let row = await prisma.selection.findUniqueOrThrow({ where: { id: s.id } })
      expect(row.autoReminders).toBe(1)
      const log = await prisma.selectionLog.findFirst({ where: { selectionId: s.id, action: 'Reminder sent' }, orderBy: { createdAt: 'desc' } })
      expect(log).toMatchObject({ actor: 'SYSTEM', detail: 'Automatic 3-day reminder' })

      // Same day again: nothing new (4 quiet days < 7, and the one just sent holds it back).
      await reminders.run()
      expect((await prisma.selection.findUniqueOrThrow({ where: { id: s.id } })).autoReminders).toBe(1)

      // 8 quiet days, the last reminder 3 days ago: the 7-day one goes out.
      await prisma.selection.update({ where: { id: s.id }, data: { sharedAt: new Date(Date.now() - 8 * DAY), lastRemindedAt: new Date(Date.now() - 3 * DAY) } })
      await reminders.run()
      row = await prisma.selection.findUniqueOrThrow({ where: { id: s.id } })
      expect(row.autoReminders).toBe(2)

      await prisma.selection.update({ where: { id: s.id }, data: { sharedAt: new Date(Date.now() - 30 * DAY), lastRemindedAt: null } })
      const after = await credits()
      await reminders.run()
      expect(await credits()).toBe(after)
    })

    it('a client visit counts as activity; a failed delivery costs nothing and is logged', async () => {
      configure()
      const quiet = await selection(30, 'Visited wedding')
      await A.agent.post(`/api/v1/selections/${quiet.id}/mark-shared`).expect(200)
      await prisma.selection.update({ where: { id: quiet.id }, data: { sharedAt: new Date(Date.now() - 10 * DAY), lastClientVisitAt: new Date(Date.now() - DAY) } })
      mockGraph()
      await reminders.run()
      expect((await prisma.selection.findUniqueOrThrow({ where: { id: quiet.id } })).autoReminders).toBe(0)
      fetchSpy.mockRestore()

      await prisma.selection.update({ where: { id: quiet.id }, data: { lastClientVisitAt: new Date(Date.now() - 4 * DAY) } })
      mockGraph(false)
      const before = await credits()
      const r = await reminders.run()
      expect(r.failed).toBeGreaterThanOrEqual(1)
      expect(await credits()).toBe(before)
      const log = await prisma.selectionLog.findFirst({ where: { selectionId: quiet.id, action: 'Automatic reminder failed' } })
      expect(log?.detail).toContain('Template not approved')
    })
  })
})
