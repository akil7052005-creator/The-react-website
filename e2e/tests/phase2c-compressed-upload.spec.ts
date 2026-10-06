import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { DEMO, login, uniqueTag } from './helpers'

// Compressed uploads for client selection: photos are made 1600 px JPEGs in the browser and keep
// their original names; the client's picks are then copied, full size, from the original folder.

const apiRequire = createRequire(resolve(__dirname, '../../apps/api/package.json'))
const sharp = apiRequire('sharp') as typeof import('sharp')

test.describe.configure({ mode: 'serial' })

const tag = uniqueTag()
const ROOT = `Wedding${tag}`
let dir = ''
const files: Record<string, Buffer> = {}
let sel: { id: string; code: string; publicToken: string }

/** A photo that compresses poorly (noise), so the original is several MB. */
const noisy = (width: number, height: number, quality = 95) =>
  sharp({ create: { width, height, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 50 } } })
    .jpeg({ quality })
    .toBuffer()

const sha = (b: Buffer | Uint8Array) => createHash('sha256').update(b).digest('hex')

/** The standard (IJG) luminance quantisation table that encoders scale by the quality setting. */
const STD_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35,
  55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
]
/**
 * A JPEG's quality setting (1–100), estimated from its luminance quantisation table: the quality whose
 * scaled standard table sums closest to the file's.
 */
function jpegQuality(buf: Buffer): number {
  let i = 2
  while (i < buf.length - 4) {
    if (buf[i] !== 0xff) throw new Error('Not a JPEG marker')
    const marker = buf[i + 1]
    const len = buf.readUInt16BE(i + 2)
    if (marker === 0xdb) {
      const precision = buf[i + 4] >> 4
      const table = Array.from({ length: 64 }, (_, k) => (precision ? buf.readUInt16BE(i + 5 + k * 2) : buf[i + 5 + k]))
      const sum = table.reduce((a, b) => a + b, 0)
      let best = 0
      let bestDiff = Infinity
      for (let q = 1; q <= 100; q++) {
        const scale = q < 50 ? 5000 / q : 200 - 2 * q
        const s = STD_LUMA.reduce((a, b) => a + Math.min(255, Math.max(1, Math.floor((b * scale + 50) / 100))), 0)
        if (Math.abs(s - sum) < bestDiff) [best, bestDiff] = [q, Math.abs(s - sum)]
      }
      return best
    }
    i += 2 + len
  }
  throw new Error('No quantisation table')
}

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'wz-originals-'))
  // A fake camera RAW: header bytes, a full-size JPEG preview, then sensor data.
  const raw = Buffer.concat([Buffer.from('IIRO\x08\x00\x00\x00CR\x02\x00'), Buffer.alloc(4000, 7), await noisy(3000, 2000, 90), Buffer.alloc(200_000, 9)])
  const layout: Record<string, Buffer> = {
    'Haldi/Cam-1/IMG_0001.JPG': await noisy(4000, 3000),
    'Haldi/Cam-1/IMG_0002.JPG': await noisy(4000, 3000),
    // Same name as the Haldi one: told apart by folder.
    'Reception/IMG_0001.JPG': await noisy(3600, 2400),
    'Reception/IMG_0003.CR2': raw,
    // Not a readable photo and no preview inside: skipped and listed.
    'Reception/IMG_0004.NEF': Buffer.alloc(50_000, 3),
  }
  for (const [rel, buf] of Object.entries(layout)) {
    const path = join(dir, ROOT, rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, buf)
    files[rel] = buf
  }
})
test.afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('Settings explain compressed uploads; the toggle starts off', async ({ page }) => {
  await login(page)
  const created = await page.request.post('/api/v1/selections/details', { data: { customerName: `Asha ${tag}`, customerPhone: '98450 33445', eventName: `Asha ${tag} Wedding`, quota: 5 } })
  sel = await created.json()
  await page.goto(`/photo-selection/${sel.id}/settings`)
  await expect(page.getByText('Upload original quality (large files)').first()).toBeVisible()
  // The switch, or the add-on notice on plans without it; either way it is off.
  const toggle = page.getByTestId('originalQuality')
  if (await toggle.count()) await expect(toggle).not.toBeChecked()
  else await expect(page.getByText('Requires Photo & Video Storage add-on.')).toBeVisible()
  await expect(page.getByTestId('upload-quality-help')).toHaveText('Photos are compressed to 80–85% quality for fast client viewing. Your originals stay on your computer.')
})

