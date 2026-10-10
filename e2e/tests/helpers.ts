import { expect, type Page } from '@playwright/test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Where the e2e API server saves console-mode emails (MAIL_OUTBOX_DIR in playwright.config.ts). */
const OUTBOX = resolve(__dirname, '../../apps/api/e2e-mail')

/** The newest email sent to `to`, or null if none has arrived yet. */
export function latestMailTo(to: string): { to: string; subject: string; text: string } | null {
  if (!existsSync(OUTBOX)) return null
  const mails = readdirSync(OUTBOX)
    .sort()
    .reverse()
    .map((f) => JSON.parse(readFileSync(join(OUTBOX, f), 'utf8')) as { to: string; subject: string; text: string })
  return mails.find((m) => m.to === to) ?? null
}

export const DEMO = { email: 'hello@goldenhour.studio', password: 'Golden@2026' }

/**
 * Letters-only tag unique to this moment. The desktop and mobile projects share one database,
 * so data a test saves must not collide with what the other project saved earlier in the run.
 */
export function uniqueTag(): string {
  return Date.now().toString(26).replace(/\d/g, (d) => 'qrstuvwxyz'[Number(d)])
}

/** Signs up a brand-new studio (on the Starter trial) and lands on its dashboard. */
export async function signupStudio(page: Page, email = `studio.${Date.now()}@example.com`, password = 'Fresh2026x') {
  await page.goto('/signup')
  await page.getByLabel('Studio name').fill('Fresh Frames')
  await page.getByLabel('Your name').fill('Asha Menon')
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByLabel('Mobile number').fill('98400 33445')
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password)
  await page.getByRole('button', { name: 'Start free trial' }).click()
  await expect(page).toHaveURL(/\/$/)
  return { email, password }
}

export async function login(page: Page, email = DEMO.email, password = DEMO.password) {
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}
