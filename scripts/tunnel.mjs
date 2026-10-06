// Cloudflare quick tunnel to the web app (for testing customer links on real phones), run by pm2.
//   node scripts/tunnel.mjs
// A quick tunnel gets a new https://<name>.trycloudflare.com address every time it starts, so this
// writes each new address into apps/web/.env (VITE_PUBLIC_APP_URL); Vite reloads on the change and
// share links use it. Exits when cloudflared exits, so pm2 starts a fresh one.
// CLOUDFLARED: path to cloudflared (default: on PATH, else C:\Program Files (x86)\cloudflared).
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const envFile = join(root, 'apps/web/.env')
const fallback = 'C:/Program Files (x86)/cloudflared/cloudflared.exe'
const exe = process.env.CLOUDFLARED ?? (process.platform === 'win32' && existsSync(fallback) ? fallback : 'cloudflared')
const target = process.env.TUNNEL_TARGET ?? 'http://localhost:5173'

function saveUrl(url) {
  const env = readFileSync(envFile, 'utf8')
  const line = `VITE_PUBLIC_APP_URL=${url}`
  if (env.includes(`${line}\n`) || env.endsWith(line)) return
  const next = /^VITE_PUBLIC_APP_URL=.*$/m.test(env) ? env.replace(/^VITE_PUBLIC_APP_URL=.*$/m, line) : `${env.trimEnd()}\n${line}\n`
  writeFileSync(envFile, next)
  console.log(`[tunnel] public address: ${url} (saved to apps/web/.env)`)
}

const child = spawn(exe, ['tunnel', '--no-autoupdate', '--url', target], { stdio: ['ignore', 'pipe', 'pipe'] })
let found = false
/** Cloudflare expires a quick tunnel that lost its connection (Wi-Fi drop, sleep); cloudflared then retries forever. */
let gone = 0
const scan = (chunk) => {
  const text = chunk.toString()
  process.stdout.write(text)
  const m = !found && /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(text)
  if (m) {
    found = true
    saveUrl(m[0])
  }
  if (/Tunnel not found/i.test(text) && ++gone >= 3) {
    console.log('[tunnel] Cloudflare dropped this tunnel; exiting so pm2 starts a new one')
    child.kill()
  }
}
child.stdout.on('data', scan)
child.stderr.on('data', scan)
child.on('exit', (code) => process.exit(code ?? 1))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill())
