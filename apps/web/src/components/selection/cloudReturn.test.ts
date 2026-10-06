import { describe, expect, it } from 'vitest'
import { fetchVerified, returnOriginals, safeName, uniqueName, type CloudPick } from './cloudReturn'
import type { DirEntryHandle, FileEntryHandle } from './localCopy'

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(s)))].map((b) => b.toString(16).padStart(2, '0')).join('')

const readText = (b: Blob) =>
  new Promise<string>((resolve) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as string)
    fr.readAsText(b)
  })

/** An in-memory folder: files written into it are recorded as "path/name" → text. */
function memoryDir(written: Map<string, string>, path: string[] = []): DirEntryHandle {
  const kids = new Map<string, DirEntryHandle>()
  return {
    kind: 'directory',
    name: path[path.length - 1] ?? 'root',
    async *values() {},
    async getDirectoryHandle(n: string) {
      if (!kids.has(n)) kids.set(n, memoryDir(written, [...path, n]))
      return kids.get(n)!
    },
    async getFileHandle(n: string): Promise<FileEntryHandle> {
      let data: Blob | null = null
      return {
        kind: 'file',
        name: n,
        getFile: async () => new File([data ?? ''], n),
        createWritable: async () => ({
          write: async (d: Blob) => void (data = d),
          close: async () => void written.set([...path, n].join('/'), await readText(data!)),
        }),
      }
    },
  }
}

const pick = (id: string, originalName: string, album: string | null, originalUrl: string | null, originalChecksum: string | null): CloudPick => ({
  id,
  originalName,
  folder: null,
  album,
  originalUrl,
  originalChecksum,
})

describe('returning the originals of the picks', () => {
  it('verifies each original by SHA-256 and fetches again once when it does not match', async () => {
    const good = await sha('ORIGINAL')
    let calls = 0
    const flaky = async () => bytes(++calls === 1 ? 'CORRUPTED' : 'ORIGINAL')
    const r = await fetchVerified('/f/1', good, flaky)
    expect(r.verified).toBe(true)
    expect(new TextDecoder().decode(r.data)).toBe('ORIGINAL')
    expect(calls).toBe(2)
    await expect(fetchVerified('/f/1', good, async () => bytes('CORRUPTED'))).rejects.toThrow('does not match')
  })

  it('saves originals under their own names, one subfolder per album; missing and bad ones are listed, never zipped', async () => {
    const files: Record<string, string> = { '/f/a': 'RAW-A', '/f/b': 'RAW-B', '/f/c': 'RAW-C', '/f/bad': 'XXXX' }
    const picks = [
      pick('1', 'IMG_0001.CR2', 'Haldi Ceremony – Bride Side (Cam 1)', '/f/a', await sha('RAW-A')),
      pick('2', 'IMG_0001.CR2', 'Haldi Ceremony – Bride Side (Cam 1)', '/f/b', await sha('RAW-B')),
      pick('3', 'DSC_9.JPG', null, '/f/c', await sha('RAW-C')),
      pick('4', 'IMG_4.JPG', 'Reception', null, null),
      pick('5', 'IMG_5.JPG', 'Reception', '/f/bad', await sha('GOOD')),
    ]
    const written = new Map<string, string>()
    const progress: number[] = []
    const r = await returnOriginals(picks, {
      root: memoryDir(written),
      folderName: 'Selected - Priya - Wedding - 2026-10-05',
      get: async (url) => bytes(files[url]),
      onProgress: (d) => progress.push(d),
    })
    expect(r).toMatchObject({ saved: 3, verified: 3 })
    expect(r.notInCloud.map((p) => p.id)).toEqual(['4'])
    expect(r.failed.map((p) => p.id)).toEqual(['5'])
    expect(Object.fromEntries(written)).toEqual({
      'Selected - Priya - Wedding - 2026-10-05/Haldi Ceremony – Bride Side (Cam 1)/IMG_0001.CR2': 'RAW-A',
      'Selected - Priya - Wedding - 2026-10-05/Haldi Ceremony – Bride Side (Cam 1)/IMG_0001 (2).CR2': 'RAW-B',
      'Selected - Priya - Wedding - 2026-10-05/Other/DSC_9.JPG': 'RAW-C',
    })
    expect([...written.keys()].some((k) => /\.zip$/i.test(k))).toBe(false)
    expect(progress).toEqual([1, 2, 3, 4, 5])
  })

  it('without a folder picker, saves one file at a time (named with the album)', async () => {
    const saved: string[] = []
    const r = await returnOriginals([pick('1', 'IMG_1.JPG', 'Haldi', '/f/a', await sha('A'))], {
      root: null,
      folderName: 'unused',
      get: async () => bytes('A'),
      save: (_d, name) => saved.push(name),
    })
    expect(r.saved).toBe(1)
    expect(saved).toEqual(['Haldi - IMG_1.JPG'])
  })

  it('makes names safe for Windows and macOS without changing ordinary ones', () => {
    expect(safeName('Haldi Ceremony – Bride Side (Cam 1)')).toBe('Haldi Ceremony – Bride Side (Cam 1)')
    expect(safeName('A/B:C*D?. ')).toBe('A-B-C-D-')
    expect(safeName('Haldi.  ')).toBe('Haldi')
    expect(uniqueName('x.jpg', new Set(['x.jpg']))).toBe('x (2).jpg')
  })
})
