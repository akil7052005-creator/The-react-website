import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { login, uniqueTag } from './helpers'

// Previews only: each photo is made into a 2048 px preview and a 400 px thumbnail in the browser and
// uploaded with signed links; the original never leaves the computer. The client's picks are then
// copied, byte for byte, from the original folder (matched by fingerprint).

const apiRequire = createRequire(resolve(__dirname, '../../apps/api/package.json'))
const sharp = apiRequire('sharp') as typeof import('sharp')
/** Where the e2e API keeps uploads (local storage stands in for R2). */
const STORAGE = resolve(__dirname, '../../apps/api/e2e-uploads')

test.describe.configure({ mode: 'serial' })

const tag = uniqueTag()
const ROOT = `Wedding${tag}`
let dir = ''
const files: Record<string, Buffer> = {}
let sel: { id: string; code: string; publicToken: string; eventId?: string }

/** A photo that compresses poorly (noise), so the original is several MB. */
const noisy = (width: number, height: number, quality = 95) =>
  sharp({ create: { width, height, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 50 } } })
    .jpeg({ quality })
    .toBuffer()

const sha = (b: Buffer | Uint8Array) => createHash('sha256').update(b).digest('hex')

/** Every file in the e2e storage, as keys relative to it. */
function storedKeys(): { key: string; size: number }[] {
  if (!existsSync(STORAGE)) return []
  const out: { key: string; size: number }[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name)
      if (e.isDirectory()) walk(full)
      else out.push({ key: relative(STORAGE, full).split('\\').join('/'), size: statSync(full).size })
    }
  }
  walk(STORAGE)
  return out
}

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'wz-originals-'))
  // A fake camera RAW: header bytes, a full-size JPEG preview, then sensor data.
  const raw = Buffer.concat([Buffer.from('IIRO\x08\x00\x00\x00CR\x02\x00'), Buffer.alloc(4000, 7), await noisy(3000, 2000, 90), Buffer.alloc(200_000, 9)])
  const layout: Record<string, Buffer> = {
    'Haldi/Cam-1/IMG_0001.JPG': await noisy(4000, 3000),
    'Haldi/Cam-1/IMG_0002.JPG': await noisy(4000, 3000),
    // Same name as the Haldi one: told apart by fingerprint.
    'Reception/IMG_0001.JPG': await noisy(3600, 2400),
    'Reception/IMG_0003.CR2': raw,
    // Not a readable photo and no preview inside: skipped and listed.
    'Reception/IMG_0004.NEF': Buffer.alloc(50_000, 3),
    // Not a photo at all: skipped.
    'Reception/notes.txt': Buffer.from('shot list'),
  }
  for (const [rel, buf] of Object.entries(layout)) {
    const path = join(dir, ROOT, rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, buf)
    files[rel] = buf
  }
})
test.afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('Settings say originals stay on this computer, with the cloud storage meter; no original-quality toggle', async ({ page }) => {
  await login(page)
  const created = await page.request.post('/api/v1/selections/details', { data: { customerName: `Asha ${tag}`, customerPhone: '98450 33445', eventName: `Asha ${tag} Wedding`, quota: 5 } })
  sel = await created.json()
  await page.goto(`/photo-selection/${sel.id}/settings`)
  await expect(page.getByTestId('upload-quality-help')).toContainText('Originals are not stored online. Keep your original folder on this computer until delivery.')
  await expect(page.getByTestId('cloud-storage-meter')).toContainText('GB used')
  await expect(page.getByText('Upload original quality')).toHaveCount(0)
  await expect(page.getByTestId('originalQuality')).toHaveCount(0)
})

