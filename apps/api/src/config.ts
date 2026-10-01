import 'dotenv/config'
import { z } from 'zod'

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1')

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  APP_URL: z.string().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_SECURE: bool,
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_PHOTO_MB: z.coerce.number().default(20),
  MAX_BANNER_MB: z.coerce.number().default(5),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('Weddyzone Studio <no-reply@weddyzone.app>'),
  // Resend (https://resend.com): when set, emails go through Resend's API instead of SMTP.
  RESEND_API_KEY: z.string().optional(),
  // Sender for all emails, e.g. "Weddyzone Studio <no-reply@mail.yourdomain.com>". Its domain must be
  // verified in Resend. Falls back to SMTP_FROM.
  MAIL_FROM: z.string().optional(),
  // Console-mode only: also save each email as a JSON file here (used by the Playwright e2e run).
  MAIL_OUTBOX_DIR: z.string().optional(),
  RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().default(10),
  RATE_LIMIT_PUBLIC_PER_MIN: z.coerce.number().int().default(120),
  // Proxies between the browser and the API. Vercel's /api rewrite + the host's load balancer = 2;
  // too low and every user shares the proxy's IP (and its rate limit), too high and IPs can be spoofed.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
  FEATURE_FACE_RECOGNITION: bool,
})
  .superRefine((c, ctx) => {
    // Refuse to start in production with development defaults.
    if (c.NODE_ENV !== 'production') return
    const fail = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
    const origins = c.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    if (!origins.length || origins.some((o) => !o.startsWith('https://') || /localhost|127\.0\.0\.1/.test(o))) {
      fail('CORS_ORIGINS', 'must list only your live https:// site origin(s) in production')
    }
    if (!c.APP_URL.startsWith('https://') || /localhost|127\.0\.0\.1/.test(c.APP_URL)) fail('APP_URL', 'must be your live https:// site URL in production')
    if (!c.COOKIE_SECURE) fail('COOKIE_SECURE', 'must be true in production')
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (c[key].startsWith('change-me')) fail(key, 'still has the example value; generate one with `openssl rand -hex 32`')
    }
    if (c.JWT_ACCESS_SECRET === c.JWT_REFRESH_SECRET) fail('JWT_REFRESH_SECRET', 'must differ from JWT_ACCESS_SECRET')
    // Without a provider, password-reset emails would only be logged and never reach anyone.
    if (!c.RESEND_API_KEY && !c.SMTP_HOST) fail('RESEND_API_KEY', 'is required in production (or set SMTP_HOST) so emails are delivered')
    if (!c.MAIL_FROM) fail('MAIL_FROM', 'is required in production: a sender on your verified domain, e.g. "Weddyzone Studio <no-reply@mail.yourdomain.com>"')
  })

export type AppConfig = z.output<typeof schema>

let cached: AppConfig | null = null

export function config(): AppConfig {
  if (!cached) {
    const parsed = schema.safeParse(process.env)
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')
      throw new Error(`Invalid environment configuration:\n${msg}`)
    }
    cached = parsed.data
  }
  return cached
}

/** Tests change env between files; this forces a re-read. */
export function resetConfigCache() {
  cached = null
}
