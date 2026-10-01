import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

// Rate limits are read when the decorators load, so this file sets strict
// limits before importing the app (jest gives each test file a fresh module registry).
describe('Rate limiting', () => {
  let app: INestApplication

  beforeAll(async () => {
    process.env.RATE_LIMIT_AUTH_PER_MIN = '3'
    process.env.RATE_LIMIT_PUBLIC_PER_MIN = '4'
    const { resetConfigCache } = await import('../src/config')
    resetConfigCache()
    const { createTestApp } = await import('./helpers')
    ;({ app } = await createTestApp())
  })
  afterAll(() => app?.close())

  it('limits login attempts per minute', async () => {
    const server = app.getHttpServer()
    const statuses: number[] = []
    for (let i = 0; i < 5; i++) {
      const res = await request(server).post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'Wrong1234' })
      statuses.push(res.status)
      if (res.status === 429) expect(res.body).toEqual({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a minute and try again.' } })
    }
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401])
    expect(statuses.slice(3)).toEqual([429, 429])
  })

  // Each auth route has its own counter; the guard runs before validation, so invalid bodies still count.
  it.each([
    ['signup', '/api/v1/auth/signup', {}],
    ['forgot password', '/api/v1/auth/forgot-password', { email: 'not-an-email' }],
    ['reset password', '/api/v1/auth/reset-password', { token: 'x', password: 'short', confirmPassword: 'short' }],
  ])('limits %s attempts per minute', async (_name, path, body) => {
    const server = app.getHttpServer()
    const statuses: number[] = []
    for (let i = 0; i < 5; i++) statuses.push((await request(server).post(path).send(body)).status)
    expect(statuses.slice(0, 3).every((s) => s !== 429)).toBe(true)
    expect(statuses.slice(3)).toEqual([429, 429])
  })

  it('limits public pages', async () => {
    const server = app.getHttpServer()
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) statuses.push((await request(server).get('/api/v1/public/selections/not-a-token')).status)
    expect(statuses.filter((s) => s === 404)).toHaveLength(4)
    expect(statuses.filter((s) => s === 429)).toHaveLength(2)
  })
})
