import type { INestApplication } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import type { SignedUp } from './helpers'

// The upload route has its own rate-limit bucket (RATE_LIMIT_UPLOADS_PER_MIN), separate from the
// general one, so a big folder upload isn't cut off at the general limit. The limit is read when the
// decorators load, so it is set before the app is imported.
describe('Rate limiting: photo uploads', () => {
  let app: INestApplication
  let prisma: PrismaClient
  let A: SignedUp
  let selectionId: string

  beforeAll(async () => {
    process.env.RATE_LIMIT_UPLOADS_PER_MIN = '5'
    const { resetConfigCache } = await import('../src/config')
    resetConfigCache()
    const helpers = await import('./helpers')
    ;({ app, prisma } = await helpers.createTestApp())
    await helpers.resetDb(prisma)
    A = await helpers.signup(app)
    const client = await A.agent.post('/api/v1/clients').send({ name: 'Rate Client', phone: '98400 12345' }).expect(201)
    const event = await A.agent.post('/api/v1/events').send({ clientId: client.body.id, title: 'Rate Wedding', type: 'WEDDING', date: helpers.isoDaysFromToday(10), venue: 'Hall', city: 'Chennai' }).expect(201)
    selectionId = (await A.agent.post('/api/v1/selections').send({ eventId: event.body.id, quota: 20, deadline: helpers.isoDaysFromToday(7) }).expect(201)).body.id
  })
  afterAll(async () => {
    delete process.env.RATE_LIMIT_UPLOADS_PER_MIN
    await app?.close()
  })

  it('uses its own limit for uploads, leaving other routes alone', async () => {
    const { pngBuffer } = await import('./helpers')
    const statuses: number[] = []
    for (let i = 0; i < 7; i++) {
      statuses.push((await A.agent.post(`/api/v1/selections/${selectionId}/photos`).attach('file', pngBuffer(i * 40), `IMG_${i}.png`)).status)
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429, 429])
    // Other routes have their own (general) counter and still answer.
    await A.agent.get(`/api/v1/selections/${selectionId}/photos`).expect(200)
    await A.agent.get('/api/v1/me/upload-limits').expect(200)
  })
})
