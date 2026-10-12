import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * Two suites, deliberately separated.
 *
 *   npm test           -> tests/unit       — offline, no network, pure logic,
 *                         running in node because none of it needs a DOM.
 *                      -> tests/components  — the same suite, but these files
 *                         render React and so run in jsdom. Kept in one `npm
 *                         test` rather than a third config: a component test
 *                         nobody runs is not a test.
 *   npm run test:security -> tests/security — hits a REAL Supabase project,
 *                         creates throwaway accounts and proves RLS. Opt-in,
 *                         because it writes to whatever project .env points at.
 *
 * See docs/testing.md for why the security suite cannot run against a local
 * Postgres on this machine.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    // Per-directory environment, so pure logic keeps node's speed and only the
    // files that actually render pay for a DOM.
    environmentMatchGlobs: [['tests/components/**', 'jsdom']],
    include: ['tests/unit/**/*.test.ts', 'tests/components/**/*.test.tsx'],
    testTimeout: 10_000,
  },
})
