import type { INestApplication } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import { createTestApp, isoDaysFromToday, pngBuffer, resetDb, signup, type SignedUp } from './helpers'

/** The Photo Selection table (sortable columns, overview totals) and the dashboard's completed count. */
describe('Photo Selection list', () => {
  let app: INestApplication
  let prisma: PrismaClient
  let A: SignedUp

  async function selectionFor(clientName: string, type: 'WEDDING' | 'ENGAGEMENT' | 'OTHER', photos: number) {
    const client = await A.agent.post('/api/v1/clients').send({ name: clientName, phone: '9876500000' }).expect(201)
    const event = await A.agent
      .post('/api/v1/events')
      .send({ clientId: client.body.id, title: `${clientName} event`, type, date: isoDaysFromToday(10), venue: 'Hall', city: 'Chennai' })
      .expect(201)
    const sel = await A.agent.post('/api/v1/selections').send({ eventId: event.body.id, quota: 5, deadline: isoDaysFromToday(7) }).expect(201)
    for (let i = 0; i < photos; i++) {
      await A.agent.post(`/api/v1/selections/${sel.body.id}/photos`).attach('file', pngBuffer(10 + i * 40 + clientName.length), `p${i}.png`).expect(201)
    }
    return sel.body as { id: string }
  }

  beforeAll(async () => {
    ;({ app, prisma } = await createTestApp())
    await resetDb(prisma)
    A = await signup(app)
    await selectionFor('Zara Khan', 'WEDDING', 1)
    await selectionFor('Akilesh', 'ENGAGEMENT', 3)
    const done = await selectionFor('Meera Iyer', 'OTHER', 2)
    await prisma.selection.update({ where: { id: done.id }, data: { status: 'SUBMITTED', submittedAt: new Date() } })
  })
  afterAll(() => app.close())

  it('shows the event type with each selection', async () => {
    const res = await A.agent.get('/api/v1/selections').expect(200)
    expect(res.body.data.find((s: { client: { name: string } }) => s.client.name === 'Akilesh').event.type).toBe('ENGAGEMENT')
  })

  it.each([
    ['project', ['Akilesh', 'Meera Iyer', 'Zara Khan']],
    ['-project', ['Zara Khan', 'Meera Iyer', 'Akilesh']],
    ['photos', ['Zara Khan', 'Meera Iyer', 'Akilesh']],
    ['-photos', ['Akilesh', 'Meera Iyer', 'Zara Khan']],
    ['created', ['Zara Khan', 'Akilesh', 'Meera Iyer']],
  ])('sorts by %s', async (sort, order) => {
    const res = await A.agent.get('/api/v1/selections').query({ sort }).expect(200)
    expect(res.body.data.map((s: { client: { name: string } }) => s.client.name)).toEqual(order)
  })

  it('pages with the chosen page size', async () => {
    const res = await A.agent.get('/api/v1/selections').query({ limit: 2, page: 2, sort: 'created' }).expect(200)
    expect(res.body.meta).toMatchObject({ page: 2, limit: 2, total: 3 })
    expect(res.body.data).toHaveLength(1)
  })

  it('gives the overview totals', async () => {
    const res = await A.agent.get('/api/v1/selections/summary').expect(200)
    expect(res.body).toMatchObject({ selections: 3, photos: 6, completed: 1 })
  })

  it('counts completed selections on the dashboard', async () => {
    const res = await A.agent.get('/api/v1/dashboard').expect(200)
    expect(res.body.stats).toMatchObject({ completedSelections: 1, totalEvents: { value: 3 } })
  })
})
