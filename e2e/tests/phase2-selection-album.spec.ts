import { expect, test, type Page } from '@playwright/test'
import { gradientPng } from '../../apps/api/src/common/png'
import { login } from './helpers'

// One couple flows through the whole studio → client → studio loop.
const couple = `Meena ${Date.now().toString().slice(-5)}`

function isoInDays(n: number) {
  const d = new Date(Date.now() + n * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d)
}

async function pickOption(page: Page, inputId: string, text: string, option: string | RegExp) {
  await page.locator(`#${inputId}`).fill(text)
  await page.getByRole('option', { name: option }).first().click()
}

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  // WhatsApp opens in a new tab; don't hit the real site in tests.
  await context.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>WhatsApp</p>' }))
})

test('create an event with a new client inline', async ({ page }) => {
  await login(page)
  await page.getByRole('button', { name: 'New Event' }).click()
  const dialog = page.getByRole('dialog', { name: 'New Event' })

  // Validation first.
  await dialog.getByRole('button', { name: 'Create event' }).click()
  await expect(dialog.getByText('Select a client')).toBeVisible()
  await expect(dialog.getByText('Event title is required')).toBeVisible()

  await page.locator('#f-clientId').fill(couple)
  await page.getByRole('option', { name: `+ Create new client “${couple}”` }).click()
  const clientDialog = page.getByRole('dialog', { name: 'New client' })
  await clientDialog.getByLabel('Mobile number').fill('98450 11223')
  await clientDialog.getByRole('button', { name: 'Create client' }).click()
  await expect(page.getByText(`Client ${couple} created`)).toBeVisible()

  await dialog.getByLabel('Event title').fill(`${couple} & Ravi Wedding`)
  await dialog.getByLabel('Event date').fill(isoInDays(20))
  await dialog.getByLabel('Venue').fill('Lotus Mahal')
  await pickOption(page, 'f-city', 'Chennai', 'Chennai')
  await dialog.getByLabel('Expected guests').fill('300')
  await dialog.getByRole('button', { name: 'Create event' }).click()
  await expect(page.getByText(/Event EVT-\d+ created/)).toBeVisible()
  await expect(page.getByRole('cell', { name: new RegExp(`${couple} & Ravi Wedding`) })).toBeVisible()
})

test('selection: create, upload, share, pick with quota lock, submit', async ({ page, context }) => {
  await login(page)
  await page.goto('/photo-selection')
  await page.getByRole('button', { name: 'New Selection' }).click()
  const dialog = page.getByRole('dialog', { name: 'New Selection' })
  await pickOption(page, 'f-eventId', couple, new RegExp(couple))
  await dialog.getByLabel('Selection quota (photos)').fill('2')
  await dialog.getByRole('button', { name: 'Create & add photos' }).click()
  await expect(page.getByText(/Selection SEL-\d+ created/)).toBeVisible()

  const upload = page.getByRole('dialog', { name: /Add photos to SEL-/ })
  await upload.getByLabel('Choose photos to upload').setInputFiles([
    { name: 'DSC_0001.png', mimeType: 'image/png', buffer: gradientPng(60, 40, 10, 1) },
    { name: 'DSC_0002.png', mimeType: 'image/png', buffer: gradientPng(60, 40, 90, 2) },
    { name: 'DSC_0003.png', mimeType: 'image/png', buffer: gradientPng(60, 40, 170, 3) },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
  ])
  await expect(upload.getByText('3 uploaded · 1 failed')).toBeVisible()
  await expect(upload.getByText('Only JPEG, PNG or WebP images')).toBeVisible()
  // Same bytes again → duplicate rejected by checksum on the server.
  await upload.getByLabel('Choose photos to upload').setInputFiles([{ name: 'copy.png', mimeType: 'image/png', buffer: gradientPng(60, 40, 10, 1) }])
  await expect(upload.getByText('Duplicate photo — already uploaded')).toBeVisible()

  await upload.getByRole('button', { name: 'Copy link' }).click()
  await expect(page.getByText('Selection link copied')).toBeVisible()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(link).toMatch(/\/s\/[\w-]+$/)
  await upload.getByRole('button', { name: 'Done' }).click()

  // Remind from the list: confirm → WhatsApp tab opens → a credit is used.
  const credits = Number((await page.getByTestId('credit-chip').locator('span').innerText()).replace(/,/g, ''))
  const row = page.getByRole('row', { name: new RegExp(couple) })
  await row.getByRole('button', { name: 'Remind' }).click()
  const popup = context.waitForEvent('page')
  await page.getByTestId('confirm-ok').click()
  // The tab opens blank (so popup blockers allow it), then navigates to WhatsApp.
  const wa = await popup
  await wa.waitForURL(/^https:\/\/wa\.me\/919845011223\?text=/)
  await wa.close()
  await expect(page.getByTestId('credit-chip')).toContainText((credits - 1).toLocaleString('en-IN'))

  // The couple's side.
  const client = await context.newPage()
  await client.goto(link)
  await expect(client.getByRole('heading', { name: `${couple} & Ravi Wedding` })).toBeVisible()
  // Uploads run in parallel, so grid order isn't fixed — pick by filename.
  await client.getByRole('button', { name: 'Heart DSC_0001.png' }).click()
  await expect(client.getByText('1 / 2 picked')).toBeVisible()
  await client.getByRole('button', { name: 'Heart DSC_0002.png' }).click()
  await expect(client.getByTestId('quota-lock')).toBeVisible()
  await client.getByRole('button', { name: 'Heart DSC_0003.png' }).click()
  await expect(client.getByText(/picked all 2 photos/).first()).toBeVisible()

  await client.getByRole('button', { name: 'Submit selection' }).click()
  await client.getByTestId('confirm-ok').click()
  await expect(client.getByText(/Your selection was submitted/)).toBeVisible()
  await expect(client.getByRole('button', { name: /^Heart / })).toHaveCount(0)

  // Studio sees it completed, with picks exportable.
  await page.reload()
  await expect(page.getByRole('row', { name: new RegExp(couple) }).getByText('Completed')).toBeVisible()
})

