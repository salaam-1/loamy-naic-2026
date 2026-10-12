import { readFileSync } from 'node:fs'

/**
 * Environment separation guard for mutation-heavy tests.
 *
 * The security suite creates real auth users, listings, transactions and bank
 * rows. It used to resolve its project from `.env`, which is production, and
 * the audit counted the result: 2,011 profiles against a documented real base
 * of 247, plus test bank rows beside a real institution.
 *
 * This module removes production as a reachable target. `testEnv()` reads a
 * separate `.env.test` and throws if it is missing or names a protected
 * project. There is no override, because an override is how a guard becomes
 * decoration.
 *
 * The production ref lives in `config/environments.json`, shared with
 * `scripts/_environment.mjs`, so the two guards cannot disagree about what
 * production is.
 */

interface EnvironmentConfig {
  production: { ref: string; label: string }
  protectedRefs: string[]
  testEnvFile: string
  requiredTestVars: string[]
}

const CONFIG: EnvironmentConfig = JSON.parse(
  readFileSync(new URL('../../config/environments.json', import.meta.url), 'utf8'),
) as EnvironmentConfig

export const PRODUCTION_REF = CONFIG.production.ref
export const PROTECTED_REFS = CONFIG.protectedRefs

/** The `<ref>` in https://<ref>.supabase.co, or null if the URL is unusable. */
export function projectRef(url: string | undefined): string | null {
  if (!url) return null
  try {
    const [ref] = new URL(url).host.split('.')
    return ref || null
  } catch {
    return null
  }
}

export function isProtected(url: string | undefined): boolean {
  const ref = projectRef(url)
  return ref !== null && PROTECTED_REFS.includes(ref)
}

/** Throws if `url` names a protected project. Returns it otherwise. */
export function assertNotProduction(url: string | undefined, context = 'this test'): string {
  if (!isProtected(url)) return url ?? ''
  throw new Error(
    `REFUSED: ${context} would write to the PRODUCTION Supabase project (${projectRef(url)}).\n` +
    `Production holds real Founding Member data and must never be the target of ` +
    `mutation-heavy tests.\n` +
    `Point ${CONFIG.requiredTestVars[0]} at a staging project instead. ` +
    `See docs/environment-separation.md.`,
  )
}

function parseEnvFile(url: URL): Record<string, string> | null {
  try {
    return Object.fromEntries(
      readFileSync(url, 'utf8')
        .split('\n')
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
    )
  } catch {
    return null
  }
}

export interface TestEnvironment {
  url: string
  key: string
  ref: string
}

/**
 * Resolve the staging project for mutation-heavy tests, or throw.
 *
 * Deliberately never falls back to `.env`: that file is production, and a
 * fallback is exactly how the contamination happened.
 */
export function testEnv(
  context = 'the security suite',
  /**
   * Where to look. Defaults to the real environment and `.env.test`; tests
   * inject a source so the fail-closed property can be asserted regardless of
   * whether this machine happens to have staging configured.
   *
   * Injection changes only WHERE the values are read, never the checks applied
   * to them: a protected ref passed in here is refused exactly as one read
   * from disk would be.
   */
  sources?: { env?: Record<string, string | undefined>; file?: Record<string, string> },
): TestEnvironment {
  const env = sources?.env ?? process.env
  const file = sources?.file ?? parseEnvFile(new URL(`../../${CONFIG.testEnvFile}`, import.meta.url)) ?? {}
  const url = env.LOAMY_TEST_SUPABASE_URL || file.LOAMY_TEST_SUPABASE_URL
  const key = env.LOAMY_TEST_SUPABASE_ANON_KEY || file.LOAMY_TEST_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error(
      `REFUSED: ${context} is mutation-heavy and has no staging project configured.\n` +
      `Set ${CONFIG.requiredTestVars.join(' and ')} in ${CONFIG.testEnvFile} (gitignored) ` +
      `or in the environment.\n` +
      `It deliberately does NOT fall back to .env, because .env is production. ` +
      `See docs/environment-separation.md.`,
    )
  }

  assertNotProduction(url, context)
  return { url, key, ref: projectRef(url) as string }
}
