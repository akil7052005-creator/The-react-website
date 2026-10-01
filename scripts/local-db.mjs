// Starts/stops a private PostgreSQL cluster for local development and tests.
//   node scripts/local-db.mjs init|start|stop|status
// Uses PG_BIN (default: C:\Program Files\PostgreSQL\18\bin on Windows, or pg_ctl on PATH)
// and PGDATA_DIR (default: %LOCALAPPDATA%/weddyzone/pgdata or ~/.weddyzone/pgdata), port 5433,
// user "weddyzone" with trust auth on localhost. Not for production.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const isWin = process.platform === 'win32'
const bin = process.env.PG_BIN ?? (isWin ? 'C:/Program Files/PostgreSQL/18/bin' : '')
const exe = (name) => (bin ? join(bin, isWin ? `${name}.exe` : name) : name)
const base = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'weddyzone') : join(homedir(), '.weddyzone')
const data = process.env.PGDATA_DIR ?? join(base, 'pgdata')
const port = process.env.PGPORT_LOCAL ?? '5433'
const run = (cmd, args) => spawnSync(exe(cmd), args, { stdio: 'inherit' }).status ?? 1

const cmd = process.argv[2] ?? 'status'
if (cmd === 'init') {
  if (existsSync(join(data, 'PG_VERSION'))) {
    console.log(`Cluster already exists at ${data}`)
  } else {
    mkdirSync(base, { recursive: true })
    process.exitCode = run('initdb', ['-D', data, '-U', 'weddyzone', '--auth=trust', '-E', 'UTF8', '--locale=C'])
  }
} else if (cmd === 'start') {
  if (isWin) {
    // On Windows a server started from a terminal shares its console and dies with a Ctrl+C there,
    // so launch pg_ctl in its own hidden console through PowerShell.
    const q = (s) => `'${s.replace(/'/g, "''")}'`
    const ps = `Start-Process -FilePath ${q(exe('pg_ctl'))} -WindowStyle Hidden -ArgumentList @('-D', ${q(`"${data}"`)}, '-o', '"-p ${port}"', '-l', ${q(`"${join(base, 'pg.log')}"`)}, 'start')`
    spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' })
  } else {
    // Detached, with stdio ignored, so the server outlives this script and the terminal.
    const child = spawn(exe('pg_ctl'), ['-D', data, '-o', `-p ${port}`, '-l', join(base, 'pg.log'), 'start'], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
  }
  for (let i = 0; i < 30; i++) {
    if (spawnSync(exe('pg_isready'), ['-h', 'localhost', '-p', port], { stdio: 'ignore' }).status === 0) {
      console.log(`PostgreSQL is running on localhost:${port}`)
      for (const db of ['weddyzone', 'weddyzone_test', 'weddyzone_e2e']) {
        spawnSync(exe('createdb'), ['-h', 'localhost', '-p', port, '-U', 'weddyzone', db], { stdio: 'ignore' })
      }
      process.exit(0)
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  console.error(`PostgreSQL did not start — see ${join(base, 'pg.log')}`)
  process.exit(1)
} else if (cmd === 'stop') {
  process.exitCode = run('pg_ctl', ['-D', data, 'stop', '-m', 'fast'])
} else {
  process.exitCode = run('pg_isready', ['-h', 'localhost', '-p', port])
}
