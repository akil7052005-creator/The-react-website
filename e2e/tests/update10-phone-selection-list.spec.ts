import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { gradientPng } from '../../apps/api/src/common/png'
import { login, uniqueTag } from './helpers'

// Photo Selection list on phones (≤ 640px): cards, filter chips, the ⋮ sheet and the fixed Add
// button. Wider screens keep the table. The workflow itself is the same as on desktop.

test.describe.configure({ mode: 'serial' })

const tag = uniqueTag()
const customer = `Nila ${tag}`
const eventTitle = `${customer} Reception`

async function noSideScroll(page: Page) {
  const [doc, win] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  expect(doc).toBeLessThanOrEqual(win)
}

test('cards on phones, the table on wider screens; no sideways scroll; chips filter and count', async ({ page }) => {
  await login(page)
  for (const width of [360, 390, 768, 1366]) {
    await page.setViewportSize({ width, height: 860 })
    await page.goto('/photo-selection')
    if (width <= 640) {
      const cards = page.getByTestId('selection-cards').locator('article')
      await expect(cards.first()).toBeVisible()
      await expect(page.getByTestId('selections-table')).toHaveCount(0)
      await expect(page.locator('.plm-tile')).toHaveCount(3)
      // The same rows as the table: this page of the list, in the same order.
      const api = await (await page.request.get('/api/v1/selections?page=1&limit=10')).json()
      const names: string[] = api.data.map((s: { client: { name: string } }) => s.client.name)
      await expect(cards.locator('.plc-name')).toHaveText(names)
      const chips = page.getByTestId('status-chips')
      await expect(chips.getByRole('button', { name: /^All/ })).toHaveText(`All ${names.length}`)
      // Each chip shows only its status, and its count matches the cards shown.
      for (const [chip, labels] of [
        ['Selected', ['Selected']],
        ['Downloaded', ['Downloaded']],
        ['Pending', ['Pending', 'Shared', 'In Progress']],
      ] as const) {
        const button = chips.getByRole('button', { name: new RegExp(`^${chip}`) })
        await button.click()
        await expect(button).toHaveAttribute('aria-pressed', 'true')
        const n = Number((await button.locator('span').innerText()).trim())
        if (n === 0) {
          await expect(cards).toHaveCount(0)
          continue
        }
        await expect(cards).toHaveCount(n)
        for (const status of await cards.locator('.pl-status').allInnerTexts()) expect(labels).toContain(status)
      }
      await chips.getByRole('button', { name: /^All/ }).click()
      await expect(cards).toHaveCount(names.length)
      // Every card's buttons are on screen and big enough to tap.
      for (const box of await cards.first().locator('.plc-btn').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
        expect(box.right).toBeLessThanOrEqual(width)
        expect(box.height).toBeGreaterThanOrEqual(40)
      }
      // The fixed Add Photo Selection pill.
      await expect(page.locator('.plm-add-bar').getByRole('button', { name: 'Add Photo Selection' })).toBeVisible()
    } else {
      await expect(page.getByTestId('selections-table')).toBeVisible()
      await expect(page.getByTestId('selection-cards')).toHaveCount(0)
      await expect(page.locator('.plm-add-bar')).toHaveCount(0)
    }
    await noSideScroll(page)
  }
})

