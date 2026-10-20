import { expect, test, type Page } from '@playwright/test'
import { DEMO } from './helpers'

// Public site: the hero with the Create your studio card; the top menu opens panels under the
// header (desktop) or a drawer with accordions and a Login sheet (phones); old links open Home
// with their panel; prices for 1, 6 or 12 months; no sideways scroll.

const noSidewaysScroll = async (page: Page, label: string) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, label).toBeLessThanOrEqual(0)
}
const card = (page: Page) => page.getByRole('region', { name: 'Create your studio' })

test('home: one h1, the hero with its card, sections, footer; alt text; no sideways scroll', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Let the couple pick their favorites effortlessly')
  await expect(page).toHaveTitle(/Photo selection for wedding studios/)
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /Photo selection/)
  await expect(card(page)).toBeVisible()
  await expect(card(page).getByRole('radio', { name: 'Trial' })).toHaveAttribute('aria-checked', 'true')
  await expect(card(page).getByText('14-day free trial · no card needed')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible()
  await expect(page.locator('#about')).toBeAttached()
  await expect(page.getByText('brandlift123@gmail.com').first()).toBeAttached()
  for (const img of await page.locator('img').all()) expect(await img.getAttribute('alt')).not.toBeNull()
  await noSidewaysScroll(page, '/')

  // Start Free Trial puts the cursor in the card's first field; Login → opens the Login panel.
  await page.getByRole('button', { name: /^Start Free Trial/ }).click()
  await expect(card(page).getByLabel('Your name')).toBeFocused()
  await page.getByRole('button', { name: 'Login →' }).click()
  await expect(page.getByRole('dialog', { name: 'Log in' })).toBeVisible()
})

test('Watch demo: beside Start Free Trial (same height); plays YouTube in a popup that closes and stops it', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !/status of 401/.test(m.text()) && errors.push(m.text()))
  // No network to YouTube in tests: a stand-in page.
  await page.route('https://www.youtube-nocookie.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>player</p>' }))
  await page.goto('/')
  const demo = page.getByRole('button', { name: 'Watch demo video' })
  await expect(demo).toContainText('Watch demo')
  await expect(demo).toContainText('2 min · how it works')
  // Read every position in one go, once the hero has settled.
  await page.evaluate(() => document.fonts.ready)
  const [a, b, login] = await page.evaluate(() =>
    ['.pub-actions .pub-btn', '.pub-demo-btn', '.pub-hero-login'].map((s) => document.querySelector(s)!.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number }),
  )
  if (page.viewportSize()!.width > 640) {
    expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1) // same row
    expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1) // same height
    expect(b.x).toBeGreaterThan(a.x + a.width)
  } else {
    expect(b.y).toBeGreaterThan(a.y + a.height - 1) // stacked, Start Free Trial first
    expect(Math.round(b.width)).toBe(Math.round(a.width)) // both full width
  }
  // The Login link stays on the line below the buttons.
  expect(login.y).toBeGreaterThanOrEqual(Math.max(a.y + a.height, b.y + b.height) - 1)
  // No player until it's opened.
  await expect(page.locator('iframe[title="Wedmanage demo"]')).toHaveCount(0)

  await demo.click()
  const popup = page.getByRole('dialog', { name: 'Wedmanage demo' })
  const frame = popup.locator('iframe[title="Wedmanage demo"]')
  await expect(frame).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/TD5uY9BHh8U?autoplay=1&rel=0&modestbranding=1&playsinline=1')
  await expect(frame).toHaveAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen')
  const box = await frame.boundingBox()
  expect(Math.abs(box!.width / box!.height - 16 / 9)).toBeLessThan(0.02)
  expect(box!.width).toBeLessThanOrEqual(900)
  // The page doesn't scroll behind it.
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden')
  // Esc closes it, removes the player and gives focus back to the button.
  await page.keyboard.press('Escape')
  await expect(popup).toHaveCount(0)
  await expect(page.locator('iframe[title="Wedmanage demo"]')).toHaveCount(0)
  await expect(demo).toBeFocused()
  // ✕ and a click outside close it too.
  await demo.click()
  await popup.getByRole('button', { name: 'Close video' }).click()
  await expect(popup).toHaveCount(0)
  await demo.click()
  await expect(frame).toBeVisible()
  await page.mouse.click(5, page.viewportSize()!.height - 5)
  await expect(popup).toHaveCount(0)
  await noSidewaysScroll(page, 'demo')
  expect(errors).toEqual([])
})

