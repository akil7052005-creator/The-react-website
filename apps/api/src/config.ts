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
  // Platform admins (SUPER_ADMIN) are signed out after this many hours without activity.
  ADMIN_SESSION_HOURS: z.coerce.number().int().min(1).max(72).default(8),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_SECURE: bool,
  UPLOAD_DIR: z.string().default('./uploads'),
  // S3-compatible storage (Cloudflare R2, AWS S3, …) for uploads. When S3_BUCKET is set, files go to the
  // bucket instead of UPLOAD_DIR. Keep the bucket private: the API checks access and streams each file.
  S3_BUCKET: z.string().optional(),
  // R2: https://<ACCOUNT_ID>.r2.cloudflarestorage.com. Leave empty for AWS S3.
  S3_ENDPOINT: z.string().optional(),
  // R2: auto. AWS: the bucket's region, e.g. ap-south-1.
  S3_REGION: z.string().default('auto'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  // Some S3-compatible servers (e.g. MinIO) need path-style URLs; R2 and AWS do not.
  S3_FORCE_PATH_STYLE: bool,
  MAX_PHOTO_MB: z.coerce.number().default(20),
  MAX_BANNER_MB: z.coerce.number().default(5),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('Wedmanage Studio <no-reply@weddyzone.app>'),
  // Resend (https://resend.com): when set, emails go through Resend's API instead of SMTP.
  RESEND_API_KEY: z.string().optional(),
  // Sender for all emails, e.g. "Wedmanage Studio <no-reply@mail.yourdomain.com>". Its domain must be
  // verified in Resend. Falls back to SMTP_FROM.
  MAIL_FROM: z.string().optional(),
  // Console-mode only: also save each email as a JSON file here (used by the Playwright e2e run).
  MAIL_OUTBOX_DIR: z.string().optional(),
  RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().default(10),
  RATE_LIMIT_PUBLIC_PER_MIN: z.coerce.number().int().default(120),
  // Customer code checks (/selection/auth), per IP per minute.
  RATE_LIMIT_CODE_PER_MIN: z.coerce.number().int().min(1).default(5),
  // Proxies between the browser and the API. Vercel's /api rewrite + the host's load balancer = 2;
  // too low and every user shares the proxy's IP (and its rate limit), too high and IPs can be spoofed.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
  FEATURE_FACE_RECOGNITION: bool,
  RATE_LIMIT_ADMIN_PER_MIN: z.coerce.number().int().default(120),
  // Photo uploads have their own bucket: a 1,000-photo folder is 1,000 requests within a minute or
  // two, far past the general limit. Login-only, and plan limits still apply.
  RATE_LIMIT_UPLOADS_PER_MIN: z.coerce.number().int().min(1).default(6000),
  // Hourly subscription job (deadline reminders, grace/expiry, admin digest). On unless set to false;
  // the test suite turns it off and runs the job by hand.
  JOBS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === undefined || v === '' || v === 'true' || v === '1'),
  // Payment gateway webhooks (Razorpay format): HMAC-SHA256 secret set in the gateway dashboard.
  // Without it POST /webhooks/payments refuses every call (test-mode purchases don't need it).
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),
  // Extra addresses for admin alert emails and the daily digest (comma-separated). Every platform
  // admin's own email gets them too.
  ADMIN_ALERT_EMAILS: z.string().default(''),
  // Seller details printed on Wedmanage's GST invoices to studios.
  PLATFORM_LEGAL_NAME: z.string().default('Wedmanage Studio'),
  PLATFORM_GSTIN: z.string().optional(),
  PLATFORM_STATE_CODE: z.string().optional(),
  PLATFORM_ADDRESS: z.string().optional(),
  // WhatsApp Cloud API for platform alerts to studios (approved templates). Without it the alert is
  // recorded with its wa.me link but not delivered. Never charged to the studio's WhatsApp credits.
  WHATSAPP_CLOUD_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_TEMPLATE_LANG: z.string().default('en'),
  // Encrypts admins' two-factor secrets at rest. Falls back to a key derived from JWT_REFRESH_SECRET.
  ADMIN_2FA_KEY: z.string().optional(),
})
  .superRefine((c, ctx) => {
    const fail = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
    if (c.S3_BUCKET) {
      for (const key of ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!c[key]) fail(key, 'is required when S3_BUCKET is set')
      }
      if (c.S3_ENDPOINT && !/^https?:\/\//.test(c.S3_ENDPOINT)) fail('S3_ENDPOINT', 'must be a full URL, e.g. https://<ACCOUNT_ID>.r2.cloudflarestorage.com')
    }
    // Refuse to start in production with development defaults.
    if (c.NODE_ENV !== 'production') return
    // Hosts like Render wipe the local disk on every deploy, so uploads must go to a bucket.
    if (!c.S3_BUCKET) fail('S3_BUCKET', 'is required in production so uploaded photos survive redeploys (set the S3_* variables)')
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
    if (!c.MAIL_FROM) fail('MAIL_FROM', 'is required in production: a sender on your verified domain, e.g. "Wedmanage Studio <no-reply@mail.yourdomain.com>"')
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
