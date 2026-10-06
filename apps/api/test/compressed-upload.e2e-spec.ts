import { createHash } from 'node:crypto'
import type { INestApplication } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { createTestApp, pngBuffer, resetDb, signup, type SignedUp } from './helpers'

// Compressed uploads: the browser sends a 1600 px JPEG plus the original's name, size and pixel
// size; the studio sees the original's name everywhere, the stored file stays the small copy.

describe('Compressed uploads keep the original file details', () => {
  let app: INestApplication
  let prisma: PrismaClient
  let A: SignedUp
  let id: string

  beforeAll(async () => {
    ;({ app, prisma } = await createTestApp())
    await resetDb(prisma)
    A = await signup(app)
    id = (await A.agent.post('/api/v1/selections/details').send({ customerName: 'Asha Rao', customerPhone: '9840012345', eventName: 'Wedding', quota: 5 }).expect(201)).body.id
  })
  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300))
    await app?.close()
  })

  it('stores the original name (any extension), size and pixel size with the compressed copy', async () => {
    const copy = pngBuffer(40, 30)
    const r = await A.agent
      .post(`/api/v1/selections/${id}/photos`)
      .field('folder', 'Wedding 2026/Haldi/Cam-1')
      .field('originalName', 'IMG_1234.CR2')
      .field('originalSize', '31457280')
      .field('originalWidth', '6000')
      .field('originalHeight', '4000')
      .field('compressed', '1')
      .attach('file', copy, 'IMG_1234.jpg')
      .expect(201)
    expect(r.body).toMatchObject({ originalName: 'IMG_1234.CR2', compressed: true, originalSize: 31457280, originalWidth: 6000, originalHeight: 4000, folder: 'Wedding 2026/Haldi/Cam-1' })
    expect(r.body.size).toBe(copy.length)

    const [p] = (await A.agent.get(`/api/v1/selections/${id}/photos`).expect(200)).body
    expect(p).toMatchObject({ originalName: 'IMG_1234.CR2', compressed: true, originalSize: 31457280, size: copy.length })
    // The stored file itself keeps the copy's own name (it is a JPEG/PNG, not a .CR2).
    const stored = await prisma.photo.findUniqueOrThrow({ where: { id: p.id }, include: { file: true } })
    expect(stored.file.originalName).toBe('IMG_1234.jpg')
  })

  it('a plain upload records its own name and size; junk metadata is dropped', async () => {
    const plain = pngBuffer(52, 41)
    const r = await A.agent
      .post(`/api/v1/selections/${id}/photos`)
      .field('originalName', '../../etc/passwd\u0000')
      .field('originalSize', '-5')
      .field('originalWidth', 'wide')
      .attach('file', plain, 'DSC_0007.png')
      .expect(201)
    expect(r.body).toMatchObject({ compressed: false, originalName: '....etcpasswd', originalSize: plain.length, originalWidth: null })
    const r2 = await A.agent.post(`/api/v1/selections/${id}/photos`).attach('file', pngBuffer(63, 47), 'DSC_0008.png').expect(201)
    expect(r2.body).toMatchObject({ compressed: false, originalName: 'DSC_0008.png', originalWidth: null })
  })

  it('keeps the full-quality original beside the compressed copy, verified; the customer never gets it', async () => {
    const original = Buffer.concat([Buffer.from('IIRO\x08\x00\x00\x00CR\x02\x00'), Buffer.alloc(5000, 7)]) // a "RAW" file
    const sha = createHash('sha256').update(original).digest('hex')
    const photo = (
      await A.agent
        .post(`/api/v1/selections/${id}/photos`)
        .field('originalName', 'IMG_5000.CR2')
        .field('originalSize', String(original.length))
        .field('compressed', '1')
        .attach('file', pngBuffer(77, 51), 'IMG_5000.jpg')
        .expect(201)
    ).body
    const url = `/api/v1/selections/${id}/photos/${photo.id}/original`

    // Verification: wrong hash, wrong file name or wrong size are refused (422, like other bad files).
    await A.agent.post(url).field('sha256', 'a'.repeat(64)).attach('file', original, 'IMG_5000.CR2').expect(422)
    await A.agent.post(url).field('sha256', sha).attach('file', original, 'IMG_9999.CR2').expect(422)
    await A.agent.post(url).attach('file', Buffer.concat([original, Buffer.from('x')]), 'IMG_5000.CR2').expect(422)

    const kept = (await A.agent.post(url).field('sha256', sha).attach('file', original, 'IMG_5000.CR2').expect(201)).body
    expect(kept).toMatchObject({ photoId: photo.id, originalChecksum: sha, size: original.length })
    // Sending it again (a retry) keeps the same file.
    expect((await A.agent.post(url).field('sha256', sha).attach('file', original, 'IMG_5000.CR2').expect(201)).body.originalUrl).toBe(kept.originalUrl)

    // The studio downloads it byte for byte.
    const p = (await A.agent.get(`/api/v1/selections/${id}/photos`).expect(200)).body.find((x: { id: string }) => x.id === photo.id)
    expect(p).toMatchObject({ originalUrl: kept.originalUrl, originalChecksum: sha, compressed: true })
    const got = await A.agent.get(kept.originalUrl).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => cb(null, Buffer.concat(chunks)))
    })
    expect(Buffer.compare(got.body as Buffer, original)).toBe(0)

    // A full-quality upload is its own original; a compressed one without a kept original has none.
    const plain = (await A.agent.get(`/api/v1/selections/${id}/photos`).expect(200)).body.find((x: { originalName: string }) => x.originalName === 'DSC_0008.png')
    expect(plain.originalUrl).toBe(plain.url)
    const cr2 = (await A.agent.get(`/api/v1/selections/${id}/photos`).expect(200)).body.find((x: { originalName: string }) => x.originalName === 'IMG_1234.CR2')
    expect(cr2.originalUrl).toBeNull()

    // The customer's view never points at the original file.
    const sel = (await A.agent.get(`/api/v1/selections/${id}`).expect(200)).body
    const view = JSON.stringify((await request(app.getHttpServer()).get(`/api/v1/public/selections/${sel.publicToken}`)).body)
    expect(view).not.toContain(kept.originalUrl.split('/').pop())

    // It counts as the studio's storage, and goes when the photo is removed.
    const stored = await prisma.photo.findUniqueOrThrow({ where: { id: photo.id }, include: { originalFile: true } })
    expect(stored.originalFile).toMatchObject({ size: original.length, checksum: sha, deletedAt: null })
    await A.agent.delete(`/api/v1/selections/${id}/photos/${photo.id}`).expect((r) => expect([200, 204]).toContain(r.status))
    expect((await prisma.storedFile.findUniqueOrThrow({ where: { id: stored.originalFileId! } })).deletedAt).not.toBeNull()
  })
})
