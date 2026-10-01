import { expect, type Page } from '@playwright/test'

export const DEMO = { email: 'hello@goldenhour.studio', password: 'Golden@2026' }

export async function login(page: Page, email = DEMO.email, password = DEMO.password) {
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}
