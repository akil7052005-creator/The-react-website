import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { resetConfigCache } from '../src/config'
import { createTestApp } from './helpers'

describe('API docs (/api/docs)', () => {
  const saved = { ...process.env }
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
    process.env = { ...saved }
    resetConfigCache()
  })

  it('are served in development', async () => {
    ;({ app } = await createTestApp())
    await request(app.getHttpServer()).get('/api/docs').expect(200)
  })

  it('are not published in production', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      APP_URL: 'https://studio.weddyzone.app',
      CORS_ORIGINS: 'https://studio.weddyzone.app',
      COOKIE_SECURE: 'true',
      JWT_ACCESS_SECRET: 'a'.repeat(64),
      JWT_REFRESH_SECRET: 'b'.repeat(64),
      RESEND_API_KEY: 're_test_key',
      MAIL_FROM: 'Wedmanage Studio <no-reply@mail.weddyzone.app>',
      S3_BUCKET: 'weddyzone-uploads',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
    })
    resetConfigCache()
    ;({ app } = await createTestApp())
    await request(app.getHttpServer()).get('/api/docs').expect(404)
    await request(app.getHttpServer()).get('/api/v1/health').expect(200)
  })
})
