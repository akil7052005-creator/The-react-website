import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { configureApp } from './app.setup'
import { config } from './config'

async function bootstrap() {
  const c = config()
  // rawBody: payment webhooks are verified against the exact bytes the gateway signed.
  const app = await NestFactory.create(AppModule, { bodyParser: true, rawBody: true })
  // Behind Railway/Render/Vercel proxies the client IP (for rate limiting) is in X-Forwarded-For.
  app.getHttpAdapter().getInstance().set('trust proxy', c.TRUST_PROXY_HOPS)
  configureApp(app)
  await app.listen(c.PORT)
  Logger.log(`API on http://localhost:${c.PORT}/api/v1${c.NODE_ENV === 'production' ? '' : ' · docs at /api/docs'}`, 'Bootstrap')
}

void bootstrap()
