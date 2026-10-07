import { expect, test, type Page } from '@playwright/test'
import { gradientPng } from '../../apps/api/src/common/png'
import { login, uniqueTag } from './helpers'

// The share-link flow end to end: the studio shares /select/<token>, the client enters the 6-digit
// Customer Code, picks photos, reviews them on the Selection tab and submits; the studio then gets
// the picks (copied from the original folder on this computer, and the originals from the cloud into a
// folder — no ZIP) and sees Downloaded.

test.describe.configure({ mode: 'serial' })

const tag = uniqueTag()
const customer = `Kavya ${tag}`
const eventTitle = `${customer} Reception`
let sel: { id: string; code: string; publicToken: string }

const png = (hue: number) => gradientPng(60, 40, hue, hue)

/** Types a code into the six boxes from the first one. */
async function typeCode(page: Page, code: string) {
  await page.getByLabel('Digit 1').click()
  await page.keyboard.type(code)
}

/**
 * Stands in for the browser's folder picker (automation can't click Chrome's own window): an
 * in-memory "Originals" folder with Haldi/H0.png, Haldi/H1.png and Wedding/W0.png. Files written
 * into it are listed in window.__written. window.__fsMode = 'deny' makes the picker refuse.
 */
function fakeFolderPicker(page: Page) {
  return page.addInitScript(() => {
    type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
    const w = window as Any
    w.__written = [] as string[]
    const fileHandle = (name: string, path: string[]) => ({
      kind: 'file',
      name,
      getFile: async () => new File([new Uint8Array([1, 2, 3])], name),
      createWritable: async () => ({ write: async () => undefined, close: async () => void w.__written.push([...path, name].join('/')) }),
    })
    const dirHandle = (name: string, path: string[], files: string[] = [], dirs: Any[] = []): Any => {
      const kids = new Map<string, Any>()
      files.forEach((f) => kids.set(f, fileHandle(f, path)))
      dirs.forEach((d) => kids.set(d.name, d))
      return {
        kind: 'directory',
        name,
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
    const root = dirHandle('Originals', [], [], [dirHandle('Haldi', ['Haldi'], ['H0.png', 'H1.png']), dirHandle('Wedding', ['Wedding'], ['W0.png'])])
    w.showDirectoryPicker = async () => {
      if (w.__fsMode === 'deny') throw new DOMException('The user aborted a request.', 'NotAllowedError')
      return root
    }
  })
}

test('studio: an event with two albums, shared', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await login(page)
  const created = await page.request.post('/api/v1/selections/details', { data: { customerName: customer, customerPhone: '98450 22334', eventName: eventTitle, quota: 2 } })
  expect(created.ok()).toBe(true)
  sel = await created.json()
  for (const [album, names] of [
    ['Haldi', ['H0.png', 'H1.png']],
    ['Wedding', ['W0.png']],
  ] as const) {
    const folder = await (await page.request.post(`/api/v1/selections/${sel.id}/folders`, { data: { name: album } })).json()
    for (const [i, name] of names.entries()) {
      const r = await page.request.post(`/api/v1/selections/${sel.id}/photos`, {
        multipart: { folderId: folder.id, folder: `Originals/${album}`, file: { name, mimeType: 'image/png', buffer: png(album.length * 40 + i * 70) } },
      })
      expect(r.ok()).toBe(true)
    }
  }

  await page.goto(`/photo-selection/${sel.id}`)
  await expect(page.getByTestId('event-info')).toContainText('2 Folders')
  await expect(page.getByTestId('event-info')).toContainText('3 Images')
  // Nothing to download before the client submits.
  await expect(page.getByTestId('download-selected')).toBeDisabled()
  await expect(page.locator('.ef-tip-wrap')).toHaveAttribute('title', 'No photos selected by the client yet')

  await page.locator('.ef-info-end').getByRole('button', { name: 'Share' }).click()
  const share = page.getByRole('dialog', { name: 'Send/Share' })
  await expect(share.getByTestId('share-code')).toHaveText(sel.code)
  await share.getByRole('button', { name: 'Copy Link' }).click()
  await expect(page.getByText('Message copied. Paste it in WhatsApp.')).toBeVisible()
  await share.getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('.ef-info-end .psx-status')).toHaveText('Shared')
})

