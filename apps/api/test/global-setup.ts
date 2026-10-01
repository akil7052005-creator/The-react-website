import { execSync } from 'child_process'
import 'dotenv/config'

// Applies migrations to the test database once per `jest` run.
export default function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://weddyzone@localhost:5433/weddyzone_test?schema=public'
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url },
  })
}