test('upload: previews + thumbnails only (no originals in storage), names, sizes, paths and fingerprints kept', async ({ page }) => {
  await login(page)
  await page.goto(`/photo-selection/${sel.id}`)
  await expect(page.getByTestId('originals-reminder')).toHaveText(/Originals are not stored online/)
  const chooser = page.waitForEvent('filechooser')
  await page.locator('.ef-actions .ef-btn', { hasText: 'Upload Folder' }).click()
  await (await chooser).setFiles(join(dir, ROOT))
  const dialog = page.getByRole('dialog', { name: 'Select Folders to Upload' })
  await expect(dialog.getByTestId('upload-mode')).toContainText('Originals are not stored online')
  await expect(dialog.getByText('Albums (2)')).toBeVisible()
  await expect(dialog.getByTestId('upload-estimate')).toHaveText(/5 photos · about [\d.]+ (KB|MB) online \(originals [\d.]+ MB stay on this computer\)/)
  await dialog.getByTestId('start-upload').click()
  const summary = page.getByTestId('upload-summary')
  await expect(summary).toContainText('4 uploaded · 1 skipped', { timeout: 90_000 })
  await summary.getByText('Show list').click()
  await expect(summary).toContainText(`${ROOT}/Reception/IMG_0004.NEF: This photo could not be read`)
  // Files that aren't photos are ignored quietly.
  await expect(summary).not.toContainText('notes.txt')

  const photos: { originalName: string; folder: string; size: number; originalSize: number; relativePath: string; sha256: string; url: string; thumbUrl: string; originalWidth: number | null }[] = await (
    await page.request.get(`/api/v1/selections/${sel.id}/photos`)
  ).json()
  expect(photos.map((p) => p.relativePath).sort()).toEqual(
    [`${ROOT}/Haldi/Cam-1/IMG_0001.JPG`, `${ROOT}/Haldi/Cam-1/IMG_0002.JPG`, `${ROOT}/Reception/IMG_0001.JPG`, `${ROOT}/Reception/IMG_0003.CR2`].sort(),
  )
  for (const p of photos) {
    const rel = p.relativePath.slice(ROOT.length + 1)
    expect(p.originalSize).toBe(files[rel].length)
    expect(p.sha256).toBe(sha(files[rel]))
    const preview = await (await page.request.get(p.url)).body()
    const meta = await sharp(preview).metadata()
    expect(meta.format).toBe('webp')
    expect(Math.max(meta.width!, meta.height!)).toBe(rel.endsWith('.CR2') ? 2048 : 2048)
    expect(preview.length).toBeLessThanOrEqual(2 * 1024 * 1024)
    const thumb = await sharp(await (await page.request.get(p.thumbUrl)).body()).metadata()
    expect(Math.max(thumb.width!, thumb.height!)).toBe(400)
    // The RAW's size is from its preview, so it isn't recorded as the original's.
    if (rel.endsWith('.CR2')) expect(p.originalWidth).toBeNull()
    else expect(p.originalWidth).toBe((await sharp(files[rel]).metadata()).width)
  }

  // Storage holds previews/ and thumbs/ only for this event; no original's bytes anywhere.
  const originals = new Set(Object.values(files).map(sha))
  for (const o of storedKeys()) {
    if (!/^(previews|thumbs)\//.test(o.key)) continue
    expect(originals.has(sha(readFileSync(join(STORAGE, o.key))))).toBe(false)
  }
  const sizes = new Set(Object.values(files).map((b) => b.length))
  expect(storedKeys().filter((o) => sizes.has(o.size))).toEqual([])

  // A 10 MB "preview" is refused at signing.
  const big = await page.request.post('/api/v1/uploads/sign', {
    data: { selectionId: sel.id, relativePath: 'x/big.jpg', originalName: 'big.jpg', originalSize: 1, sha256: 'a'.repeat(64), format: 'webp', previewSize: 10 * 1024 * 1024, thumbSize: 1000 },
  })
  expect(big.status()).toBe(400)
})

test('client picks 3; Copy from my computer copies the 3 exact originals, byte for byte', async ({ page }) => {
  // The client: code → pick 3 (two share a name across folders, one RAW) → submit.
  const verify = await (await page.request.post('/api/v1/public/selection/verify', { data: { code: sel.code, shareToken: sel.publicToken } })).json()
  const headers = { 'X-Client-Token': verify.token }
  await login(page)
  const photos: { id: string; relativePath: string }[] = await (await page.request.get(`/api/v1/selections/${sel.id}/photos`)).json()
  const pick = ['Haldi/Cam-1/IMG_0001.JPG', 'Reception/IMG_0001.JPG', 'Reception/IMG_0003.CR2']
  for (const rel of pick) {
    const p = photos.find((x) => x.relativePath === `${ROOT}/${rel}`)!
    expect((await page.request.patch(`/api/v1/public/selection/${sel.id}/items/${p.id}`, { data: { selected: true }, headers })).ok()).toBe(true)
  }
  expect((await page.request.post(`/api/v1/public/selection/${sel.id}/submit`, { headers })).ok()).toBe(true)

  // The studio's original folder, served to a stand-in for the browser's folder picker (automation
  // can't click Chrome's own window). Files copied into it are recorded with their bytes' SHA-256.
  await page.route('**/__originals/**', (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.split('/__originals/')[1])
    return route.fulfill({ status: 200, body: readFileSync(join(dir, ROOT, rel)), contentType: 'application/octet-stream' })
  })
  await page.addInitScript((tree: string[]) => {
    type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
    const w = window as Any
    w.__copied = [] as { path: string; size: number; sha: string }[]
    const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
    const fileHandle = (name: string, path: string[], source?: string): Any => {
      let written: Blob | null = null
      return {
        kind: 'file',
        name,
        getFile: async () => (source ? new File([await (await fetch(`/__originals/${encodeURIComponent(source)}`)).blob()], name) : new File([written ?? ''], name)),
        createWritable: async () => ({
          write: async (data: Blob) => void (written = data),
          close: async () => {
            const buf = await written!.arrayBuffer()
            w.__copied.push({ path: [...path, name].join('/'), size: buf.byteLength, sha: hex(await crypto.subtle.digest('SHA-256', buf)) })
          },
        }),
      }
    }
    const dirHandle = (name: string, path: string[]): Any => {
      const kids = new Map<string, Any>()
      return {
        kind: 'directory',
        name,
        kids,
        async *values() {
          for (const k of [...kids.values()]) yield k
        },
        async getDirectoryHandle(n: string, o?: { create?: boolean }) {
          if (!kids.has(n)) {
            if (!o?.create) throw new DOMException('missing', 'NotFoundError')
            kids.set(n, dirHandle(n, [...path, n]))
          }
          return kids.get(n)
        },
        async getFileHandle(n: string, o?: { create?: boolean }) {
          if (!kids.has(n)) {
            if (!o?.create) throw new DOMException('missing', 'NotFoundError')
            kids.set(n, fileHandle(n, path))
          }
          return kids.get(n)
        },
        queryPermission: async () => 'granted',
      }
    }
    const root = dirHandle('Originals', [])
    for (const rel of tree) {
      const parts = rel.split('/')
      let d = root
      const path: string[] = []
      for (const p of parts.slice(0, -1)) {
        path.push(p)
        if (!d.kids.has(p)) d.kids.set(p, dirHandle(p, [...path]))
        d = d.kids.get(p)
      }
      d.kids.set(parts[parts.length - 1], fileHandle(parts[parts.length - 1], parts.slice(0, -1), rel))
    }
    w.showDirectoryPicker = async () => root
  }, Object.keys(files))

  await page.goto(`/photo-selection/${sel.id}`)
  await page.getByTestId('download-selected').click()
  const choose = page.getByRole('dialog', { name: 'Get selected files' })
  // No cloud option any more: originals only come from this computer.
  await expect(choose.getByText(/Download from cloud/)).toHaveCount(0)
  await choose.getByTestId('select-original-folder').click()
  await expect(page.getByTestId('copy-summary')).toContainText('3 copied · 0 not found')

  const copied: { path: string; size: number; sha: string }[] = await page.evaluate(() => (window as unknown as { __copied: never[] }).__copied)
  const target = new RegExp(`^Selected - Asha ${tag} - Asha ${tag} Wedding - \\d{4}-\\d{2}-\\d{2}/`)
  expect(copied.map((c) => c.path.replace(target, '')).sort()).toEqual([...pick].sort())
  for (const c of copied) {
    const rel = c.path.replace(target, '')
    expect(c.size).toBe(files[rel].length) // identical byte size to the source
    expect(c.sha).toBe(sha(files[rel])) // and identical bytes: the original, not the preview
  }
  // Then the selection shows Downloaded.
  await expect.poll(async () => (await (await page.request.get(`/api/v1/selections/${sel.id}`)).json()).status).toBe('DELIVERED')
})

