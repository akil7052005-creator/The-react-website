import { describe, expect, it } from 'vitest'
import { folderPathOf, groupInputFiles, isRaw, mediaOf, rejectReason, targetsOf, toRow } from './folderUpload'

const file = (name: string, path?: string) => ({ name, size: 10, type: '', webkitRelativePath: path ?? '' }) as unknown as File

describe('mediaOf', () => {
  it('keeps photos (JPG, JPEG, PNG, WebP, HEIC) and videos (MP4, MOV), any case', () => {
    expect(['a.jpg', 'b.JPEG', 'c.png', 'd.webp', 'e.HEIC'].map(mediaOf)).toEqual(['image', 'image', 'image', 'image', 'image'])
    expect(['clip.mp4', 'CLIP.MOV'].map(mediaOf)).toEqual(['video', 'video'])
  })
  it('takes camera RAW files as photos (uploaded as a compressed copy of their preview)', () => {
    expect(['IMG_1.CR2', 'a.nef', 'b.ARW', 'c.dng', 'd.cr3'].map(mediaOf)).toEqual(['image', 'image', 'image', 'image', 'image'])
    expect(['IMG_1.CR2', 'x.jpg'].map(isRaw)).toEqual([true, false])
  })
  it('ignores everything else', () => {
    for (const n of ['notes.txt', 'shot.xmp', 'Thumbs.db', '.DS_Store', 'desktop.ini', 'README']) expect(mediaOf(n)).toBeNull()
  })
})

describe('folder rows', () => {
  it('counts only photos and videos, labels video-only folders', () => {
    const r = toRow({ name: 'Pictures', files: [file('a.jpg'), file('b.png'), file('x.txt'), file('c.mp4')] }, 'k')
    expect(r).toMatchObject({ name: 'Pictures', images: 2, videos: 1, label: 'Photo' })
    expect(r.files).toHaveLength(3)
    expect(toRow({ name: 'Clips', files: [file('a.mov')] }, 'k').label).toBe('Video')
  })

  it('blocks a folder already listed or already in the event (any case), and empty ones', () => {
    const r = toRow({ name: 'Pictures', files: [file('a.jpg')] }, 'k')
    const dup = { message: 'A folder with this name already exists', name: 'Pictures' }
    expect(rejectReason(r, ['pictures'], [])).toEqual(dup)
    expect(rejectReason(r, [], ['PICTURES'])).toEqual(dup)
    expect(rejectReason(r, ['Haldi'], ['Wedding'])).toBeNull()
    expect(rejectReason(toRow({ name: 'Docs', files: [file('a.pdf')] }, 'k'), [], [])).toEqual({ message: 'This folder has no photos or videos', name: 'Docs' })
  })
})

describe('album names', () => {
  const exact = 'Haldi Ceremony – Bride Side (Cam 1) – 25 Nov 2026 Morning Session'

  it("uses the picked folder's exact name: spaces, dots, dashes, brackets and non-English letters kept", () => {
    const g = groupInputFiles([
      file('a.jpg', `${exact}/a.jpg`),
      file('b.jpg', `${exact}/  திருமணம் [Day 2] v1.0  /b.jpg`),
      file('c.jpg', `${exact}/Mehendi.Night - Side (B)/c.jpg`),
    ])
    expect(g.map((x) => x.name)).toEqual([exact, 'திருமணம் [Day 2] v1.0', 'Mehendi.Night - Side (B)'])
  })

  it('keeps the first 255 characters of a longer name, never "Photos" or "Pictures"', () => {
    const long = `${exact} `.repeat(6)
    const [g] = groupInputFiles([file('a.jpg', `${long}/a.jpg`)])
    expect(g.name).toBe(long.trim().slice(0, 255).trimEnd())
    expect(g.name.length).toBeLessThanOrEqual(255)
    expect(g.name.startsWith(exact)).toBe(true)
  })

  it('a photo + video folder makes "<name> Videos", still within 255 characters', () => {
    const name = 'x'.repeat(255)
    expect(targetsOf({ name, images: 1, videos: 1 })).toEqual([
      { name, type: 'photo' },
      { name: `${'x'.repeat(248)} Videos`, type: 'video' },
    ])
    expect(targetsOf({ name: exact, images: 1, videos: 1 })[1].name).toBe(`${exact} Videos`)
  })
})

describe('groupInputFiles', () => {
  it('makes one album per subfolder; deeper folders join their subfolder, loose files the picked folder', () => {
    const g = groupInputFiles([
      file('a.jpg', 'Wedding/a.jpg'),
      file('b.jpg', 'Wedding/Haldi/b.jpg'),
      file('c.jpg', 'Wedding/Haldi/Day 2/c.jpg'),
      file('d.jpg', 'Wedding/Reception/d.jpg'),
    ])
    expect(g.map((x) => [x.name, x.files.map((f) => f.name)])).toEqual([
      ['Wedding', ['a.jpg']],
      ['Haldi', ['b.jpg', 'c.jpg']],
      ['Reception', ['d.jpg']],
    ])
  })

  it('skips "Selected - …" output folders (at any depth) and folders without photos or videos', () => {
    const g = groupInputFiles([
      file('a.jpg', 'Wedding/Haldi/a.jpg'),
      file('b.jpg', 'Wedding/Selected - Priya - Wedding - 2026-10-04/b.jpg'),
      file('c.jpg', 'Wedding/Reception/Selected - Priya - Reception - 2026-10-05/c.jpg'),
      file('notes.txt', 'Wedding/Docs/notes.txt'),
      file('Thumbs.db', 'Wedding/Empty/Thumbs.db'),
    ])
    expect(g.map((x) => [x.name, x.files.map((f) => f.name)])).toEqual([['Haldi', ['a.jpg']]])
    expect(groupInputFiles([file('b.jpg', 'Selected - Priya - Wedding - 2026-10-04/Haldi/b.jpg')])).toEqual([])
  })

  it('keeps the full folder path of each file', () => {
    expect(folderPathOf(file('c.jpg', 'Wedding/Haldi/Day 2/c.jpg'))).toBe('Wedding/Haldi/Day 2')
    expect(folderPathOf(file('a.jpg', 'Wedding/a.jpg'))).toBe('Wedding')
    expect(folderPathOf(file('loose.jpg'))).toBeNull()
  })
})
