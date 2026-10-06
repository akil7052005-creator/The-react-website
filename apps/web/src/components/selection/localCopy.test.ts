import { describe, expect, it } from 'vitest'
import { copyFolderName, matchSelected, missingListText, type FoundFile, type SelectedPhoto } from './localCopy'

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