test('a dropped connection pauses and resumes; a closed tab resumes with no duplicates', async ({ page, context }) => {
  await login(page)
  const ev: { id: string } = await (await page.request.post('/api/v1/selections/details', { data: { customerName: `Kiran ${tag}`, customerPhone: '98450 55667', eventName: `Kiran ${tag} Sangeet`, quota: 5 } })).json()
  const folder = join(dir, `Sangeet${tag}`)
  mkdirSync(folder, { recursive: true })
  for (let i = 1; i <= 12; i++) writeFileSync(join(folder, `IMG_${8000 + i}.JPG`), await noisy(1600, 1067, 85 + (i % 5)))

  // Slow each photo's last step down so the upload is still running when we pull the plug.
  await page.route('**/api/v1/uploads/complete', async (route) => {
    await new Promise((r) => setTimeout(r, 700))
    await route.continue()
  })
  await page.goto(`/photo-selection/${ev.id}`)
  let chooser = page.waitForEvent('filechooser')
  await page.locator('.ef-actions .ef-btn', { hasText: 'Upload Folder' }).click()
  await (await chooser).setFiles(folder)
  await page.getByTestId('start-upload').click()
  const progress = page.getByTestId('upload-progress')
  await expect(progress).toContainText(/Uploading [1-9]\d* \/ 12/, { timeout: 30_000 })

  // Offline: paused with a notice; back online: it carries on.
  await context.setOffline(true)
  await expect(progress).toContainText('You’re offline')
  await context.setOffline(false)
  await expect(progress).not.toContainText('You’re offline', { timeout: 20_000 })

  // Close the tab mid-upload (reload), then resume from the saved progress.
  await expect(progress).toContainText(/Uploading ([3-9]|1[01]) \/ 12/, { timeout: 30_000 })
  page.on('dialog', (d) => void d.accept())
  await page.reload()
  const before = (await (await page.request.get(`/api/v1/selections/${ev.id}/photos`)).json()).length
  expect(before).toBeLessThan(12)
  chooser = page.waitForEvent('filechooser')
  await page.locator('.ef-actions .ef-btn', { hasText: 'Upload Folder' }).click()
  // Opening it straight away picks a folder; pick an empty one and use the Resume offer instead.
  const empty = join(dir, `Empty${tag}`)
  mkdirSync(empty, { recursive: true })
  await (await chooser).setFiles(empty)
  const resume = page.getByTestId('upload-resume')
  await expect(resume).toContainText(/Resume \d+ of 12\?/)
  chooser = page.waitForEvent('filechooser')
  await resume.getByRole('button', { name: 'Resume' }).click()
  await (await chooser).setFiles(folder)
  await page.getByTestId('start-upload').click()
  await expect.poll(async () => (await (await page.request.get(`/api/v1/selections/${ev.id}/photos`)).json()).length, { timeout: 60_000 }).toBe(12)
  // Exactly 12: nothing was recorded twice.
  const photos: { originalName: string }[] = await (await page.request.get(`/api/v1/selections/${ev.id}/photos`)).json()
  expect(new Set(photos.map((p) => p.originalName)).size).toBe(12)
})

