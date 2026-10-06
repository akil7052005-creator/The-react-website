// Local development servers under pm2: restarted when they crash and independent of any terminal.
//   pm2 start ecosystem.config.cjs     (or: pnpm servers:start)
//   pm2 status · pm2 logs · pm2 restart all · pm2 stop all
// The database runs separately: pnpm db:local:start (scripts/start-servers.ps1 does both at login).
const path = require('node:path')

const common = {
  windowsHide: true,
  autorestart: true,
  // A crash loop backs off (0.5 s, 0.75 s, …, up to 15 s) instead of spinning.
  exp_backoff_restart_delay: 500,
  max_restarts: 1000,
  time: true,
}

module.exports = {
  apps: [
    // The API in two parts. `nest start --watch` is not used: on Windows its restart step can fail
    // ("process not found") and stop the API while the watcher keeps running, so pm2 sees nothing wrong.
    {
      // Compiles src/ to dist/ on every save (same output as `nest build`: no CLI plugins).
      ...common,
      name: 'api-build',
      cwd: path.join(__dirname, 'apps/api'),
      script: 'node_modules/typescript/bin/tsc',
      args: '-w -p tsconfig.build.json --preserveWatchOutput',
    },
    {
      // The API itself, restarted by pm2 whenever dist/ changes.
      ...common,
      name: 'api',
      cwd: path.join(__dirname, 'apps/api'),
      script: 'dist/main.js',
      node_args: '--enable-source-maps',
      watch: ['dist'],
      // Wait for tsc to finish writing every file of a rebuild before restarting.
      watch_delay: 2000,
    },
    {
      ...common,
      name: 'web',
      cwd: path.join(__dirname, 'apps/web'),
      script: 'node_modules/vite/bin/vite.js',
    },
    {
      ...common,
      name: 'tunnel',
      cwd: __dirname,
      script: 'scripts/tunnel.mjs',
      // Give cloudflared a few seconds before starting again, so Cloudflare isn't hammered.
      restart_delay: 5000,
    },
  ],
}
