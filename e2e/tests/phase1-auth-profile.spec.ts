import { expect, test } from '@playwright/test'
import { DEMO, latestMailTo, login, uniqueTag } from './helpers'

test('deep links redirect to login, then back after logging in', async ({ page }) => {
  await page.goto('/profile')
  await expect(page).toHaveURL(/\/login\?next=%2Fprofile/)
  await page.getByRole('textbox', { name: 'Email' }).fill(DEMO.email)
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(DEMO.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible()
})

test('login shows inline errors for bad input and wrong password', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByText('Email is required')).toBeVisible()
  await page.getByRole('textbox', { name: 'Email' }).fill(DEMO.email)
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('WrongPass1')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.locator('.field-error', { hasText: 'Incorrect email or password' })).toBeVisible()
})

test('log in, edit profile, reset, save, and log out', async ({ page }) => {
  await login(page)
  await page.goto('/profile')
  const form = page.getByTestId('profile-form')
  const save = form.getByRole('button', { name: 'Save changes' })
  await expect(save).toBeDisabled()

  // Invalid GSTIN for Tamil Nadu (33) shows an inline error and keeps Save disabled.
  await form.getByLabel('GSTIN').fill('29ABCDE1234F1Z5')
  await expect(page.getByText(/must start with 33/)).toBeVisible()
  await expect(save).toBeDisabled()

  // Reset restores the saved values.
  await form.getByRole('button', { name: 'Reset' }).click()
  await expect(form.getByLabel('GSTIN')).toHaveValue('33ABCDE1234F1Z5')

  // Unique text: the other viewport's run (same database) may already have saved a bio.
  const bio = `Candid storytellers across South India (${uniqueTag()}).`
  await form.getByLabel('About your studio').fill(bio)
  await expect(save).toBeEnabled()
  await save.click()
  await expect(page.getByText('Profile saved')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('profile-form').getByLabel('About your studio')).toHaveValue(bio)

  await page.goto('/logout')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
})

test('sign up a new studio', async ({ page }) => {
  await page.goto('/signup')
  await page.getByLabel('Studio name').fill('Lotus Frames')
  await page.getByLabel('Your name').fill('Meena Iyer')
  await page.getByRole('textbox', { name: 'Email' }).fill(`meena.${Date.now()}@example.com`)
  await page.getByLabel('Mobile number').fill('98400 11223')
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('Lotus2026')
  await page.getByRole('button', { name: 'Create studio' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText('Studio Starter')).toBeVisible()

  // The 50 trial credits are not flagged as a low balance.
  await page.goto('/whatsapp-credit')
  await expect(page.getByTestId('credit-balance')).toHaveText('50')
  await expect(page.getByText('Ready to send')).toBeVisible()
  await expect(page.getByText('Low balance')).toHaveCount(0)

  // No published albums yet, so the website is still a draft.
  await page.goto('/my-website')
  await expect(page.locator('.stat-card', { hasText: 'Website Status' }).getByText('Draft')).toBeVisible()

  // Until the studio uploads a banner, its public site uses the plain default photo (no promo text).
  const site = await page.getByRole('link', { name: 'Visit Site' }).getAttribute('href')
  await page.goto(site!)
  await expect(page.locator('.site-hero img')).toHaveAttribute('src', /wedding-photo/)
})

test('reset a forgotten password with the emailed link', async ({ page, context }) => {
  const email = `reset.${Date.now()}@example.com`
  await page.goto('/signup')
  await page.getByLabel('Studio name').fill('Reset Frames')
  await page.getByLabel('Your name').fill('Kiran Rao')
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByLabel('Mobile number').fill('98400 22334')
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('Before2026')
  await page.getByRole('button', { name: 'Create studio' }).click()
  await expect(page).toHaveURL(/\/$/)
  await context.clearCookies()

  await page.goto('/forgot-password')
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByText(/a reset link is on its way/)).toBeVisible()

  // Console-mode emails are saved to MAIL_OUTBOX_DIR by the e2e API server.
  await expect.poll(() => latestMailTo(email), { timeout: 10_000 }).not.toBeNull()
  const mail = latestMailTo(email)!
  expect(mail.subject).toBe('Reset your Weddyzone Studio password')
  const link = mail.text.match(/https?:\/\/\S+\/reset-password\?token=\S+/)?.[0]
  expect(link).toBeTruthy()

  await page.goto(link!)
  await page.getByRole('textbox', { name: 'New password', exact: true }).fill('After2026x')
  await page.getByRole('textbox', { name: 'Confirm new password', exact: true }).fill('After2026x')
  await page.getByRole('button', { name: 'Update password' }).click()
  await expect(page).toHaveURL(/\/login/)

  // The link is single use.
  await page.goto(link!)
  await page.getByRole('textbox', { name: 'New password', exact: true }).fill('Again2026x')
  await page.getByRole('textbox', { name: 'Confirm new password', exact: true }).fill('Again2026x')
  await page.getByRole('button', { name: 'Update password' }).click()
  await expect(page).not.toHaveURL(/\/login/)

  await login(page, email, 'After2026x')
  await expect(page).toHaveURL(/\/$/)
})

test('visiting /login while logged in offers the dashboard or a different account', async ({ page }) => {
  await login(page)
  await page.goto('/login')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByTestId('signed-in-notice')).toHaveText("You're logged in as Arjun Mehta (hello@goldenhour.studio)")

  await page.getByRole('link', { name: 'Go to dashboard' }).click()
  await expect(page).toHaveURL(/\/$/)

  await page.goto('/login')
  await page.getByRole('button', { name: 'Log in with a different account' }).click()
  await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible()
  await expect(page.getByTestId('signed-in-notice')).toHaveCount(0)
  // The old session is really gone.
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
})
