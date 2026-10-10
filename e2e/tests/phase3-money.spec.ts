import { expect, test, type Page } from '@playwright/test'
import { login, signupStudio } from './helpers'

test.describe.configure({ mode: 'serial' })

async function pickOption(page: Page, inputId: string, text: string, option: string | RegExp) {
  await page.locator(`#${inputId}`).fill(text)
  await page.getByRole('option', { name: option }).first().click()
}

test.beforeEach(async ({ context }) => {
  await context.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>WhatsApp</p>' }))
})

test('create a GST invoice, record a payment, mark it paid and print it', async ({ page, context }) => {
  await login(page)
  await page.goto('/billing')
  await page.getByRole('button', { name: 'Create Invoice' }).click()
  const dialog = page.getByRole('dialog', { name: 'Create GST Invoice' })

  await pickOption(page, 'f-clientId', 'Ananya', /Ananya Iyer/)
  await dialog.getByLabel(/^Item 1/).fill('Reception coverage')
  await dialog.getByLabel(/^Rate/).fill('100000')
  // Karnataka client, Tamil Nadu studio → IGST.
  await pickOption(page, 'f-placeOfSupply', 'Karnataka', 'Karnataka')
  await expect(dialog.getByTestId('igst')).toHaveText('₹18,000')
  await expect(dialog.getByTestId('grand-total')).toHaveText('₹1,18,000')
  await dialog.getByRole('button', { name: 'Split 30/30/40' }).click()
  await dialog.getByRole('button', { name: 'Create invoice' }).click()

  const created = page.getByText(/Invoice INV-\d{4}-\d{4} created/)
  await expect(created).toBeVisible()
  const number = (await created.innerText()).match(/INV-\d{4}-\d{4}/)![0]
  const row = page.getByRole('row', { name: new RegExp(number) })
  await expect(row).toContainText('₹1,18,000')
  await expect(row).toContainText('Pending')

  await row.getByRole('button', { name: `Record payment for ${number}` }).click()
  const pay = page.getByRole('dialog', { name: `Record payment · ${number}` })
  await pay.getByLabel(/^Amount received/).fill('35400')
  await pay.getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByText(`Payment recorded on ${number} · ₹82,600 still due`)).toBeVisible()

  await row.getByRole('button', { name: `More actions for ${number}` }).click()
  const detail = page.getByRole('dialog', { name: `Invoice ${number}` })
  await detail.getByRole('button', { name: 'Mark paid' }).click()
  await page.getByTestId('confirm-ok').click()
  await expect(page.getByText(`Invoice ${number} marked as paid`)).toBeVisible()
  await expect(detail.getByText('Paid').first()).toBeVisible()

  const popup = context.waitForEvent('page')
  await detail.getByRole('button', { name: 'Print / PDF' }).click()
  const print = await popup
  await expect(print.getByRole('heading', { name: 'Tax Invoice' })).toBeVisible()
  await expect(print.getByText('Inter-state (IGST)')).toBeVisible()
  await expect(print.getByText('Rupees One Lakh Eighteen Thousand Only')).toBeVisible()
})

test('buy WhatsApp credits in test mode', async ({ page }) => {
  await login(page)
  await page.goto('/whatsapp-credit')
  const before = Number((await page.getByTestId('credit-balance').innerText()).replace(/,/g, ''))
  await page.getByRole('button', { name: '500 credits for ₹399' }).click()
  await page.getByRole('button', { name: 'Buy 500 Credits for ₹399' }).click()
  await expect(page.getByText('Test mode, no real charge').first()).toBeVisible()
  await page.getByTestId('confirm-ok').click()
  await expect(page.getByText('500 credits added')).toBeVisible()
  await expect(page.getByTestId('credit-balance')).toHaveText((before + 500).toLocaleString('en-IN'))
  await expect(page.getByTestId('credit-chip')).toContainText((before + 500).toLocaleString('en-IN'))
})

test('upgrade to VIP yearly, then cancel and resume', async ({ page }) => {
  // A fresh trial studio, so the run on the other viewport (same database) can't have upgraded it already.
  await signupStudio(page)
  await page.goto('/subscriptions?months=12')
  await page.getByRole('button', { name: 'Choose VIP' }).click()
  // ₹49,999 + 18% GST
  await expect(page.getByText(/₹58,998\.82/).last()).toBeVisible()
  await page.getByTestId('confirm-ok').click()
  await expect(page.getByText("You're now on the VIP plan")).toBeVisible()
  await expect(page.getByRole('button', { name: 'Active Studio Plan' })).toBeDisabled()

  await page.goto('/my-subscription')
  await expect(page.getByRole('heading', { name: /VIP Studio Plan/ })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel plan' }).click()
  const dialog = page.getByRole('dialog', { name: /Cancel your VIP plan/ })
  await dialog.getByRole('button', { name: 'Cancel plan' }).click()
  await expect(dialog.getByText('Tell us why you are cancelling')).toBeVisible()
  await dialog.getByLabel(/Why are you cancelling/).selectOption('NOT_ENOUGH_WORK')
  await dialog.getByRole('button', { name: 'Cancel plan' }).click()
  await expect(page.getByText(/VIP will end on/)).toBeVisible()
  await page.getByRole('button', { name: 'Resume my plan' }).click()
  await expect(page.getByText('VIP will renew as usual')).toBeVisible()
})
