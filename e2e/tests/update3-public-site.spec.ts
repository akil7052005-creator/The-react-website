import { expect, test } from '@playwright/test'

test('public site: home, about, pricing with period switch; menu and footer; no sideways scroll', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(page).toHaveTitle(/Photo selection for wedding studios/)
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /Photo selection/)
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible()
  await expect(page.getByText('[Owner to add]').first()).toBeAttached()

  const nav = page.getByRole('navigation', { name: 'Main' })
  const burger = page.getByRole('button', { name: 'Open menu' })
  if (await burger.isVisible()) await burger.click()
  await nav.getByRole('link', { name: 'Plans & Pricing' }).click()
  await expect(page).toHaveURL(/\/pricing/)
  await expect(page.getByRole('heading', { level: 1, name: 'Plans & Pricing' })).toBeVisible()
  await expect(page.getByTestId('public-plan-PRO')).toContainText('Most popular')
  await page.getByRole('tab', { name: '1 year' }).click()
  await expect(page).toHaveURL(/months=12/)
  await expect(page.getByTestId('public-plan-PRO').getByRole('link', { name: /Choose Pro/ })).toHaveAttribute('href', '/signup?plan=PRO&months=12')

  await page.goto('/about')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('About')
  await expect(page.getByText('[Owner to write]').first()).toBeVisible()

  for (const path of ['/', '/about', '/pricing', '/login']) {
    await page.goto(path)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, path).toBeLessThanOrEqual(0)
    for (const img of await page.locator('img').all()) expect(await img.getAttribute('alt'), path).not.toBeNull()
  }
})

test('login: email or phone field, show/hide password, forgot password, start free trial', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByLabel('Email or mobile number')).toBeVisible()
  await page.getByLabel('Password').fill('secret12')
  await page.getByRole('button', { name: 'Show password' }).click()
  await expect(page.getByLabel('Password')).toHaveAttribute('type', 'text')
  await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Start free trial' })).toHaveAttribute('href', '/signup')
  await page.getByLabel('Email or mobile number').fill('12345')
  await page.getByRole('button', { name: /Log in/ }).click()
  await expect(page.getByText('Enter a valid email or 10-digit mobile number')).toBeVisible()
})
