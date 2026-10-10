import { expect, test, type Browser, type Page } from '@playwright/test'
import { login, uniqueTag } from './helpers'

// The demo seed's platform admin (development / e2e only; production admins come from `admin:create`).
const ADMIN = { email: 'admin@weddyzone.app', password: 'Admin@2026' }

test.describe.configure({ mode: 'serial' })

async function studioPage(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await login(page)
  return page
}

test('studio users cannot see the admin area', async ({ page }) => {
  await login(page)
  await page.goto('/admin/plans')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Plans' })).toHaveCount(0)
})

test('an admin answers a studio ticket from the support inbox', async ({ page, browser }) => {
  // A studio raises a ticket.
  const subject = `Album export question ${uniqueTag()}`
  const studio = await studioPage(browser)
  const created = await studio.request.post('/api/v1/tickets', {
    multipart: { subject, category: 'TECHNICAL', priority: 'HIGH', description: 'How do I export a finished album as PDF?' },
  })
  expect(created.ok()).toBeTruthy()

  // The admin signs in and lands in the admin area, not a studio dashboard.
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'Email' }).fill(ADMIN.email)
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(ADMIN.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('heading', { name: 'Subscriptions dashboard' })).toBeVisible()
  await page.goto('/admin/tickets')
  await expect(page.getByRole('heading', { name: 'Support inbox' })).toBeVisible()

  await page.getByRole('searchbox', { name: 'Search tickets' }).fill(subject)
  await page.getByRole('cell', { name: subject, exact: true }).click()
  const thread = page.getByRole('dialog', { name: new RegExp(subject) })
  await thread.getByLabel(/^Reply as Wedmanage Support/).fill('Open the album, then use Export → PDF.')
  await thread.getByRole('button', { name: 'Send reply' }).click()
  await expect(page.getByText('Reply sent to the studio')).toBeVisible()
  await thread.getByLabel('Ticket status').selectOption('RESOLVED')
  await expect(page.getByText('Marked resolved')).toBeVisible()

  // The studio sees the reply.
  await studio.goto('/support')
  await studio.getByRole('cell', { name: subject }).click()
  await expect(studio.getByText('Open the album, then use Export → PDF.')).toBeVisible()
})

test('an admin publishes an FAQ that studios see in their Help Center', async ({ page, browser }) => {
  const question = `How do I share a gallery with grandparents ${uniqueTag()}?`
  await login(page, ADMIN.email, ADMIN.password)
  await page.goto('/admin/help')
  await page.getByRole('button', { name: 'Add FAQ' }).click()
  const form = page.getByRole('dialog', { name: 'Add an FAQ' })
  await form.getByLabel(/^Category/).selectOption('Selections & albums')
  await form.getByLabel(/^Question/).fill(question)
  await form.getByLabel(/^Answer/).fill('Forward the private album link on WhatsApp. No login is needed.')
  await form.getByRole('button', { name: 'Add FAQ' }).click()
  await expect(page.getByText('FAQ added')).toBeVisible()
  await expect(page.getByRole('cell', { name: question, exact: true })).toBeVisible()

  const studio = await studioPage(browser)
  await studio.goto('/help')
  await studio.getByLabel('Search help articles').fill('grandparents')
  await expect(studio.getByText(question)).toBeVisible()
})

test('an admin edits a plan and studios see it on the pricing page', async ({ page, browser }) => {
  const tagline = `For new photographers ${uniqueTag()}`
  await login(page, ADMIN.email, ADMIN.password)
  await page.goto('/admin/plans')
  await page.getByRole('button', { name: 'Edit Trial' }).click()
  const form = page.getByRole('dialog', { name: 'Edit Trial' })
  await form.getByLabel('Tagline').fill(tagline)
  await form.getByRole('button', { name: 'Save plan' }).click()
  await expect(page.getByText('Trial saved')).toBeVisible()

  const studio = await studioPage(browser)
  await studio.goto('/subscriptions')
  await expect(studio.getByText(tagline)).toBeVisible()

  // Admins sign out from the admin area (on a phone the sidebar is behind the menu button).
  const menu = page.getByRole('button', { name: 'Open menu' })
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('link', { name: 'Log out' }).click()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
})
