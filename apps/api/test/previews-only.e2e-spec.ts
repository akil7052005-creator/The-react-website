import { createHash } from 'node:crypto'
import type { INestApplication } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import sharp from 'sharp'
import request from 'supertest'
import { assertPhotoKey, createStorage, isPhotoKey, MAX_PREVIEW_BYTES } from '../src/infra/storage.service'
import { cleanup } from '../prisma/r2-originals'
import { createTestApp, expectError, pngBuffer, resetDb, signup, type SignedUp } from './helpers'

// Previews only: originals never reach storage. The browser makes a 2048 px preview and a 400 px
// thumbnail, gets two signed links from /uploads/sign, PUTs both straight to storage and calls
// /uploads/complete; the server checks both objects before it records the photo.

const webp = (hue: number, px: number) => sharp({ create: { width: px, height: Math.round(px * 0.66), channels: 3, background: { r: hue, g: 90, b: 140 } } }).webp({ quality: 80 }).toBuffer()
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')

describe('Previews-only uploads', () => {
  let app: INestApplication
  let prisma: PrismaClient
  let A: SignedUp
  let B: SignedUp
  let id: string
  const http = () => request(app.getHttpServer())

  beforeAll(async () => {
    ;({ app, prisma } = await createTestApp())
    await resetDb(prisma)
    A = await signup(app)
    B = await signup(app)
    id = (await A.agent.post('/api/v1/selections/details').send({ customerName: 'Asha Rao', customerPhone: '9840012345', eventName: 'Wedding', quota: 5 }).expect(201)).body.id
  })
  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300))
    await app?.close()
  })

  /** What the browser sends for one photo, with its two encoded copies. */
  async function photoMeta(name: string, hue: number, extra: Record<string, unknown> = {}) {
    const preview = await webp(hue, 2048)
    const thumb = await webp(hue, 400)
    const original = `original bytes of ${name} ${hue}` // stands in for the camera file (never sent)
    return {
      preview,
      thumb,
      body: {
        selectionId: id,
        relativePath: `Wedding 2026/Haldi/${name}`,
        originalName: name,
        originalSize: 24_500_000,
        originalWidth: 6000,
        originalHeight: 4000,
        lastModified: 1_760_000_000_000,
        sha256: sha(original),
        format: 'webp',
        previewSize: preview.length,
        thumbSize: thumb.length,
        ...extra,
      },
    }
  }

  function put(url: string, data: Buffer, type = 'image/webp') {
    return http().put(url).set('Content-Type', type).send(data)
  }

  async function uploadOne(name: string, hue: number) {
    const m = await photoMeta(name, hue)
    const signed = (await A.agent.post('/api/v1/uploads/sign').send(m.body).expect(200)).body
    expect(signed.duplicate).toBe(false)
    await put(signed.preview.url, m.preview).expect(200)
    await put(signed.thumb.url, m.thumb).expect(200)
    const done = (await A.agent.post('/api/v1/uploads/complete').send({ ...m.body, photoId: signed.photoId }).expect(200)).body
    return { m, signed, done }
  }

  it('signs two links, takes both copies, then records the photo with the original’s details', async () => {
    const { m, signed, done } = await uploadOne('IMG_1234.CR2', 40)
    expect(signed.preview.key).toMatch(/^previews\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/)
    expect(signed.thumb.key).toMatch(/^thumbs\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/)
    expect(Date.parse(signed.preview.expiresAt) - Date.now()).toBeGreaterThan(14 * 60_000)
    expect(done).toEqual({ id: signed.photoId, existing: false })

    const [p] = (await A.agent.get(`/api/v1/selections/${id}/photos`).expect(200)).body
    expect(p).toMatchObject({
      id: signed.photoId,
      originalName: 'IMG_1234.CR2',
      originalSize: 24_500_000,
      originalWidth: 6000,
      originalHeight: 4000,
      relativePath: 'Wedding 2026/Haldi/IMG_1234.CR2',
      sha256: m.body.sha256,
      folder: 'Wedding 2026/Haldi',
      compressed: true,
      size: m.preview.length,
    })
    expect(p.thumbUrl).toMatch(/^\/api\/v1\/files\//)
    const stored = await prisma.photo.findUniqueOrThrow({ where: { id: p.id }, include: { file: true, thumb: true } })
    expect(stored).toMatchObject({ format: 'webp', lastModified: new Date(1_760_000_000_000) })
    expect([stored.file.storageKey, stored.thumb!.storageKey]).toEqual([signed.preview.key, signed.thumb.key])
    // The selection moved from Draft to Uploading.
    expect((await A.agent.get(`/api/v1/selections/${id}`).expect(200)).body.status).toBe('UPLOADING')
  })

  it('skips the same file (same path + fingerprint) and a retried complete changes nothing', async () => {
    const first = await uploadOne('IMG_2000.JPG', 70)
    const again = (await A.agent.post('/api/v1/uploads/sign').send(first.m.body).expect(200)).body
    expect(again).toEqual({ duplicate: true, photoId: first.signed.photoId })
    const retried = (await A.agent.post('/api/v1/uploads/complete').send({ ...first.m.body, photoId: first.signed.photoId }).expect(200)).body
    expect(retried).toEqual({ id: first.signed.photoId, existing: true })
    // The same fingerprint from another folder is a different file on the computer: uploaded.
    const other = await photoMeta('IMG_2000.JPG', 70, { relativePath: 'Wedding 2026/Reception/IMG_2000.JPG', sha256: first.m.body.sha256 })
    expect((await A.agent.post('/api/v1/uploads/sign').send(other.body).expect(200)).body.duplicate).toBe(false)
  })

  it('a resumed upload gets fresh links for the same keys', async () => {
    const m = await photoMeta('IMG_3000.JPG', 90)
    const a = (await A.agent.post('/api/v1/uploads/sign').send(m.body).expect(200)).body
    const b = (await A.agent.post('/api/v1/uploads/sign').send({ ...m.body, photoId: a.photoId }).expect(200)).body
    expect(b.photoId).toBe(a.photoId)
    expect(b.preview.key).toBe(a.preview.key)
  })

  it('records nothing until both copies are uploaded with the declared sizes', async () => {
    const m = await photoMeta('IMG_4000.JPG', 110)
    const s = (await A.agent.post('/api/v1/uploads/sign').send(m.body).expect(200)).body
    const complete = () => A.agent.post('/api/v1/uploads/complete').send({ ...m.body, photoId: s.photoId })
    const before = (await A.agent.get(`/api/v1/selections/${id}`).expect(200)).body.photoCount
    expect((await complete().expect(409)).body.error.details).toMatchObject({ missing: 'preview' })
    await put(s.preview.url, m.preview).expect(200)
    expect((await complete().expect(409)).body.error.details).toMatchObject({ missing: 'thumb' })
    expect((await A.agent.get(`/api/v1/selections/${id}`).expect(200)).body.photoCount).toBe(before)
    await put(s.thumb.url, m.thumb).expect(200)
    await complete().expect(200)
    expect((await A.agent.get(`/api/v1/selections/${id}`).expect(200)).body.photoCount).toBe(before + 1)
  })

  it('refuses anything over 2 MB: at signing, at the PUT and on the API route', async () => {
    const big = 10 * 1024 * 1024
    const m = await photoMeta('IMG_BIG.JPG', 130)
    expectError((await A.agent.post('/api/v1/uploads/sign').send({ ...m.body, previewSize: big }).expect(400)).body, 'VALIDATION_ERROR')
    // A signed link takes exactly the signed size: more bytes are refused and nothing is stored.
    const s = (await A.agent.post('/api/v1/uploads/sign').send(m.body).expect(200)).body
    await put(s.preview.url, Buffer.concat([m.preview, Buffer.alloc(1024)])).expect(422)
    // The one-photo API route takes at most 2 MB per photo.
    const tenMb = await sharp({ create: { width: 3000, height: 3000, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).png({ compressionLevel: 0 }).toBuffer()
    expect(tenMb.length).toBeGreaterThan(MAX_PREVIEW_BYTES)
    const refused = await A.agent.post(`/api/v1/selections/${id}/photos`).attach('file', tenMb, 'huge.png')
    expect([413, 422]).toContain(refused.status)
  })

  it('only previews/ and thumbs/ keys can be signed or written; forged links are refused', async () => {
    expect(() => assertPhotoKey('2026/10/original.CR2')).toThrow()
    expect(() => assertPhotoKey('previews/../secrets.txt')).toThrow()
    expect(isPhotoKey('previews/7b8f0a52-0c55-4c39-9b84-7e2a8f4bb1a1/0d1c7f3b-2b6a-4f6e-9d0b-3f1d9c2a8e11.webp')).toBe(true)
    await put('/api/v1/uploads/local/forged.token', await webp(1, 50)).expect(403)
    // Another studio can't sign for this selection.
    const m = await photoMeta('IMG_5000.JPG', 150)
    await B.agent.post('/api/v1/uploads/sign').send(m.body).expect(404)
  })

  it('the one-photo API route stores only a preview and thumbnail, never the file it was sent', async () => {
    const sent = pngBuffer(77, 900)
    const r = (await A.agent.post(`/api/v1/selections/${id}/photos`).field('originalName', 'DSC_0007.NEF').attach('file', sent, 'DSC_0007.png').expect(201)).body
    expect(r).toMatchObject({ compressed: true, originalName: 'DSC_0007.NEF' })
    const p = await prisma.photo.findUniqueOrThrow({ where: { id: r.id }, include: { file: true, thumb: true } })
    expect(isPhotoKey(p.file.storageKey) && isPhotoKey(p.thumb!.storageKey)).toBe(true)
    expect(p.file.mimeType).toBe('image/webp')
    const meta = await sharp((await A.agent.get(`/api/v1/files/${p.thumbFileId}`).buffer(true).parse(binary).expect(200)).body as Buffer).metadata()
    expect(Math.max(meta.width!, meta.height!)).toBe(400)
    // The cloud-original route is gone.
    await A.agent.post(`/api/v1/selections/${id}/photos/${r.id}/original`).attach('file', sent, 'DSC_0007.png').expect(404)
  })

  it('the storage holds only previews and thumbnails for photos uploaded this way', async () => {
    const storage = createStorage()
    const photoKeys: string[] = []
    for await (const o of storage.list()) if (/^(previews|thumbs)\//.test(o.key)) photoKeys.push(o.key)
    const files = await prisma.storedFile.findMany({ where: { studioId: A.studioId, kind: 'PHOTO', deletedAt: null } })
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) expect(isPhotoKey(f.storageKey)).toBe(true)
    for (const f of files) expect(photoKeys).toContain(f.storageKey)
  })

  it('cleanup: the dry run deletes nothing; generate makes missing previews; delete needs --confirm and keeps studio assets', async () => {
    const storage = createStorage()
    // An old-style upload: the original stored under a date key, no thumbnail.
    const original = pngBuffer(200, 600)
    const key = `2026/09/${sha(original).slice(0, 8)}-0000-4000-8000-000000000000.png`
    await storage.saveAt(key, original, 'image/png')
    const sel = await prisma.selection.findUniqueOrThrow({ where: { id } })
    const file = await prisma.storedFile.create({ data: { studioId: A.studioId, kind: 'PHOTO', storageKey: key, originalName: 'OLD_1.png', mimeType: 'image/png', size: original.length, checksum: sha(original) } })
    const old = await prisma.photo.create({ data: { studioId: A.studioId, eventId: sel.eventId, selectionId: id, fileId: file.id, position: 999, originalName: 'OLD_1.png', compressed: false } })
    // A studio logo outside previews/: never touched.
    const logoKey = '2026/09/logo-0000-4000-8000-000000000001.png'
    await storage.saveAt(logoKey, pngBuffer(5), 'image/png')
    await prisma.storedFile.create({ data: { studioId: A.studioId, kind: 'LOGO', storageKey: logoKey, originalName: 'logo.png', mimeType: 'image/png', size: 100, checksum: 'logo' } })

    const dry = await cleanup(prisma, storage, { mode: 'dry-run' })
    expect(dry.summary).toMatchObject({ photoOriginals: { count: 1 }, studioAssetsKept: { count: 1 } })
    expect(dry.photosStillMissingPreviews).toBe(1)
    expect(await storage.size(key)).toBe(original.length)

    await expect(cleanup(prisma, storage, { mode: 'delete', confirm: true })).rejects.toThrow(/Run --generate first/)
    const gen = await cleanup(prisma, storage, { mode: 'generate' })
    expect(gen).toMatchObject({ generated: 1, photosStillMissingPreviews: 0 })
    const fixed = await prisma.photo.findUniqueOrThrow({ where: { id: old.id }, include: { file: true, thumb: true } })
    expect(isPhotoKey(fixed.file.storageKey) && isPhotoKey(fixed.thumb!.storageKey)).toBe(true)
    expect(fixed.sha256).toBe(sha(original))

    await expect(cleanup(prisma, storage, { mode: 'delete' })).rejects.toThrow(/--confirm/)
    const del = await cleanup(prisma, storage, { mode: 'delete', confirm: true })
    expect(del).toMatchObject({ deleted: 1, bytesFreed: original.length })
    expect(await storage.size(key)).toBeNull()
    expect(await storage.size(logoKey)).not.toBeNull()
  })
})

const binary: Parameters<request.Test['parse']>[0] = (res, cb) => {
  const chunks: Buffer[] = []
  res.on('data', (c: Buffer) => chunks.push(c))
  res.on('end', () => cb(null, Buffer.concat(chunks)))
}
