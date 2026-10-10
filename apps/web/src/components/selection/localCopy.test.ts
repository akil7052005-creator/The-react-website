import { describe, expect, it } from 'vitest'
import { copyFolderName, matchExact, matchSelected, missingListText, pickedListText, type FoundFile, type SelectedPhoto } from './localCopy'

const found = (path: string): FoundFile<string> => {
  const parts = path.split('/')
  return { name: parts[parts.length - 1], dirs: parts.slice(0, -1), handle: path }
}
const photo = (id: string, originalName: string, folder: string | null = null, album: string | null = null): SelectedPhoto => ({ id, originalName, folder, album })

describe('matchSelected', () => {
  const files = [found('Haldi/IMG_1.JPG'), found('Wedding/Stage/IMG_1.jpg'), found('Wedding/IMG_2.jpg'), found('Reception/IMG_9.HEIC')]

  it('matches by original file name, any case', () => {
    const { matched, missing } = matchSelected([photo('a', 'img_2.JPG')], files)
    expect(matched.map((m) => m.file.handle)).toEqual(['Wedding/IMG_2.jpg'])
    expect(missing).toEqual([])
  })

  it('uses the folder to choose between files with the same name', () => {
    const { matched } = matchSelected([photo('a', 'IMG_1.jpg', 'Shoot/Wedding/Stage', 'Wedding'), photo('b', 'IMG_1.jpg', 'Shoot/Haldi', 'Haldi')], files)
    expect(matched.map((m) => m.file.handle)).toEqual(['Wedding/Stage/IMG_1.jpg', 'Haldi/IMG_1.JPG'])
  })

  it('falls back to the album name when the folder path is unknown', () => {
    const { matched } = matchSelected([photo('a', 'IMG_1.jpg', null, 'Haldi')], files)
    expect(matched[0].file.handle).toBe('Haldi/IMG_1.JPG')
  })

  it('finds the HEIC original of a photo uploaded as JPEG', () => {
    expect(matchSelected([photo('a', 'IMG_9.jpg')], files).matched[0].file.handle).toBe('Reception/IMG_9.HEIC')
  })

  it('lists what is not found', () => {
    const { matched, missing } = matchSelected([photo('a', 'nope.jpg', 'Haldi')], files)
    expect(matched).toEqual([])
    expect(missingListText('Wedding', missing)).toBe('Selected photos not found on this computer — Wedding\r\n\r\nHaldi/nope.jpg')
  })
})

describe('copyFolderName', () => {
  it('names the copy after the customer, event and date, without characters folders cannot have', () => {
    expect(copyFolderName('Priya & Arjun', 'Wedding: Day 1', new Date(2026, 9, 4))).toBe('Selected - Priya & Arjun - Wedding- Day 1 - 2026-10-04')
  })
})

describe('matchExact (Copy from my computer)', () => {
  const sized = (path: string, size: number, sha: string): FoundFile<string> & { sha: string } => ({ ...found(path), size, sha })
  const files = [
    sized('Haldi/IMG_1.JPG', 100, 'a'.repeat(64)),
    sized('Wedding/IMG_1.jpg', 100, 'b'.repeat(64)),
    sized('Renamed/holiday.jpg', 250, 'c'.repeat(64)),
    sized('Wedding/IMG_2.jpg', 300, 'd'.repeat(64)),
  ]
  const hashOf = async (f: FoundFile<string>) => (f as (typeof files)[number]).sha

  it('matches by fingerprint first: the exact file even when another has the same name and size', async () => {
    const p: SelectedPhoto = { id: '1', originalName: 'IMG_1.jpg', folder: 'Haldi', album: null, size: 100, sha256: 'b'.repeat(64) }
    const { matched } = await matchExact([p], files, hashOf)
    expect(matched.map((m) => [m.file.handle, m.by])).toEqual([['Wedding/IMG_1.jpg', 'sha256']])
  })

  it('finds a renamed original by its fingerprint (same size), and reports a changed file as missing', async () => {
    const renamed: SelectedPhoto = { id: '1', originalName: 'IMG_7.jpg', folder: null, album: null, size: 250, sha256: 'c'.repeat(64) }
    const edited: SelectedPhoto = { id: '2', originalName: 'IMG_2.jpg', folder: 'Wedding', album: null, size: 300, sha256: 'e'.repeat(64) }
    const { matched, missing } = await matchExact([renamed, edited], files, hashOf)
    expect(matched.map((m) => m.file.handle)).toEqual(['Renamed/holiday.jpg'])
    expect(missing.map((m) => m.id)).toEqual(['2'])
  })

  it('without a fingerprint: folder path + name, then name + size, then (older uploads) name only', async () => {
    const byPath: SelectedPhoto = { id: '1', originalName: 'IMG_1.jpg', folder: null, album: null, size: 999, relativePath: 'Shoot/Wedding/IMG_1.jpg' }
    const bySize: SelectedPhoto = { id: '2', originalName: 'IMG_2.jpg', folder: null, album: null, size: 300 }
    const old: SelectedPhoto = { id: '3', originalName: 'IMG_1.jpg', folder: null, album: 'Haldi' }
    const wrongSize: SelectedPhoto = { id: '4', originalName: 'IMG_2.jpg', folder: null, album: null, size: 1 }
    const { matched, missing } = await matchExact([byPath, bySize, old, wrongSize], files, hashOf)
    expect(matched.map((m) => [m.photo.id, m.file.handle, m.by])).toEqual([
      ['1', 'Wedding/IMG_1.jpg', 'path'],
      ['2', 'Wedding/IMG_2.jpg', 'size'],
      ['3', 'Haldi/IMG_1.JPG', 'name'],
    ])
    expect(missing.map((m) => m.id)).toEqual(['4'])
  })

  it('only hashes files with the right name or size', async () => {
    const hashed: string[] = []
    const p: SelectedPhoto = { id: '1', originalName: 'IMG_2.jpg', folder: null, album: null, size: 300, sha256: 'd'.repeat(64) }
    await matchExact([p], files, async (f) => {
      hashed.push(f.handle)
      return hashOf(f)
    })
    expect(hashed).toEqual(['Wedding/IMG_2.jpg'])
  })

  it('the picked-names list has one path per line', () => {
    expect(pickedListText('Wedding', [{ id: '1', originalName: 'a.jpg', folder: 'Haldi', album: null, relativePath: 'Shoot/Haldi/a.jpg' }, { id: '2', originalName: 'b.jpg', folder: null, album: null }])).toBe(
      'Picked photos — Wedding\n\nShoot/Haldi/a.jpg\nb.jpg',
    )
  })
})
