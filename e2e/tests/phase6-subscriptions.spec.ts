import { expect, test } from '@playwright/test'
import { login, signupStudio } from './helpers'

const ADMIN = { email: 'admin@weddyzone.app', password: 'Admin@2026' }

test.describe.configure({ mode: 'serial' })

test('a purchase shows up for the admin at once, who can extend its deadline', async ({ page, browser }) => {
  // A studio buys Pro yearly (test-mode gateway → webhook → plan applied).
  const studio = await (await browser.newContext()).newPage()
  const { email } = await signupStudio(studio, `sub.${Date.now()}@example.com`)
  await expect(studio.getByText(/free Trial/i).first()).toBeVisible()
  await studio.goto('/subscriptions?months=12')
  await studio.getByRole('button', { name: 'Choose Pro' }).click()
  await expect(studio.getByText(/₹23,598\.82/).last()).toBeVisible()
  await studio.getByTestId('confirm-ok').click()
  await expect(studio.getByText("You're now on the Pro plan")).toBeVisible()
  await studio.goto('/')
  await expect(studio.getByTestId('usage-meter')).toContainText('Pro')

  // The admin finds it in the table (searching by owner email) and in the alerts.
  await login(page, ADMIN.email, ADMIN.password)
  await page.goto('/admin/subscriptions')
  await page.getByRole('searchbox', { name: 'Search studios' }).fill(email)
  const row = page.getByRole('row', { name: /Fresh Frames/ })
  await expect(row).toHaveCount(1)
  await expect(row.getByRole('cell', { name: 'Pro · Yearly' })).toBeVisible()
  // Admin amounts exclude GST: ₹19,999, not the ₹23,598.82 charged.
  await expect(row.getByRole('cell', { name: '₹19,999' })).toBeVisible()
  await expect(row.getByText('Active')).toBeVisible()
  // The bell opens the alerts; "View all" goes to the full feed.
  await page.getByRole('button', { name: /^Alerts/ }).click()
  await expect(page.getByText(/Fresh Frames chose Pro \(Yearly\)/).first()).toBeVisible()
  await page.getByRole('link', { name: 'View all' }).click()
  await expect(page).toHaveURL(/\/admin\/alerts$/)
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

test('no admin page scrolls sideways at 375, 768 or 1280 px', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password)
  await page.goto('/admin/subscriptions')
  await page.getByRole('searchbox', { name: 'Search studios' }).fill('goldenhour')
  const golden = page.getByRole('link', { name: 'Golden Hour Studios' })
  await expect(golden).toHaveCount(1)
  const detail = (await golden.getAttribute('href'))!
  const pages = ['/admin', '/admin/subscriptions', '/admin/subscriptions?tab=grace', detail, '/admin/alerts', '/admin/settings', '/admin/tickets', '/admin/help', '/admin/plans']
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    for (const path of pages) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await page.waitForLoadState('networkidle')
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, `${path} at ${width}px`).toBe(0)
    }
  }
})

