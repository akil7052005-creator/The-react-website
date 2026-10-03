import { defineConfig, devices } from '@playwright/test'

// E2E runs against its own database and ports so it never touches dev data:
//   API  → http://localhost:4100 (DATABASE_URL = E2E_DATABASE_URL, reset + seeded in global-setup)
//   Web  → http://localhost:5174 (Vite, proxying /api to 4100)
// E2E_WEB_PORT moves the web server off 5174 when a dev server already uses it.
const WEB_PORT = process.env.E2E_WEB_PORT ?? '5174'
const WEB = `http://localhost:${WEB_PORT}`
const E2E_DB = process.env.E2E_DATABASE_URL ?? 'postgresql://weddyzone@localhost:5433/weddyzone_e2e?schema=public'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './global-setup.ts',
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: false, hasTouch: true } },
  ],
  webServer: [
    {
      // Separate output folder so a running dev server (which runs from dist/) is left alone.
      command: 'cd ../apps/api && npx tsc -p tsconfig.build.json --outDir dist-e2e && node dist-e2e/main.js',
      url: 'http://localhost:4100/api/v1/health',
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        PORT: '4100',
        DATABASE_URL: E2E_DB,
        UPLOAD_DIR: './e2e-uploads',
        MAIL_OUTBOX_DIR: './e2e-mail',
        APP_URL: WEB,
        CORS_ORIGINS: WEB,
        RATE_LIMIT_AUTH_PER_MIN: '1000',
        RATE_LIMIT_PUBLIC_PER_MIN: '5000',
        NODE_ENV: 'development',
        // No hourly job during the run: its emails would land in the outbox the tests read.
        JOBS_ENABLED: 'false',
      },
    },
    {
      command: `cd ../apps/web && npx vite --port ${WEB_PORT} --strictPort`,
      url: WEB,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_DEV_API_PROXY: 'http://localhost:4100' },
    },
  ],
})
