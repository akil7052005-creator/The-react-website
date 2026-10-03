import { expect, test, type Page } from '@playwright/test'
import { gradientPng } from '../../apps/api/src/common/png'
import { login, uniqueTag } from './helpers'

// One couple flows through the whole studio → client → studio loop. Desktop and mobile runs share
// the database, so names carry a per-run tag.
const tag = uniqueTag()
const couple = `Meena ${tag}`
const eventTitle = `${couple} & Ravi Wedding`

function isoInDays(n: number) {
  const d = new Date(Date.now() + n * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d)
}

async function pickOption(page: Page, inputId: string, text: string, option: string | RegExp) {
  await page.locator(`#${inputId}`).fill(text)
  await page.getByRole('option', { name: option }).first().click()
}

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

test('create an event with a new client inline', async ({ page }) => {
  await login(page)
  await page.goto('/photo-selection')
  await page.getByRole('button', { name: 'Add Photo Selection' }).click()
  const selectionDialog = page.getByRole('dialog', { name: 'New Selection' })
  await selectionDialog.getByRole('button', { name: '+ New event' }).click()
  const dialog = page.getByRole('dialog', { name: 'New Event' })

  await dialog.getByRole('button', { name: 'Create event' }).click()
  await expect(dialog.getByText('Select a client')).toBeVisible()
  await expect(dialog.getByText('Event title is required')).toBeVisible()

  await page.locator('#f-clientId').fill(couple)
  await page.getByRole('option', { name: `+ Create new client “${couple}”` }).click()
  const clientDialog = page.getByRole('dialog', { name: 'New client' })
  await clientDialog.getByLabel('Mobile number').fill('98450 11223')
  await clientDialog.getByRole('button', { name: 'Create client' }).click()
  await expect(page.getByText(`Client ${couple} created`)).toBeVisible()

  await dialog.getByLabel('Event title').fill(eventTitle)
  await dialog.getByLabel('Event date').fill(isoInDays(20))
  await dialog.getByLabel('Venue').fill('Lotus Mahal')
  await pickOption(page, 'f-city', 'Chennai', 'Chennai')
  await dialog.getByRole('button', { name: 'Create event' }).click()
  await expect(page.getByText(/Event EVT-\d+ created/)).toBeVisible()
  // The new event is picked straight away, with its type and date shown.
  await expect(selectionDialog.getByText(eventTitle)).toBeVisible()
  await expect(selectionDialog.getByTestId('event-facts')).toContainText('Wedding')
  await selectionDialog.getByRole('button', { name: 'Cancel' }).click()
  await page.getByTestId('confirm-ok').click()
  await expect(selectionDialog).toHaveCount(0)
})

test('studio: create with a PIN, upload into folders, share', async ({ page }) => {
  await login(page)
  await page.goto('/photo-selection')
  await page.getByRole('button', { name: 'Add Photo Selection' }).click()
  const dialog = page.getByRole('dialog', { name: 'New Selection' })
  await pickOption(page, 'f-eventId', couple, new RegExp(couple))
  await dialog.getByLabel('Photo limit').fill('2')
  await dialog.getByLabel('Gallery expires on').fill(isoInDays(10))
  await dialog.getByLabel('4-digit PIN (optional)').fill('12')
  await dialog.getByRole('button', { name: 'Create & add photos' }).click()
  await expect(dialog.getByText('The PIN must be 4 digits')).toBeVisible()
  await dialog.getByLabel('4-digit PIN (optional)').fill('4321')
  await dialog.getByRole('button', { name: 'Create & add photos' }).click()
  await expect(page.getByText(/Selection SEL-\d+ created/)).toBeVisible()

  // Lands on the event page with the uploader open.
  await expect(page).toHaveURL(/\/photo-selection\/[0-9a-f-]{36}\?upload=1$/)
  selectionUrl = page.url().split('?')[0]
  await expect(page.getByRole('heading', { level: 1, name: eventTitle })).toBeVisible()
  await expect(page.getByTestId('selection-status')).toHaveText('Draft')
  await expect(page.getByTestId('picked-counter')).toHaveText('0 / 2 picked')

  await page.getByLabel('Choose photos to upload').setInputFiles([
    photo('DSC_0001.png', 10),
    photo('DSC_0002.png', 90),
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
  ])
  await expect(page.locator('.uploader-summary')).toContainText('2 done · 1 failed')
  await expect(page.getByText('Only JPEG, PNG or WebP images')).toBeVisible()
  await expect(page.getByTestId('selection-status')).toHaveText('Uploading')

  // A Haldi folder, and a photo uploaded straight into it.
  await page.getByRole('button', { name: 'New folder' }).click()
  await page.getByRole('dialog', { name: 'New folder' }).getByRole('button', { name: /Haldi/ }).click()
  await expect(page.getByText('Folder Haldi created')).toBeVisible()
  await expect(page.locator('.sw-folder.on')).toContainText('Haldi')
  await expect(page.getByText('Uploading into')).toContainText('Haldi')
  await page.getByLabel('Choose photos to upload').setInputFiles([photo('DSC_0003.png', 170)])
  await expect(page.locator('.sw-folder', { hasText: 'Haldi' })).toContainText('1')
  // The same bytes again are skipped as a duplicate.
  await page.getByLabel('Choose photos to upload').setInputFiles([photo('copy.png', 10)])
  await expect(page.getByText('Already uploaded').first()).toBeVisible()
  await page.locator('.sw-folder', { hasText: 'All' }).click()
  await expect(page.locator('.sw-grid .photo-tile')).toHaveCount(3)
  await expectNoSideScroll(page)

  // Share: QR, copy link → Shared.
  await page.locator('.sw-tabs button', { hasText: 'Share' }).click()
  await expect(page.locator('.sw-qr img')).toBeVisible()
  await page.getByRole('button', { name: 'Copy link' }).click()
  await expect(page.getByText('Gallery link copied')).toBeVisible()
  galleryLink = await page.evaluate(() => navigator.clipboard.readText())
  expect(galleryLink).toMatch(/\/s\/[\w-]+$/)
  await expect(page.getByTestId('selection-status')).toHaveText('Shared')
})

