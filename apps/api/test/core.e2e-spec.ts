import type { INestApplication } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { createTestApp, expectError, isoDaysFromToday, pngBuffer, resetDb, signup, type SignedUp } from './helpers'

describe('Phase 2 — clients, events, selections, albums, dashboard', () => {
  let app: INestApplication
  let prisma: PrismaClient
  let A: SignedUp
  let B: SignedUp

  const newClient = (s: SignedUp, name = 'Priya Raman') =>
    s.agent.post('/api/v1/clients').send({ name, phone: '98400 12345', city: 'Chennai' }).expect(201)
  const newEvent = async (s: SignedUp, clientId: string, extra: Record<string, unknown> = {}) =>
    (
      await s.agent
        .post('/api/v1/events')
        .send({ clientId, title: 'Priya & Karthik Wedding', type: 'WEDDING', date: isoDaysFromToday(10), venue: 'Mandapam', city: 'Chennai', guests: 400, ...extra })
        .expect(201)
    ).body
  const upload = (s: SignedUp, selectionId: string, hue: number, name = `IMG_${hue}.png`) =>
    s.agent.post(`/api/v1/selections/${selectionId}/photos`).attach('file', pngBuffer(hue), name)

  beforeAll(async () => {
    ;({ app, prisma } = await createTestApp())
    await resetDb(prisma)
    A = await signup(app)
    B = await signup(app)
  })
  afterAll(() => app.close())

  describe('clients & events', () => {
    it('creates, lists and searches clients', async () => {
      const { body } = await newClient(A, 'Ananya Iyer')
      expect(body).toMatchObject({ name: 'Ananya Iyer', phone: '+919840012345' })
      const list = await A.agent.get('/api/v1/clients').query({ search: 'anan' }).expect(200)
      expect(list.body.meta).toMatchObject({ page: 1, total: 1 })
      const byPhone = await A.agent.get('/api/v1/clients').query({ search: '98400' }).expect(200)
      expect(byPhone.body.meta.total).toBeGreaterThan(0)
    })

    it('validates clients (phone, GSTIN needs state)', async () => {
      const res = await A.agent.post('/api/v1/clients').send({ name: 'X', phone: '123', gstin: '33ABCDE1234F1Z5' }).expect(400)
      expect(Object.keys(res.body.error.fields).sort()).toEqual(['name', 'phone', 'stateCode'])
    })

    it('creates events with sequential codes and rejects past dates', async () => {
      const client = (await newClient(A)).body
      const e1 = await newEvent(A, client.id)
      const e2 = await newEvent(A, client.id)
      expect(Number(e2.code.split('-')[1])).toBe(Number(e1.code.split('-')[1]) + 1)
      expect(e1.client.name).toBe('Priya Raman')
      const past = await A.agent
        .post('/api/v1/events')
        .send({ clientId: client.id, title: 'Old wedding', type: 'WEDDING', date: '2020-01-01', venue: 'Hall', city: 'Chennai' })
        .expect(400)
      expect(past.body.error.fields.date).toBe('Event date cannot be in the past')
    })

    it("cannot use or see another studio's clients and events", async () => {
      const client = (await newClient(A)).body
      const event = await newEvent(A, client.id)
      await B.agent.get(`/api/v1/events/${event.id}`).expect(404)
      await B.agent.patch(`/api/v1/events/${event.id}`).send({ ...event, clientId: client.id, status: 'DELIVERED' }).expect(400)
      await B.agent.delete(`/api/v1/events/${event.id}`).expect(404)
      await B.agent.get(`/api/v1/clients/${client.id}`).expect(404)
      const useForeignClient = await B.agent
        .post('/api/v1/events')
        .send({ clientId: client.id, title: 'Sneaky Wedding', type: 'WEDDING', date: isoDaysFromToday(5), venue: 'Hall', city: 'Chennai' })
        .expect(400)
      expect(useForeignClient.body.error.fields.clientId).toBeDefined()
      const list = await B.agent.get('/api/v1/events').expect(200)
      expect(list.body.data.find((e: { id: string }) => e.id === event.id)).toBeUndefined()
    })

    it('bookings are not capped by the plan (its event limit counts customer photo selections)', async () => {
      const C = await signup(app, { plan: 'trial' })
      const client = (await newClient(C)).body
      for (let i = 0; i < 3; i++) await newEvent(C, client.id)
      await C.agent
        .post('/api/v1/events')
        .send({ clientId: client.id, title: 'Another booking', type: 'WEDDING', date: isoDaysFromToday(3), venue: 'Hall', city: 'Chennai' })
        .expect(201)
    })
  })

  describe('photo selection', () => {
    let eventId: string
    let selection: { id: string; publicToken: string; members: { id: string; name: string }[] }

    beforeAll(async () => {
      const client = (await newClient(A, 'Divya Suresh')).body
      eventId = (await newEvent(A, client.id, { title: 'Divya & Arvind Wedding' })).id
      const res = await A.agent
        .post('/api/v1/selections')
        .send({ eventId, quota: 2, deadline: isoDaysFromToday(7), notesAllowed: true, members: [{ name: 'Divya' }, { name: 'Mom', phone: '9840099999' }] })
        .expect(201)
      selection = res.body
      expect(res.body).toMatchObject({ status: 'DRAFT', quota: 2, photoCount: 0, pickedCount: 0 })
      expect(res.body.code).toMatch(/^\d{6}$/)
    })

    it('validates new selections', async () => {
      const res = await A.agent.post('/api/v1/selections').send({ eventId: '', quota: 0, deadline: '2020-01-01' }).expect(400)
      expect(res.body.error.fields).toMatchObject({
        eventId: 'Select an event',
        quota: 'Quota must be at least 1 photo',
        deadline: 'Deadline cannot be in the past',
      })
    })

    it('uploads photos, rejecting fakes and duplicates', async () => {
      await upload(A, selection.id, 10).expect(201)
      await upload(A, selection.id, 50).expect(201)
      await upload(A, selection.id, 90).expect(201)
      const dup = await upload(A, selection.id, 10, 'copy.png').expect(409)
      expect(dup.body.error.fields.file).toMatch(/Duplicate/)
      const fake = await A.agent.post(`/api/v1/selections/${selection.id}/photos`).attach('file', Buffer.from('MZ-not-an-image'), 'photo.jpg').expect(422)
      expectError(fake.body, 'FILE_INVALID')
      const photos = await A.agent.get(`/api/v1/selections/${selection.id}/photos`).expect(200)
      expect(photos.body).toHaveLength(3)
      // Stored as its WebP preview, never as the file that was sent.
      await A.agent.get(photos.body[0].url).expect(200).expect('Content-Type', 'image/webp')
    })

    it('still skips a duplicate when copies upload at the same time (folder uploads send several at once)', async () => {
      const before = (await A.agent.get(`/api/v1/selections/${selection.id}/photos`).expect(200)).body.length
      const results = await Promise.all([
        upload(A, selection.id, 200, 'IMG_200.png'),
        upload(A, selection.id, 200, 'Reception/copy-of-IMG_200.png'),
        upload(A, selection.id, 200, 'Candid/another-copy.png'),
        upload(A, selection.id, 210, 'IMG_210.png'),
      ])
      const sameFile = results.slice(0, 3).map((r) => r.status).sort()
      expect(sameFile).toEqual([201, 409, 409])
      expect(results[3].status).toBe(201)
      const photos = (await A.agent.get(`/api/v1/selections/${selection.id}/photos`).expect(200)).body as { position: number }[]
      expect(photos).toHaveLength(before + 2)
      // Parallel uploads never share a position.
      expect(new Set(photos.map((p) => p.position)).size).toBe(photos.length)
    })

    it("keeps selections and photos private to the studio", async () => {
      await B.agent.get(`/api/v1/selections/${selection.id}`).expect(404)
      await upload(B, selection.id, 120).expect(404)
      const photos = await A.agent.get(`/api/v1/selections/${selection.id}/photos`).expect(200)
      await B.agent.get(photos.body[0].url).expect(404)
      await request(app.getHttpServer()).get(photos.body[0].url).expect(401)
    })

    it('sends the link over WhatsApp, deducting a credit and logging the message', async () => {
      const before = (await prisma.studio.findUniqueOrThrow({ where: { id: A.studioId } })).creditBalance
      const res = await A.agent.post(`/api/v1/selections/${selection.id}/send`).expect(200)
      expect(res.body.waLink).toMatch(/^https:\/\/wa\.me\/919840012345\?text=/)
      expect(decodeURIComponent(res.body.waLink)).toContain(`/s/${selection.publicToken}`)
      expect(res.body.creditBalance).toBe(before - 1)
      expect(res.body.message).toMatchObject({ status: 'SENT', credits: 1, templateKey: 'SELECTION_INVITE' })
      const ledger = await prisma.creditLedger.findFirst({ where: { studioId: A.studioId }, orderBy: { createdAt: 'desc' } })
      expect(ledger).toMatchObject({ delta: -1, reason: 'MESSAGE', balanceAfter: before - 1 })
      const s = await A.agent.get(`/api/v1/selections/${selection.id}`).expect(200)
      expect(s.body.status).toBe('SENT')
    })

    it('blocks sending without credits', async () => {
      const C = await signup(app)
      const client = (await newClient(C)).body
      const ev = await newEvent(C, client.id)
      const sel = (await C.agent.post('/api/v1/selections').send({ eventId: ev.id, quota: 5, deadline: isoDaysFromToday(5) }).expect(201)).body
      await upload(C, sel.id, 33).expect(201)
      await prisma.studio.update({ where: { id: C.studioId }, data: { creditBalance: 0 } })
      const res = await C.agent.post(`/api/v1/selections/${sel.id}/remind`).expect(402)
      expectError(res.body, 'INSUFFICIENT_CREDITS')
      expect(await prisma.whatsAppMessage.count({ where: { studioId: C.studioId } })).toBe(0)
    })

    it('lets the family pick on the public page with a quota lock', async () => {
      const server = app.getHttpServer()
      const view = await request(server).get(`/api/v1/public/selections/${selection.publicToken}`).expect(200)
      expect(view.body).toMatchObject({ quota: 2, readOnly: false, pickedCount: 0 })
      const [p1, p2, p3] = view.body.photos
      const [divya, mom] = view.body.members
      await request(server).get(p1.url).expect(200)

      const pick = (photoId: string, memberId: string, picked = true) =>
        request(server).post(`/api/v1/public/selections/${selection.publicToken}/picks`).send({ photoId, memberId, picked })

      expect((await pick(p1.id, divya.id).expect(200)).body.pickedCount).toBe(1)
      expect((await pick(p2.id, mom.id).expect(200)).body.pickedCount).toBe(2)
      // Hearting a photo the family already picked does not use quota.
      expect((await pick(p1.id, mom.id).expect(200)).body).toMatchObject({ pickedCount: 2, pickedBy: [divya.id, mom.id] })
      const locked = await pick(p3.id, divya.id).expect(409)
      expectError(locked.body, 'QUOTA_LOCKED')
      expect(locked.body.error.message).toMatch(/all 2 photos/)
      await pick(p2.id, mom.id, false).expect(200)
      expect((await pick(p3.id, divya.id).expect(200)).body.pickedCount).toBe(2)

      await request(server)
        .post(`/api/v1/public/selections/${selection.publicToken}/comments`)
        .send({ photoId: p3.id, memberId: divya.id, text: 'Brighter please' })
        .expect(201)
      const s = await A.agent.get(`/api/v1/selections/${selection.id}`).expect(200)
      expect(s.body).toMatchObject({ status: 'IN_PROGRESS', pickedCount: 2 })
      expect(await prisma.notification.count({ where: { studioId: A.studioId, type: 'SELECTION_PICK' } })).toBe(1)
    })

    it('rejects foreign members and photos from other selections', async () => {
      const server = app.getHttpServer()
      const view = await request(server).get(`/api/v1/public/selections/${selection.publicToken}`).expect(200)
      const res = await request(server)
        .post(`/api/v1/public/selections/${selection.publicToken}/picks`)
        .send({ photoId: view.body.photos[0].id, memberId: '00000000-0000-4000-8000-000000000000', picked: true })
        .expect(400)
      expect(res.body.error.fields.memberId).toBeDefined()
      await request(server).get('/api/v1/public/selections/not-a-real-token').expect(404)
    })

    it('exports picked filenames for Lightroom', async () => {
      const csv = await A.agent.get(`/api/v1/selections/${selection.id}/export`).query({ format: 'csv' }).expect(200)
      expect(csv.headers['content-disposition']).toMatch(/attachment; filename=".*-picks\.csv"/)
      expect(csv.text.split('\n')[0]).toBe('filename,picked_by,comments')
      expect(csv.text).toContain('IMG_10.png')
      expect(csv.text).toContain('Brighter please')
      const txt = await A.agent.get(`/api/v1/selections/${selection.id}/export`).query({ format: 'txt' }).expect(200)
      expect(txt.text.trim()).toBe('IMG_10, IMG_90')
    })

    it('checks quota edits against picks', async () => {
      const res = await A.agent.patch(`/api/v1/selections/${selection.id}`).send({ quota: 1, deadline: isoDaysFromToday(7) }).expect(400)
      expect(res.body.error.fields.quota).toMatch(/at least that/)
    })

    it('submits, then becomes read-only', async () => {
      const server = app.getHttpServer()
      const view = await request(server).get(`/api/v1/public/selections/${selection.publicToken}`).expect(200)
      const submitted = await request(server)
        .post(`/api/v1/public/selections/${selection.publicToken}/submit`)
        .send({ memberId: view.body.members[0].id })
        .expect(200)
      expect(submitted.body).toMatchObject({ status: 'SUBMITTED', readOnly: true })
      const after = await request(server)
        .post(`/api/v1/public/selections/${selection.publicToken}/picks`)
        .send({ photoId: view.body.photos[1].id, memberId: view.body.members[0].id, picked: true })
        .expect(409)
      expectError(after.body, 'READ_ONLY')
      expect(await prisma.notification.count({ where: { studioId: A.studioId, type: 'SELECTION_SUBMITTED' } })).toBe(1)
      await A.agent.post(`/api/v1/selections/${selection.id}/remind`).expect(409)
      const summary = await A.agent.get('/api/v1/selections/summary').expect(200)
      expect(summary.body.completed).toBe(1)
    })

    it('derives EXPIRED when the deadline passes', async () => {
      const sel = (await A.agent.post('/api/v1/selections').send({ eventId, quota: 5, deadline: isoDaysFromToday(3) }).expect(201)).body
      await prisma.selection.update({ where: { id: sel.id }, data: { deadline: new Date('2020-01-01T00:00:00Z') } })
      const s = await A.agent.get(`/api/v1/selections/${sel.id}`).expect(200)
      expect(s.body.status).toBe('EXPIRED')
      const list = await A.agent.get('/api/v1/selections').query({ status: 'EXPIRED' }).expect(200)
      expect(list.body.data.map((x: { id: string }) => x.id)).toContain(sel.id)
      // An expired gallery is closed to the client.
      const pub = await request(app.getHttpServer()).get(`/api/v1/public/selections/${sel.publicToken}`).expect(410)
      expect(pub.body.error.code).toBe('GALLERY_EXPIRED')
    })
  })

  describe('digital albums', () => {
    let eventId: string
    let photoIds: string[]
    let album: { id: string; publicToken: string; code: string }

    beforeAll(async () => {
      const client = (await newClient(A, 'Kavya Reddy')).body
      eventId = (await newEvent(A, client.id, { title: 'Kavya & Aditya Wedding' })).id
      const sel = (await A.agent.post('/api/v1/selections').send({ eventId, quota: 4, deadline: isoDaysFromToday(4), notesAllowed: true }).expect(201)).body
      for (const hue of [200, 220, 240, 260]) await upload(A, sel.id, hue).expect(201)
      const photos = await A.agent.get(`/api/v1/events/${eventId}/photos`).expect(200)
      photoIds = photos.body.map((p: { id: string }) => p.id)
    })

    it('creates an album from event photos only', async () => {
      const other = (await A.agent.get('/api/v1/selections').expect(200)).body.data.find((s: { event: { id: string }; photoCount: number }) => s.event.id !== eventId && s.photoCount > 0)
      const otherPhotos = (await A.agent.get(`/api/v1/selections/${other.id}/photos`).expect(200)).body
      const bad = await A.agent
        .post('/api/v1/albums')
        .send({ eventId, title: 'Kavya & Aditya', photoIds: [photoIds[0], otherPhotos[0].id] })
        .expect(400)
      expect(bad.body.error.fields.photoIds).toBeDefined()

      const res = await A.agent.post('/api/v1/albums').send({ eventId, title: 'Kavya & Aditya', subtitle: 'Wedding · Hyderabad', photoIds }).expect(201)
      album = res.body
      expect(res.body).toMatchObject({ status: 'DRAFT', pageCount: 4, title: 'Kavya & Aditya' })
      expect(res.body.code).toMatch(/^ALB-\d+$/)
    })

    it('reorders pages', async () => {
      const reversed = [...photoIds].reverse()
      const res = await A.agent.put(`/api/v1/albums/${album.id}/pages`).send({ photoIds: reversed }).expect(200)
      expect(res.body.pages.map((p: { photoId: string }) => p.photoId)).toEqual(reversed)
    })

    it('keeps drafts private, then shares (moving to In Review)', async () => {
      const server = app.getHttpServer()
      await request(server).get(`/api/v1/public/albums/${album.publicToken}`).expect(404)
      await B.agent.get(`/api/v1/albums/${album.id}`).expect(404)
      const share = await A.agent.post(`/api/v1/albums/${album.id}/share`).expect(200)
      expect(share.body.message.templateKey).toBe('ALBUM_SHARE')
      const view = await request(server).get(`/api/v1/public/albums/${album.publicToken}`).expect(200)
      expect(view.body).toMatchObject({ status: 'IN_REVIEW', title: 'Kavya & Aditya' })
      expect(view.body.pages).toHaveLength(4)
      await request(server).get(view.body.pages[0].url).expect(200)
    })

    it('collects per-spread feedback and approvals from the client', async () => {
      const server = app.getHttpServer()
      const bad = await request(server).post(`/api/v1/public/albums/${album.publicToken}/feedback`).send({ spreadIndex: 5, authorName: 'Kavya', message: 'Hi' }).expect(400)
      expect(bad.body.error.fields.spreadIndex).toBeDefined()
      const fb = await request(server)
        .post(`/api/v1/public/albums/${album.publicToken}/feedback`)
        .send({ spreadIndex: 1, authorName: 'Kavya (Bride)', message: 'Brighten the fairy lights please' })
        .expect(201)
      await request(server).post(`/api/v1/public/albums/${album.publicToken}/approvals`).send({ spreadIndex: 0, authorName: 'Kavya', approved: true }).expect(200)

      const detail = await A.agent.get(`/api/v1/albums/${album.id}`).expect(200)
      expect(detail.body.openFeedbackCount).toBe(1)
      expect(detail.body.feedback.map((f: { kind: string }) => f.kind).sort()).toEqual(['APPROVAL', 'COMMENT'])
      expect(await prisma.notification.count({ where: { studioId: A.studioId, type: 'ALBUM_FEEDBACK' } })).toBe(1)

      const resolved = await A.agent.patch(`/api/v1/albums/${album.id}/feedback/${fb.body.id}`).send({ resolved: true }).expect(200)
      expect(resolved.body.resolvedAt).not.toBeNull()
      await B.agent.patch(`/api/v1/albums/${album.id}/feedback/${fb.body.id}`).send({ resolved: false }).expect(404)
    })

    it('publishes and counts by status', async () => {
      const res = await A.agent.patch(`/api/v1/albums/${album.id}/status`).send({ status: 'PUBLISHED' }).expect(200)
      expect(res.body.status).toBe('PUBLISHED')
      const summary = await A.agent.get('/api/v1/albums/summary').expect(200)
      expect(summary.body).toMatchObject({ all: 1, PUBLISHED: 1, IN_REVIEW: 0, DRAFT: 0 })
      const tab = await A.agent.get('/api/v1/albums').query({ status: 'PUBLISHED' }).expect(200)
      expect(tab.body.meta.total).toBe(1)
    })
  })

  describe('dashboard & search', () => {
    it('returns live dashboard numbers', async () => {
      const res = await A.agent.get('/api/v1/dashboard').expect(200)
      expect(res.body.stats.totalEvents.value).toBeGreaterThan(0)
      expect(res.body.nextAssignment).toMatchObject({ daysLeft: 10 })
      expect(res.body.monthlyEvents).toHaveLength(8)
      expect(res.body.recentAlbums[0].title).toBe('Kavya & Aditya')
      expect(res.body.activity.length).toBeGreaterThan(0)
    })

    it('searches only the current studio', async () => {
      const a = await A.agent.get('/api/v1/search').query({ q: 'Kavya' }).expect(200)
      expect(a.body.map((r: { type: string }) => r.type).sort()).toEqual(expect.arrayContaining(['album', 'client', 'event']))
      const b = await B.agent.get('/api/v1/search').query({ q: 'Kavya' }).expect(200)
      expect(b.body).toEqual([])
    })
  })
})
