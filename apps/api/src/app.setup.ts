import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import type { NextFunction, Request, Response } from 'express'
import { config } from './config'

/** Shared by main.ts and the integration tests so both run the exact same pipeline. */
export function configureApp(app: INestApplication) {
  const c = config()
  const allowed = c.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)

  app.setGlobalPrefix('api/v1', { exclude: ['api/docs'] })
  app.use(
    helmet({
      // Images are embedded by the web app from another origin in development.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  )
  app.use(cookieParser())
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      // Same-origin and server-to-server requests have no Origin header.
      if (!origin || allowed.includes(origin)) return cb(null, true)
      cb(null, false)
    },
    credentials: true,
  })
  // Mutating JSON endpoints must be called with a JSON content type. Browsers cannot send
  // that cross-site without a CORS preflight, which the allowlist above then blocks.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
    const len = Number(req.headers['content-length'] ?? 0)
    const type = req.headers['content-type'] ?? ''
    // Local storage stands in for the bucket's signed PUT of a preview (development and tests only).
    const localPreviewPut = req.method === 'PUT' && req.path.startsWith('/api/v1/uploads/local/') && /^image\/(webp|jpeg)$/.test(type)
    if (mutating && len > 0 && !localPreviewPut && !type.startsWith('application/json') && !type.startsWith('multipart/form-data')) {
      res.status(415).json({ error: { code: 'VALIDATION_ERROR', message: 'Send JSON (application/json) or multipart/form-data' } })
      return
    }
    next()
  })

  // Interactive API docs are for development only; production doesn't publish the API's map.
  if (c.NODE_ENV === 'production') return
  const doc = new DocumentBuilder()
    .setTitle('Wedmanage Studio API')
    .setDescription(
      'REST API for Wedmanage Studio. Auth uses httpOnly cookies (log in via POST /api/v1/auth/login). ' +
        'Errors: { error: { code, message, fields? } }. Money is in paise in responses and rupees in request bodies.',
    )
    .setVersion('1.0')
    .addCookieAuth('wz_at')
    .build()
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc))
}
