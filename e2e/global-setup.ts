import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

// Fresh e2e database with the demo studio before every run.
export default function globalSetup() {
  const api = resolve(__dirname, '../apps/api')
  const url = process.env.E2E_DATABASE_URL ?? 'postgresql://weddyzone@localhost:5433/weddyzone_e2e?schema=public'
  rmSync(resolve(api, 'e2e-uploads'), { recursive: true, force: true })
  rmSync(resolve(api, 'e2e-mail'), { recursive: true, force: true })
  execSync('npx prisma migrate reset --force --skip-generate', {
    cwd: api,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url, UPLOAD_DIR: './e2e-uploads' },
  })
}
