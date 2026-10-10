import type { UploadSign } from '@weddyzone/shared'
import { describe, expect, it, vi } from 'vitest'
import { Undecodable, type Copies } from './copies'
import { etaLabel, PUT_RETRY_DELAYS_MS, UploadQueue, type QueueDeps, type QueueItem } from './uploadQueue'

const blob = (n: number) => new Blob([new Uint8Array(n)])
const copies = (name: string): Copies => ({ preview: blob(300), thumb: blob(30), format: 'webp', originalWidth: 6000, originalHeight: 4000, sha256: name.padEnd(64, '0').slice(0, 64) })
const item = (name: string, extra: Partial<QueueItem> = {}): QueueItem => ({ key: `Haldi/${name}|10|1`, file: new File(['x'], name), relativePath: `Haldi/${name}`, ...extra })

/** A fake backend: signs, takes PUTs, records completes. */
function fakeDeps(over: Partial<QueueDeps> = {}) {
  const signed: UploadSign[] = []
  const puts: string[] = []
  const completed: string[] = []
  const sleeps: number[] = []
  let n = 0
  const deps: QueueDeps = {
    copies: async (f) => copies(f.name),
    sign: async (b) => {
      signed.push(b)
      const photoId = b.photoId ?? `p${++n}`
      return { duplicate: false, photoId, preview: { key: 'k', url: `prev-${photoId}-${signed.length}`, headers: {}, expiresAt: '' }, thumb: { key: 'k', url: `thumb-${photoId}-${signed.length}`, headers: {}, expiresAt: '' } }
    },
    complete: async (b) => {
      completed.push(b.photoId)
      return { id: b.photoId, existing: false }
    },
    put: async (url) => {
      puts.push(url)
    },
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    ...over,
  }
  return { deps, signed, puts, completed, sleeps }
}

