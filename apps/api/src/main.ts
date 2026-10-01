import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { configureApp } from './app.setup'
import { config } from './config'

async function bootstrap() {
  const c = config()
  const app = await NestFactory.create(AppModule, { bodyParser: true })
  // Behind Railway/Render/Vercel proxies the client IP (for rate limiting) is in X-Forwarded-For.
  app.getHttpAdapter().getInstance().set('trust proxy', 1)
  configureApp(app)
  await app.listen(c.PORT)
  Logger.log(`API on http://localhost:${c.PORT}/api/v1 · docs at /api/docs`, 'Bootstrap')
}

void bootstrap()