test('pricing: 1, 6 or 12 months with the new prices and savings', async ({ page }) => {
  await page.goto('/')
  const plans = page.getByTestId('public-plans')
  await expect(plans.locator('article')).toHaveCount(3)
  await expect(page.locator('#pricing').getByRole('tab')).toHaveText(['1 month', '6 months', '1 year'])
  await expect(page.getByTestId('public-plan-PRO').locator('.pub-price')).toContainText('₹600')
  await expect(page.getByTestId('public-plan-ALL_ACCESS').locator('.pub-price')).toContainText('₹1,200')
  await page.locator('#pricing').getByRole('tab', { name: '6 months' }).click()
  await expect(page.getByTestId('public-plan-PRO')).toContainText('₹3,000')
  await expect(page.getByTestId('public-plan-PRO')).toContainText('Save 17%')
  await page.locator('#pricing').getByRole('tab', { name: '1 year' }).click()
  await expect(page.getByTestId('public-plan-PRO')).toContainText('₹5,000')
  await expect(page.getByTestId('public-plan-ALL_ACCESS')).toContainText('₹10,000')
  await expect(page.getByTestId('public-plan-ALL_ACCESS')).toContainText('Save 31%')
  // Choose VIP: the card switches to VIP for a year, with its price, and the first field is focused.
  await page.getByTestId('public-plan-ALL_ACCESS').getByRole('button', { name: /Choose/ }).click()
  await expect(card(page).getByRole('radio', { name: 'VIP' })).toHaveAttribute('aria-checked', 'true')
  await expect(card(page).getByLabel('Billing period')).toHaveValue('YEARLY')
  await expect(card(page)).toContainText('₹10,000 + GST')
  await expect(card(page).getByText('14-day free trial · no card needed')).toHaveCount(0)
  await expect(card(page).getByLabel('Your name')).toBeFocused()
})

