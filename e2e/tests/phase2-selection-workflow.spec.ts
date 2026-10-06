import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { gradientPng } from '../../apps/api/src/common/png'
import { login, uniqueTag } from './helpers'

// One couple flows through the whole studio → client → studio loop. Desktop and mobile runs share
// the database, so names carry a per-run tag.
const tag = uniqueTag()
const couple = `Meena ${tag}`
const eventTitle = `${couple} & Ravi Wedding`

/** The page's width fits the viewport: nothing makes the whole page scroll sideways. */
async function expectNoSideScroll(page: Page) {
  const [doc, win] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  expect(doc).toBeLessThanOrEqual(win)
}

const photo = (name: string, hue: number) => ({ name, mimeType: 'image/png', buffer: gradientPng(60, 40, hue, hue) })

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  // WhatsApp opens in a new tab; don't hit the real site in tests.
  await context.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>WhatsApp</p>' }))
})

let selectionUrl = ''
let galleryLink = ''

test('Add Photo Selection: Event Details validates, then adds the event at the top', async ({ page }) => {
  await login(page)
  await page.goto('/photo-selection')
  const totalEvents = page.locator('.pl-tile', { hasText: 'Total Events' }).locator('strong')
  await expect(totalEvents).not.toHaveText('')
  const before = Number((await totalEvents.innerText()).replace(/,/g, ''))
  await page.getByRole('button', { name: 'Add Photo Selection' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Event Details' })

  await dialog.getByRole('button', { name: 'Add Event' }).click()
  await expect(dialog.getByText('Customer name is required')).toBeVisible()
  await expect(dialog.getByText('Event name is required')).toBeVisible()
  await expect(dialog.getByText('Enter the selection limit')).toBeVisible()
  await dialog.getByLabel('Customer Phone Number').fill('12345')
  await dialog.getByRole('button', { name: 'Add Event' }).click()
  await expect(dialog.getByText('Enter a valid 10-digit Indian mobile number')).toBeVisible()

  await dialog.getByLabel('Customer Name').fill(couple)
  await dialog.getByLabel('Customer Phone Number').fill('98450 11223')
  await dialog.getByLabel('Event Name').fill(eventTitle)
  await dialog.getByLabel(/Selection Limit/).fill('2')
  await dialog.getByRole('button', { name: 'Add Event' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText(/Event added · code \d{6}/)).toBeVisible()

  const top = page.getByTestId('selections-table').locator('tbody tr').first()
  await expect(top).toContainText(couple)
  await expect(top).toContainText(eventTitle)
  await expect(top.locator('.pl-status')).toHaveText('Pending')
  await expect(top.locator('.pl-chip')).toHaveText(['0 Folders', '0 Images', '0 Selected', '0 Videos'])
  await expect(top.locator('.pl-code-num')).toHaveText(/^\d{6}$/)
  // Clicking the code copies it.
  await top.locator('.pl-code-num').click()
  await expect(page.getByText('Code copied')).toBeVisible()
  const [doc, win] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  expect(doc).toBeLessThanOrEqual(win)
  await expect(totalEvents).toHaveText(String(before + 1))
})

test('studio: upload folders, block a duplicate, set a PIN, share', async ({ page }) => {
  // Two folders on disk: "Wedding" (2 photos + a stray text file) and "Haldi" (1 photo).
  const root = mkdtempSync(join(tmpdir(), 'wz-folders-'))
  const wedding = join(root, 'Wedding')
  const haldi = join(root, 'Haldi')
  mkdirSync(wedding)
  mkdirSync(haldi)
  for (const [dir, f] of [
    [wedding, photo('DSC_0001.png', 10)],
    [wedding, photo('DSC_0002.png', 90)],
    [haldi, photo('DSC_0003.png', 170)],
  ] as const)
    writeFileSync(join(dir, f.name), f.buffer)
  writeFileSync(join(wedding, 'notes.txt'), 'hello')
  await login(page)
  await page.goto('/photo-selection')
  const row = page.getByTestId('selections-table').locator('tbody tr', { hasText: couple })
  await row.getByRole('link', { name: `Upload & Download: ${eventTitle}` }).click()
  await expect(page).toHaveURL(/\/photo-selection\/[0-9a-f-]{36}$/)
  selectionUrl = page.url()
  await expect(page.getByText('No folders yet — click Upload Folder')).toBeVisible()
  await expect(page.getByTestId('event-info')).toContainText(`Customer : ${couple}`)

  // Upload Folder opens the dialog and the folder picker together.
  let chooser = page.waitForEvent('filechooser')
  await page.locator('.ef-actions .ef-btn', { hasText: 'Upload Folder' }).click()
  await (await chooser).setFiles(wedding)
  const dialog = page.getByRole('dialog', { name: 'Select Folders to Upload' })
  await expect(dialog.getByText('Albums (1)')).toBeVisible()
  await expect(dialog.getByTestId('selected-folders')).toContainText('Wedding')
  await expect(dialog.getByTestId('selected-folders')).toContainText('2 files') // the text file is ignored
  chooser = page.waitForEvent('filechooser')
  await dialog.getByRole('button', { name: 'Add Photo Folder' }).click()
  await (await chooser).setFiles(haldi)
  await expect(dialog.getByText('Albums (2)')).toBeVisible()
  await dialog.getByTestId('start-upload').click()
  await expect(page.getByText('Upload complete')).toBeVisible()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('folder-grid').getByRole('button', { name: /Open photo folder Wedding, 2 images/ })).toBeVisible()
  await expect(page.getByTestId('folder-grid').getByRole('button', { name: /Open photo folder Haldi, 1 images/ })).toBeVisible()
  await expect(page.getByTestId('event-info')).toContainText('2 Folders')
  await expect(page.getByTestId('event-info')).toContainText('3 Images')

  // The same folder again is blocked.
  chooser = page.waitForEvent('filechooser')
  await page.locator('.ef-actions .ef-btn', { hasText: 'Upload Folder' }).click()
  await (await chooser).setFiles(haldi)
  // The duplicate is refused with a message naming the folder.
  const refused = page.locator('[data-sonner-toast]', { hasText: 'A folder with this name already exists' }).first()
  await expect(refused).toBeVisible()
  await expect(refused).toContainText('Haldi')
  await expect(dialog.getByText('Albums (0)')).toBeVisible()
  await expect(dialog.getByTestId('start-upload')).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // A folder opens its photos.
  await page.getByTestId('folder-grid').getByRole('button', { name: /Open photo folder Wedding/ }).click()
  await expect(page.getByTestId('folder-photos').locator('.photo-tile')).toHaveCount(2)
  await page.getByRole('button', { name: 'All folders' }).click()
  await expectNoSideScroll(page)

  // Settings page: notes on (they start off), then Share & activity → a PIN, QR, copy link.
  await page.locator('.ef-actions .ef-btn', { hasText: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Photo Selection Settings' })).toBeVisible()
  await page.locator('.ss-pill', { hasText: 'Photo Notes' }).click()
  await expect(page.getByTestId('photoNotes')).toBeChecked()
  await page.getByRole('button', { name: /Share & activity/ }).click()
  const settings = page.getByRole('dialog', { name: 'Share & activity' })
  await settings.getByRole('tab', { name: /Share & PIN/ }).click()
  await expect(settings.locator('.sw-qr img')).toBeVisible()
  await settings.getByLabel('PIN', { exact: true }).fill('4321')
  await settings.getByRole('button', { name: 'Set PIN' }).click()
  await expect(page.getByText(/PIN saved/)).toBeVisible()
  await settings.getByRole('button', { name: 'Copy link' }).click()
  await expect(page.getByText('Gallery link copied')).toBeVisible()
  galleryLink = await page.evaluate(() => navigator.clipboard.readText())
  expect(galleryLink).toMatch(/\/s\/[\w-]+$/)
  await settings.getByRole('button', { name: 'Close' }).click()
  rmSync(root, { recursive: true, force: true })
})

test('studio: Send/Share sends the code and the /select link on WhatsApp, then shows Shared', async ({ page, context }) => {
  await login(page)
  await page.goto('/photo-selection')
  const row = page.getByRole('row', { name: new RegExp(couple) })
  // Copying the gallery link in the previous test already counted as sharing.
  await expect(row.locator('.pl-status')).toHaveText('Shared')
  await row.getByRole('button', { name: /^Send code/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Send/Share' })
  await expect(dialog.locator('.sh-card')).toHaveCount(4)
  const code = await dialog.getByTestId('share-code').innerText()
  expect(code).toMatch(/^\d{6}$/)
  const popup = context.waitForEvent('page')
  await dialog.getByRole('button', { name: 'Send on WhatsApp' }).click()
  const wa = await popup
  const url = new URL(wa.url())
  expect(url.pathname).toBe('/919845011223')
  const text = url.searchParams.get('text') ?? ''
  expect(text).toContain(`Access code: ${code}`)
  // The link has a line of its own, so WhatsApp makes it tappable.
  expect(text.split('\n').some((l) => /^https?:\/\/\S+\/select\/[\w-]+$/.test(l))).toBe(true)
  await wa.close()
  await expect(page.getByText('Opening WhatsApp…').first()).toBeVisible()
  await dialog.getByRole('button', { name: 'Show QR Code' }).click()
  await expect(dialog.locator('.sw-qr img')).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(row.locator('.pl-status')).toHaveText('Shared')
})

test('client: PIN, folders, hearts up to the limit, a note, review and submit', async ({ page, context }) => {
  const client = await context.newPage()
  await client.goto(galleryLink)
  await expect(client.getByRole('heading', { name: eventTitle })).toBeVisible()
  await client.getByRole('textbox', { name: 'PIN' }).fill('1111')
  await expect(client.getByRole('alert')).toContainText('Wrong PIN. 4 tries left.')
  await client.getByRole('textbox', { name: 'PIN' }).fill('4321')
  await expect(client.getByTestId('client-counter')).toHaveText('0 / 2 picked')
  await expectNoSideScroll(client)

  // Folder tabs: Haldi holds one photo.
  const folders = client.getByRole('navigation', { name: 'Folders' })
  await folders.getByRole('button', { name: /Haldi/ }).click()
  await expect(client.locator('.cg-tile')).toHaveCount(1)
  await folders.getByRole('button', { name: /All/ }).click()

  await client.getByRole('button', { name: 'Heart DSC_0001.png' }).click()
  await expect(client.getByTestId('client-counter')).toHaveText('1 / 2 picked')
  await client.getByRole('button', { name: 'Heart DSC_0002.png' }).click()
  await expect(client.getByTestId('client-counter')).toHaveText('2 / 2 picked')
  await expect(client.getByTestId('quota-lock')).toBeVisible()
  // A third heart is refused: the counter can't pass the limit.
  await client.getByRole('button', { name: 'Heart DSC_0003.png' }).click()
  await expect(client.getByText(/picked all 2 photos/).first()).toBeVisible()
  await expect(client.getByTestId('client-counter')).toHaveText('2 / 2 picked')

  // A note on a picked photo.
  await client.getByRole('button', { name: 'Open DSC_0001.png' }).click()
  await client.getByRole('textbox', { name: 'Note for your photographer' }).fill('Please brighten this one')
  await client.getByRole('button', { name: 'Add note' }).click()
  await expect(client.getByText('Note added')).toBeVisible()
  await client.getByRole('button', { name: 'Close', exact: true }).click()

  await client.getByTestId('review-button').click()
  await expect(client.getByRole('heading', { name: 'Review your picks' })).toBeVisible()
  await expect(client.locator('.cg-tile')).toHaveCount(2)
  await client.getByRole('button', { name: 'Submit 2' }).click()
  await client.getByTestId('confirm-ok').click()
  await expect(client.getByText(/Your selection was submitted/)).toBeVisible()
  await expect(client.getByRole('button', { name: /^Heart / })).toHaveCount(0)
  await client.close()
})

test('studio: dashboard shows the client activity and the event in Recent Events', async ({ page }) => {
  await login(page)
  await page.goto('/')
  const activity = page.getByTestId('client-activity')
  await expect(activity).toContainText(couple)
  // A table row per action: client, action, event, time and the status pill.
  const submitted = activity.getByRole('row').filter({ hasText: couple }).filter({ has: page.getByRole('cell', { name: 'Submitted', exact: true }) })
  await expect(submitted.first().locator('.db-pill')).toHaveText('Selected')
  await expect(page.getByTestId('stat-cards').getByRole('link', { name: /^Total Events: / })).toBeVisible()
  const row = page.getByTestId('recent-events').getByRole('row', { name: new RegExp(eventTitle) })
  await expect(row.locator('.db-pill')).toHaveText('Selected')
  await expect(row.getByRole('link', { name: /^#\d{6}$/})).toBeVisible()
  await expectNoSideScroll(page)
  await row.getByRole('cell', { name: eventTitle }).click()
  await expect(page).toHaveURL(selectionUrl)
})

test('studio: submitted → download picks (no ZIP), unlock with a reason, resubmitted → delivered, reset refused', async ({ page }) => {
  await login(page)
  await page.goto(selectionUrl)
  await page.locator('.ef-actions .ef-btn', { hasText: 'Settings' }).click()
  await page.getByRole('button', { name: /Share & activity/ }).click()
  const settings = page.getByRole('dialog', { name: 'Share & activity' })
  await settings.getByRole('tab', { name: /Picks & activity/ }).click()
  await expect(settings.getByText('2 of 2 picked. The client submitted their selection.')).toBeVisible()

  // "Download picked photos" opens Download Selected (originals into a folder, never a ZIP).
  await expect(settings.getByRole('link', { name: /ZIP/ })).toHaveCount(0)
  await settings.getByRole('button', { name: 'Download picked photos' }).click()
  const get = page.getByRole('dialog', { name: 'Get selected files' })
  await expect(get.getByTestId('download-from-cloud')).toContainText('Full-quality originals, into a folder')
  await get.getByRole('button', { name: 'Close' }).click()

  // Unlock, logged with the reason.
  await settings.getByLabel('Reason to unlock').fill('Swap one photo')
  await settings.getByRole('button', { name: /Unlock/ }).click()
  await expect(page.getByText(/Unlocked — the client can change/)).toBeVisible()
  await expect(settings.locator('.sw-log')).toContainText('Unlocked — Swap one photo')
  await expect(settings.locator('.sw-log')).toContainText('Submitted')
  await settings.getByRole('button', { name: 'Close' }).click()

  // The client submits again (through the API: PIN → key → submit); without the key it's refused.
  const token = galleryLink.split('/s/')[1]
  expect((await page.request.get(`/api/v1/public/selections/${token}`, { failOnStatusCode: false })).status()).toBe(403)
  const { key } = await (await page.request.post(`/api/v1/public/selections/${token}/pin`, { data: { pin: '4321' } })).json()
  const view = await (await page.request.get(`/api/v1/public/selections/${token}`, { headers: { 'X-Gallery-Key': key } })).json()
  await page.request.post(`/api/v1/public/selections/${token}/submit`, { data: { memberId: view.members[0].id }, headers: { 'X-Gallery-Key': key } })

  // Still on the settings page.
  await page.reload()
  await page.getByRole('button', { name: /Share & activity/ }).click()
  await settings.getByRole('tab', { name: /Picks & activity/ }).click()
  await settings.getByRole('button', { name: /Mark delivered/ }).click()
  await page.getByTestId('confirm-ok').click()
  await expect(settings.getByText(/Delivered\./)).toBeVisible()
  await settings.getByRole('button', { name: 'Close' }).click()
  // A delivered selection's picks are final.
  await page.getByRole('link', { name: /Back to folders/ }).click()
  await expect(page.locator('.ef-actions .ef-btn', { hasText: 'Reset Selection' })).toBeDisabled()
})

test('studio defaults apply to new selections', async ({ page }) => {
  await login(page)
  await page.goto('/photo-selection')
  const card = page.locator('.sw-defaults')
  await card.getByRole('button', { name: /Edit/ }).click()
  await card.getByText('Watermark previews').click()
  await card.getByLabel('Gallery stays open for (days)').fill('21')
  await card.getByRole('button', { name: 'Save defaults' }).click()
  await expect(page.getByText('Studio defaults saved')).toBeVisible()
  await expect(page.getByTestId('defaults-summary')).toContainText('gallery open 21 days')
  // Put it back for the other project's run.
  await card.getByRole('button', { name: /Edit/ }).click()
  await card.getByText('Watermark previews').click()
  await card.getByLabel('Gallery stays open for (days)').fill('30')
  await card.getByRole('button', { name: 'Save defaults' }).click()
  await expect(page.getByTestId('defaults-summary')).toContainText('gallery open 30 days')
})

test('Digital Album is gone from the studio app; old links land on the dashboard', async ({ page }) => {
  await login(page)
  await expect(page.locator('aside nav').getByText('Digital Album')).toHaveCount(0)
  await page.goto('/digital-album')
  await expect(page).toHaveURL(/\/$/)
})
