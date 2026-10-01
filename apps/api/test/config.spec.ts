import { config, resetConfigCache } from '../src/config'

describe('production config guard', () => {
  const saved = { ...process.env }
  const live = {
    NODE_ENV: 'production',
    APP_URL: 'https://studio.weddyzone.app',
    CORS_ORIGINS: 'https://studio.weddyzone.app',
    COOKIE_SECURE: 'true',
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    JWT_REFRESH_SECRET: 'b'.repeat(64),
    RESEND_API_KEY: 're_test_key',
    MAIL_FROM: 'Weddyzone Studio <no-reply@mail.weddyzone.app>',
    SMTP_HOST: '',
  }

  afterEach(() => {
    process.env = { ...saved }
    resetConfigCache()
  })

  const load = (env: Record<string, string>) => {
    process.env = { ...saved, ...live, ...env }
    resetConfigCache()
    return () => config()
  }

  it('accepts a live https setup', () => {
    expect(load({})()).toMatchObject({ NODE_ENV: 'production', TRUST_PROXY_HOPS: 1, FEATURE_FACE_RECOGNITION: false })
  })

  it.each([
    ['CORS_ORIGINS', 'http://localhost:5173'],
    ['CORS_ORIGINS', 'https://studio.weddyzone.app,http://localhost:5173'],
    ['APP_URL', 'http://localhost:5173'],
    ['COOKIE_SECURE', 'false'],
    ['JWT_ACCESS_SECRET', 'change-me-access-secret-at-least-32-chars'],
    ['RESEND_API_KEY', ''],
    ['MAIL_FROM', ''],
  ])('refuses %s=%s', (key, value) => {
    expect(load({ [key]: value })).toThrow(new RegExp(key))
  })

  it('keeps development defaults working outside production', () => {
    expect(load({ NODE_ENV: 'development', CORS_ORIGINS: 'http://localhost:5173', COOKIE_SECURE: 'false' })().NODE_ENV).toBe('development')
  })
})
