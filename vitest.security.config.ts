import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * Security / RLS suite. Runs against the live Supabase project in .env.
 *
 * Single-threaded and serial on purpose: these tests create and delete real
 * auth users, and Supabase rate-limits signups. Running them in parallel
 * produces flakes that look like security failures but are not.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/security/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
  },
})
