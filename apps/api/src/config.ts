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
  RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().default(10),
  RATE_LIMIT_PUBLIC_PER_MIN: z.coerce.number().int().default(120),
  FEATURE_FACE_RECOGNITION: bool,
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
