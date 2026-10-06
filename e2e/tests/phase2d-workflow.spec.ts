import { expect, test, type Page } from '@playwright/test'
import { gradientPng } from '../../apps/api/src/common/png'
import { login, uniqueTag } from './helpers'

// Manage → Settings, Send options, the two Reset Selection choices, upload errors, and the client's
// Photo Notes and selection limit.

test.describe.configure({ mode: 'serial' })

const tag = uniqueTag()
const customer = `Leela ${tag}`
const eventTitle = `${customer} Sangeet`
let sel: { id: string; code: string; publicToken: string }

async function clientToken(page: Page) {
  const r = await page.request.post('/api/v1/public/selection/verify', { data: { code: sel.code, shareToken: sel.publicToken } })
  return (await r.json()).token as string
}

test('setup: an event with 3 photos, notes on, limit 2', async ({ page }) => {
  await login(page)
  sel = await (await page.request.post('/api/v1/selections/details', { data: { customerName: customer, customerPhone: '98450 55667', eventName: eventTitle, quota: 2 } })).json()
  const folder = await (await page.request.post(`/api/v1/selections/${sel.id}/folders`, { data: { name: 'Sangeet' } })).json()
  for (let i = 0; i < 3; i++) {
    const r = await page.request.post(`/api/v1/selections/${sel.id}/photos`, {
      multipart: { folderId: folder.id, file: { name: `S${i}.png`, mimeType: 'image/png', buffer: gradientPng(80, 60, 30 + i * 90, 200 - i * 50) } },
    })
    expect(r.ok()).toBe(true)
  }
  expect((await page.request.patch(`/api/v1/selections/${sel.id}/settings`, { data: { photoNotes: true } })).ok()).toBe(true)
})

test('Manage opens the event’s Settings page with Edit Event Details at the top', async ({ page }) => {
  await login(page)
  await page.goto('/photo-selection')
  await page.getByTestId('selections-table').getByRole('link', { name: `Manage ${eventTitle}` }).click()
  await expect(page).toHaveURL(new RegExp(`/photo-selection/${sel.id}/settings$`))
  await expect(page.getByRole('heading', { name: 'Photo Selection Settings' })).toBeVisible()
  await expect(page.locator('.ss-head').getByRole('button', { name: /Edit Event Details/ })).toBeVisible()
})

test('Send options: web sign-in and personal links, the full message, never localhost', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  for (const host of ['https://wa.me/**', 'https://api.whatsapp.com/**']) {
    await context.route(host, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>WhatsApp</p>' }))
  }
  await login(page)
  await page.goto('/photo-selection')
  await page.getByTestId('selections-table').getByRole('button', { name: `Send code ${sel.code} to ${customer}` }).click()
  const dialog = page.getByRole('dialog', { name: 'Send/Share' })
  const options = dialog.getByTestId('send-options')
  await expect(options.locator('.sh-option strong')).toHaveText(['Web link', 'Personal link', 'Full message']) // app links aren't set: hidden
  await expect(options.locator('.sh-option').first()).toContainText('https://studio.weddyzone.example/selection/auth')

  // Copy full message = Copy message = Send on WhatsApp: one message, word for word.
  await options.getByRole('button', { name: 'Copy full message' }).click()
  await expect(page.getByText('Message copied. Paste it in WhatsApp.').first()).toBeVisible()
  const full = await page.evaluate(() => navigator.clipboard.readText())
  expect(full).toContain('📸')
  expect(full).toContain(`Access code: ${sel.code}`)
  expect(full.split('\n')).toContain(`https://studio.weddyzone.example/select/${sel.publicToken}`)
  expect(full).not.toMatch(/localhost|127\.0\.0\.1/)
  await dialog.getByTestId('copy-message').click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(full)
  const sent = context.waitForEvent('page')
  await dialog.getByRole('button', { name: 'Send on WhatsApp' }).click()
  const sentPage = await sent
  expect(new URL(sentPage.url()).searchParams.get('text')).toBe(full)
  await sentPage.close()
  await dialog.getByTestId('copy-link-only').click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`https://studio.weddyzone.example/select/${sel.publicToken}`)
  await dialog.getByTestId('copy-wa-link').click()
  const waLink = await page.evaluate(() => navigator.clipboard.readText())
  expect(waLink).toMatch(/^https:\/\/wa\.me\/\d*\?text=/)
  expect(new URL(waLink).searchParams.get('text')).toBe(full)

  const popup = context.waitForEvent('page')
  await options.getByRole('button', { name: 'Send Web link via WhatsApp' }).click()
  const wa = await popup
  const text = new URL(wa.url()).searchParams.get('text') ?? ''
  expect(text.split('\n')).toContain('https://studio.weddyzone.example/selection/auth')
  expect(text).toContain(`Access code: ${sel.code}`)
  await wa.close()
  expect(await dialog.innerText()).not.toMatch(/localhost/)
})

