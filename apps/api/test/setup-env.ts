// Runs before each test file: point everything at the throwaway test database.
import 'dotenv/config'

process.env.NODE_ENV = 'test'
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://weddyzone@localhost:5433/weddyzone_test?schema=public'
process.env.UPLOAD_DIR = './test-uploads'
process.env.RATE_LIMIT_AUTH_PER_MIN = process.env.TEST_RATE_LIMIT ?? '10000'
process.env.RATE_LIMIT_PUBLIC_PER_MIN = process.env.TEST_RATE_LIMIT ?? '10000'
process.env.RATE_LIMIT_CODE_PER_MIN = process.env.TEST_RATE_LIMIT ?? '10000'
process.env.SMTP_HOST = ''
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-test-access-secret-123'
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-test-refresh-secret-12'
// Payment webhooks are signed with this in the tests; the hourly job is run by hand, never on a timer.
process.env.PAYMENT_WEBHOOK_SECRET ??= 'test-webhook-secret'
process.env.JOBS_ENABLED = 'false'
