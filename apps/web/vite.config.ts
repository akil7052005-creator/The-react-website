/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite'

/** Link-preview crawlers (WhatsApp, Facebook, Telegram, …): they read meta tags and never run the app. */
const PREVIEW_BOTS = /WhatsApp|facebookexternalhit|Facebot|TelegramBot|Twitterbot|Slackbot|LinkedInBot|Discordbot|SkypeUriPreview|Pinterest|vkShare|redditbot|Applebot/i

/**
 * /select/<token> for a link-preview crawler: the API's preview page (per-event og:title,
 * og:description, og:image) instead of the app. Same rule as the user-agent rewrite in vercel.json.
 */
function sharePreview(api: string): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const m = /^\/select\/([^/?#]+)\/?(?:\?|$)/.exec(req.url ?? '')
    if (!m || req.method !== 'GET' || !PREVIEW_BOTS.test(req.headers['user-agent'] ?? '')) return next()
    const headers: Record<string, string> = { 'x-forwarded-host': String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '') }
    headers['x-forwarded-proto'] = String(req.headers['x-forwarded-proto'] ?? 'http')
    fetch(`${api}/api/v1/public/og/select/${m[1]}`, { headers })
      .then(async (r) => {
        res.statusCode = r.status
        res.setHeader('Content-Type', r.headers.get('content-type') ?? 'text/html; charset=utf-8')
        res.end(await r.text())
      })
      .catch(() => next())
  }
  return {
    name: 'share-preview',
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['VITE_', 'FEATURE_'])
  return {
    plugins: [react(), sharePreview(env.VITE_DEV_API_PROXY || 'http://localhost:4000')],
    // FEATURE_* flags (e.g. FEATURE_FACE_RECOGNITION) are exposed to the app like VITE_* vars.
    envPrefix: ['VITE_', 'FEATURE_'],
    resolve: {
      alias: {
        // Use the shared package's TypeScript source directly (no build step needed for the web app).
        '@weddyzone/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      // Reachable from phones on the same Wi-Fi (http://<this computer's IP>:5173) and through a
      // Cloudflare quick tunnel (https://<name>.trycloudflare.com) for testing customer links.
      host: true,
      allowedHosts: ['.trycloudflare.com'],
      proxy: {
        '/api': { target: env.VITE_DEV_API_PROXY || 'http://localhost:4000', changeOrigin: false },
      },
    },
    preview: {
      port: 4173,
      proxy: {
        '/api': { target: env.VITE_DEV_API_PROXY || 'http://localhost:4000', changeOrigin: false },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  }
})