test('client: a note on a photo reaches the studio; picks beyond the limit are refused with a message', async ({ page }) => {
  const token = await clientToken(page)
  await page.goto(`/select/${sel.publicToken}`)
  await page.getByLabel('Digit 1').click()
  await page.keyboard.type(sel.code)
  await expect(page).toHaveURL(new RegExp(`/selection/${sel.id}$`))
  await page.getByRole('link', { name: /^Open Sangeet/ }).click()

  // Photo Notes: open a photo, write a note, save.
  await page.getByRole('button', { name: 'Open photo 1' }).click()
  await page.getByLabel('Add note').fill('Please brighten this one')
  await page.getByRole('button', { name: 'Save note' }).click()
  await expect(page.getByText('Note saved')).toBeVisible()
  await page.locator('.cp-lb-close').click()
  await expect(page.locator('.cp-lightbox')).toHaveCount(0)

  // The limit is 2: the third pick is refused with a message.
  const select = page.getByRole('button', { name: 'Select photo', exact: true })
  await select.first().click()
  await expect(page.locator('.cp-counter')).toHaveText(/Selected: 1\s*\/ 2/)
  await select.first().click()
  await expect(page.locator('.cp-counter')).toHaveText(/Selected: 2\s*\/ 2/)
  await select.first().click()
  await expect(page.getByText('You can select up to 2 photos')).toBeVisible()
  await expect(page.locator('.cp-counter')).toHaveText(/Selected: 2\s*\/ 2/)
  // The server refuses it too.
  await login(page)
  const photos: { id: string; pickedBy: string[]; comments: { text: string }[] }[] = await (await page.request.get(`/api/v1/selections/${sel.id}/photos`)).json()
  const unpicked = photos.find((p) => p.pickedBy.length === 0)!
  const over = await page.request.patch(`/api/v1/public/selection/${sel.id}/items/${unpicked.id}`, { data: { selected: true }, headers: { 'X-Client-Token': token } })
  expect(over.status()).toBe(409)
  // The studio sees the note.
  expect(photos.flatMap((p) => p.comments.map((c) => c.text))).toContain('Please brighten this one')
  await page.goto(`/photo-selection/${sel.id}`)
  await page.getByTestId('folder-grid').getByRole('button', { name: /Open photo folder Sangeet/ }).click()
  await page.getByRole('tab', { name: 'With notes (1)' }).click()
  await page.getByTestId('folder-photos').locator('.photo-tile').first().click()
  await expect(page.locator('.lb-comments')).toContainText('Please brighten this one')
  await page.keyboard.press('Escape')

  // Submit, for the reset tests.
  expect((await page.request.post(`/api/v1/public/selection/${sel.id}/submit`, { headers: { 'X-Client-Token': token } })).ok()).toBe(true)
})