describe('UploadQueue', () => {
  it('makes copies, signs, PUTs preview + thumbnail, then completes each photo', async () => {
    const f = fakeDeps()
    const items = [item('a.jpg'), item('b.jpg'), item('c.CR2')]
    const results: string[] = []
    const q = new UploadQueue({ selectionId: 's1', items, concurrency: 2, deps: f.deps, onItem: (r) => results.push(r.outcome) })
    await q.run()
    expect(results).toEqual(['uploaded', 'uploaded', 'uploaded'])
    expect(f.completed).toHaveLength(3)
    expect(f.puts.filter((u) => u.startsWith('prev-'))).toHaveLength(3)
    expect(f.puts.filter((u) => u.startsWith('thumb-'))).toHaveLength(3)
    expect(f.signed[0]).toMatchObject({ selectionId: 's1', relativePath: 'Haldi/a.jpg', originalName: 'a.jpg', format: 'webp', previewSize: 300, thumbSize: 30, originalWidth: 6000 })
    expect(q.state).toMatchObject({ done: 3, uploaded: 3, skipped: 0, failed: 0 })
  })

  it('retries a failed PUT after 1 s, 3 s and 9 s, then gives up on that photo only', async () => {
    let fails = 0
    const f = fakeDeps({
      put: async (url) => {
        if (url.startsWith('prev-p1')) {
          fails++
          throw { status: 0 }
        }
      },
    })
    const q = new UploadQueue({ selectionId: 's', items: [item('a.jpg'), item('b.jpg')], concurrency: 1, deps: f.deps })
    await q.run()
    expect(fails).toBe(4)
    expect(f.sleeps.slice(0, 3)).toEqual(PUT_RETRY_DELAYS_MS)
    expect(q.state).toMatchObject({ uploaded: 1, failed: 1 })
  })

  it('asks for a fresh link when the old one expired (403) and keeps the same photo id', async () => {
    let first = true
    const f = fakeDeps({
      put: async () => {
        if (first) {
          first = false
          throw { status: 403 }
        }
      },
    })
    const q = new UploadQueue({ selectionId: 's', items: [item('a.jpg')], concurrency: 1, deps: f.deps })
    await q.run()
    expect(f.signed).toHaveLength(2)
    expect(f.signed[1].photoId).toBe('p1')
    expect(f.completed).toEqual(['p1'])
  })

  it('skips duplicates and photos that cannot be read, with a reason', async () => {
    const reasons: string[] = []
    const f = fakeDeps({
      copies: async (file) => {
        if (file.name === 'broken.jpg') throw new Undecodable()
        return copies(file.name)
      },
      sign: async () => ({ duplicate: true, photoId: 'old' }) as never,
    })
    const q = new UploadQueue({ selectionId: 's', items: [item('broken.jpg'), item('dup.jpg')], concurrency: 1, deps: f.deps, onItem: (r) => r.outcome === 'skipped' && reasons.push(r.reason) })
    await q.run()
    expect(reasons).toEqual(['This photo could not be read', 'Already uploaded'])
    expect(q.state).toMatchObject({ skipped: 2, uploaded: 0 })
  })

  it('a resumed file reuses its photo id', async () => {
    const f = fakeDeps()
    await new UploadQueue({ selectionId: 's', items: [item('a.jpg', { photoId: 'earlier' })], concurrency: 1, deps: f.deps }).run()
    expect(f.signed[0].photoId).toBe('earlier')
    expect(f.completed).toEqual(['earlier'])
  })

  it('re-uploads a copy the server reports missing, once', async () => {
    let tries = 0
    const f = fakeDeps({
      complete: async (b) => {
        if (tries++ === 0) throw { status: 409, code: 'CONFLICT', details: { missing: 'thumb' } }
        return { id: b.photoId, existing: false }
      },
    })
    const q = new UploadQueue({ selectionId: 's', items: [item('a.jpg')], concurrency: 1, deps: f.deps })
    await q.run()
    expect(f.puts.filter((u) => u.startsWith('thumb-'))).toHaveLength(2)
    expect(q.state.uploaded).toBe(1)
  })

  it('a plan limit stops the whole upload with the server’s message', async () => {
    const f = fakeDeps({
      sign: async () => {
        throw { status: 402, code: 'PLAN_LIMIT', message: 'Event photo limit reached', details: { resource: 'photos' } }
      },
    })
    const q = new UploadQueue({ selectionId: 's', items: [item('a.jpg'), item('b.jpg'), item('c.jpg')], concurrency: 1, deps: f.deps })
    const out = await q.run()
    expect(out.stopped?.message).toBe('Event photo limit reached')
    expect(out.stopped?.code).toBe('PLAN_LIMIT')
    expect(q.state.done).toBe(0)
  })

  it('pauses while offline and continues when back online', async () => {
    let online = false
    let back: () => void = () => {}
    const f = fakeDeps({ isOnline: () => online, waitOnline: () => new Promise<void>((r) => (back = r)) })
    const states: boolean[] = []
    const q = new UploadQueue({ selectionId: 's', items: [item('a.jpg')], concurrency: 1, deps: f.deps, onProgress: (p) => states.push(p.offline) })
    const done = q.run()
    await vi.waitFor(() => expect(states).toContain(true))
    expect(f.completed).toEqual([])
    online = true
    back()
    await done
    expect(f.completed).toHaveLength(1)
    expect(q.state.offline).toBe(false)
  })

  it('pause holds new photos; cancel stops', async () => {
    const f = fakeDeps()
    const q = new UploadQueue({ selectionId: 's', items: [item('a.jpg'), item('b.jpg')], concurrency: 1, deps: f.deps })
    q.pause()
    const run = q.run()
    await new Promise((r) => setTimeout(r, 10))
    expect(f.signed).toHaveLength(0)
    q.cancel()
    expect((await run).cancelled).toBe(true)
  })

  it('formats the time left', () => {
    expect(etaLabel(null)).toBe('')
    expect(etaLabel(42)).toBe('~40 s left')
    expect(etaLabel(360)).toBe('~6 min left')
    expect(etaLabel(4000)).toBe('~1 h 7 min left')
  })
})
