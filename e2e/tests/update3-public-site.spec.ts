import { expect, test, type Page } from '@playwright/test'
import { DEMO } from './helpers'

// Public site: the top menu opens panels under the header (desktop) or a drawer with accordions
// and bottom sheets (phones); old links open Home with their panel; no sideways scroll.

const noSidewaysScroll = async (page: Page, label: string) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, label).toBeLessThanOrEqual(0)
}

test('home: one h1, meta, sections, footer; every image has alt text; no sideways scroll', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(page).toHaveTitle(/Photo selection for wedding studios/)
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /Photo selection/)
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible()
  await expect(page.locator('#about')).toBeAttached()
  await expect(page.getByTestId('public-plans').locator('article')).toHaveCount(3)
  await expect(page.getByText('[Owner to add]').first()).toBeAttached()
  for (const img of await page.locator('img').all()) expect(await img.getAttribute('alt')).not.toBeNull()
  await noSidewaysScroll(page, '/')
})

test.describe('desktop menu', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name === 'mobile', 'desktop only'))

  test('About Us and Plans & Pricing open panels under the header without leaving the page', async ({ page }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Main' })
    const about = nav.getByRole('button', { name: 'About Us' })

    // Hover opens after a short delay; the caret item says it's expanded.
    await about.hover()
    const aboutPanel = page.locator('#pub-panel-about')
    await expect(aboutPanel).toBeVisible()
    await expect(about).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByTestId('about-detail')).toContainText('Our story')
    await aboutPanel.getByRole('menuitem', { name: /Contact/ }).hover()
    await expect(page.getByTestId('about-detail')).toContainText('WhatsApp: [Owner to add]')
    // Moving away closes it (after the grace period).
    await page.mouse.move(600, 600)
    await expect(aboutPanel).toBeHidden()
    expect(new URL(page.url()).pathname).toBe('/')

    // Click opens Plans & Pricing; only one panel at a time; Esc closes and focus returns.
    const pricing = nav.getByRole('button', { name: 'Plans & Pricing' })
    await pricing.click()
    const pricePanel = page.locator('#pub-panel-pricing')
    await expect(pricePanel).toBeVisible()
    await expect(page.getByTestId('menu-plans').locator('article')).toHaveCount(3)
    await expect(page.getByTestId('menu-plan-PRO')).toContainText('Most popular')
    const monthly = await page.getByTestId('menu-plan-PRO').locator('.pub-mini-price').textContent()
    await pricePanel.getByRole('tab', { name: '1 year' }).click()
    await expect(page.getByTestId('menu-plan-PRO').locator('.pub-mini-price')).not.toHaveText(monthly ?? '')
    await page.keyboard.press('Escape')
    await expect(pricePanel).toBeHidden()
    await expect(pricing).toBeFocused()

    // Compare all plans scrolls to the full pricing section.
    await pricing.click()
    await page.getByRole('button', { name: 'Compare all plans →' }).click()
    await expect(page.locator('#pub-panel-pricing')).toBeHidden()
    await expect(page.locator('#pricing')).toBeInViewport()

    // Choose Pro: the sign-up panel shows Pro; a click outside closes it.
    await pricing.click()
    await page.getByTestId('menu-plan-PRO').getByRole('button', { name: /Choose/ }).click()
    const trial = page.getByRole('dialog', { name: 'Start free trial' })
    await expect(trial).toBeVisible()
    await expect(trial.getByTestId('signup-plan')).toContainText('Pro')
    await page.mouse.click(10, 500)
    await expect(trial).toBeHidden()
    // The header button is the Trial plan.
    await nav.getByRole('button', { name: 'Start free trial' }).click()
    await expect(page.getByRole('dialog', { name: 'Start free trial' }).getByTestId('signup-plan')).toContainText('Trial')
    await page.getByRole('dialog', { name: 'Start free trial' }).getByRole('button', { name: 'Log in' }).click()
    await expect(page.getByRole('dialog', { name: 'Log in' })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/')
  })

  test('Login panel: show/hide password, errors inside, forgot password and back; then log in to the dashboard', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Login' }).click()
    const panel = page.getByRole('dialog', { name: 'Log in' })
    // The panel takes focus; Tab moves into its fields and stays inside.
    await expect(panel).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(panel.getByRole('button', { name: 'Close' })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(panel.getByRole('button', { name: 'Start free trial' })).toBeFocused()
    await panel.getByRole('textbox', { name: 'Password', exact: true }).fill('secret12')
    await panel.getByRole('button', { name: 'Show password' }).click()
    await expect(panel.getByRole('textbox', { name: 'Password', exact: true })).toHaveAttribute('type', 'text')
    // Typed in: moving the mouse away doesn't close it.
    await page.mouse.move(400, 700)
    await page.waitForTimeout(500)
    await expect(panel).toBeVisible()
    await panel.getByLabel('Email or mobile number').fill('12345')
    await panel.getByRole('button', { name: /Log in/ }).click()
    await expect(panel.getByText('Enter a valid email or 10-digit mobile number')).toBeVisible()

    await panel.getByRole('button', { name: 'Forgot password?' }).click()
    await expect(panel.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Send reset link' })).toBeVisible()
    await panel.getByRole('button', { name: '← Back to login' }).click()

    await panel.getByLabel('Email or mobile number').fill(DEMO.email)
    await panel.getByRole('textbox', { name: 'Password', exact: true }).fill(DEMO.password)
    await panel.getByRole('button', { name: /Log in/ }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  })

  test('old links open Home with their panel', async ({ page }) => {
    await page.goto('/about')
    await expect(page.locator('#pub-panel-about')).toBeVisible()
    await page.goto('/pricing')
    await expect(page.locator('#pub-panel-pricing')).toBeVisible()
    await page.goto('/login')
    await expect(page.getByRole('dialog', { name: 'Log in' })).toBeVisible()
    await page.goto('/signup?plan=ALL_ACCESS&months=12')
    await expect(page.getByRole('dialog', { name: 'Start free trial' }).getByTestId('signup-plan')).toContainText('1 year')
    for (const path of ['/about', '/pricing', '/login', '/signup']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toContainText('favorites')
      await noSidewaysScroll(page, path)
    }
  })
})