test('studio: a reminder from the list opens WhatsApp and uses a credit', async ({ page, context }) => {
  await login(page)
  await page.goto('/photo-selection')
  const credits = Number((await page.getByTestId('credit-chip').locator('span').innerText()).replace(/,/g, ''))
  const row = page.getByRole('row', { name: new RegExp(couple) })
  await expect(row.getByText('Shared')).toBeVisible()
  await row.getByRole('button', { name: /^Send / }).click()
  const popup = context.waitForEvent('page')
  await page.getByTestId('confirm-ok').click()
  const wa = await popup
  await wa.waitForURL(/^https:\/\/wa\.me\/919845011223\?text=/)
  await wa.close()
  await expect(page.getByTestId('credit-chip')).toContainText((credits - 1).toLocaleString('en-IN'))
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

test('studio: dashboard shows the submitted picks and client activity', async ({ page }) => {
  await login(page)
  await page.goto('/')
  await expect(page.getByTestId('needs-attention')).toContainText(`${couple} submitted their picks`)
  await expect(page.getByTestId('client-activity')).toContainText(couple)
  await expect(page.getByRole('link', { name: 'Create bill' })).toBeVisible()
  await expectNoSideScroll(page)
  await page.getByTestId('needs-attention').getByRole('link', { name: new RegExp(`${couple} submitted`) }).click()
  await expect(page).toHaveURL(selectionUrl)
})

test('studio: submitted → ZIP, unlock with a reason, resubmitted → delivered', async ({ page }) => {
  await login(page)
  await page.goto(selectionUrl)
  await expect(page.getByTestId('selection-status')).toHaveText('Submitted')
  await expect(page.getByTestId('picked-counter')).toHaveText('2 / 2 picked')

  // ZIP of the picks downloads.
  await page.getByRole('button', { name: /Export/ }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'ZIP of picked photos' }).click()
  expect((await download).suggestedFilename()).toMatch(/^SEL-\d+-.*-picked\.zip$/)

  // Unlock (logged with the reason), then deliver after the client submits again.
  await page.getByRole('button', { name: /More/ }).click()
  await page.getByRole('menuitem', { name: 'Unlock selection' }).click()
  await page.getByLabel('Reason (for the change log)').fill('Swap one photo')
  await page.getByRole('dialog').getByRole('button', { name: /Unlock/ }).click()
  await expect(page.getByTestId('selection-status')).toHaveText('In progress')
  await page.locator('.sw-tabs button', { hasText: 'Activity' }).click()
  await expect(page.locator('.sw-log')).toContainText('Unlocked — Swap one photo')
  await expect(page.locator('.sw-log')).toContainText('Submitted')

  // The client submits again (through the API: PIN → key → submit); without the key it's refused.
  const token = galleryLink.split('/s/')[1]
  expect((await page.request.get(`/api/v1/public/selections/${token}`, { failOnStatusCode: false })).status()).toBe(403)
  const { key } = await (await page.request.post(`/api/v1/public/selections/${token}/pin`, { data: { pin: '4321' } })).json()
  const view = await (await page.request.get(`/api/v1/public/selections/${token}`, { headers: { 'X-Gallery-Key': key } })).json()
  await page.request.post(`/api/v1/public/selections/${token}/submit`, { data: { memberId: view.members[0].id }, headers: { 'X-Gallery-Key': key } })

  await page.reload()
  await expect(page.getByTestId('selection-status')).toHaveText('Submitted')
  await page.getByRole('button', { name: /More/ }).click()
  await page.getByRole('menuitem', { name: 'Mark delivered' }).click()
  await page.getByTestId('confirm-ok').click()
  await expect(page.getByTestId('selection-status')).toHaveText('Delivered')
})

test('studio defaults apply to new selections', async ({ page }) => {
  await login(page)
  await page.goto('/photo-selection')
  await page.getByRole('button', { name: 'Edit' }).click()
  const card = page.locator('.sw-defaults')
  await card.getByText('Watermark previews').click()
  await card.getByLabel('Gallery stays open for (days)').fill('21')
  await card.getByRole('button', { name: 'Save defaults' }).click()
  await expect(page.getByText('Studio defaults saved')).toBeVisible()
  await expect(page.getByTestId('defaults-summary')).toContainText('gallery open 21 days')
  // Put it back for the other project's run.
  await page.getByRole('button', { name: 'Edit' }).click()
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
