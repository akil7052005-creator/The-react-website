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

  it('shows the get-started checklist until the first selection is shared', async () => {
    expect((await workflow()).checklist).toEqual({ eventCreated: false, photosUploaded: false, selectionShared: false })
    const s = await selection(10, 'Checklist wedding')
    expect((await workflow()).checklist).toEqual({ eventCreated: true, photosUploaded: true, selectionShared: false })
    await A.agent.post(`/api/v1/selections/${s.id}/mark-shared`).expect(200)
    expect((await workflow()).checklist).toEqual({ eventCreated: true, photosUploaded: true, selectionShared: true })
    expect((await workflow()).uploadTarget).toMatchObject({ id: s.id })
  })

  it('needs attention: submitted picks, galleries expiring within 7 days, unpaid invoices', async () => {
    const submitted = await selection(20, 'Submitted wedding')
    const view = (await pub().get(`/api/v1/public/selections/${submitted.publicToken}`).expect(200)).body
    await pub().post(`/api/v1/public/selections/${submitted.publicToken}/picks`).send({ photoId: view.photos[0].id, memberId: view.members[0].id, picked: true }).expect(200)
    await pub().post(`/api/v1/public/selections/${submitted.publicToken}/submit`).send({ memberId: view.members[0].id }).expect(200)
    const soon = await selection(5, 'Soon wedding')
    await A.agent.post(`/api/v1/selections/${soon.id}/mark-shared`).expect(200)
    const later = await selection(12, 'Later wedding')
    await prisma.invoice.create({
      data: {
        studioId: A.studioId,
        number: 'INV-TEST-1',
        clientId,
        issueDate: new Date(),
        dueDate: new Date(Date.now() - 2 * DAY),
        placeOfSupply: '33',
        subtotal: 100_000,
        cgst: 9_000,
        sgst: 9_000,
        igst: 0,
        total: 118_000,
        amountPaid: 18_000,
      },
    })

    const w = await workflow()
    const byKind = (k: string) => w.needsAttention.filter((n: { kind: string }) => n.kind === k)
    expect(byKind('SUBMITTED')).toEqual([
      expect.objectContaining({ id: submitted.id, title: 'Meera Iyer submitted their picks', detail: 'Submitted wedding · 1 of 5 photos', link: `/photo-selection/${submitted.id}` }),
    ])
    expect(byKind('EXPIRING').map((n: { id: string }) => n.id)).toEqual([soon.id])
    expect(byKind('EXPIRING')[0].title).toBe('Gallery expires in 5 days')
    expect(byKind('EXPIRING').some((n: { id: string }) => n.id === later.id)).toBe(false)
    expect(byKind('UNPAID')).toEqual([expect.objectContaining({ title: '₹1,000 unpaid · Meera Iyer', detail: expect.stringMatching(/^INV-TEST-1 · overdue since /) })])

    // Client activity: opening the gallery, picking, submitting.
    expect(w.activity.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['Submitted', 'Started picking', 'Opened the gallery']))
    expect(w.thisMonth).toMatchObject({ selectionsSubmitted: 1, billedPaise: 118_000 })
    expect(w.thisMonth.photosUploaded).toBeGreaterThanOrEqual(4)
    expect(w.upcoming.length).toBeLessThanOrEqual(5)
    expect(w.upcoming[0]).toEqual(expect.objectContaining({ clientName: 'Meera Iyer', daysLeft: expect.any(Number) }))
  })

  it("another studio's dashboard shows none of it", async () => {
    const w = await workflow(B)
    expect(w.needsAttention).toEqual([])
    expect(w.activity).toEqual([])
    expect(w.upcoming).toEqual([])
    expect(w.checklist.eventCreated).toBe(false)
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
