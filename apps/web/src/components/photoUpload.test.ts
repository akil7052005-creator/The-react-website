import { describe, expect, it, vi } from 'vitest'
import { fitBatch, folderLabel, folderOf, folderSummary, isRetryable, photoType, RETRY_DELAYS_MS, sortByPath, triage, withRetries, type Candidate } from './photoUpload'

const MB = 1024 * 1024
const file = (name: string, size = 1000, type = '') => ({ name, size, type }) as unknown as File
const c = (name: string, size?: number, type?: string, folder: string | null = null): Candidate => ({ file: file(name, size, type), folder })
const PRO = { maxPhotoMb: 50, planName: 'Pro' }

describe('photoType', () => {
  it("trusts the browser's type when it is a photo", () => {
    expect(photoType(file('x.bin', 1, 'image/png'))).toBe('image/png')
  })
  it('falls back to the extension, any case (Windows .JPG, .JFIF, .JPE)', () => {
    expect(photoType(file('DSC_0001.JPG'))).toBe('image/jpeg')
    expect(photoType(file('a.jfif', 1, 'application/octet-stream'))).toBe('image/jpeg')
    expect(photoType(file('a.JPE'))).toBe('image/jpeg')
    expect(photoType(file('a.WebP'))).toBe('image/webp')
  })
  it('rejects non-photos and files without an extension', () => {
    for (const n of ['IMG_1.HEIC', 'RAW.CR2', 'clip.mp4', 'notes.txt', 'README']) expect(photoType(file(n))).toBeNull()
  })
})

describe('folderOf', () => {
  it('takes the folder part of a picker path or a dropped entry path', () => {
    expect(folderOf('Haldi/IMG_1.jpg')).toBe('Haldi')
    expect(folderOf('Wedding/Stage/IMG_2.jpg')).toBe('Wedding/Stage')
    expect(folderOf('/Haldi/Close-ups/IMG_3.jpg')).toBe('Haldi/Close-ups')
    expect(folderOf('Wedding\\Stage\\IMG_4.jpg')).toBe('Wedding/Stage')
  })
  it('is null for a loose file', () => {
    expect(folderOf('IMG_1.jpg')).toBeNull()
    expect(folderOf('')).toBeNull()
    expect(folderOf(undefined)).toBeNull()
  })
})

describe('sortByPath', () => {
  it('orders by folder, then name, numbers naturally', () => {
    const sorted = sortByPath([c('IMG_10.jpg', 1, '', 'Wedding'), c('IMG_2.jpg', 1, '', 'Wedding'), c('IMG_1.jpg', 1, '', 'Haldi'), c('loose.jpg')])
    expect(sorted.map((x) => `${x.folder ?? ''}/${x.file.name}`)).toEqual(['/loose.jpg', 'Haldi/IMG_1.jpg', 'Wedding/IMG_2.jpg', 'Wedding/IMG_10.jpg'])
  })
})

describe('triage', () => {
  const batch = [c('a.JPG', 10 * MB), c('b.jpeg', 60 * MB), c('c.HEIC'), c('d.CR2'), c('e.heic'), c('.DS_Store'), c('Thumbs.db'), c('desktop.ini'), c('f.png', 1, 'image/png')]

  it('from a folder: skips junk silently and counts the rest for the summary', () => {
    const t = triage(batch, PRO, true)
    expect(t.photos.map((p) => p.file.name)).toEqual(['a.JPG', 'f.png'])
    expect(t.rejected).toHaveLength(0)
    expect(t.skippedLarge).toBe(1)
    expect(t.skippedNotPhoto).toBe(3)
    expect(t.notPhotoExamples).toEqual(['.HEIC', '.CR2'])
  })

  it('picked one by one: every problem becomes an error row with the plan in it', () => {
    const t = triage([c('b.jpeg', 60 * MB), c('notes.txt', 5, 'text/plain'), c('ok.jpg')], PRO, false)
    expect(t.photos.map((p) => p.file.name)).toEqual(['ok.jpg'])
    expect(t.rejected.map((r) => r.error)).toEqual(['Larger than 50 MB on your Pro plan', 'Only JPEG, PNG or WebP images'])
  })
})

