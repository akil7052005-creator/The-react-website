import type { INestApplication } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import sharp from 'sharp'
import request from 'supertest'
import { zipNames } from '../src/selections/selection-workflow.service'
import { createTestApp, expectError, isoDaysFromToday, pngBuffer, resetDb, signup, type SignedUp } from './helpers'

/** Collects a binary response (ZIP) into a Buffer. */
const binary: Parameters<request.Test['parse']>[0] = (res, cb) => {
  const chunks: Buffer[] = []
  res.on('data', (c: Buffer) => chunks.push(c))
  res.on('end', () => cb(null, Buffer.concat(chunks)))
}

/** Waits for background preview jobs to settle. */
const settle = () => new Promise((r) => setTimeout(r, 300))

describe('Studio workflow: Photo Selection', () => {
  let app: INestApplication
  let prisma: PrismaClient
  let A: SignedUp
  let B: SignedUp
  let eventId: string
  let hue = 0

  const pub = () => request(app.getHttpServer())
  const upload = (selectionId: string, opts: { folder?: string; folderId?: string; size?: number } = {}) => {
    const req = A.agent.post(`/api/v1/selections/${selectionId}/photos`)
    if (opts.folder !== undefined) req.field('folder', opts.folder)
    if (opts.folderId !== undefined) req.field('folderId', opts.folderId)
    hue += 13
    return req.attach('file', pngBuffer(hue % 360, opts.size ?? 64), `IMG_${hue}.png`)
  }
  const newSelection = async (body: Record<string, unknown> = {}) =>
    (await A.agent.post('/api/v1/selections').send({ eventId, quota: 3, deadline: isoDaysFromToday(10), ...body }).expect(201)).body

  beforeAll(async () => {
    ;({ app, prisma } = await createTestApp())
    await resetDb(prisma)
    A = await signup(app)
    B = await signup(app)
    const client = await A.agent.post('/api/v1/clients').send({ name: 'Priya Kumar', phone: '98400 12345' }).expect(201)
    eventId = (
      await A.agent
        .post('/api/v1/events')
        .send({ clientId: client.body.id, title: 'Priya Wedding', type: 'WEDDING', date: isoDaysFromToday(5), venue: 'Hall', city: 'Chennai' })
        .expect(201)
    ).body.id
  })
  afterAll(async () => {
    await settle()
    await app?.close()
  })

  describe('folders, statuses and the event page', () => {
    it('Draft → Uploading on the first photo → Shared when the link goes out', async () => {
      const s = await newSelection()
      expect(s.status).toBe('DRAFT')
      await upload(s.id).expect(201)
      expect((await A.agent.get(`/api/v1/selections/${s.id}`).expect(200)).body.status).toBe('UPLOADING')
      const shared = await A.agent.post(`/api/v1/selections/${s.id}/mark-shared`).expect(200)
      expect(shared.body).toMatchObject({ status: 'SENT', sharedAt: expect.any(String) })
    })

    it('files photos by their top upload folder, else General; a chosen folder wins', async () => {
      const s = await newSelection()
      await upload(s.id, { folder: 'Haldi/Close-ups' }).expect(201)
      await upload(s.id, { folder: 'haldi' }).expect(201) // same folder, any case
      await upload(s.id).expect(201)
      const mehendi = await A.agent.post(`/api/v1/selections/${s.id}/folders`).send({ name: 'Mehendi' }).expect(201)
      const r = await upload(s.id, { folderId: mehendi.body.id, folder: 'Wedding' }).expect(201)
      expect(r.body.folderId).toBe(mehendi.body.id)
      const folders = (await A.agent.get(`/api/v1/selections/${s.id}/folders`).expect(200)).body
      expect(folders.map((f: { name: string; photoCount: number }) => [f.name, f.photoCount])).toEqual([
        ['Haldi', 2],
        ['General', 1],
        ['Mehendi', 1],
      ])
    })

    it('rejects duplicate folder names and a folder from another selection', async () => {
      const s = await newSelection()
      const other = await newSelection()
      await A.agent.post(`/api/v1/selections/${s.id}/folders`).send({ name: 'Wedding' }).expect(201)
      const dup = await A.agent.post(`/api/v1/selections/${s.id}/folders`).send({ name: 'wedding' }).expect(409)
      expectError(dup.body, 'CONFLICT')
      const foreign = await A.agent.post(`/api/v1/selections/${other.id}/folders`).send({ name: 'Haldi' }).expect(201)
      await upload(s.id, { folderId: foreign.body.id }).expect(400)
    })

    it('deleting a folder keeps its photos (they move to General); rename and move work', async () => {
      const s = await newSelection()
      await upload(s.id, { folder: 'Reception' }).expect(201)
      const folders = (await A.agent.get(`/api/v1/selections/${s.id}/folders`).expect(200)).body
      const reception = folders[0]
      await A.agent.patch(`/api/v1/selections/${s.id}/folders/${reception.id}`).send({ name: 'Sangeet' }).expect(200)
      const del = await A.agent.delete(`/api/v1/selections/${s.id}/folders/${reception.id}`).expect(200)
      expect(del.body.moved).toBe(1)
      const after = (await A.agent.get(`/api/v1/selections/${s.id}/folders`).expect(200)).body
      expect(after.map((f: { name: string; photoCount: number }) => [f.name, f.photoCount])).toEqual([['General', 1]])
      const haldi = await A.agent.post(`/api/v1/selections/${s.id}/folders`).send({ name: 'Haldi' }).expect(201)
      const photos = (await A.agent.get(`/api/v1/selections/${s.id}/photos`).expect(200)).body
      await A.agent.post(`/api/v1/selections/${s.id}/photos/move`).send({ photoIds: [photos[0].id], folderId: haldi.body.id }).expect(200)
      expect((await A.agent.get(`/api/v1/selections/${s.id}/photos`).expect(200)).body[0].folderId).toBe(haldi.body.id)
    })

    it('overview has the selection, folders, notes count, log and event date', async () => {
      const s = await newSelection()
      await upload(s.id, { folder: 'Wedding' }).expect(201)
      const o = (await A.agent.get(`/api/v1/selections/${s.id}/overview`).expect(200)).body
      expect(o.selection).toMatchObject({ id: s.id, eventDate: isoDaysFromToday(5), hasPin: false, watermark: false, allowDownload: false, notesAllowed: false })
      expect(o.folders).toHaveLength(1)
      expect(o.noteCount).toBe(0)
      expect(o.log.map((l: { action: string }) => l.action)).toContain('Created')
    })

    it("another studio can't see or change any of it", async () => {
      const s = await newSelection()
      for (const [m, url] of [
        ['get', `/api/v1/selections/${s.id}/overview`],
        ['get', `/api/v1/selections/${s.id}/folders`],
        ['post', `/api/v1/selections/${s.id}/folders`],
        ['patch', `/api/v1/selections/${s.id}/access`],
        ['post', `/api/v1/selections/${s.id}/unlock`],
        ['post', `/api/v1/selections/${s.id}/reset-picks`],
        ['post', `/api/v1/selections/${s.id}/deliver`],
        ['get', `/api/v1/selections/${s.id}/zip`],
      ] as const) {
        const res = await B.agent[m](url).send(m === 'post' && url.endsWith('folders') ? { name: 'X' } : {})
        expect([url, res.status]).toEqual([url, 404])
      }
    })
  })

  describe('client gallery: PIN, previews, downloads, notes', () => {
    it('asks for the PIN, locks after 5 wrong tries, and the key unlocks everything', async () => {
      const s = await newSelection({ pin: '0427' })
      expect(s.hasPin).toBe(true)
      await upload(s.id).expect(201)
      const token = s.publicToken
      const locked = await pub().get(`/api/v1/public/selections/${token}`).expect(403)
      expectError(locked.body, 'PIN_REQUIRED')
      expect(locked.body.error.details).toMatchObject({ pinRequired: true, eventTitle: 'Priya Wedding', clientName: 'Priya Kumar' })
      expect(JSON.stringify(locked.body)).not.toContain('photos')

      const wrong = await pub().post(`/api/v1/public/selections/${token}/pin`).send({ pin: '1111' }).expect(403)
      expect(wrong.body.error.message).toBe('Wrong PIN. 4 tries left.')
      const ok = await pub().post(`/api/v1/public/selections/${token}/pin`).send({ pin: '0427' }).expect(200)
      const key = ok.body.key as string
      expect(key).toMatch(/^[\w-]{32}$/)

      const view = await pub().get(`/api/v1/public/selections/${token}`).set('X-Gallery-Key', key).expect(200)
      const photo = view.body.photos[0]
      expect(photo.url).toContain(`?k=${key}`)
      await pub().get(photo.url).expect(200)
      await pub().get(photo.url.split('?')[0]).expect(403)
      const member = view.body.members[0].id
      await pub().post(`/api/v1/public/selections/${token}/picks`).send({ photoId: photo.id, memberId: member, picked: true }).expect(403)
      await pub().post(`/api/v1/public/selections/${token}/picks`).set('X-Gallery-Key', key).send({ photoId: photo.id, memberId: member, picked: true }).expect(200)

      // A right PIN resets the count; 5 wrong ones in a row lock the gallery, even for the right PIN.
      for (let i = 0; i < 4; i++) await pub().post(`/api/v1/public/selections/${token}/pin`).send({ pin: '9999' }).expect(403)
      expectError((await pub().post(`/api/v1/public/selections/${token}/pin`).send({ pin: '9999' }).expect(429)).body, 'PIN_LOCKED')
      const lock = await pub().post(`/api/v1/public/selections/${token}/pin`).send({ pin: '0427' }).expect(429)
      expectError(lock.body, 'PIN_LOCKED')

      // Changing the PIN invalidates keys already handed out.
      await A.agent.patch(`/api/v1/selections/${s.id}/access`).send({ pin: '5555' }).expect(200)
      await pub().get(`/api/v1/public/selections/${token}`).set('X-Gallery-Key', key).expect(403)
      // Removing it opens the gallery again.
      const open = await A.agent.patch(`/api/v1/selections/${s.id}/access`).send({ pin: '' }).expect(200)
      expect(open.body.hasPin).toBe(false)
      await pub().get(`/api/v1/public/selections/${token}`).expect(200)
      const log = (await A.agent.get(`/api/v1/selections/${s.id}/overview`).expect(200)).body.log.map((l: { action: string; detail: string }) => `${l.action}: ${l.detail}`)
      expect(log).toEqual(expect.arrayContaining(['Gallery locked: 5 wrong PINs — locked for 15 minutes', 'Gallery access changed: PIN changed', 'Gallery access changed: PIN removed']))
    })

    it('rejects a PIN that is not 4 digits', async () => {
      await A.agent.post('/api/v1/selections').send({ eventId, quota: 3, deadline: isoDaysFromToday(10), pin: '12' }).expect(400)
    })

    it('serves a resized JPEG preview, never the original; watermark changes the preview', async () => {
      const s = await newSelection()
      await upload(s.id, { size: 2600 }).expect(201)
      const view = (await pub().get(`/api/v1/public/selections/${s.publicToken}`).expect(200)).body
      const res = await pub().get(view.photos[0].url).expect(200)
      expect(res.headers['content-type']).toBe('image/jpeg')
      const meta = await sharp(res.body as Buffer).metadata()
      expect(Math.max(meta.width!, meta.height!)).toBe(2048)
      expect(view.photos[0].downloadUrl).toBeNull()
      await pub().get(`${view.photos[0].url}/download`).expect(403)

      await A.agent.patch(`/api/v1/selections/${s.id}/access`).send({ watermark: true }).expect(200)
      const marked = await pub().get(view.photos[0].url).expect(200)
      expect(Buffer.compare(marked.body as Buffer, res.body as Buffer)).not.toBe(0)
      const photo = await prisma.photo.findFirstOrThrow({ where: { selectionId: s.id }, include: { preview: true } })
      // The stored preview is named by the watermark it carries.
      expect(photo.preview?.originalName).toMatch(/^preview-[0-9a-f]{10}-2048-m1:/)
    })

    it('server-made customer copies do not count toward studio storage (the preview and thumbnail do)', async () => {
      const before = (await A.agent.get('/api/v1/me/upload-limits').expect(200)).body.storageUsedBytes
      const s = await newSelection()
      await upload(s.id).expect(201)
      const photo = await prisma.photo.findFirstOrThrow({ where: { selectionId: s.id }, include: { file: true, thumb: true } })
      const file = { size: photo.file.size + photo.thumb!.size }
      await settle()
      const view = (await pub().get(`/api/v1/public/selections/${s.publicToken}`).expect(200)).body
      await pub().get(view.photos[0].url).expect(200)
      const after = (await A.agent.get('/api/v1/me/upload-limits').expect(200)).body.storageUsedBytes
      expect(after - before).toBe(file.size)
    })

    it('gives a preview-quality download only when downloads are on', async () => {
      const s = await newSelection({ allowDownload: true })
      await upload(s.id).expect(201)
      const view = (await pub().get(`/api/v1/public/selections/${s.publicToken}`).expect(200)).body
      expect(view.allowDownload).toBe(true)
      const dl = await pub().get(view.photos[0].downloadUrl).expect(200)
      expect(dl.headers['content-disposition']).toMatch(/^attachment/)
      // Customers only ever download the preview (a 2048 px JPEG), never an original.
      expect(dl.headers['content-type']).toBe('image/jpeg')
    })

    it('refuses notes when the studio turned them off', async () => {
      const s = await newSelection({ notesAllowed: false })
      await upload(s.id).expect(201)
      const view = (await pub().get(`/api/v1/public/selections/${s.publicToken}`).expect(200)).body
      expect(view.notesAllowed).toBe(false)
      const r = await pub()
        .post(`/api/v1/public/selections/${s.publicToken}/comments`)
        .send({ photoId: view.photos[0].id, memberId: view.members[0].id, text: 'Brighter please' })
        .expect(409)
      expectError(r.body, 'READ_ONLY')
    })

    it('records client visits and shows folders to the client', async () => {
      const s = await newSelection()
      await upload(s.id, { folder: 'Haldi' }).expect(201)
      await upload(s.id, { folder: 'Wedding' }).expect(201)
      const view = (await pub().get(`/api/v1/public/selections/${s.publicToken}`).expect(200)).body
      expect(view.folders.map((f: { name: string }) => f.name)).toEqual(['Haldi', 'Wedding'])
      await pub().get(`/api/v1/public/selections/${s.publicToken}`).expect(200)
      const dto = (await A.agent.get(`/api/v1/selections/${s.id}`).expect(200)).body
      expect(dto.clientVisits).toBe(1) // twice within 30 minutes = one visit
      expect(dto.lastClientVisitAt).toEqual(expect.any(String))
    })
  })

  describe('submit, unlock, reset, deliver', () => {
    it('limit holds, submit locks, unlock reopens with a log entry, deliver closes', async () => {
      const s = await newSelection({ quota: 1 })
      await upload(s.id).expect(201)
      await upload(s.id).expect(201)
      const view = (await pub().get(`/api/v1/public/selections/${s.publicToken}`).expect(200)).body
      const member = view.members[0].id
      const pick = (photoId: string) => pub().post(`/api/v1/public/selections/${s.publicToken}/picks`).send({ photoId, memberId: member, picked: true })
      await pick(view.photos[0].id).expect(200)
      expectError((await pick(view.photos[1].id).expect(409)).body, 'QUOTA_LOCKED')
      await pub().post(`/api/v1/public/selections/${s.publicToken}/submit`).send({ memberId: member }).expect(200)
      await pick(view.photos[0].id).expect(409)

      const unlocked = await A.agent.post(`/api/v1/selections/${s.id}/unlock`).send({ reason: 'Couple wants to swap two photos' }).expect(200)
      expect(unlocked.body).toMatchObject({ status: 'IN_PROGRESS', submittedAt: null, reopened: true })
      const reset = await A.agent.post(`/api/v1/selections/${s.id}/reset-picks`).expect(200)
      expect(reset.body).toMatchObject({ cleared: 1, selection: { pickedCount: 0, status: 'SENT', reopened: true } })
      await pick(view.photos[1].id).expect(200)
      await pub().post(`/api/v1/public/selections/${s.publicToken}/submit`).send({ memberId: member }).expect(200)
      // Submitting again clears the reopened mark: shown as Selected.
      expect((await A.agent.get(`/api/v1/selections/${s.id}`).expect(200)).body).toMatchObject({ status: 'SUBMITTED', reopened: false })
      const delivered = await A.agent.post(`/api/v1/selections/${s.id}/deliver`).expect(200)
      expect(delivered.body.status).toBe('DELIVERED')
      await A.agent.post(`/api/v1/selections/${s.id}/unlock`).expect(400)
      // Delivered selections count as completed and are not active.
      const list = (await A.agent.get('/api/v1/selections').query({ status: 'DELIVERED' }).expect(200)).body
      expect(list.data.map((x: { id: string }) => x.id)).toContain(s.id)
      // Downloaded can be reopened too, the same way as Selected (shortlist keeps the pick).
      const reopened = (await A.agent.post(`/api/v1/selections/${s.id}/reset-picks`).send({ mode: 'shortlist' }).expect(200)).body
      expect(reopened).toMatchObject({ kept: 1, selection: { status: 'SENT', submittedAt: null, deliveredAt: null, reopened: true, pickedCount: 1 } })

      const log = (await A.agent.get(`/api/v1/selections/${s.id}/overview`).expect(200)).body.log.map((l: { actor: string; action: string; detail: string | null }) => [l.actor, l.action, l.detail])
      expect(log).toEqual(
        expect.arrayContaining([
          ['STUDIO', 'Unlocked', 'Couple wants to swap two photos'],
          ['STUDIO', 'Selection reopened by studio', 'Reject all · 1 photo cleared · status Pending'],
          ['CLIENT', 'Submitted', expect.stringContaining('1 of 1 photos')],
          ['STUDIO', 'Delivered', null],
          // Reopened after a download: says so and when it was downloaded; the Delivered entry above stays.
          ['STUDIO', 'Selection reopened by studio (after download)', expect.stringMatching(/^Shortlist · 1 photo kept · status Pending · downloaded \d{1,2} \w{3} \d{4}$/)],
        ]),
      )
    })

    it('reset as shortlist keeps the picks and reopens the selection; both resets show in Client Activity', async () => {
      const s = await newSelection({ quota: 3 })
      await upload(s.id).expect(201)
      await upload(s.id).expect(201)
      const view = (await pub().get(`/api/v1/public/selections/${s.publicToken}`).expect(200)).body
      const member = view.members[0].id
      const pick = (photoId: string, picked = true) => pub().post(`/api/v1/public/selections/${s.publicToken}/picks`).send({ photoId, memberId: member, picked })
      await pick(view.photos[0].id).expect(200)
      await pick(view.photos[1].id).expect(200)
      await pub().post(`/api/v1/public/selections/${s.publicToken}/submit`).send({ memberId: member }).expect(200)

      const r = (await A.agent.post(`/api/v1/selections/${s.id}/reset-picks`).send({ mode: 'shortlist' }).expect(200)).body
      expect(r).toMatchObject({ mode: 'shortlist', kept: 2, cleared: 0, selection: { pickedCount: 2, status: 'SENT', submittedAt: null, reopened: true } })
      // The client can change the shortlist again.
      await pick(view.photos[1].id, false).expect(200)
      await A.agent.post(`/api/v1/selections/${s.id}/reset-picks`).send({ mode: 'everything' }).expect(400)

      const activity = (await A.agent.get('/api/v1/dashboard').expect(200)).body.workflow.activity
      expect(activity.find((a: { selectionId: string }) => a.selectionId === s.id)).toMatchObject({ action: 'Selection reopened by studio', detail: 'Shortlist · 2 photos kept · status Pending', status: 'DRAFT' })
    })
  })

  describe('exports', () => {
    it('ZIP of the picks keeps folders; Lightroom list still works', async () => {
      const s = await newSelection()
      await upload(s.id, { folder: 'Haldi' }).expect(201)
      await upload(s.id, { folder: 'Wedding' }).expect(201)
      const view = (await pub().get(`/api/v1/public/selections/${s.publicToken}`).expect(200)).body
      await A.agent.get(`/api/v1/selections/${s.id}/zip`).expect(400) // nothing picked yet
      await pub().post(`/api/v1/public/selections/${s.publicToken}/picks`).send({ photoId: view.photos[0].id, memberId: view.members[0].id, picked: true }).expect(200)
      const zip = await A.agent.get(`/api/v1/selections/${s.id}/zip`).buffer(true).parse(binary).expect(200)
      expect(zip.headers['content-type']).toBe('application/zip')
      const body = zip.body as Buffer
      expect(body.subarray(0, 2).toString()).toBe('PK')
      // The ZIP holds the previews (WebP), named after the originals.
      expect(body.includes(Buffer.from(`Haldi/${view.photos[0].originalName.replace(/\.[^.]+$/, '')}.webp`))).toBe(true)
      expect(body.includes(Buffer.from('Wedding/'))).toBe(false)
      const all = await A.agent.get(`/api/v1/selections/${s.id}/zip`).query({ scope: 'all' }).buffer(true).parse(binary).expect(200)
      expect((all.body as Buffer).includes(Buffer.from('Wedding/'))).toBe(true)
      const txt = await A.agent.get(`/api/v1/selections/${s.id}/export`).query({ format: 'txt' }).expect(200)
      expect(txt.text.trim()).toBe(view.photos[0].originalName.replace(/\.[^.]+$/, ''))
    })

    it('names clashing files uniquely', () => {
      expect(zipNames([{ folder: 'Haldi', name: 'IMG_1.jpg' }, { folder: 'Haldi', name: 'img_1.jpg' }, { folder: null, name: 'a/b.jpg' }])).toEqual(['Haldi/IMG_1.jpg', 'Haldi/img_1 (2).jpg', 'a_b.jpg'])
    })
  })

  describe('folders of photos and videos', () => {
    /** The smallest thing the server recognises as an MP4 (an ISO "ftyp" box). */
    const mp4 = (n: number) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(16, n)])

    it('takes MP4 videos, counts them apart from images, and keeps them out of the client gallery', async () => {
      const s = await newSelection()
      const folder = (await A.agent.post(`/api/v1/selections/${s.id}/folders`).send({ name: 'Pictures' }).expect(201)).body
      const clips = (await A.agent.post(`/api/v1/selections/${s.id}/folders`).send({ name: 'Clips', type: 'video' }).expect(201)).body
      expect([folder.type, clips.type]).toEqual(['photo', 'video'])
      await upload(s.id, { folderId: folder.id }).expect(201)
      // A photo folder takes photos only, a video folder videos only.
      await A.agent.post(`/api/v1/selections/${s.id}/photos`).field('folderId', folder.id).attach('file', mp4(1), 'clip.mp4').expect(422)
      await upload(s.id, { folderId: clips.id }).expect(422)
      const v = await A.agent.post(`/api/v1/selections/${s.id}/photos`).field('folderId', clips.id).attach('file', mp4(1), 'clip.mp4').expect(201)
      expect(v.body.folderId).toBe(clips.id)
      await A.agent.post(`/api/v1/selections/${s.id}/photos`).attach('file', Buffer.from('just text'), 'notes.txt').expect(422)

      const dto = (await A.agent.get(`/api/v1/selections/${s.id}`).expect(200)).body
      expect(dto).toMatchObject({ photoCount: 1, videoCount: 1, folderCount: 2 })
      const folders = (await A.agent.get(`/api/v1/selections/${s.id}/folders`).expect(200)).body
      expect(folders.map((f: { name: string; type: string; photoCount: number; videoCount: number }) => [f.name, f.type, f.photoCount, f.videoCount])).toEqual([
        ['Pictures', 'photo', 1, 0],
        ['Clips', 'video', 0, 1],
      ])
      const photos = (await A.agent.get(`/api/v1/selections/${s.id}/photos`).expect(200)).body
      expect(photos.map((p: { media: string }) => p.media).sort()).toEqual(['image', 'video'])
      const view = (await pub().get(`/api/v1/public/selections/${s.publicToken}`).expect(200)).body
      expect(view.photos).toHaveLength(1)
      const video = photos.find((p: { media: string }) => p.media === 'video')
      const pick = await pub().post(`/api/v1/public/selections/${s.publicToken}/picks`).send({ photoId: video.id, memberId: view.members[0].id, picked: true })
      expect(pick.status).toBe(404)
      expect((await A.agent.get('/api/v1/selections/summary').expect(200)).body.videos).toBeGreaterThanOrEqual(1)
      // A folder name is taken once per event.
      await A.agent.post(`/api/v1/selections/${s.id}/folders`).send({ name: 'pictures' }).expect(409)
    })

    it('folder names keep the exact name, up to 255 characters; duplicates are refused case-insensitively', async () => {
      const s = await newSelection()
      const exact = 'Haldi Ceremony – Bride Side (Cam 1) – 25 Nov 2026 Morning Session'
      const made = (await A.agent.post(`/api/v1/selections/${s.id}/folders`).send({ name: `  ${exact}  ` }).expect(201)).body
      expect(made.name).toBe(exact)
      const dup = (await A.agent.post(`/api/v1/selections/${s.id}/folders`).send({ name: exact.toUpperCase() }).expect(409)).body
      expect(dup.error.message).toBe('A folder with this name already exists')
      const max = 'அ'.repeat(10) + 'x'.repeat(245)
      expect((await A.agent.post(`/api/v1/selections/${s.id}/folders`).send({ name: max }).expect(201)).body.name).toBe(max)
      await A.agent.post(`/api/v1/selections/${s.id}/folders`).send({ name: 'y'.repeat(256) }).expect(400)
      // Uploaded by path (no folder chosen): the top folder's full name.
      await upload(s.id, { folder: `${'Mehendi Night '.repeat(10)}/Close-ups` }).expect(201)
      const folders = (await A.agent.get(`/api/v1/selections/${s.id}/overview`).expect(200)).body.folders.map((f: { name: string }) => f.name)
      expect(folders).toContain('Mehendi Night '.repeat(10).trim())
    })

    it('Reset Selection clears the picks and reopens a submitted selection', async () => {
      const s = await newSelection()
      await upload(s.id).expect(201)
      const view = (await pub().get(`/api/v1/public/selections/${s.publicToken}`).expect(200)).body
      await pub().post(`/api/v1/public/selections/${s.publicToken}/picks`).send({ photoId: view.photos[0].id, memberId: view.members[0].id, picked: true }).expect(200)
      await pub().post(`/api/v1/public/selections/${s.publicToken}/submit`).send({ memberId: view.members[0].id }).expect(200)
      const r = (await A.agent.post(`/api/v1/selections/${s.id}/reset-picks`).expect(200)).body
      expect(r).toMatchObject({ cleared: 1, selection: { pickedCount: 0, status: 'SENT', submittedAt: null } })
      await pub().post(`/api/v1/public/selections/${s.publicToken}/picks`).send({ photoId: view.photos[0].id, memberId: view.members[0].id, picked: true }).expect(200)
    })
  })

  describe('Event Details (add, manage, delete)', () => {
    const details = { customerName: 'Anitha Raj', customerPhone: '98400 55555', eventName: 'Anitha Engagement', quota: 120 }
    const summary = async () => (await A.agent.get('/api/v1/selections/summary').expect(200)).body

    it('validates the form', async () => {
      const r = await A.agent.post('/api/v1/selections/details').send({ customerName: '', customerPhone: '12345', eventName: '', quota: 0 }).expect(400)
      expect(Object.keys(r.body.error.fields).sort()).toEqual(['customerName', 'customerPhone', 'eventName', 'quota'])
      expect(r.body.error.fields.customerPhone).toBe('Enter a valid 10-digit Indian mobile number')
    })

    it('creates the customer, event and selection: unique 6-digit code, Pending, counts 0, newest first', async () => {
      const before = await summary()
      const a = (await A.agent.post('/api/v1/selections/details').send(details).expect(201)).body
      const b = (await A.agent.post('/api/v1/selections/details').send({ ...details, eventName: 'Anitha Reception' }).expect(201)).body
      for (const s of [a, b]) {
        expect(s.code).toMatch(/^\d{6}$/)
        expect(s).toMatchObject({ status: 'DRAFT', photoCount: 0, pickedCount: 0, folderCount: 0, videoCount: 0, quota: 120 })
        expect(s.client).toMatchObject({ name: 'Anitha Raj', phone: '+919840055555' })
      }
      expect(a.code).not.toBe(b.code)
      expect(b.client.id).toBe(a.client.id) // same customer reused
      expect(b.event.id).not.toBe(a.event.id)
      expect((await summary()).selections).toBe(before.selections + 2)
      const list = (await A.agent.get('/api/v1/selections').query({ limit: 2 }).expect(200)).body.data
      expect(list.map((s: { id: string }) => s.id)).toEqual([b.id, a.id])
      // Search by code, customer or event name.
      for (const q of [a.code, 'anitha raj', 'Reception']) {
        const found = (await A.agent.get('/api/v1/selections').query({ search: q }).expect(200)).body.data.map((s: { id: string }) => s.id)
        expect(found.length).toBeGreaterThan(0)
      }
    })

    it('Manage edits the customer, event name and limit', async () => {
      const s = (await A.agent.post('/api/v1/selections/details').send({ ...details, customerPhone: '98400 66666' }).expect(201)).body
      const r = await A.agent.put(`/api/v1/selections/${s.id}/details`).send({ customerName: 'Anitha R', customerPhone: '98400 77777', eventName: 'Anitha & Karthik Engagement', quota: 80 }).expect(200)
      expect(r.body).toMatchObject({ quota: 80, client: { name: 'Anitha R', phone: '+919840077777' }, event: { title: 'Anitha & Karthik Engagement' } })
      await B.agent.put(`/api/v1/selections/${s.id}/details`).send(details).expect(404)
    })

    it('Delete removes the selection with its photos; the counts drop and the event goes', async () => {
      const s = (await A.agent.post('/api/v1/selections/details').send({ ...details, customerPhone: '98400 88888' }).expect(201)).body
      await upload(s.id).expect(201)
      const before = await summary()
      await A.agent.delete(`/api/v1/selections/${s.id}`).expect(200)
      const after = await summary()
      expect(after.selections).toBe(before.selections - 1)
      expect(after.photos).toBe(before.photos - 1)
      expect(await prisma.photo.count({ where: { selectionId: s.id, deletedAt: null } })).toBe(0)
      expect((await prisma.event.findUniqueOrThrow({ where: { id: s.event.id } })).deletedAt).not.toBeNull()
      await A.agent.get(`/api/v1/selections/${s.id}`).expect(404)
      await pub().get(`/api/v1/public/selections/${s.publicToken}`).expect(404)
    })

    it('the WhatsApp message carries the code', async () => {
      const s = (await A.agent.post('/api/v1/selections/details').send({ ...details, customerPhone: '98400 99999' }).expect(201)).body
      const preview = (await A.agent.get(`/api/v1/selections/${s.id}/message-preview`).query({ type: 'invite' }).expect(200)).body
      expect(preview.body).toContain(`Your selection code: ${s.code}`)
    })
  })

  describe('studio defaults', () => {
    it('saves the defaults and applies them to new selections', async () => {
      const d0 = (await A.agent.get('/api/v1/studio/selection-defaults').expect(200)).body
      expect(d0).toEqual({ watermark: false, allowDownload: false, galleryDays: 30, notesAllowed: false })
      await A.agent.put('/api/v1/studio/selection-defaults').send({ watermark: true, allowDownload: true, galleryDays: 0, notesAllowed: false }).expect(400)
      const d1 = (await A.agent.put('/api/v1/studio/selection-defaults').send({ watermark: true, allowDownload: true, galleryDays: 45, notesAllowed: false }).expect(200)).body
      expect(d1.galleryDays).toBe(45)
      const s = await newSelection()
      expect(s).toMatchObject({ watermark: true, allowDownload: true, notesAllowed: false })
      const override = await newSelection({ watermark: false })
      expect(override.watermark).toBe(false)
      expect((await B.agent.get('/api/v1/studio/selection-defaults').expect(200)).body.watermark).toBe(false)
    })
  })
})
