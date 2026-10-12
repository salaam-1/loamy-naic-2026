import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { loamDevServer } from './scripts/loam-dev-server'
import { devTargetBanner } from './scripts/dev-target-banner'

export default defineConfig({
  // loamDevServer adds POST /loam/chat to the dev server (apply: 'serve', so it
  // is absent from production builds). Loam's server side is a middleware
  // rather than a second process; see scripts/loam-dev-server.ts.
  // devTargetBanner names the Supabase project the dev server is serving, and
  // shouts when it is production. `npm run dev` now defaults to staging
  // (--mode test); `npm run dev:production` is the deliberate escape hatch.
  plugins: [react(), devTargetBanner(), loamDevServer()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
