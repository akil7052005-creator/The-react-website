import { expect, test } from '@playwright/test'
import { DEMO, login } from './helpers'

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

  await form.getByLabel('About your studio').fill('Candid storytellers across South India.')
  await expect(save).toBeEnabled()
  await save.click()
  await expect(page.getByText('Profile saved')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('profile-form').getByLabel('About your studio')).toHaveValue('Candid storytellers across South India.')

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
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByText('Starter plan')).toBeVisible()
})