test('Reset Selection: clicking "Selected" reopens (Pending); a new submit shows Selected again live; Reject all; both logged', async ({ page }) => {
  await login(page)
  await page.goto(`/photo-selection/${sel.id}`)
  const badge = page.locator('.ef-info-end .psx-status')
  await expect(badge).toHaveText('Selected')

  // The "Selected" pill is a button that opens Reset Selection. Shortlist: choose → confirm.
  await expect(badge).toHaveAttribute('title', 'Give the customer another chance to select')
  await badge.click()
  const choose = page.getByRole('dialog', { name: 'Reset Selection' })
  await expect(choose.getByTestId('reset-shortlist')).toBeVisible()
  await expect(choose.getByTestId('reset-reject')).toBeVisible()
  await choose.getByTestId('reset-shortlist').click()
  const confirmShortlist = page.getByRole('dialog', { name: 'Shortlist?' })
  await expect(confirmShortlist).toContainText('2 picks stay selected')
  await confirmShortlist.getByTestId('reset-confirm').click()
  await expect(page.getByText('Selection reopened — 2 picks kept')).toBeVisible()
  await expect(badge).toHaveText('Pending')
  await expect(badge).toHaveClass(/pending/)
  await expect(page.locator('.ef-actions .ef-btn', { hasText: /Download Selected \(2\)/ })).toBeDisabled()

  // The customer submits again: the badge turns Selected without a reload.
  const token = await clientToken(page)
  expect((await page.request.post(`/api/v1/public/selection/${sel.id}/submit`, { headers: { 'X-Client-Token': token } })).ok()).toBe(true)
  await expect(badge).toHaveText('Selected', { timeout: 15_000 })

  // Reject all from the Reset Selection button: choose → Back works → choose again → confirm.
  await page.locator('.ef-actions .ef-btn', { hasText: 'Reset Selection' }).click()
  await page.getByTestId('reset-reject').click()
  await page.getByRole('dialog', { name: 'Reject all?' }).getByRole('button', { name: 'Back' }).click()
  await page.getByTestId('reset-reject').click()
  await page.getByRole('dialog', { name: 'Reject all?' }).getByTestId('reset-confirm').click()
  await expect(page.getByText('Selection reset — 0 photos selected')).toBeVisible()
  await expect(badge).toHaveText('Pending')
  await expect(page.locator('.ef-actions .ef-btn', { hasText: /Download Selected \(0\)/ })).toBeVisible()

  // Both are in Client Activity, with the status Pending.
  await page.goto('/')
  const activity = page.getByTestId('client-activity')
  const reopened = activity.getByRole('row').filter({ hasText: customer }).filter({ hasText: 'Selection reopened by studio' })
  await expect(reopened).toHaveCount(2)
  await expect(reopened.first().locator('.db-pill')).toHaveText('Pending')
})

test('upload: rejected files and a failed start show an error toast; counts update when done', async ({ page }) => {
  await login(page)
  await page.goto(`/photo-selection/${sel.id}`)
  await expect(page.getByTestId('event-info')).toContainText('3 Images')

  // Every file is refused by the server: the upload ends with an error toast and Retry.
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const root = mkdtempSync(join(tmpdir(), 'wz-upload-'))
  const folder = join(root, `Mehendi${tag}`)
  mkdirSync(folder)
  writeFileSync(join(folder, 'M1.png'), gradientPng(70, 50, 10, 250))
  writeFileSync(join(folder, 'M2.png'), gradientPng(70, 50, 250, 10))
  await page.route('**/api/v1/selections/*/photos', (r) =>
    r.request().method() === 'POST'
      ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'FILE_INVALID', message: 'Not a supported file', fields: { file: 'Not a supported file' } } }) })
      : r.continue(),
  )
  let chooser = page.waitForEvent('filechooser')
  await page.locator('.ef-actions .ef-btn', { hasText: 'Upload Folder' }).click()
  await (await chooser).setFiles(folder)
  const dialog = page.getByRole('dialog', { name: 'Select Folders to Upload' })
  await dialog.getByTestId('start-upload').click()
  await expect(page.getByText("2 files didn't upload")).toBeVisible()
  await expect(dialog.getByRole('button', { name: /Retry failed/ })).toBeVisible()

  // Retry with the server back: "Uploading X / Y", then the counts on the page update.
  await page.unroute('**/api/v1/selections/*/photos')
  await dialog.getByRole('button', { name: /Retry failed/ }).click()
  await expect(page.getByText('Upload complete')).toBeVisible()
  await expect(page.getByTestId('event-info')).toContainText('5 Images')
  await expect(page.getByTestId('event-info')).toContainText('2 Folders')

  // The folder can't even be created: Start Upload fails with an error toast.
  const again = join(root, `Haldi${tag}`)
  mkdirSync(again)
  writeFileSync(join(again, 'H1.png'), gradientPng(66, 44, 120, 40))
  await page.route('**/api/v1/selections/*/folders', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 500, body: 'boom' }) : r.continue()))
  chooser = page.waitForEvent('filechooser')
  await page.locator('.ef-actions .ef-btn', { hasText: 'Upload Folder' }).click()
  await (await chooser).setFiles(again)
  await dialog.getByTestId('start-upload').click()
  await expect(page.getByText(/file didn't upload/)).toBeVisible()
  await expect(dialog).toContainText('H1.png')
  rmSync(root, { recursive: true, force: true })
})
