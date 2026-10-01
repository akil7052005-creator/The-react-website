/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['VITE_', 'FEATURE_'])
  return {
    plugins: [react()],
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