test('album: create from picks, share for review, client feedback and approval', async ({ page, context }) => {
  await login(page)
  await page.goto('/digital-album')
  await page.getByRole('button', { name: 'Create Album' }).click()
  const dialog = page.getByRole('dialog', { name: 'Create Album' })
  await pickOption(page, 'f-eventId', couple, new RegExp(couple))
  await dialog.getByRole('button', { name: 'Create album' }).click()
  await expect(dialog.getByText('Choose at least 2 photos (one spread)')).toBeVisible()
  const tiles = dialog.locator('.photo-grid-pick .photo-tile')
  await expect(tiles).toHaveCount(2) // "Client picks only" shows the 2 picked photos
  await tiles.nth(0).click()
  await tiles.nth(1).click()
  await expect(dialog.getByText('2 pages · 1 spread')).toBeVisible()
  await dialog.getByRole('button', { name: 'Create album' }).click()
  await expect(page.getByText(/Album ALB-\d+ created/)).toBeVisible()

  // The studio viewer opens; send for review, then copy the client link.
  const viewer = page.getByRole('dialog', { name: /flipbook/ })
  await viewer.getByRole('button', { name: 'Send for review' }).click()
  await page.getByTestId('confirm-ok').click()
  await expect(page.getByText(/is now In Review/)).toBeVisible()
  await viewer.getByRole('button', { name: 'Copy link' }).click()
  await expect(page.getByText('Album link copied')).toBeVisible()
  const link = await page.evaluate(() => navigator.clipboard.readText())

  const client = await context.newPage()
  await client.goto(link)
  await expect(client.getByText('Spread 1 of 1 · 2 Curated Photos')).toBeVisible()
  await client.getByLabel('Your name').fill('Meena (Bride)')
  await client.getByLabel('Your note').fill('Please warm up the colours on the right page')
  await client.getByRole('button', { name: 'Send feedback' }).click()
  await expect(client.getByText('Feedback sent for spread 1')).toBeVisible()
  await expect(client.locator('.client-sticky-note')).toContainText('Please warm up the colours')
  await client.getByTestId('approve-spread').click()
  await expect(client.getByTestId('approve-spread')).toHaveText(/Spread Approved/)

  // Studio: note visible and resolvable; the card shows the open note.
  // The open album is kept in the URL, so after a reload the viewer is open again.
  await page.reload()
  await expect(page.getByRole('dialog', { name: /flipbook/ })).toBeVisible()
  await page.getByRole('button', { name: 'Close flipbook' }).click()
  const card = page.getByRole('button', { name: new RegExp(`Open Flipbook for ${couple}`) }).first()
  await expect(card).toContainText('1 note')
  await card.click()
  await page.getByRole('button', { name: 'Mark resolved' }).click()
  await expect(page.getByText('Feedback marked as resolved')).toBeVisible()
})
