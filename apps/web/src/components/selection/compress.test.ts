import { describe, expect, it } from 'vitest'
import { formatBytes } from './compressForUpload'
import { fitWithin } from './imageCompress'
import { matchSelected, type FoundFile, type SelectedPhoto } from './localCopy'
import { jpegCandidates } from './rawPreview'

describe('fitWithin', () => {
  it('shrinks the long side to 1600 px, keeping the shape, and never enlarges', () => {
    expect(fitWithin(6000, 4000)).toEqual({ width: 1600, height: 1067 })
    expect(fitWithin(4000, 6000)).toEqual({ width: 1067, height: 1600 })
    expect(fitWithin(1200, 800)).toEqual({ width: 1200, height: 800 })
  })
})

describe('formatBytes', () => {
  it('reads like "1.2 GB → 96 MB"', () => {
    expect(formatBytes(1.2 * 1024 ** 3)).toBe('1.2 GB')
    expect(formatBytes(96 * 1024 ** 2)).toBe('96 MB')
    expect(formatBytes(480 * 1024)).toBe('480 KB')
  })
})

describe('jpegCandidates (RAW embedded previews)', () => {
  /** A fake RAW: header bytes, a small thumbnail JPEG, then a big preview JPEG holding its own thumbnail. */
  function fakeRaw() {
    const jpeg = (n: number, fill: number) => [0xff, 0xd8, 0xff, ...new Array(n).fill(fill), 0xff, 0xd9]
    const thumb = jpeg(3000, 1)
    const preview = [0xff, 0xd8, 0xff, ...new Array(5000).fill(2), ...jpeg(2500, 3), ...new Array(9000).fill(4), 0xff, 0xd9]
    return { bytes: new Uint8Array([...new Array(100).fill(0), ...thumb, ...new Array(50).fill(0), ...preview]), thumbStart: 100, previewStart: 100 + thumb.length + 50, previewLength: preview.length }
  }

  it('includes the whole preview (past its inner thumbnail) and the thumbnail, longest first', () => {
    const { bytes, thumbStart, previewStart, previewLength } = fakeRaw()
    const list = jpegCandidates(bytes)
    expect(list).toContainEqual([previewStart, previewStart + previewLength])
    expect(list).toContainEqual([thumbStart, thumbStart + 3005])
    // Longest first: the decoder tries the big streams before thumbnails.
    expect(list.map(([s, e]) => e - s)).toEqual([...list.map(([s, e]) => e - s)].sort((a, b) => b - a))
  })

  it('leaves out tiny streams', () => {
    const tiny = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 0xff, 0xd9])
    expect(jpegCandidates(tiny)).toEqual([])
  })
})

describe('matchSelected: path + name, then name, then byte size', () => {
  const found = (path: string, size?: number): FoundFile<string> => {
    const parts = path.split('/')
    return { name: parts[parts.length - 1], dirs: parts.slice(0, -1), handle: path, size }
  }
  const photo = (p: Partial<SelectedPhoto> & { originalName: string }): SelectedPhoto => ({ id: p.originalName, folder: null, album: null, ...p })

  it('prefers the same folder path (studio picked the folder above the uploaded one)', () => {
    const files = [found('Backup/Haldi/Cam-1/IMG_1.CR2', 30_000_000), found('Shoot/Haldi/Cam-1/IMG_1.CR2', 31_000_000)]
    const { matched } = matchSelected([photo({ originalName: 'IMG_1.CR2', folder: 'Shoot/Haldi/Cam-1' })], files)
    // Both end in Haldi/Cam-1; "Shoot/Haldi/Cam-1" is the full path.
    expect(matched[0].file.handle).toBe('Shoot/Haldi/Cam-1/IMG_1.CR2')
  })

  it('with only the name to go on, prefers the file with the same byte size', () => {
    const files = [found('A/IMG_7.CR2', 1000), found('B/IMG_7.CR2', 2000)]
    const { matched } = matchSelected([photo({ originalName: 'img_7.cr2', size: 2000 })], files)
    expect(matched[0].file.handle).toBe('B/IMG_7.CR2')
  })

  it('a different file name never matches, even with the same size', () => {
    const { matched, missing } = matchSelected([photo({ originalName: 'IMG_9.CR2', size: 1000 })], [found('A/IMG_7.CR2', 1000)])
    expect(matched).toEqual([])
    expect(missing).toHaveLength(1)
  })
})
