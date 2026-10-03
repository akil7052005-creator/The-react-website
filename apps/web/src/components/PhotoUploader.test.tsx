import { describe, expect, it } from 'vitest'
import { filesFromDrop } from './PhotoUploader'

// Minimal stand-ins for the browser's FileSystem entries (jsdom has none).
const fileEntry = (name: string) =>
  ({ isFile: true, isDirectory: false, name, file: (ok: (f: File) => void) => ok(new File(['x'], name, { type: 'image/jpeg' })) }) as unknown as FileSystemEntry

/** A folder whose reader hands out its children in batches, like Chrome (about 100 at a time). */
const dirEntry = (name: string, children: FileSystemEntry[], batch = 100) =>
  ({
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let i = 0
      return {
        readEntries: (ok: (e: FileSystemEntry[]) => void) => {
          const slice = children.slice(i, i + batch)
          i += batch
          ok(slice)
        },
      }
    },
  }) as unknown as FileSystemEntry

const dataTransfer = (entries: (FileSystemEntry | null)[], files: File[] = []) =>
  ({
    items: entries.map((entry) => ({ kind: 'file', webkitGetAsEntry: () => entry })),
    files,
  }) as unknown as DataTransfer

const names = (files: File[]) => files.map((f) => f.name).sort()

describe('filesFromDrop', () => {
  it('walks nested folders', async () => {
    const dt = dataTransfer([dirEntry('Wedding', [fileEntry('a.jpg'), dirEntry('Reception', [fileEntry('b.jpg'), dirEntry('Candid', [fileEntry('c.jpg')])])])])
    expect(names(await filesFromDrop(dt))).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
  })

  it('keeps reading a folder until readEntries returns nothing (batches of 100)', async () => {
    const many = Array.from({ length: 250 }, (_, i) => fileEntry(`IMG_${String(i).padStart(4, '0')}.jpg`))
    const files = await filesFromDrop(dataTransfer([dirEntry('Big shoot', many)]))
    expect(files).toHaveLength(250)
    expect(new Set(files.map((f) => f.name)).size).toBe(250)
  })

  it('takes loose files and folders dropped together', async () => {
    const dt = dataTransfer([fileEntry('loose.jpg'), dirEntry('Haldi', [fileEntry('h1.jpg'), fileEntry('h2.jpg')])])
    expect(names(await filesFromDrop(dt))).toEqual(['h1.jpg', 'h2.jpg', 'loose.jpg'])
  })

  it('falls back to the plain file list when there are no entries', async () => {
    const plain = [new File(['x'], 'p1.jpg', { type: 'image/jpeg' }), new File(['x'], 'p2.png', { type: 'image/png' })]
    expect(names(await filesFromDrop(dataTransfer([null, null], plain)))).toEqual(['p1.jpg', 'p2.png'])
  })

  it('skips a file it cannot read instead of failing the whole drop', async () => {
    const broken = { isFile: true, isDirectory: false, name: 'gone.jpg', file: (_ok: unknown, fail: (e: Error) => void) => fail(new Error('NotFoundError')) } as unknown as FileSystemEntry
    expect(names(await filesFromDrop(dataTransfer([dirEntry('Folder', [broken, fileEntry('ok.jpg')])])))).toEqual(['ok.jpg'])
  })
})
