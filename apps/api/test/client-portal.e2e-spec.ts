import type { INestApplication } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { createTestApp, expectError, pngBuffer, resetDb, signup, type SignedUp } from './helpers'

/** The smallest thing the server recognises as an MP4 (an ISO "ftyp" box). */
const mp4 = (n: number) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(40, n)])

describe('Customer portal (/public/selection)', () => {
  let app: INestApplication
  let prisma: PrismaClient
  let A: SignedUp
  let B: SignedUp
  let s: { id: string; code: string }
  let photosFolder: { id: string }
  let videosFolder: { id: string }
  let token: string
  const pub = () => request(app.getHttpServer())
  const base = () => `/api/v1/public/selection/${s.id}`
  const get = (path = '') => pub().get(`${base()}${path}`).set('X-Client-Token', token)
  const patchItem = (itemId: string, body: object) => pub().patch(`${base()}/items/${itemId}`).set('X-Client-Token', token).send(body)
  const verify = (body: object) => pub().post('/api/v1/public/selection/verify').send(body)
  const items = async (folderId: string) => (await get(`/folders/${folderId}/items`).expect(200)).body

  beforeAll(async () => {
    ;({ app, prisma } = await createTestApp())
    await resetDb(prisma)
    A = await signup(app)
    B = await signup(app)
    s = (await A.agent.post('/api/v1/selections/details').send({ customerName: 'Meena Raj', customerPhone: '98400 12345', eventName: 'Wedding', quota: 3 }).expect(201)).body
    photosFolder = (await A.agent.post(`/api/v1/selections/${s.id}/folders`).send({ name: 'Haldi' }).expect(201)).body
    videosFolder = (await A.agent.post(`/api/v1/selections/${s.id}/folders`).send({ name: 'Clips', type: 'video' }).expect(201)).body
    await A.agent.post(`/api/v1/selections/${s.id}/folders`).send({ name: 'Reception' }).expect(201)
    for (let i = 0; i < 4; i++) {
      await A.agent.post(`/api/v1/selections/${s.id}/photos`).field('folderId', photosFolder.id).attach('file', pngBuffer(20 + i * 60, 200), `H${i}.png`).expect(201)
    }
    await A.agent.post(`/api/v1/selections/${s.id}/photos`).field('folderId', videosFolder.id).attach('file', mp4(3), 'first-dance.mp4').expect(201)
  })
  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300))
    await app?.close()
  })

  it('studio: Send/Share records the card used; the first share marks it Shared and is logged', async () => {
    const r = (await A.agent.patch(`/api/v1/selections/${s.id}/sent`).send({ via: 'whatsapp' }).expect(200)).body
    expect(r).toMatchObject({ sentVia: 'whatsapp', status: 'SENT' })
    expect(r.lastSentAt).toBeTruthy()
    await A.agent.patch(`/api/v1/selections/${s.id}/sent`).send({ via: 'link' }).expect(200)
    const log = (await A.agent.get(`/api/v1/selections/${s.id}/overview`).expect(200)).body.log
    expect(log.map((l: { action: string }) => l.action).slice(0, 2)).toEqual(['Copied the link', 'Shared'])
    await A.agent.patch(`/api/v1/selections/${s.id}/sent`).send({ via: 'telegram' }).expect(400)
    await B.agent.patch(`/api/v1/selections/${s.id}/sent`).send({ via: 'web' }).expect(404)
  })

  it('verify: a wrong or malformed code is refused; the right one gives a token for this selection', async () => {
    expect(s.code).toMatch(/^\d{6}$/)
    const wrong = s.code === '000000' ? '111111' : '000000'
    expect((await verify({ code: wrong }).expect(404)).body.error.message).toBe('Invalid code')
    await verify({ code: '12ab56' }).expect(400)
    const ok = (await verify({ code: s.code }).expect(200)).body
    expect(ok).toMatchObject({ selectionId: s.id, submitted: false })
    token = ok.token
  })

  it('every call needs the token, and it only opens its own selection', async () => {
    expectError((await pub().get(base()).expect(403)).body, 'CLIENT_AUTH_REQUIRED')
    expectError((await pub().get(base()).set('X-Client-Token', 'nonsense').expect(403)).body, 'CLIENT_AUTH_REQUIRED')
    const other = (await B.agent.post('/api/v1/selections/details').send({ customerName: 'Other Client', customerPhone: '9840099999', eventName: 'Other', quota: 2 }).expect(201)).body
    expectError((await pub().get(`/api/v1/public/selection/${other.id}`).set('X-Client-Token', token).expect(403)).body, 'CLIENT_AUTH_REQUIRED')
  })

  it('the album page: counts, folders (empty ones left out), covers and no studio data', async () => {
    const v = (await get().expect(200)).body
    expect(v).toMatchObject({
      id: s.id,
      eventName: 'Wedding',
      customerName: 'Meena Raj',
      selectionLimit: 3,
      status: 'Pending',
      readOnly: false,
      counts: { photos: 4, videos: 1, favorites: 0, selected: 0, folders: 2 },
      permissions: { favorites: true, notes: false, download: false, downloadAllFolder: false },
    })
    expect(v.folders.map((f: { name: string; total: number }) => [f.name, f.total])).toEqual([
      ['Haldi', 4],
      ['Clips', 1],
    ])
    // "Reception" has nothing in it, so the customer doesn't see it.
    expect(v.folders[1].cover.type).toBe('video')
    expect(JSON.stringify(v)).not.toMatch(/publicToken|pinHash|email|walletBalance/)
  })

  it('serves photo previews and videos (with byte ranges) only with the token', async () => {
    const [photo] = (await items(photosFolder.id)).items
    await pub().get(`${base()}/items/${photo.id}/file`).expect(403)
    const img = await pub().get(`${base()}/items/${photo.id}/file?t=${token}`).expect(200)
    expect(img.headers['content-type']).toMatch(/^image\//)
    const [video] = (await items(videosFolder.id)).items
    expect(video).toMatchObject({ type: 'video', selected: false })
    const part = await pub().get(`${base()}/items/${video.id}/file?t=${token}`).set('Range', 'bytes=0-9').expect(206)
    expect(part.headers['content-range']).toBe('bytes 0-9/52')
    expect(part.headers['accept-ranges']).toBe('bytes')
    // Downloads are off by default.
    await pub().get(`${base()}/items/${photo.id}/download?t=${token}`).expect(403)
  })

  it('select, favourite and note save at once and persist; the limit is enforced', async () => {
    const list = (await items(photosFolder.id)).items
    const [video] = (await items(videosFolder.id)).items
    const r = (await patchItem(list[0].id, { selected: true, favorite: true }).expect(200)).body
    expect(r).toMatchObject({ item: { id: list[0].id, selected: true, favorite: true }, counts: { selected: 1, favorites: 1 }, folder: { id: photosFolder.id, selected: 1 } })
    await patchItem(list[1].id, { selected: true }).expect(200)
    // Videos play but can't be picked until the studio turns on video selection; then they count towards the same limit.
    expect(video.selectable).toBe(false)
    expectError((await patchItem(video.id, { selected: true }).expect(409)).body, 'READ_ONLY')
    await A.agent.patch(`/api/v1/selections/${s.id}/settings`).send({ videoSelection: true }).expect(200)
    expect((await patchItem(video.id, { selected: true }).expect(200)).body.counts.selected).toBe(3)
    const over = (await patchItem(list[2].id, { selected: true }).expect(409)).body
    expect(over.error).toMatchObject({ code: 'QUOTA_LOCKED', message: 'You can select up to 3 photos' })
    // Unselecting is always allowed; favouriting doesn't use the limit.
    await patchItem(list[1].id, { selected: false }).expect(200)
    await patchItem(list[3].id, { favorite: true }).expect(200)
    // Notes only when Photo Notes is on.
    expectError((await patchItem(list[0].id, { note: 'Brighter please' }).expect(409)).body, 'READ_ONLY')
    await A.agent.patch(`/api/v1/selections/${s.id}/settings`).send({ photoNotes: true }).expect(200)
    expect((await patchItem(list[0].id, { note: 'Brighter please' }).expect(200)).body.item.note).toBe('Brighter please')
    await patchItem(list[0].id, {}).expect(400)

    // A reload shows the same.
    const again = (await items(photosFolder.id)).items
    expect(again.map((i: { selected: boolean; favorite: boolean }) => [i.selected, i.favorite])).toEqual([
      [true, true],
      [false, false],
      [false, false],
      [false, true],
    ])
    expect(again[0].note).toBe('Brighter please')
    expect((await get().expect(200)).body.counts).toMatchObject({ selected: 2, favorites: 2 })
    // The studio sees the picks (and the note) as usual.
    const studio = (await A.agent.get(`/api/v1/selections/${s.id}`).expect(200)).body
    expect(studio).toMatchObject({ pickedCount: 2, status: 'IN_PROGRESS' })
    const photos = (await A.agent.get(`/api/v1/selections/${s.id}/photos`).expect(200)).body
    expect(photos.find((p: { id: string }) => p.id === list[0].id).comments[0].text).toBe('Brighter please')
  })

  it('Favorite Option off: hearts are refused', async () => {
    const [first] = (await items(photosFolder.id)).items
    await A.agent.patch(`/api/v1/selections/${s.id}/settings`).send({ favoriteOption: false }).expect(200)
    expect((await get().expect(200)).body.permissions.favorites).toBe(false)
    expectError((await patchItem(first.id, { favorite: false }).expect(409)).body, 'READ_ONLY')
    await A.agent.patch(`/api/v1/selections/${s.id}/settings`).send({ favoriteOption: true }).expect(200)
  })

  it('submit: locks the selection, shows Selected to the studio and notifies it', async () => {
    const v = (await pub().post(`${base()}/submit`).set('X-Client-Token', token).expect(200)).body
    expect(v).toMatchObject({ status: 'Selected', readOnly: true })
    expect(v.submittedAt).toBeTruthy()
    const [first] = (await items(photosFolder.id)).items
    expectError((await patchItem(first.id, { selected: false }).expect(409)).body, 'READ_ONLY')
    await pub().post(`${base()}/submit`).set('X-Client-Token', token).expect(409)
    expect((await A.agent.get(`/api/v1/selections/${s.id}`).expect(200)).body.status).toBe('SUBMITTED')
    const bell = (await A.agent.get('/api/v1/notifications').expect(200)).body
    const list = Array.isArray(bell) ? bell : bell.data
    expect(list.some((n: { title: string; body: string }) => n.title === 'Meena Raj' && n.body === 'submitted 2 photos for Wedding')).toBe(true)
    // Entering the code again still works, view-only.
    expect((await verify({ code: s.code }).expect(200)).body.submitted).toBe(true)
  })

  it('studio Reset Selection reopens it (Pending again)', async () => {
    await A.agent.post(`/api/v1/selections/${s.id}/reset-picks`).expect(200)
    const v = (await get().expect(200)).body
    expect(v).toMatchObject({ status: 'Pending', readOnly: false, counts: { selected: 0 } })
  })

  it('closed or expired galleries refuse the code and end open sessions', async () => {
    await A.agent.patch(`/api/v1/selections/${s.id}/settings`).send({ allowClientView: false }).expect(200)
    expectError((await verify({ code: s.code }).expect(403)).body, 'GALLERY_CLOSED')
    expectError((await get().expect(403)).body, 'GALLERY_CLOSED')
    await A.agent.patch(`/api/v1/selections/${s.id}/settings`).send({ allowClientView: true }).expect(200)
    await prisma.selection.update({ where: { id: s.id }, data: { deadline: new Date('2020-01-01') } })
    expectError((await verify({ code: s.code }).expect(410)).body, 'GALLERY_EXPIRED')
    expectError((await get().expect(410)).body, 'GALLERY_EXPIRED')
    await A.agent.patch(`/api/v1/selections/${s.id}/settings`).send({ galleryExpiry: 30 }).expect(200)
  })

  describe('share link (/select/:token)', () => {
    let shareToken: string
    beforeAll(async () => {
      shareToken = (await A.agent.get(`/api/v1/selections/${s.id}`).expect(200)).body.publicToken
    })

    it('shows the studio and event before the code, without customer data', async () => {
      const r = (await pub().get(`/api/v1/public/selection/link/${shareToken}`).expect(200)).body
      expect(r).toMatchObject({ eventName: 'Wedding', lockedUntil: null })
      expect(r.studio.name).toBeTruthy()
      expect(r).not.toHaveProperty('code')
      expect(JSON.stringify(r)).not.toMatch(/Meena|9840|publicToken/)
      await pub().get('/api/v1/public/selection/link/not-a-real-token').expect(404)
    })

    it('link preview (WhatsApp): per-event og:title, og:description and an absolute https og:image', async () => {
      const r = await pub().get(`/api/v1/public/og/select/${shareToken}`).set('X-Forwarded-Host', 'demo.trycloudflare.com').set('X-Forwarded-Proto', 'https').expect(200)
      expect(r.headers['content-type']).toMatch(/^text\/html/)
      const studio = (await A.agent.get('/api/v1/auth/me').expect(200)).body.studio.name as string
      const og = (p: string) => new RegExp(`<meta property="og:${p}" content="([^"]*)"`).exec(r.text)?.[1]
      expect(og('title')).toBe(`${studio.replace(/&/g, '&amp;').replace(/'/g, '&#39;')} · Wedding photos`)
      expect(og('description')).toBe('Hi Meena Raj! Tap to open your gallery and pick your favourites.')
      // No gallery banner yet: the default card.
      expect(og('image')).toBe('https://demo.trycloudflare.com/og/share-card.jpg')
      expect(og('url')).toBe(`https://demo.trycloudflare.com/select/${shareToken}`)
      // An unknown link still gets a generic preview, with nobody's name.
      const unknown = await pub().get('/api/v1/public/og/select/not-a-real-token').expect(200)
      expect(unknown.text).toMatch(/Your photo gallery/)
      await pub().get(`/api/v1/public/og/select/${shareToken}/image.jpg`).expect(404)
    })

    it('needs this selection’s code; 5 wrong codes lock the link for 10 minutes', async () => {
      const other = (await A.agent.post('/api/v1/selections/details').send({ customerName: 'Someone Else', customerPhone: '9840022222', eventName: 'Other', quota: 2 }).expect(201)).body
      // Another selection's valid code doesn't open this link.
      const bad = (await verify({ code: other.code, shareToken }).expect(404)).body.error
      expect(bad).toMatchObject({ code: 'NOT_FOUND', message: 'Invalid code. 4 tries left.' })
      for (let i = 0; i < 3; i++) await verify({ code: other.code, shareToken }).expect(404)
      const locked = (await verify({ code: other.code, shareToken }).expect(429)).body.error
      expect(locked).toMatchObject({ code: 'PIN_LOCKED' })
      expect(locked.message).toMatch(/Too many wrong codes\. Try again in 10 minutes/)
      // Even the right code waits; the link screen shows the lock.
      await verify({ code: s.code, shareToken }).expect(429)
      expect((await pub().get(`/api/v1/public/selection/link/${shareToken}`).expect(200)).body.lockedUntil).toBeTruthy()
      const log = (await A.agent.get(`/api/v1/selections/${s.id}/overview`).expect(200)).body.log
      expect(log.some((l: { action: string }) => l.action === 'Link locked')).toBe(true)
      // After the lock: the right code opens the gallery and clears the count.
      await prisma.selection.update({ where: { id: s.id }, data: { codeLockedUntil: new Date(Date.now() - 1000) } })
      const ok = (await verify({ code: s.code, shareToken }).expect(200)).body
      expect(ok.selectionId).toBe(s.id)
      token = ok.token
      expect((await prisma.selection.findUniqueOrThrow({ where: { id: s.id } })).codeFailures).toBe(0)
    })

    it('the Selection tab lists picks grouped by album', async () => {
      const [p0, p1] = (await items(photosFolder.id)).items
      await patchItem(p0.id, { selected: true }).expect(200)
      await patchItem(p1.id, { selected: true }).expect(200)
      const r = (await get('/selected').expect(200)).body
      expect(r.total).toBe(2)
      expect(r.groups.map((g: { folderName: string; items: unknown[] }) => [g.folderName, g.items.length])).toEqual([['Haldi', 2]])
      await pub().get(`${base()}/selected`).expect(403)
    })

    it('limit off: no cap; client selection off: picking is refused', async () => {
      await A.agent.patch(`/api/v1/selections/${s.id}/settings`).send({ limitOn: false }).expect(200)
      expect((await get().expect(200)).body.selectionLimit).toBeNull()
      const list = (await items(photosFolder.id)).items
      await patchItem(list[2].id, { selected: true }).expect(200)
      await patchItem(list[3].id, { selected: true }).expect(200) // 4 picks with a limit of 3
      await A.agent.patch(`/api/v1/selections/${s.id}/settings`).send({ limitOn: true, selectionLimit: 10, allowSelection: false }).expect(200)
      const v = (await get().expect(200)).body
      expect(v).toMatchObject({ selectionLimit: 10, permissions: { select: false } })
      await patchItem(list[3].id, { selected: false }).expect(200) // unpicking still works
      expectError((await patchItem(list[3].id, { selected: true }).expect(409)).body, 'READ_ONLY')
      await A.agent.patch(`/api/v1/selections/${s.id}/settings`).send({ allowSelection: true }).expect(200)
      await A.agent.post(`/api/v1/selections/${s.id}/reset-picks`).expect(200)
    })

    it('settings: a chosen link expiry date is saved; a past date is refused', async () => {
      const next = (await A.agent.patch(`/api/v1/selections/${s.id}/settings`).send({ linkExpiresOn: '2099-12-31' }).expect(200)).body
      expect(next).toMatchObject({ galleryExpiry: 'custom', galleryExpiresOn: '2099-12-31' })
      await A.agent.patch(`/api/v1/selections/${s.id}/settings`).send({ linkExpiresOn: '2020-01-01' }).expect(400)
      expect((await A.agent.patch(`/api/v1/selections/${s.id}/settings`).send({ linkExpiresOn: null }).expect(200)).body.galleryExpiry).toBeNull()
    })
  })

  it('a gallery PIN is asked for too, and changing it ends old sessions', async () => {
    await A.agent.patch(`/api/v1/selections/${s.id}/access`).send({ pin: '4321' }).expect(200)
    expectError((await get().expect(403)).body, 'CLIENT_AUTH_REQUIRED')
    expect((await verify({ code: s.code }).expect(403)).body.error).toMatchObject({ code: 'PIN_REQUIRED', details: { pinRequired: true } })
    await verify({ code: s.code, pin: '1111' }).expect(403)
    token = (await verify({ code: s.code, pin: '4321' }).expect(200)).body.token
    await get().expect(200)
  })

  it('older SEL- codes can get a 6-digit code', async () => {
    const other = (await A.agent.post('/api/v1/selections/details').send({ customerName: 'Old', customerPhone: '9840011111', eventName: 'Old', quota: 2 }).expect(201)).body
    await prisma.selection.update({ where: { id: other.id }, data: { code: 'SEL-007' } })
    const r = (await A.agent.post(`/api/v1/selections/${other.id}/new-code`).expect(200)).body
    expect(r.code).toMatch(/^\d{6}$/)
  })
})
