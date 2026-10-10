import type { INestApplication } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import sharp from 'sharp'
import request from 'supertest'
import { createTestApp, expectError, isoDaysFromToday, pngBuffer, resetDb, signup, type SignedUp } from './helpers'

const binary: Parameters<request.Test['parse']>[0] = (res, cb) => {
  const chunks: Buffer[] = []
  res.on('data', (c: Buffer) => chunks.push(c))
  res.on('end', () => cb(null, Buffer.concat(chunks)))
}

describe('Photo Selection settings (per event)', () => {
  let app: INestApplication
  let prisma: PrismaClient
  let A: SignedUp
  let B: SignedUp
  let s: { id: string; publicToken: string }
  let hue = 0
  const pub = () => request(app.getHttpServer())
  const settings = async () => (await A.agent.get(`/api/v1/selections/${s.id}/settings`).expect(200)).body
  const patch = (body: object) => A.agent.patch(`/api/v1/selections/${s.id}/settings`).send(body)

  beforeAll(async () => {
    ;({ app, prisma } = await createTestApp())
    await resetDb(prisma)
    // Pro: no video downloads, no favourites (both VIP).
    A = await signup(app, { plan: 'PRO' })
    B = await signup(app)
    s = (await A.agent.post('/api/v1/selections/details').send({ customerName: 'Ravi Kumar', customerPhone: '98400 12345', eventName: 'birthday', quota: 5 }).expect(201)).body
    const folder = (await A.agent.post(`/api/v1/selections/${s.id}/folders`).send({ name: 'Pictures' }).expect(201)).body
    for (let i = 0; i < 2; i++) await A.agent.post(`/api/v1/selections/${s.id}/photos`).field('folderId', folder.id).attach('file', pngBuffer((hue += 40), 400), `P${i}.png`).expect(201)
  })
  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300))
    await app?.close()
  })

  it('starts with the defaults', async () => {
    expect(await settings()).toMatchObject({
      allowClientView: true,
      downloadOn: false,
      downloadAllFolder: false,
      instagramFollow: false,
      // Favourites are VIP only: off (and locked) on Pro.
      favoriteOption: false,
      photoNotes: false,
      galleryExpiry: 30,
      galleryExpiresOn: isoDaysFromToday(30),
      videoDownload: false,
      watermark: { logoUrl: null, position: 'bottom-right', sizePct: 20, spacingPct: 2, opacityPct: 80, enabled: false },
      addons: { videoDownload: false, favourites: false, galleryDaysMax: null },
    })
  })

  it('saves toggles; Download All Folder needs Download On and goes off with it', async () => {
    await patch({ downloadAllFolder: true }).expect(400)
    expect((await patch({ downloadOn: true, downloadAllFolder: true, instagramFollow: true, photoNotes: true }).expect(200)).body).toMatchObject({
      downloadOn: true,
      downloadAllFolder: true,
      instagramFollow: true,
      photoNotes: true,
    })
    expect(await settings()).toMatchObject({ downloadOn: true, downloadAllFolder: true })
    expect((await patch({ downloadOn: false }).expect(200)).body).toMatchObject({ downloadOn: false, downloadAllFolder: false })
  })

  it('gallery expiry: days from today, or no expiry', async () => {
    expect((await patch({ galleryExpiry: 7 }).expect(200)).body).toMatchObject({ galleryExpiry: 7, galleryExpiresOn: isoDaysFromToday(7) })
    expect((await patch({ galleryExpiry: null }).expect(200)).body).toMatchObject({ galleryExpiry: null, galleryExpiresOn: null })
    expect((await A.agent.get(`/api/v1/selections/${s.id}`).expect(200)).body.status).not.toBe('EXPIRED')
    await patch({ galleryExpiry: 12 }).expect(400)
  })

  it('add-on settings need the add-on; favourites need VIP', async () => {
    expectError((await patch({ videoDownload: true }).expect(402)).body, 'PLAN_LIMIT')
    const fav = await patch({ favoriteOption: true }).expect(402)
    expectError(fav.body, 'PLAN_LIMIT')
    expect(fav.body.error.message).toBe('Customer favourites come with the VIP plan.')
  })

  it('watermark: logo (PNG or SVG, stored as PNG), layout, remove; previews are made again', async () => {
    const logo = await sharp({ create: { width: 200, height: 80, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0.5 } } }).png().toBuffer()
    const r = (await A.agent.post(`/api/v1/selections/${s.id}/settings/logo`).attach('file', logo, 'logo.png').expect(200)).body
    expect(r.watermark.logoUrl).toMatch(/^\/api\/v1\/files\//)
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="red"/></svg>')
    const r2 = (await A.agent.post(`/api/v1/selections/${s.id}/settings/logo`).attach('file', svg, 'logo.svg').expect(200)).body
    expect(r2.watermark.logoUrl).not.toBe(r.watermark.logoUrl)
    await A.agent.get(r2.watermark.logoUrl).expect('Content-Type', 'image/png').expect(200)
    await A.agent.post(`/api/v1/selections/${s.id}/settings/logo`).attach('file', Buffer.from('hello'), 'notes.txt').expect(422)

    const view = (await pub().get(`/api/v1/public/selections/${s.publicToken}`).expect(200)).body
    const plain = (await pub().get(view.photos[0].url).buffer(true).parse(binary).expect(200)).body as Buffer
    const w = (await patch({ watermark: { enabled: true, position: 'top-left', sizePct: 30, spacingPct: 5, opacityPct: 60 } }).expect(200)).body.watermark
    expect(w).toMatchObject({ enabled: true, position: 'top-left', sizePct: 30, spacingPct: 5, opacityPct: 60 })
    const marked = (await pub().get(view.photos[0].url).buffer(true).parse(binary).expect(200)).body as Buffer
    expect(Buffer.compare(plain, marked)).not.toBe(0)
    await patch({ watermark: { sizePct: 60 } }).expect(400)
    expect((await patch({ watermark: { removeLogo: true } }).expect(200)).body.watermark.logoUrl).toBeNull()
  })

  it('the client gallery follows the settings', async () => {
    await prisma.studio.update({ where: { id: A.studioId }, data: { instagramHandle: 'ravi.studio' } })
    await patch({ downloadOn: true, downloadAllFolder: true, favoriteOption: false, instagramFollow: true }).expect(200)
    const view = (await pub().get(`/api/v1/public/selections/${s.publicToken}`).expect(200)).body
    expect(view).toMatchObject({ favoritesEnabled: false, downloadAllFolder: true, instagram: { handle: 'ravi.studio' }, notesAllowed: true })
    const pick = await pub().post(`/api/v1/public/selections/${s.publicToken}/picks`).send({ photoId: view.photos[0].id, memberId: view.members[0].id, picked: true })
    expect(pick.status).toBe(409)
    // A download (watermarked, 2048 px JPEG) and the folder ZIP.
    const dl = await pub().get(view.photos[0].downloadUrl).buffer(true).parse(binary).expect(200)
    expect(dl.headers['content-type']).toBe('image/jpeg')
    const zip = await pub().get(`/api/v1/public/selections/${s.publicToken}/folders/${view.folders[0].id}/zip`).buffer(true).parse(binary).expect(200)
    expect((zip.body as Buffer).subarray(0, 2).toString()).toBe('PK')
    await patch({ downloadAllFolder: false }).expect(200)
    await pub().get(`/api/v1/public/selections/${s.publicToken}/folders/${view.folders[0].id}/zip`).expect(403)

    // Client view off: the gallery is closed.
    await patch({ allowClientView: false }).expect(200)
    expectError((await pub().get(`/api/v1/public/selections/${s.publicToken}`).expect(403)).body, 'GALLERY_CLOSED')
    await patch({ allowClientView: true }).expect(200)
  })

  it("another studio can't read or change them", async () => {
    await B.agent.get(`/api/v1/selections/${s.id}/settings`).expect(404)
    await B.agent.patch(`/api/v1/selections/${s.id}/settings`).send({ downloadOn: true }).expect(404)
    await B.agent.post(`/api/v1/selections/${s.id}/settings/logo`).attach('file', pngBuffer(1), 'l.png').expect(404)
  })

  it('folders have a type; a name is unique per event (any case)', async () => {
    const v = (await A.agent.post(`/api/v1/selections/${s.id}/folders`).send({ name: 'Highlights', type: 'video' }).expect(201)).body
    expect(v).toMatchObject({ name: 'Highlights', type: 'video', videoCount: 0 })
    const dup = await A.agent.post(`/api/v1/selections/${s.id}/folders`).send({ name: 'highlights', type: 'photo' }).expect(409)
    expect(dup.body.error.fields.name).toBe('A folder with this name already exists')
    // Folder names go up to 255 characters (the Windows/macOS limit).
    await A.agent.post(`/api/v1/selections/${s.id}/folders`).send({ name: 'x'.repeat(255) }).expect(201)
    await A.agent.post(`/api/v1/selections/${s.id}/folders`).send({ name: 'y'.repeat(256) }).expect(400)
  })
})
