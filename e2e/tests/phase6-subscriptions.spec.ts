import { expect, test } from '@playwright/test'
import { login, signupStudio } from './helpers'

const ADMIN = { email: 'admin@weddyzone.app', password: 'Admin@2026' }

test.describe.configure({ mode: 'serial' })

test('a purchase shows up for the admin at once, who can extend its deadline', async ({ page, browser }) => {
  // A studio buys Pro yearly (test-mode gateway → webhook → plan applied).
  const studio = await (await browser.newContext()).newPage()
  const { email } = await signupStudio(studio, `sub.${Date.now()}@example.com`)
  await expect(studio.getByText(/Starter trial/)).toBeVisible()
  await studio.goto('/subscriptions?cycle=yearly')
  await studio.getByRole('button', { name: 'Choose Pro' }).click()
  await expect(studio.getByText(/₹29,488\.20/).last()).toBeVisible()
  await studio.getByTestId('confirm-ok').click()
  await expect(studio.getByText("You're now on the Pro plan")).toBeVisible()
  await studio.goto('/')
  await expect(studio.getByRole('status').filter({ hasText: /Pro · \d+ days left/ })).toBeVisible()

  // The admin finds it in the table (searching by owner email) and in the alerts.
  await login(page, ADMIN.email, ADMIN.password)
  await page.goto('/admin/subscriptions')
  await page.getByRole('searchbox', { name: 'Search studios' }).fill(email)
  const row = page.getByRole('row', { name: /Fresh Frames/ })
  await expect(row).toHaveCount(1)
  await expect(row.getByRole('cell', { name: 'Yearly' })).toBeVisible()
  await expect(row.getByText('Active')).toBeVisible()
  await page.goto('/admin/alerts')
  await expect(page.getByText('Fresh Frames chose Pro (Yearly)').first()).toBeVisible()

  // Extend the deadline from the detail page; the note is required and shows in the timeline.
  await page.goto('/admin/subscriptions')
  await page.getByRole('searchbox', { name: 'Search studios' }).fill(email)
  // Other tests' studios share the name: wait for the (debounced) search to narrow it to this one.
  const link = page.getByRole('link', { name: 'Fresh Frames' })
  await expect(link).toHaveCount(1)
  await link.click()
  await expect(page.getByRole('heading', { name: 'Fresh Frames' })).toBeVisible()
  await page.getByRole('button', { name: 'Extend' }).click()
  const dialog = page.getByRole('dialog', { name: 'Extend deadline' })
  await dialog.getByLabel(/^Add days/).fill('10')
  await dialog.getByRole('button', { name: 'Extend' }).click()
  await expect(dialog.getByText('A note is required')).toBeVisible()
  await dialog.getByLabel(/^Note/).fill('Festival season goodwill')
  await dialog.getByRole('button', { name: 'Extend' }).click()
  await expect(page.getByText('Fresh Frames: deadline extended')).toBeVisible()
  await expect(page.getByText('Extended by admin')).toBeVisible()
  await expect(page.getByText(/Festival season goodwill/)).toBeVisible()
})

test('the admin tabs separate grace and expired studios; studios see why they are read-only', async ({ page, browser }) => {
  await login(page, ADMIN.email, ADMIN.password)
  await page.goto('/admin/subscriptions?tab=grace')
  await expect(page.getByRole('link', { name: 'Moments by Kiran' })).toBeVisible()
  await page.getByRole('tab', { name: 'Expired' }).click()
  await expect(page.getByRole('link', { name: 'Candid Clicks' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Moments by Kiran' })).toHaveCount(0)

  // Non-admins never see any of it.
  const studio = await (await browser.newContext()).newPage()
  await login(studio)
  await studio.goto('/admin/subscriptions')
  await expect(studio.getByRole('heading', { name: 'Page not found' })).toBeVisible()
})