test('phone: Add → Upload → Send (WhatsApp) → customer submits → Download Selected → Reset → Pending', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'mobile', 'the phone flow runs in the mobile project')
  test.setTimeout(120_000)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  for (const host of ['https://wa.me/**', 'https://api.whatsapp.com/**']) {
    await context.route(host, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>WhatsApp</p>' }))
  }
  await login(page)
  await page.goto('/photo-selection')

  // Add Photo Selection from the fixed pill.
  await page.locator('.plm-add-bar').getByRole('button', { name: 'Add Photo Selection' }).click()
  const details = page.getByRole('dialog', { name: 'Event Details' })
  await details.getByLabel('Customer Name').fill(customer)
  await details.getByLabel('Customer Phone Number').fill('98450 77889')
  await details.getByLabel('Event Name').fill(eventTitle)
  await details.getByLabel(/Selection Limit/).fill('2')
  await details.getByRole('button', { name: 'Add Event' }).click()
  await expect(details).toHaveCount(0)
  const card = page.getByTestId('selection-cards').locator('article', { hasText: customer })
  await expect(page.getByTestId('selection-cards').locator('article').first()).toContainText(customer)
  await expect(card.locator('.pl-status')).toHaveText('Pending')
  await expect(card.getByRole('button', { name: /^Send code/ })).toBeVisible()

  // Upload: the card's Upload opens the event page, where the folder is uploaded as on desktop.
  const root = mkdtempSync(join(tmpdir(), 'wz-phone-'))
  const folder = join(root, 'Reception')
  mkdirSync(folder)
  for (let i = 0; i < 3; i++) writeFileSync(join(folder, `R${i}.png`), gradientPng(60, 40, 20 + i * 80, 200 - i * 40))
  await card.getByRole('link', { name: `Upload & Download: ${eventTitle}` }).click()
  await expect(page).toHaveURL(/\/photo-selection\/[0-9a-f-]{36}$/)
  const chooser = page.waitForEvent('filechooser')
  await page.locator('.ef-actions .ef-btn', { hasText: 'Upload Folder' }).click()
  await (await chooser).setFiles(folder)
  const upload = page.getByRole('dialog', { name: 'Select Folders to Upload' })
  await upload.getByTestId('start-upload').click()
  await expect(page.getByText('3 photos uploaded')).toBeVisible({ timeout: 60_000 })
  rmSync(root, { recursive: true, force: true })
  await page.goto('/photo-selection')
  await expect(card.locator('.plc-count')).toHaveText(['1 folder', '3 photos', '0 / 2 picked'])

  // Send on WhatsApp from the card: the same Send/Share dialog.
  await card.getByRole('button', { name: /^Send code/ }).click()
  const share = page.getByRole('dialog', { name: 'Send/Share' })
  const code = await share.getByTestId('share-code').innerText()
  const popup = context.waitForEvent('page')
  await share.getByRole('button', { name: 'Send on WhatsApp' }).click()
  const wa = await popup
  expect(new URL(wa.url()).searchParams.get('text') ?? '').toContain(`Access code: ${code}`)
  await wa.close()
  await share.getByRole('button', { name: 'Close' }).click()
  await expect(card.locator('.pl-status')).toHaveText('Shared')

  // The ⋮ sheet: closes on Escape, on a tap outside and on Back (staying on the list).
  const more = card.getByRole('button', { name: `More actions for ${eventTitle}` })
  const sheet = page.getByRole('dialog', { name: new RegExp(customer) })
  await more.click()
  await expect(sheet.getByRole('button', { name: 'Reset Selection' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await more.click()
  await page.mouse.click(195, 40)
  await expect(sheet).toHaveCount(0)
  await more.click()
  await page.goBack()
  await expect(sheet).toHaveCount(0)
  await expect(page).toHaveURL(/\/photo-selection$/)
  await expect(card).toBeVisible()

  // The customer picks 2 and submits.
  const sel = (await (await page.request.get(`/api/v1/selections?search=${encodeURIComponent(customer)}`)).json()).data[0]
  const token = (await (await page.request.post('/api/v1/public/selection/verify', { data: { code, shareToken: sel.publicToken } })).json()).token as string
  const photos: { id: string }[] = await (await page.request.get(`/api/v1/selections/${sel.id}/photos`)).json()
  for (const p of photos.slice(0, 2)) {
    expect((await page.request.patch(`/api/v1/public/selection/${sel.id}/items/${p.id}`, { data: { selected: true }, headers: { 'X-Client-Token': token } })).ok()).toBe(true)
  }
  expect((await page.request.post(`/api/v1/public/selection/${sel.id}/submit`, { headers: { 'X-Client-Token': token } })).ok()).toBe(true)

  // The card turns Selected without a reload, with Download Selected (2).
  await expect(card.locator('.pl-status')).toHaveText('Selected', { timeout: 15_000 })
  await expect(card.locator('.plc-caption')).toHaveText('Submitted · ready to download · 100%')
  const chips = page.getByTestId('status-chips')
  await chips.getByRole('button', { name: /^Selected/ }).click()
  await expect(card).toBeVisible()
  await chips.getByRole('button', { name: /^Pending/ }).click()
  await expect(card).toHaveCount(0)
  await chips.getByRole('button', { name: /^All/ }).click()

  // Download Selected: the event page's own dialog.
  await card.getByRole('button', { name: 'Download Selected (2)' }).click()
  const download = page.getByRole('dialog', { name: 'Get selected files' })
  await expect(download).toBeVisible()
  await download.getByRole('button', { name: 'Close' }).click()
  await expect(download).toHaveCount(0)

  // Reset Selection from the ⋮ sheet: the same choose → confirm dialogs, then Pending.
  await more.click()
  await sheet.getByRole('button', { name: 'Reset Selection' }).click()
  const choose = page.getByRole('dialog', { name: 'Reset Selection' })
  await choose.getByTestId('reset-shortlist').click()
  await page.getByRole('dialog', { name: 'Shortlist?' }).getByTestId('reset-confirm').click()
  await expect(page.getByText('Selection reopened — 2 picks kept')).toBeVisible()
  await expect(card.locator('.pl-status')).toHaveText('Pending')
  await expect(page).toHaveURL(/\/photo-selection$/)
  await noSideScroll(page)
})