test('upload with the toggle off: 1600 px JPEGs at 80–85% quality, original names, sizes and folders kept', async ({ page }) => {
  await login(page)
  await page.goto(`/photo-selection/${sel.id}`)
  const chooser = page.waitForEvent('filechooser')
  await page.locator('.ef-actions .ef-btn', { hasText: 'Upload Folder' }).click()
  await (await chooser).setFiles(join(dir, ROOT))
  const dialog = page.getByRole('dialog', { name: 'Select Folders to Upload' })
  await expect(dialog.getByTestId('upload-mode')).toContainText('compressed to 80–85% quality (1600 px) for fast client viewing')
  await expect(dialog.getByText('Albums (2)')).toBeVisible()
  await dialog.getByTestId('start-upload').click()
  await expect(page.getByText('Upload complete — 1 file was skipped')).toBeVisible({ timeout: 60_000 })
  const modal = page.getByRole('dialog')
  await expect(modal.locator('.uf-skipped')).toContainText(`${ROOT}/Reception/IMG_0004.NEF: No readable preview in this RAW file`)
  await expect(modal.getByTestId('upload-saving')).toHaveText(/Compressed \d+ MB → \d+(\.\d)? ?(KB|MB)/)

  const photos: { originalName: string; folder: string; size: number; originalSize: number; compressed: boolean; url: string; originalWidth: number | null; originalUrl: string | null; originalChecksum: string | null }[] = await (
    await page.request.get(`/api/v1/selections/${sel.id}/photos`)
  ).json()
  expect(photos.map((p) => `${p.folder}/${p.originalName}`).sort()).toEqual(
    [`${ROOT}/Haldi/Cam-1/IMG_0001.JPG`, `${ROOT}/Haldi/Cam-1/IMG_0002.JPG`, `${ROOT}/Reception/IMG_0001.JPG`, `${ROOT}/Reception/IMG_0003.CR2`].sort(),
  )
  for (const p of photos) {
    const rel = `${p.folder.slice(ROOT.length + 1)}/${p.originalName}`
    expect(p.compressed).toBe(true)
    expect(p.originalSize).toBe(files[rel].length)
    expect(p.size).toBeLessThan(p.originalSize)
    // The full-quality original is kept in the cloud too (for the studio only), byte for byte.
    expect(p.originalChecksum).toBe(sha(files[rel]))
    expect(sha(await (await page.request.get(p.originalUrl!)).body())).toBe(sha(files[rel]))
    const stored = await (await page.request.get(p.url)).body()
    const meta = await sharp(stored).metadata()
    expect(meta.format).toBe('jpeg')
    expect(Math.max(meta.width!, meta.height!)).toBe(1600)
    // JPEG quality ≈ 82, never outside 80–85 (a very detailed photo may be stored at 80).
    const q = jpegQuality(stored)
    expect(q, `${rel} quality`).toBeGreaterThanOrEqual(80)
    expect(q, `${rel} quality`).toBeLessThanOrEqual(85)
    // The RAW's size is from its preview, so it isn't recorded as the original's.
    if (rel.endsWith('.CR2')) expect(p.originalWidth).toBeNull()
    else expect(p.originalWidth).toBe((await sharp(files[rel]).metadata()).width)
  }
})