test.describe('desktop menu', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name === 'mobile', 'desktop only'))

  test('About Us and Plans & Pricing open panels under the header; no Start free trial in the header', async ({ page }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav.getByRole('button', { name: /Start free trial/i })).toHaveCount(0)
    await expect(nav.getByRole('button')).toHaveText([/About Us/, /Plans & Pricing/, /Login/])
    const about = nav.getByRole('button', { name: 'About Us' })

    // Hover opens after a short delay; the caret item says it's expanded.
    await about.hover()
    const aboutPanel = page.locator('#pub-panel-about')
    await expect(aboutPanel).toBeVisible()
    await expect(about).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByTestId('about-detail')).toContainText('Our story')
    await aboutPanel.getByRole('menuitem', { name: /Contact/ }).hover()
    await expect(page.getByTestId('about-detail')).toContainText('WhatsApp: 97867 55777')
    // Moving away closes it (after the grace period).
    await page.mouse.move(600, 700)
    await expect(aboutPanel).toBeHidden()
    expect(new URL(page.url()).pathname).toBe('/')

    // Click opens Plans & Pricing (1 / 6 / 12 months); Esc closes and focus returns.
    const pricing = nav.getByRole('button', { name: 'Plans & Pricing' })
    await pricing.click()
    const pricePanel = page.locator('#pub-panel-pricing')
    await expect(pricePanel).toBeVisible()
    await expect(pricePanel.getByRole('tab')).toHaveText(['1 month', '6 months', '1 year'])
    await expect(page.getByTestId('menu-plans').locator('article')).toHaveCount(3)
    await expect(page.getByTestId('menu-plan-PRO')).toContainText('₹600')
    await pricePanel.getByRole('tab', { name: '1 year' }).click()
    await expect(page.getByTestId('menu-plan-PRO')).toContainText('₹5,000')
    await expect(page.getByTestId('menu-plan-PRO')).toContainText('Save 31%')
    await page.keyboard.press('Escape')
    await expect(pricePanel).toBeHidden()
    await expect(pricing).toBeFocused()

    // Compare all plans scrolls to the full pricing section.
    await pricing.click()
    await page.getByRole('button', { name: 'Compare all plans →' }).click()
    await expect(pricePanel).toBeHidden()
    await expect(page.locator('#pricing')).toBeInViewport()

    // Choose Pro in the panel: the card switches to Pro and gets the cursor.
    await pricing.click()
    await page.getByTestId('menu-plan-PRO').getByRole('button', { name: /Choose/ }).click()
    await expect(pricePanel).toBeHidden()
    await expect(card(page).getByRole('radio', { name: 'Pro' })).toHaveAttribute('aria-checked', 'true')
    await expect(card(page).getByLabel('Your name')).toBeFocused()
    // Switch back to Trial on the card.
    await card(page).getByRole('radio', { name: 'Trial' }).click()
    await expect(card(page).getByText('14-day free trial · no card needed')).toBeVisible()
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

  test('old links open Home with their panel; /signup focuses the card with the linked plan', async ({ page }) => {
    await page.goto('/about')
    await expect(page.locator('#pub-panel-about')).toBeVisible()
    await page.goto('/pricing')
    await expect(page.locator('#pub-panel-pricing')).toBeVisible()
    await page.goto('/login')
    await expect(page.getByRole('dialog', { name: 'Log in' })).toBeVisible()
    await page.goto('/signup?plan=ALL_ACCESS&months=12')
    await expect(card(page).getByRole('radio', { name: 'VIP' })).toHaveAttribute('aria-checked', 'true')
    await expect(card(page).getByLabel('Billing period')).toHaveValue('YEARLY')
    await expect(card(page).getByLabel('Your name')).toBeFocused()
    for (const path of ['/about', '/pricing', '/login', '/signup']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Let the couple pick their favorites')
      await noSidewaysScroll(page, path)
    }
  })
})

test.describe('phone menu', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'mobile', 'phone only'))

  test('☰ drawer with accordions and no Start free trial; Choose goes to the card; Login as a bottom sheet', async ({ page }) => {
    await page.goto('/')
    // The card stacks under the hero buttons, full width.
    const hero = await page.getByRole('button', { name: /^Start Free Trial/ }).boundingBox()
    const box = await card(page).boundingBox()
    expect(box!.y).toBeGreaterThan(hero!.y)
    expect(box!.width).toBeGreaterThan(340)

    await page.getByRole('button', { name: 'Open menu' }).click()
    const drawer = page.getByRole('dialog', { name: 'Menu' })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('button', { name: /Start free trial/i })).toHaveCount(0)
    await drawer.getByRole('button', { name: 'About Us' }).click()
    await expect(drawer.getByTestId('about-detail')).toContainText('Our story')
    await drawer.getByRole('button', { name: 'Plans & Pricing' }).click()
    await expect(drawer.getByTestId('menu-plans').locator('article')).toHaveCount(3)
    await noSidewaysScroll(page, 'drawer')
    await drawer.getByTestId('menu-plan-PRO').getByRole('button', { name: /Choose/ }).click()
    await expect(drawer).toBeHidden()
    await expect(card(page).getByRole('radio', { name: 'Pro' })).toHaveAttribute('aria-checked', 'true')
    await expect(card(page).getByLabel('Your name')).toBeFocused()
    await expect(card(page)).toBeInViewport()

    await page.getByRole('button', { name: 'Login →' }).click()
    const sheet = page.getByRole('dialog', { name: 'Log in' })
    await expect(sheet).toBeVisible()
    await noSidewaysScroll(page, 'sheet')
    await sheet.getByRole('button', { name: 'Close' }).click()
    await expect(sheet).toBeHidden()
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
