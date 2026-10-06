import type { INestApplication } from '@nestjs/common'
import type { PlanCode, PrismaClient } from '@prisma/client'
import { addDays } from '@weddyzone/shared'
import { cleanFolder } from '../src/selections/upload-limits'
import { createTestApp, isoDaysFromToday, pngBuffer, resetDb, signup, type SignedUp } from './helpers'

const MB = 1024 * 1024
const GB = 1024 ** 3

describe('Photo uploads: plan-based limits', () => {
  let app: INestApplication
  let prisma: PrismaClient
  let A: SignedUp
  let selectionId: string
  let hue = 0

  /** A real PNG (sniffed as image/png), padded to `bytes` when given. Each call is a different image. */
  const photo = (bytes?: number) => {
    const png = pngBuffer((hue += 7) % 360)
    return bytes ? Buffer.concat([png, Buffer.alloc(bytes - png.length)]) : png
  }
  const upload = (buf: Buffer, name = `IMG_${hue}.png`, folder?: string) => {
    const req = A.agent.post(`/api/v1/selections/${selectionId}/photos`)
    if (folder !== undefined) req.field('folder', folder)
    return req.attach('file', buf, name)
  }
  const setPlan = async (code: PlanCode, sub: Record<string, unknown> = {}) => {
    const plan = await prisma.plan.findUniqueOrThrow({ where: { code } })
    await prisma.subscription.update({ where: { studioId: A.studioId }, data: { planId: plan.id, isTrial: false, status: 'ACTIVE', currentPeriodStart: addDays(new Date(), -5), currentPeriodEnd: addDays(new Date(), 25), graceEndsAt: null, ...sub } })
  }
  const setLimits = async (code: PlanCode, patch: Record<string, unknown>) => {
    const plan = await prisma.plan.findUniqueOrThrow({ where: { code } })
    await prisma.plan.update({ where: { id: plan.id }, data: { limits: { ...(plan.limits as object), ...patch } as object } })
  }

  beforeAll(async () => {
    ;({ app, prisma } = await createTestApp())
    await resetDb(prisma)
    A = await signup(app)
    const client = await A.agent.post('/api/v1/clients').send({ name: 'Upload Client', phone: '98400 12345' }).expect(201)
    const event = await A.agent.post('/api/v1/events').send({ clientId: client.body.id, title: 'Upload Wedding', type: 'WEDDING', date: isoDaysFromToday(10), venue: 'Hall', city: 'Chennai' }).expect(201)
    selectionId = (await A.agent.post('/api/v1/selections').send({ eventId: event.body.id, quota: 20, deadline: isoDaysFromToday(7) }).expect(201)).body.id
  })
  afterAll(() => app.close())

  describe('GET /me/upload-limits', () => {
    it("gives the plan's limits and the storage left (trial = Starter)", async () => {
      const res = await A.agent.get('/api/v1/me/upload-limits').expect(200)
      expect(res.body).toMatchObject({ planCode: 'STARTER', planName: 'Starter', maxPhotoMb: 25, maxFilesPerUpload: 300, uploadConcurrency: 3, storageGb: 100, readOnly: false, status: 'TRIAL', graceEndsAt: null })
      expect(res.body.storageLeftBytes).toBe(100 * GB - res.body.storageUsedBytes)
      expect(res.body.renewLink).toBe('/subscriptions?renew=STARTER&cycle=MONTHLY')
    })

    it('follows the plan (seeded values for every plan)', async () => {
      const expected = { PRO: [50, 1000, 4, 500], STUDIO: [80, 3000, 5, 2048], ALL_ACCESS: [100, 5000, 6, 5120] } as const
      for (const [code, [maxPhotoMb, maxFilesPerUpload, uploadConcurrency, storageGb]] of Object.entries(expected)) {
        await setPlan(code as PlanCode, code === 'ALL_ACCESS' ? { cycle: 'YEARLY' } : {})
        const res = await A.agent.get('/api/v1/me/upload-limits').expect(200)
        expect(res.body).toMatchObject({ planCode: code, maxPhotoMb, maxFilesPerUpload, uploadConcurrency, storageGb, readOnly: false })
      }
      await setPlan('STARTER', { cycle: 'MONTHLY' })
    })

    it('uses the Starter values for fields a plan lacks', async () => {
      const pro = await prisma.plan.findUniqueOrThrow({ where: { code: 'PRO' } })
      const { maxPhotoMb, maxFilesPerUpload, uploadConcurrency, ...rest } = pro.limits as Record<string, unknown>
      expect([maxPhotoMb, maxFilesPerUpload, uploadConcurrency]).toEqual([50, 1000, 4])
      await prisma.plan.update({ where: { id: pro.id }, data: { limits: rest as object } })
      await setPlan('PRO')
      const res = await A.agent.get('/api/v1/me/upload-limits').expect(200)
      expect(res.body).toMatchObject({ planCode: 'PRO', maxPhotoMb: 25, maxFilesPerUpload: 300, uploadConcurrency: 3, storageGb: 500 })
      await prisma.plan.update({ where: { id: pro.id }, data: { limits: pro.limits as object } })
    })

    it('in grace: uploads allowed, with the grace end date', async () => {
      const end = addDays(new Date(), -1)
      await setPlan('PRO', { currentPeriodEnd: end, currentPeriodStart: addDays(end, -30) })
      const res = await A.agent.get('/api/v1/me/upload-limits').expect(200)
      expect(res.body).toMatchObject({ status: 'GRACE', readOnly: false, graceEndsAt: addDays(end, 3).toISOString() })
      await upload(photo()).expect(201)
    })

    it('expired past grace: read-only, and the upload is refused with 403 PLAN_LIMIT', async () => {
      const end = addDays(new Date(), -10)
      await setPlan('PRO', { currentPeriodEnd: end, currentPeriodStart: addDays(end, -30), status: 'EXPIRED' })
      const res = await A.agent.get('/api/v1/me/upload-limits').expect(200)
      expect(res.body).toMatchObject({ status: 'EXPIRED', readOnly: true })
      const refused = await upload(photo()).expect(403)
      expect(refused.body.error).toMatchObject({ code: 'PLAN_LIMIT', message: 'Renew your plan to upload' })
      expect(refused.body.error.details).toMatchObject({ resource: 'subscription', renewLink: '/subscriptions?renew=PRO&cycle=MONTHLY' })
    })

    it('cancelled: refused the same way', async () => {
      await setPlan('PRO', { status: 'CANCELLED' })
      expect((await upload(photo()).expect(403)).body.error.code).toBe('PLAN_LIMIT')
      await setPlan('STARTER')
    })
  })

  describe('POST /selections/:id/photos enforces the plan', () => {
    it('rejects a photo over the plan size with 413 FILE_TOO_LARGE (Starter: 25 MB)', async () => {
      const res = await upload(photo(26 * MB), 'big.png').expect(413)
      expect(res.body.error).toMatchObject({ code: 'FILE_TOO_LARGE', message: 'Larger than 25 MB on your Starter plan', fields: { file: 'Larger than 25 MB on your Starter plan' } })
      await upload(photo(24 * MB), 'under-limit.png').expect(201)
    })

    it("uses each plan's own size (Pro accepts what Starter refuses)", async () => {
      await setLimits('STARTER', { maxPhotoMb: 1 })
      await setLimits('PRO', { maxPhotoMb: 2 })
      const file = photo(Math.round(1.5 * MB))
      expect((await upload(file, 'one-and-a-half.png').expect(413)).body.error.message).toBe('Larger than 1 MB on your Starter plan')
      await setPlan('PRO')
      await upload(file, 'one-and-a-half.png').expect(201)
      expect((await upload(photo(3 * MB), 'three.png').expect(413)).body.error.message).toBe('Larger than 2 MB on your Pro plan')
      await setLimits('STARTER', { maxPhotoMb: 25 })
      await setLimits('PRO', { maxPhotoMb: 50 })
      await setPlan('STARTER')
    })

    it('refuses an upload that would pass the storage limit (402 PLAN_LIMIT "Storage full")', async () => {
      await setLimits('STARTER', { storageGb: 1 })
      const used = (await A.agent.get('/api/v1/me/upload-limits').expect(200)).body.storageUsedBytes
      // A stand-in file record bringing usage to 1 GB minus 100 KB.
      await prisma.storedFile.create({ data: { studioId: A.studioId, kind: 'PHOTO', storageKey: `test/filler-${Date.now()}`, originalName: 'filler.png', mimeType: 'image/png', size: GB - used - 100 * 1024, checksum: 'filler' } })
      const left = (await A.agent.get('/api/v1/me/upload-limits').expect(200)).body.storageLeftBytes
      expect(left).toBe(100 * 1024)
      await upload(photo(50 * 1024), 'fits.png').expect(201)
      const full = await upload(photo(200 * 1024), 'too-much.png').expect(402)
      expect(full.body.error.code).toBe('PLAN_LIMIT')
      expect(full.body.error.message).toBe('Storage full: 1 of 1 GB used. Upgrade for more space.')
      expect(full.body.error.details).toMatchObject({ resource: 'storage', limit: 1 })
      await prisma.storedFile.deleteMany({ where: { checksum: 'filler' } })
      await setLimits('STARTER', { storageGb: 100 })
    })

    it('saves the folder each photo came from (cleaned), and lists it', async () => {
      const a = await upload(photo(), 'H1.png', 'Haldi').expect(201)
      const b = await upload(photo(), 'W1.png', 'Wedding\\Stage/').expect(201)
      const c = await upload(photo(), 'X1.png', '../../etc').expect(201)
      const d = await upload(photo(), 'single.png').expect(201)
      expect([a.body.folder, b.body.folder, c.body.folder, d.body.folder]).toEqual(['Haldi', 'Wedding/Stage', null, null])
      const list = await A.agent.get(`/api/v1/selections/${selectionId}/photos`).expect(200)
      const byName = Object.fromEntries(list.body.map((p: { originalName: string; folder: string | null }) => [p.originalName, p.folder]))
      expect(byName).toMatchObject({ 'H1.png': 'Haldi', 'W1.png': 'Wedding/Stage', 'single.png': null })
    })

    it('still rejects duplicates and fake images', async () => {
      const same = photo()
      await upload(same, 'once.png', 'Haldi').expect(201)
      expect((await upload(same, 'again.png', 'Wedding').expect(409)).body.error.fields.file).toMatch(/Duplicate/)
      expect((await upload(Buffer.from('MZ-not-an-image'), 'fake.jpg').expect(422)).body.error.code).toBe('FILE_INVALID')
    })

    it('counts new uploads in My Subscription → Storage', async () => {
      const before = (await A.agent.get('/api/v1/subscription').expect(200)).body.usage.find((u: { key: string }) => u.key === 'storage').used
      await upload(photo(3 * MB), 'storage.png').expect(201)
      const after = (await A.agent.get('/api/v1/subscription').expect(200)).body.usage.find((u: { key: string }) => u.key === 'storage').used
      expect(after).toBeGreaterThan(before)
    })
  })

  it('cleans folder names', () => {
    expect(cleanFolder('Haldi')).toBe('Haldi')
    expect(cleanFolder(' Wedding / Stage ')).toBe('Wedding/Stage')
    expect(cleanFolder('Wedding\\Stage\\')).toBe('Wedding/Stage')
    expect(cleanFolder('./Haldi/./Close-ups')).toBe('Haldi/Close-ups')
    expect(cleanFolder('Haldi/../..')).toBeNull()
    expect(cleanFolder('')).toBeNull()
    expect(cleanFolder(undefined)).toBeNull()
    expect(cleanFolder('x'.repeat(256))).toBeNull()
    // Folder names up to 255 characters each, nested: kept whole, so local copies still match.
    const long = 'Haldi Ceremony – Bride Side (Cam 1) – 25 Nov 2026 Morning Session'.padEnd(255, '.')
    expect(cleanFolder(`${long}/${long}`)).toBe(`${long}/${long}`)
  })
})