test('client picks 3; Copy from my computer copies the 3 full-size originals, byte for byte', async ({ page }) => {
  // The client: code → pick 3 (one with a name shared across folders, one RAW) → submit.
  const verify = await (await page.request.post('/api/v1/public/selection/verify', { data: { code: sel.code, shareToken: sel.publicToken } })).json()
  const headers = { 'X-Client-Token': verify.token }
  await login(page)
  const photos: { id: string; originalName: string; folder: string }[] = await (await page.request.get(`/api/v1/selections/${sel.id}/photos`)).json()
  const pick = ['Haldi/Cam-1/IMG_0001.JPG', 'Reception/IMG_0001.JPG', 'Reception/IMG_0003.CR2']
  for (const rel of pick) {
    const p = photos.find((x) => `${x.folder}/${x.originalName}` === `${ROOT}/${rel}`)!
    expect((await page.request.patch(`/api/v1/public/selection/${sel.id}/items/${p.id}`, { data: { selected: true }, headers })).ok()).toBe(true)
  }
  // The image the customer views and picks from is the 80–85% quality version too.
  const viewed = await page.request.get(`/api/v1/public/selection/${sel.id}/items/${photos[0].id}/file`, { headers })
  expect(viewed.ok()).toBe(true)
  const viewedQ = jpegQuality(await viewed.body())
  expect(viewedQ).toBeGreaterThanOrEqual(80)
  expect(viewedQ).toBeLessThanOrEqual(85)
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
  await expect(choose.getByRole('button', { name: /Download from cloud/ })).toBeVisible()
  await expect(choose.getByTestId('online-note')).toHaveText('The client picked from 80–85% copies; you get the originals, each checked before it is saved.')
  await choose.getByRole('button', { name: /Copy from my computer/ }).click()
  await page.getByTestId('select-original-folder').click()
  await expect(page.getByTestId('copy-summary')).toContainText('3 copied · 0 not found')

  const copied: { path: string; size: number; sha: string }[] = await page.evaluate(() => (window as unknown as { __copied: never[] }).__copied)
  const target = new RegExp(`^Selected - Asha ${tag} - Asha ${tag} Wedding - \\d{4}-\\d{2}-\\d{2}/`)
  expect(copied.map((c) => c.path.replace(target, '')).sort()).toEqual([...pick].sort())
  for (const c of copied) {
    const rel = c.path.replace(target, '')
    expect(c.size).toBe(files[rel].length) // identical byte size to the source
    expect(c.sha).toBe(sha(files[rel])) // and identical bytes: the original, not the preview
  }
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
  await expect(page.getByText('Upload complete', { exact: true })).toBeVisible({ timeout: 60_000 })
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

test('toggle on: uploads keep the original size', async ({ page }) => {
  // Original quality needs the All-Access plan: give the demo studio that plan in the e2e database
  // for this test only, and put its own plan back afterwards.
  const { PrismaClient } = apiRequire('@prisma/client') as typeof import('@prisma/client')
  const db = new PrismaClient({ datasources: { db: { url: process.env.E2E_DATABASE_URL ?? 'postgresql://weddyzone@localhost:5433/weddyzone_e2e?schema=public' } } })
  const user = await db.user.findUniqueOrThrow({ where: { email: DEMO.email } })
  const sub = await db.subscription.findUniqueOrThrow({ where: { studioId: user.studioId! } })
  const allAccess = await db.plan.findUniqueOrThrow({ where: { code: 'ALL_ACCESS' } })
  await db.subscription.update({ where: { id: sub.id }, data: { planId: allAccess.id } })
  try {
    await originalQualityUpload(page)
  } finally {
    await db.subscription.update({ where: { id: sub.id }, data: { planId: sub.planId } })
    await db.$disconnect()
  }
})

async function originalQualityUpload(page: import('@playwright/test').Page) {
  await login(page)
  // A fresh event: the first one is Downloaded now, which takes no more photos.
  const fresh: { id: string } = await (await page.request.post('/api/v1/selections/details', { data: { customerName: `Ravi ${tag}`, customerPhone: '98450 44556', eventName: `Ravi ${tag} Reception`, quota: 5 } })).json()
  const on = await page.request.patch(`/api/v1/selections/${fresh.id}/settings`, { data: { originalQuality: true } })
  expect(on.ok()).toBe(true)
  const extra = join(dir, `Extra${tag}`)
  mkdirSync(extra, { recursive: true })
  const big = await noisy(3000, 2000)
  writeFileSync(join(extra, 'DSC_9001.JPG'), big)

  await page.goto(`/photo-selection/${fresh.id}`)
  const chooser = page.waitForEvent('filechooser')
  await page.locator('.ef-actions .ef-btn', { hasText: 'Upload Folder' }).click()
  await (await chooser).setFiles(extra)
  const dialog = page.getByRole('dialog', { name: 'Select Folders to Upload' })
  await expect(dialog.getByTestId('upload-mode')).toContainText('Uploading original quality')
  await dialog.getByTestId('start-upload').click()
  await expect(page.getByText('Upload complete', { exact: true })).toBeVisible({ timeout: 60_000 })

  const photos: { originalName: string; size: number; compressed: boolean; originalSize: number }[] = await (await page.request.get(`/api/v1/selections/${fresh.id}/photos`)).json()
  const p = photos.find((x) => x.originalName === 'DSC_9001.JPG')!
  expect(p.compressed).toBe(false)
  expect(p.size).toBe(big.length)
  expect(p.originalSize).toBe(big.length)
}
