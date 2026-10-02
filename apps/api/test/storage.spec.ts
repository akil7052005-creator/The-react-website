import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Readable } from 'stream'
import { resetConfigCache } from '../src/config'
import { createStorage, LocalStorageService, S3StorageService } from '../src/infra/storage.service'

const read = async (stream: Readable) => {
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(Buffer.from(c))
  return Buffer.concat(chunks).toString()
}

describe('storage', () => {
  const saved = { ...process.env }
  const setEnv = (env: Record<string, string>) => {
    process.env = { ...saved, ...env }
    resetConfigCache()
  }
  afterEach(() => {
    process.env = { ...saved }
    resetConfigCache()
  })

  describe('S3StorageService', () => {
    const s3Env = { S3_BUCKET: 'weddyzone-uploads', S3_ACCESS_KEY_ID: 'key', S3_SECRET_ACCESS_KEY: 'secret', S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com' }
    let send: jest.Mock
    let storage: S3StorageService

    beforeEach(() => {
      setEnv(s3Env)
      send = jest.fn()
      storage = new S3StorageService({ send } as unknown as S3Client)
    })

    it('uploads to the bucket under a dated, random key with the content type', async () => {
      send.mockResolvedValue({})
      const key = await storage.save(Buffer.from('jpeg-bytes'), 'jpg', 'image/jpeg')

      expect(key).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/)
      const cmd = send.mock.calls[0][0]
      expect(cmd).toBeInstanceOf(PutObjectCommand)
      expect(cmd.input).toMatchObject({ Bucket: 'weddyzone-uploads', Key: key, ContentType: 'image/jpeg', ContentLength: 10 })
    })

    it('streams an object back', async () => {
      send.mockResolvedValue({ Body: Readable.from([Buffer.from('jpeg-bytes')]) })
      const stream = await storage.open('2026/10/a.jpg')

      expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand)
      expect(send.mock.calls[0][0].input).toEqual({ Bucket: 'weddyzone-uploads', Key: '2026/10/a.jpg' })
      expect(await read(stream!)).toBe('jpeg-bytes')
    })

    it.each([
      ['NoSuchKey', { name: 'NoSuchKey' }],
      ['a 404', { name: 'Unknown', $metadata: { httpStatusCode: 404 } }],
    ])('returns null for a missing object (%s)', async (_case, error) => {
      send.mockRejectedValue(Object.assign(new Error('missing'), error))
      expect(await storage.open('2026/10/gone.jpg')).toBeNull()
    })

    it('surfaces other storage errors', async () => {
      send.mockRejectedValue(Object.assign(new Error('Access Denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }))
      await expect(storage.open('2026/10/a.jpg')).rejects.toThrow('Access Denied')
    })

    it('deletes objects', async () => {
      send.mockResolvedValue({})
      await storage.remove('2026/10/a.jpg')
      expect(send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand)
    })
  })

  describe('LocalStorageService (development)', () => {
    let dir: string
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'wz-storage-'))
      setEnv({ UPLOAD_DIR: dir })
    })
    afterEach(() => rmSync(dir, { recursive: true, force: true }))

    it('saves, reads and removes files on disk', async () => {
      const storage = new LocalStorageService()
      const key = await storage.save(Buffer.from('png-bytes'), 'png', 'image/png')
      expect(await read((await storage.open(key))!)).toBe('png-bytes')
      await storage.remove(key)
      expect(await storage.open(key)).toBeNull()
    })

    it('refuses keys that escape the upload folder', async () => {
      await expect(new LocalStorageService().open('../../etc/passwd')).rejects.toThrow('Invalid storage key')
    })
  })

  it('uses the bucket when S3_BUCKET is set, local disk otherwise', () => {
    setEnv({ S3_BUCKET: '' })
    expect(createStorage()).toBeInstanceOf(LocalStorageService)
    setEnv({ S3_BUCKET: 'weddyzone-uploads', S3_ACCESS_KEY_ID: 'key', S3_SECRET_ACCESS_KEY: 'secret' })
    expect(createStorage()).toBeInstanceOf(S3StorageService)
  })
})