test('the admin is tidy: one nav, four KPIs, filters and row actions tucked away', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password)
  await expect(page.getByRole('heading', { name: 'Subscriptions dashboard' })).toBeVisible()
  // Alerts live behind the bell, not in the sidebar; no "Platform admin" labels, just an Admin badge.
  const nav = page.getByRole('navigation', { name: 'Admin' })
  await expect(nav.getByRole('link', { name: 'Alerts' })).toHaveCount(0)
  // Page content only: the sidebar brand keeps its small 'Platform admin' line.
  await expect(page.getByRole('main').getByText('Platform admin', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/signed in as a platform admin/)).toHaveCount(0)
  await expect(page.locator('.admin-badge')).toHaveText(/Admin/)
  await expect(page.getByText('Amounts exclude GST')).toHaveCount(1)

  // Four KPIs; no "Expiring soon" button or "New vs churned" chart.
  await expect(page.locator('.kpi')).toHaveCount(4)
  await expect(page.getByRole('link', { name: /Expiring soon/ })).toHaveCount(0)
  await expect(page.getByText('New vs churned')).toHaveCount(0)
  await expect(page.getByText('MRR trend')).toBeVisible()
  await expect(page.getByText('Plan split')).toBeVisible()
  await page.getByRole('link', { name: /^Needs attention/ }).click()
  await expect(page).toHaveURL(/tab=attention/)
  await expect(page.getByRole('tab', { name: 'Needs attention' })).toHaveAttribute('aria-selected', 'true')

  // Status filtering is the tabs' job; the rarer filters wait behind "More filters".
  await expect(page.getByLabel('Status')).toHaveCount(0)
  await expect(page.getByLabel('Cycle')).toHaveCount(0)
  await page.getByRole('button', { name: /More filters/ }).click()
  await expect(page.getByLabel('Cycle')).toBeVisible()
  await expect(page.getByLabel('Sort')).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Start' })).toHaveCount(0)

  // One "⋯" menu per row instead of four buttons.
  await page.getByRole('tab', { name: 'All' }).click()
  const menu = page.getByRole('button', { name: /^Actions for / }).first()
  await menu.click()
  const items = page.getByRole('menu').getByRole('menuitem')
  await expect(items).toHaveText([/Send reminder/, /Extend/, /Change plan/, /Cancel/])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await menu.click()
  await page.getByRole('menuitem', { name: /Extend/ }).click()
  await expect(page.getByRole('dialog', { name: 'Extend deadline' })).toBeVisible()
  await page.getByRole('dialog', { name: 'Extend deadline' }).getByRole('button', { name: 'Cancel' }).click()

  // Plan cards list each limit once.
  await page.goto('/admin/plans')
  const studio = page.locator('.card').filter({ has: page.getByRole('heading', { name: /^Studio/ }) })
  await expect(studio.getByText('Team seats: 5')).toBeVisible()
  await expect(studio.getByText('Storage: 2 TB')).toBeVisible()
  await expect(studio.getByText('5 team seats')).toHaveCount(0)
  await expect(studio.getByText('2 TB storage')).toHaveCount(0)
  await expect(studio.getByText('Unlimited events')).toHaveCount(0)
})

test('grace rows show when grace ends, and paid plans link to a printable GST invoice', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password)
  await page.goto('/admin/subscriptions?tab=grace')
  await expect(page.getByRole('columnheader', { name: 'Grace ends (IST)' })).toBeVisible()
  const row = page.getByRole('row', { name: /Moments by Kiran/ })
  await expect(row.getByText(/^Ended (today|\d+d ago)$/)).toBeVisible()
  await expect(row.getByText(/\d{2} \w{3} \d{4}, \d{1,2}:\d{2} (am|pm)/)).toBeVisible()

  // Golden Hour's three demo payments each have an invoice that opens as a printable page.
  await page.goto('/admin/subscriptions')
  await page.getByRole('searchbox', { name: 'Search studios' }).fill('goldenhour')
  const link = page.getByRole('link', { name: 'Golden Hour Studios' })
  await expect(link).toHaveCount(1)
  await link.click()
  const invoices = page.getByRole('link', { name: /^WZ\/\d{4}-\d{2}\/\d{5}$/ })
  await expect(invoices).toHaveCount(3)
  const number = await invoices.first().textContent()
  await invoices.first().click()
  await expect(page.getByRole('heading', { name: 'Tax Invoice' })).toBeVisible()
  await expect(page.getByText(number!, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Print/ })).toBeVisible()
  // WhatsApp credits read as a balance on the detail page, not as a limit; the countdown has no seconds.
  await page.goBack()
  await expect(page.getByText(/used this month · [\d,]+ left in balance/)).toBeVisible()
  await expect(page.getByText(/^(\d+ days?( \d+ hrs?)?|\d+ hrs?( \d+ min)?|\d+ min|under a minute) (left|ago)$/)).toBeVisible()
})