test("the album takes the picked folder's exact long name, studio side and customer side; a duplicate is refused", async ({ page, browser }) => {
  const album = 'Haldi Ceremony – Bride Side (Cam 1) – 25 Nov 2026 Morning Session'
  await login(page)
  const ev: { id: string; code: string; publicToken: string } = await (
    await page.request.post('/api/v1/selections/details', { data: { customerName: `Divya ${tag}`, customerPhone: '98450 66778', eventName: `Divya ${tag} Haldi`, quota: 5 } })
  ).json()
  const picked = join(dir, `Long${tag}`, album)
  mkdirSync(picked, { recursive: true })
  writeFileSync(join(picked, 'IMG_7001.JPG'), await noisy(2400, 1600, 90))

  // Studio: Upload Folder → the album list and the folder card show the exact name.
  await page.goto(`/photo-selection/${ev.id}`)
  const chooser = page.waitForEvent('filechooser')
  await page.locator('.ef-actions .ef-btn', { hasText: 'Upload Folder' }).click()
  await (await chooser).setFiles(picked)
  const dialog = page.getByRole('dialog', { name: 'Select Folders to Upload' })
  await expect(dialog.locator('.uf-name')).toHaveText(album)
  await expect(dialog.locator('.uf-name')).toHaveAttribute('title', album)
  await dialog.getByTestId('start-upload').click()
  await expect(page.getByText('1 photo uploaded', { exact: true })).toBeVisible({ timeout: 60_000 })
  const card = page.locator('.ef-card .ef-name span[title]')
  await expect(card).toHaveText(album)
  await expect(card).toHaveAttribute('title', album)

  // Picking the same folder again: refused with a message, not skipped silently.
  const again = page.waitForEvent('filechooser')
  await page.locator('.ef-actions .ef-btn', { hasText: 'Upload Folder' }).click()
  await (await again).setFiles(picked)
  await expect(page.getByText('A folder with this name already exists')).toBeVisible()

  // Customer: the album card shows the same name (cut with "…" if needed, full name in the tooltip).
  const customer = await (await browser.newContext()).newPage()
  await customer.goto(`/select/${ev.publicToken}`)
  await customer.getByLabel('Digit 1').click()
  await customer.keyboard.type(ev.code)
  await expect(customer).toHaveURL(new RegExp(`/selection/${ev.id}$`))
  const albumCard = customer.locator('.cp-album-name')
  await expect(albumCard).toHaveText(album)
  await expect(albumCard).toHaveAttribute('title', album)
  await customer.close()
})