test.describe('phone menu', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'mobile', 'phone only'))

  test('☰ drawer with accordions; Login and Start free trial as bottom sheets; no sideways scroll', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Open menu' }).click()
    const drawer = page.getByRole('dialog', { name: 'Menu' })
    await expect(drawer).toBeVisible()
    await drawer.getByRole('button', { name: 'About Us' }).click()
    await expect(drawer.getByTestId('about-detail')).toContainText('Our story')
    await drawer.getByRole('button', { name: 'Plans & Pricing' }).click()
    await expect(drawer.getByTestId('menu-plans').locator('article')).toHaveCount(3)
    await noSidewaysScroll(page, 'drawer')
    await drawer.getByTestId('menu-plan-PRO').getByRole('button', { name: /Choose/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Start free trial' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByTestId('signup-plan')).toContainText('Pro')
    await noSidewaysScroll(page, 'sheet')
    await sheet.getByRole('button', { name: 'Log in' }).click()
    await expect(page.getByRole('dialog', { name: 'Log in' })).toBeVisible()
    await page.getByRole('dialog', { name: 'Log in' }).getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('dialog', { name: 'Log in' })).toBeHidden()

    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Login' }).click()
    await expect(page.getByRole('dialog', { name: 'Log in' })).toBeVisible()
  })

  test('old links: About and Pricing scroll to their section, Login opens the sheet', async ({ page }) => {
    await page.goto('/about')
    await expect(page.locator('#about')).toBeInViewport()
    await page.goto('/pricing')
    await expect(page.locator('#pricing')).toBeInViewport()
    await page.goto('/login')
    await expect(page.getByRole('dialog', { name: 'Log in' }).getByLabel('Email or mobile number')).toBeVisible()
    for (const path of ['/', '/about', '/pricing', '/login', '/signup']) {
      await page.goto(path)
      await noSidewaysScroll(page, path)
    }
  })
})

test('/forgot-password still works as its own page', async ({ page }) => {
  await page.goto('/forgot-password')
  await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Back to login' })).toHaveAttribute('href', '/login')
})
