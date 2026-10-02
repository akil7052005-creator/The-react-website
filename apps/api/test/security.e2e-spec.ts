import type { INestApplication } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { createTestApp, isoDaysFromToday, pngBuffer, resetDb, setStudioState, signup, type SignedUp } from './helpers'

/** Every route Express knows about, as [METHOD, path]. */
function routes(app: INestApplication): [string, string][] {
  const out: [string, string][] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stack: any[] = app.getHttpAdapter().getInstance()._router?.stack ?? app.getHttpAdapter().getInstance().router?.stack ?? []
  for (const layer of stack) {
    if (!layer.route) continue
    for (const method of Object.keys(layer.route.methods)) out.push([method.toUpperCase(), layer.route.path])
  }
  return out
}

describe('Security — auth on every route, tenant isolation, public tokens', () => {
  let app: INestApplication
  let prisma: PrismaClient
  let A: SignedUp
  let B: SignedUp

  beforeAll(async () => {
    ;({ app, prisma } = await createTestApp())
    await resetDb(prisma)
    A = await signup(app)
    B = await signup(app)
    await setStudioState(prisma, A.studioId, '33')
  })
  afterAll(() => app.close())

  it('rejects every non-public route without a session', async () => {
    const all = routes(app)
    expect(all.length).toBeGreaterThan(80)
    const isPublic = (path: string) =>
      path.startsWith('/api/v1/public/') ||
      path === '/api/v1/health' ||
      // Called by the payment gateway, authenticated by its HMAC signature instead of a session.
      path === '/api/v1/webhooks/payments' ||
      ['/api/v1/auth/signup', '/api/v1/auth/login', '/api/v1/auth/refresh', '/api/v1/auth/logout', '/api/v1/auth/forgot-password', '/api/v1/auth/reset-password'].includes(path) ||
      path.startsWith('/api/docs')
    const failures: string[] = []
    for (const [method, path] of all.filter(([, p]) => p.startsWith('/api/v1') && !isPublic(p))) {
      const url = path.replace(/:[a-zA-Z]+/g, '00000000-0000-4000-8000-000000000000')
      const res = await request(app.getHttpServer())[method.toLowerCase() as 'get'](url)
      if (res.status !== 401) failures.push(`${method} ${path} → ${res.status}`)
    }
    expect(failures).toEqual([])
  })

  it("hides every kind of studio record from other studios", async () => {
    // Studio A creates one of everything.
    const client = (await A.agent.post('/api/v1/clients').send({ name: 'Isolated Client', phone: '9840012345' }).expect(201)).body
    const event = (
      await A.agent
        .post('/api/v1/events')
        .send({ clientId: client.id, title: 'Isolated Wedding', type: 'WEDDING', date: isoDaysFromToday(5), venue: 'Hall', city: 'Chennai' })
        .expect(201)
    ).body
    const selection = (await A.agent.post('/api/v1/selections').send({ eventId: event.id, quota: 2, deadline: isoDaysFromToday(4) }).expect(201)).body
    const photo = (await A.agent.post(`/api/v1/selections/${selection.id}/photos`).attach('file', pngBuffer(1), 'a.png').expect(201)).body
    await A.agent.post(`/api/v1/selections/${selection.id}/photos`).attach('file', pngBuffer(2), 'b.png').expect(201)
    const photos = (await A.agent.get(`/api/v1/events/${event.id}/photos`).expect(200)).body
    const album = (await A.agent.post('/api/v1/albums').send({ eventId: event.id, title: 'Isolated Album', photoIds: photos.map((p: { id: string }) => p.id) }).expect(201)).body
    const invoice = (
      await A.agent
        .post('/api/v1/invoices')
        .send({ clientId: client.id, issueDate: '2026-09-01', dueDate: '2026-09-10', placeOfSupply: '33', items: [{ description: 'Coverage', sac: '998386', qty: 1, rate: 1000, gstRate: 18 }] })
        .expect(201)
    ).body
    const banner = (await A.agent.post('/api/v1/banners').field('title', 'Isolated Banner').field('placement', 'GALLERY_HERO').attach('file', pngBuffer(3), 'x.png').expect(201)).body
    const ticket = (
      await A.agent.post('/api/v1/tickets').field('subject', 'Isolated ticket').field('category', 'GENERAL').field('priority', 'LOW').field('description', 'Private problem details').expect(201)
    ).body
    const fileId = photo.url.split('/').pop()

    const attempts: [string, string, object?][] = [
      ['get', `/api/v1/clients/${client.id}`],
      ['patch', `/api/v1/clients/${client.id}`, { name: 'Hacked', phone: '9840012345' }],
      ['delete', `/api/v1/clients/${client.id}`],
      ['get', `/api/v1/events/${event.id}`],
      ['delete', `/api/v1/events/${event.id}`],
      ['get', `/api/v1/events/${event.id}/photos`],
      ['get', `/api/v1/selections/${selection.id}`],
      ['patch', `/api/v1/selections/${selection.id}`, { quota: 9, deadline: isoDaysFromToday(9) }],
      ['delete', `/api/v1/selections/${selection.id}`],
      ['get', `/api/v1/selections/${selection.id}/photos`],
      ['delete', `/api/v1/selections/${selection.id}/photos/${photo.id}`],
      ['post', `/api/v1/selections/${selection.id}/remind`],
      ['post', `/api/v1/selections/${selection.id}/mark-shared`],
      ['get', `/api/v1/selections/${selection.id}/export`],
      ['get', `/api/v1/selections/${selection.id}/message-preview`],
      ['get', `/api/v1/albums/${album.id}`],
      ['patch', `/api/v1/albums/${album.id}`, { title: 'Hacked' }],
      ['patch', `/api/v1/albums/${album.id}/status`, { status: 'PUBLISHED' }],
      ['put', `/api/v1/albums/${album.id}/pages`, { photoIds: photos.map((p: { id: string }) => p.id) }],
      ['post', `/api/v1/albums/${album.id}/share`],
      ['delete', `/api/v1/albums/${album.id}`],
      ['get', `/api/v1/invoices/${invoice.id}`],
      ['post', `/api/v1/invoices/${invoice.id}/mark-paid`, { method: 'UPI' }],
      ['post', `/api/v1/invoices/${invoice.id}/cancel`],
      ['post', `/api/v1/invoices/${invoice.id}/send`],
      ['patch', `/api/v1/banners/${banner.id}/active`, { active: false }],
      ['delete', `/api/v1/banners/${banner.id}`],
      ['get', `/api/v1/tickets/${ticket.id}`],
      ['patch', `/api/v1/tickets/${ticket.id}/status`, { status: 'RESOLVED' }],
      ['get', `/api/v1/files/${fileId}`],
    ]
    const leaks: string[] = []
    for (const [method, url, body] of attempts) {
      const res = await B.agent[method as 'get'](url).send(body ?? {})
      if (res.status !== 404) leaks.push(`${method.toUpperCase()} ${url} → ${res.status}`)
    }
    expect(leaks).toEqual([])

    // Nothing of A's shows up in B's lists or search.
    for (const list of ['/api/v1/clients', '/api/v1/events', '/api/v1/selections', '/api/v1/albums', '/api/v1/invoices', '/api/v1/tickets', '/api/v1/website/leads', '/api/v1/credits/messages']) {
      const res = await B.agent.get(list).expect(200)
      expect(res.body.meta.total).toBe(0)
    }
    expect((await B.agent.get('/api/v1/banners').expect(200)).body).toEqual([])
    expect((await B.agent.get('/api/v1/search').query({ q: 'Isolated' }).expect(200)).body).toEqual([])
    const dash = (await B.agent.get('/api/v1/dashboard').expect(200)).body
    expect(dash.recentEvents).toEqual([])
    // And A's data is untouched.
    expect((await A.agent.get(`/api/v1/albums/${album.id}`).expect(200)).body.title).toBe('Isolated Album')
  })

  describe('public tokens', () => {
    let tokens: { selA: string; selB: string; albumDraft: string; albumShared: string }
    let photoA: string
    let photoB: string
    let albumPhoto: string
    let otherEventPhoto: string

    beforeAll(async () => {
      const make = async (s: SignedUp, hue: number) => {
        const client = (await s.agent.post('/api/v1/clients').send({ name: `Token Client ${hue}`, phone: '9840012345' }).expect(201)).body
        const event = (
          await s.agent
            .post('/api/v1/events')
            .send({ clientId: client.id, title: `Token Wedding ${hue}`, type: 'WEDDING', date: isoDaysFromToday(5), venue: 'Hall', city: 'Chennai' })
            .expect(201)
        ).body
        const sel = (await s.agent.post('/api/v1/selections').send({ eventId: event.id, quota: 3, deadline: isoDaysFromToday(4) }).expect(201)).body
        const p1 = (await s.agent.post(`/api/v1/selections/${sel.id}/photos`).attach('file', pngBuffer(hue), `p${hue}.png`).expect(201)).body
        const p2 = (await s.agent.post(`/api/v1/selections/${sel.id}/photos`).attach('file', pngBuffer(hue + 1), `q${hue}.png`).expect(201)).body
        return { event, sel, p1, p2 }
      }
      const a = await make(A, 100)
      const b = await make(B, 200)
      const draft = (await A.agent.post('/api/v1/albums').send({ eventId: a.event.id, title: 'Draft Album', photoIds: [a.p1.id, a.p2.id] }).expect(201)).body
      const shared = (await A.agent.post('/api/v1/albums').send({ eventId: a.event.id, title: 'Shared Album', photoIds: [a.p1.id, a.p2.id] }).expect(201)).body
      await A.agent.post(`/api/v1/albums/${shared.id}/mark-shared`).expect(200)
      // A third photo in the same event that is NOT in the shared album.
      const extra = (await A.agent.post(`/api/v1/selections/${a.sel.id}/photos`).attach('file', pngBuffer(150), 'extra.png').expect(201)).body
      tokens = { selA: a.sel.publicToken, selB: b.sel.publicToken, albumDraft: draft.publicToken, albumShared: shared.publicToken }
      photoA = a.p1.id
      photoB = b.p1.id
      albumPhoto = a.p1.id
      otherEventPhoto = extra.id
    })

    it('uses unguessable tokens', () => {
      for (const t of Object.values(tokens)) expect(t).toMatch(/^[\w-]{24,}$/)
    })

    it("can't use one selection's token to see or pick another's photos", async () => {
      const server = app.getHttpServer()
      await request(server).get(`/api/v1/public/selections/${tokens.selA}/photos/${photoB}`).expect(404)
      const view = await request(server).get(`/api/v1/public/selections/${tokens.selA}`).expect(200)
      const member = view.body.members[0].id
      await request(server).post(`/api/v1/public/selections/${tokens.selA}/picks`).send({ photoId: photoB, memberId: member, picked: true }).expect(404)
      await request(server).post(`/api/v1/public/selections/${tokens.selB}/picks`).send({ photoId: photoB, memberId: member, picked: true }).expect(400)
    })

    it('keeps draft albums and non-album photos private', async () => {
      const server = app.getHttpServer()
      await request(server).get(`/api/v1/public/albums/${tokens.albumDraft}`).expect(404)
      await request(server).get(`/api/v1/public/albums/${tokens.albumDraft}/photos/${albumPhoto}`).expect(404)
      await request(server).post(`/api/v1/public/albums/${tokens.albumDraft}/feedback`).send({ spreadIndex: 0, authorName: 'X', message: 'Y' }).expect(404)
      await request(server).get(`/api/v1/public/albums/${tokens.albumShared}/photos/${albumPhoto}`).expect(200)
      await request(server).get(`/api/v1/public/albums/${tokens.albumShared}/photos/${otherEventPhoto}`).expect(404)
    })

    it('never serves photos through the public file route', async () => {
      const file = await prisma.photo.findUniqueOrThrow({ where: { id: photoA } })
      await request(app.getHttpServer()).get(`/api/v1/public/files/${file.fileId}`).expect(404)
    })

    it('does not leak internal ids or studio data on public pages', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/public/selections/${tokens.selA}`).expect(200)
      const body = JSON.stringify(res.body)
      expect(body).not.toContain(A.studioId)
      expect(body).not.toMatch(/passwordHash|referralCode|walletBalance|creditBalance|"gstin"/)
      expect(res.body.members.every((m: { phone: unknown }) => m.phone === null)).toBe(true)
    })
  })

  it('sets security headers and blocks unknown origins', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').set('Origin', 'https://evil.example').expect(200)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
    const ok = await request(app.getHttpServer()).get('/api/v1/health').set('Origin', 'http://localhost:5173').expect(200)
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    // Form posts (no JSON / multipart content type) are refused.
    await request(app.getHttpServer()).post('/api/v1/auth/login').type('form').send('email=a@b.com&password=x').expect(415)
  })
})