describe('fitBatch', () => {
  const photos = (n: number, size = MB) => Array.from({ length: n }, (_, i) => c(`p${i}.jpg`, size))

  it('caps a pick or drop at the plan maximum (first N queued)', () => {
    const f = fitBatch(photos(400), { maxFilesPerUpload: 300, storageLeftBytes: null })
    expect(f.queued).toHaveLength(300)
    expect(f.queued[0].file.name).toBe('p0.jpg')
    expect(f).toMatchObject({ overCap: 100, noRoom: 0 })
  })

  it('queues only what fits in the storage left, in order', () => {
    const f = fitBatch(photos(10, 3 * MB), { maxFilesPerUpload: 300, storageLeftBytes: 10 * MB })
    expect(f.queued.map((p) => p.file.name)).toEqual(['p0.jpg', 'p1.jpg', 'p2.jpg'])
    expect(f).toMatchObject({ overCap: 0, noRoom: 7 })
  })

  it('applies both: the cap first, then storage', () => {
    const f = fitBatch(photos(5, MB), { maxFilesPerUpload: 3, storageLeftBytes: 2 * MB })
    expect(f).toMatchObject({ overCap: 2, noRoom: 1 })
    expect(f.queued).toHaveLength(2)
  })

  it('no storage left: nothing queued', () => {
    expect(fitBatch(photos(2), { maxFilesPerUpload: 300, storageLeftBytes: 0 }).queued).toHaveLength(0)
  })
})

describe('folder summary', () => {
  it('reads like the brief', () => {
    expect(folderSummary(248, "'Haldi'", { skippedLarge: 5, skippedNotPhoto: 7, notPhotoExamples: ['.HEIC', '.CR2'] }, PRO)).toBe(
      "Added 248 photos from 'Haldi' · skipped 12 (5 over 50 MB on Pro, 7 not JPEG/PNG/WebP e.g. .HEIC, .CR2)",
    )
    expect(folderSummary(1, "'Haldi'", { skippedLarge: 0, skippedNotPhoto: 0, notPhotoExamples: [] }, PRO)).toBe("Added 1 photo from 'Haldi'")
  })
  it('names one top folder, or counts several', () => {
    expect(folderLabel([{ folder: 'Haldi' }, { folder: 'Haldi/Close-ups' }])).toBe("'Haldi'")
    expect(folderLabel([{ folder: 'Haldi' }, { folder: 'Wedding/Stage' }, { folder: 'Reception' }])).toBe('3 folders')
  })
})

describe('retries', () => {
  const err = (status: number, code = 'X') => ({ status, code })

  it('retries network errors, 429 and 5xx; never other 4xx or PLAN_LIMIT', () => {
    expect(isRetryable(err(0))).toBe(true)
    expect(isRetryable(err(502))).toBe(true)
    expect(isRetryable(err(503))).toBe(true)
    expect(isRetryable(err(429, 'RATE_LIMITED'))).toBe(true)
    expect(isRetryable(err(409))).toBe(false)
    expect(isRetryable(err(413, 'FILE_TOO_LARGE'))).toBe(false)
    expect(isRetryable(err(402, 'PLAN_LIMIT'))).toBe(false)
    expect(isRetryable(err(503, 'PLAN_LIMIT'))).toBe(false)
    expect(isRetryable(new Error('boom'))).toBe(false)
  })

  it('waits 2 s then 5 s, then gives up', async () => {
    const sleep = vi.fn(async (_ms: number) => {})
    const attempt = vi.fn(async () => {
      throw err(0)
    })
    await expect(withRetries(attempt, sleep)).rejects.toMatchObject({ status: 0 })
    expect(attempt).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map((a) => a[0])).toEqual(RETRY_DELAYS_MS)
    expect(RETRY_DELAYS_MS).toEqual([2000, 5000])
  })

  it('recovers when a retry succeeds', async () => {
    let n = 0
    const result = await withRetries(
      async () => {
        if (++n < 2) throw err(503)
        return 'ok'
      },
      async () => {},
    )
    expect([result, n]).toEqual(['ok', 2])
  })

  it('does not retry a 4xx', async () => {
    const attempt = vi.fn(async () => {
      throw err(409)
    })
    await expect(withRetries(attempt, async () => {})).rejects.toMatchObject({ status: 409 })
    expect(attempt).toHaveBeenCalledTimes(1)
  })
})