test('client: code check, picking within the limit, Selection tab, submit', async ({ page }) => {
  await page.goto(`/select/${sel.publicToken}`)
  await expect(page.getByRole('heading', { name: 'Customer Verification' })).toBeVisible()
  const wrong = sel.code === '000000' ? '111111' : '000000'
  await typeCode(page, wrong)
  await expect(page.locator('.sv-error')).toHaveText('Invalid code. 4 tries left.')
  await typeCode(page, sel.code)
  await expect(page).toHaveURL(new RegExp(`/selection/${sel.id}$`))
  await expect(page.getByRole('heading', { name: `${eventTitle} Photo Selection` })).toBeVisible()
  for (const label of ['Total Photos', 'Selected', 'Albums', 'Videos']) await expect(page.locator('.cp-stat', { hasText: label })).toBeVisible()

  await page.getByRole('link', { name: /^Open Haldi/ }).click()
  await page.getByRole('button', { name: 'Select photo', exact: true }).first().click()
  await expect(page.locator('.cp-counter')).toHaveText(/Selected: 1\s*\/ 2/)
  await page.getByRole('button', { name: 'Select photo', exact: true }).first().click()
  await expect(page.locator('.cp-counter')).toHaveText(/Selected: 2\s*\/ 2/)

  // The Selection tab: tapping a photo removes it.
  await page.locator('.cp-counter').click()
  await expect(page.getByRole('heading', { name: 'My Selection' })).toBeVisible()
  await expect(page.locator('.cp-sel-group h3')).toHaveText('Haldi (2)')
  await page.locator('.cp-sel-tile').first().click()
  await expect(page.getByText('Removed from your selection')).toBeVisible()
  await expect(page.locator('.cp-sel-group h3')).toHaveText('Haldi (1)')

  await page.getByRole('button', { name: 'Submit Selection' }).click()
  await page.getByRole('dialog', { name: 'Submit selection' }).getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Thank you, / })).toBeVisible()
  const [doc, win] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  expect(doc).toBeLessThanOrEqual(win)
})

test('studio: Download Selected — permission refused, local copy, originals from the cloud (no ZIP), Selected Photos', async ({ page }) => {
  await fakeFolderPicker(page)
  await login(page)
  await page.goto(`/photo-selection/${sel.id}`)
  await expect(page.locator('.ef-info-end .psx-status')).toHaveText('Selected')
  await page.getByTestId('download-selected').click()
  const dialog = page.getByRole('dialog', { name: 'Get selected files' })
  await expect(dialog.getByRole('button', { name: /Copy from my computer/ })).toBeVisible()
  await expect(dialog.getByRole('button', { name: /Download from cloud/ })).toBeVisible()

  // Copy from my computer → Back returns; Esc closes.
  await dialog.getByRole('button', { name: /Copy from my computer/ }).click()
  const local = page.getByRole('dialog', { name: 'Find your originals' })
  await expect(local.getByText('Pick the top folder. We’ll look inside every subfolder.')).toBeVisible()
  await local.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByRole('dialog', { name: 'Get selected files' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // "Don't Allow" in the browser's prompt.
  await page.evaluate(() => ((window as unknown as { __fsMode: string }).__fsMode = 'deny'))
  await page.getByTestId('download-selected').click()
  await page.getByRole('button', { name: /Copy from my computer/ }).click()
  await page.getByTestId('select-original-folder').click()
  await expect(page.getByText('Permission needed to copy selected photos')).toBeVisible()

  // Allowed: the pick is found in Haldi and copied into "Selected - …/Haldi".
  await page.evaluate(() => ((window as unknown as { __fsMode: string }).__fsMode = 'allow'))
  await page.getByTestId('select-original-folder').click()
  await expect(page.getByTestId('copy-summary')).toContainText('1 copied · 0 not found')
  const written = await page.evaluate(() => (window as unknown as { __written: string[] }).__written)
  expect(written).toHaveLength(1)
  expect(written[0]).toMatch(new RegExp(`^Selected - ${customer} - ${eventTitle} - \\d{4}-\\d{2}-\\d{2}/Haldi/H\\d\\.png$`))
  await page.getByRole('button', { name: 'View Selected Photos' }).click()
  await expect(page.getByRole('heading', { name: 'Selected Photos' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'All Selected (1)' })).toBeVisible()
  await expect(page.getByTestId('selected-grid').locator('li')).toHaveCount(1)
  await expect(page.locator('.ef-info-end .psx-status')).toHaveText('Downloaded')

  // Download from cloud: the pick's full-quality original, verified, into a "Selected - …/<album>" folder. No ZIP.
  await page.getByTestId('download-selected').click()
  const zips: string[] = []
  page.on('download', (d) => zips.push(d.suggestedFilename()))
  await page.getByTestId('download-from-cloud').click()
  await expect(page.getByTestId('cloud-summary')).toContainText('1 originals saved · 1 verified')
  const after = await page.evaluate(() => (window as unknown as { __written: string[] }).__written)
  expect(after).toHaveLength(2)
  expect(after[1]).toMatch(new RegExp(`^Selected - ${customer} - ${eventTitle} - \\d{4}-\\d{2}-\\d{2}/Haldi/[^/]+$`))
  expect(zips.filter((n) => /\.zip$/i.test(n))).toEqual([])
})
