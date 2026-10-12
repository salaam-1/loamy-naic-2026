import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  PRODUCTION_REF,
  PROTECTED_REFS,
  assertNotProduction,
  isProtected,
  projectRef,
  testEnv,
} from '../helpers/environment'

/**
 * Environment separation guards.
 *
 * The audit found 2,011 profiles in the production member database against a
 * documented real base of 247, because every mutation-heavy test resolved its
 * project from `.env`, which is production. These tests pin the guard that
 * removed production as a reachable target.
 *
 * They are deliberately pure: nothing here contacts any Supabase project.
 */

const PROD_URL = `https://${PRODUCTION_REF}.supabase.co`
const STAGING_URL = 'https://abcdefghijklmnopqrst.supabase.co'

describe('project reference parsing', () => {
  it('reads the ref out of a Supabase URL', () => {
    expect(projectRef(PROD_URL)).toBe(PRODUCTION_REF)
    expect(projectRef(STAGING_URL)).toBe('abcdefghijklmnopqrst')
  })

  it('returns null rather than guessing on unusable input', () => {
    expect(projectRef(undefined)).toBeNull()
    expect(projectRef('')).toBeNull()
    expect(projectRef('not-a-url')).toBeNull()
  })
})

describe('protected projects', () => {
  it('recognises production', () => {
    expect(isProtected(PROD_URL)).toBe(true)
  })

  it('does not treat a staging project as protected', () => {
    expect(isProtected(STAGING_URL)).toBe(false)
  })

  it('treats an unparseable URL as NOT protected, so it fails elsewhere', () => {
    // A null ref must not accidentally match the protected list; the missing
    // URL is caught by testEnv() instead, with a clearer message.
    expect(isProtected('not-a-url')).toBe(false)
  })
})

describe('assertNotProduction', () => {
  it('throws for the production project', () => {
    expect(() => assertNotProduction(PROD_URL, 'a test')).toThrow(/REFUSED/)
    expect(() => assertNotProduction(PROD_URL, 'a test')).toThrow(/PRODUCTION/)
  })

  it('names the caller so the failure says what was about to happen', () => {
    expect(() => assertNotProduction(PROD_URL, 'scripts/verify-stage3.mjs'))
      .toThrow(/scripts\/verify-stage3\.mjs/)
  })

  it('returns the url unchanged for a non-protected project', () => {
    expect(assertNotProduction(STAGING_URL, 'a test')).toBe(STAGING_URL)
  })

  it('throws rather than returning a boolean', () => {
    // A boolean guard becomes a no-op the moment someone forgets the `if`.
    const result = (() => { try { assertNotProduction(PROD_URL) } catch { return 'threw' } return 'returned' })()
    expect(result).toBe('threw')
  })
})

describe('testEnv fails closed', () => {
  // Deterministic: these inject an empty source rather than depending on
  // whether THIS machine has staging configured. The earlier version branched
  // on process.env, so the moment .env.test appeared the assertions silently
  // stopped running -- a guard test that goes quiet exactly when the guard
  // starts mattering.
  const NOTHING = { env: {}, file: {} }

  it('throws when no staging project is configured', () => {
    expect(() => testEnv('a mutation-heavy test', NOTHING)).toThrow(/REFUSED/)
    expect(() => testEnv('a mutation-heavy test', NOTHING)).toThrow(/no staging project configured/)
  })

  it('says explicitly that it will not fall back to .env', () => {
    expect(() => testEnv('a test', NOTHING)).toThrow(/does NOT fall back to \.env/)
  })

  it('refuses a configured source that names production', () => {
    const pointingAtProd = {
      env: {},
      file: { LOAMY_TEST_SUPABASE_URL: PROD_URL, LOAMY_TEST_SUPABASE_ANON_KEY: 'irrelevant' },
    }
    expect(() => testEnv('a test', pointingAtProd)).toThrow(/PRODUCTION/)
  })

  it('accepts a staging source', () => {
    const staging = {
      env: {},
      file: { LOAMY_TEST_SUPABASE_URL: STAGING_URL, LOAMY_TEST_SUPABASE_ANON_KEY: 'irrelevant' },
    }
    expect(testEnv('a test', staging).ref).toBe('abcdefghijklmnopqrst')
  })

  it('whatever this machine resolves, it is never production', () => {
    // Complements the injected cases: asserts the REAL configuration is sane,
    // if there is one, without assuming there is.
    try {
      const r = testEnv('machine check')
      expect(isProtected(`https://${r.ref}.supabase.co`)).toBe(false)
    } catch (e) {
      expect(String(e)).toMatch(/REFUSED/)
    }
  })
})

describe('the guard cannot drift from the scripts guard', () => {
  it('reads the production ref from the shared config file', () => {
    const cfg = JSON.parse(readFileSync('config/environments.json', 'utf8'))
    expect(PRODUCTION_REF).toBe(cfg.production.ref)
    expect(PROTECTED_REFS).toEqual(cfg.protectedRefs)
  })

  it('the scripts guard reads the same file', () => {
    const js = readFileSync('scripts/_environment.mjs', 'utf8')
    expect(js).toContain('config/environments.json')
    // No second copy of the ref anywhere in the guard.
    expect(js).not.toContain(PRODUCTION_REF)
  })
})

describe('mutation-heavy entry points are wired to the guard', () => {
  const MUTATORS = [
    'verify-dataviz', 'verify-extras', 'verify-public', 'verify-sept2026',
    'verify-stage1', 'verify-stage2', 'verify-stage3', 'verify-stage4',
    'verify-stage5', 'verify-stage6', 'verify-stage7', 'verify-stage8',
    'verify-stage9', 'verify-stock-spine', 'visual-qa-checkout',
    'visual-qa-commodity', 'visual-qa-fee-rules', 'visual-qa-financing',
    'visual-qa-fulfilment', 'visual-qa-edit', 'visual-qa-profile',
    'visual-qa-home', 'visual-qa',
  ]

  it.each(MUTATORS)('scripts/%s.mjs calls testEnv()', (name) => {
    const s = readFileSync(`scripts/${name}.mjs`, 'utf8')
    expect(s).toContain("from './_environment.mjs'")
    expect(s).toMatch(/testEnv\(/)
  })

  it.each(MUTATORS)('scripts/%s.mjs no longer reads the production project', (name) => {
    const s = readFileSync(`scripts/${name}.mjs`, 'utf8')
    expect(s).not.toContain('VITE_SUPABASE_URL')
    expect(s).not.toContain('VITE_SUPABASE_ANON_KEY')
  })

  it('the security suite fixtures resolve staging, never .env', () => {
    const s = readFileSync('tests/helpers/supabase.ts', 'utf8')
    expect(s).toContain("testEnv('the security suite')")
    expect(s).not.toContain('env.VITE_SUPABASE_URL')
  })

  it('leaves the read-only production smoke test alone', () => {
    // live-smoke.mjs verifies a deployment by reading it. Reading production is
    // the point; only writing is forbidden.
    const s = readFileSync('scripts/live-smoke.mjs', 'utf8')
    expect(s).not.toContain("from './_environment.mjs'")
    expect(s).toMatch(/READ-ONLY/i)
  })
})

describe('browser fixtures that write through the UI', () => {
  /**
   * A harness that clicks "Add to cart" persists a row without ever building a
   * Supabase client, so testEnv() never sees it. What decides the target is
   * whichever project the dev server was built against. This was a real gap:
   * visual-qa-ux-polish.mjs toggles wishlist hearts and adds to cart, and was
   * unguarded because the first sweep classified harnesses by direct API calls.
   */
  it('the mutating polish harness asks the dev server what it serves', () => {
    const s = readFileSync('scripts/visual-qa-ux-polish.mjs', 'utf8')
    expect(s).toContain('assertServedProjectNotProduction')
    expect(s).toContain("from './_environment.mjs'")
  })

  it('the guard exists and reads the served bundle rather than a config file', () => {
    const s = readFileSync('scripts/_environment.mjs', 'utf8')
    expect(s).toContain('export async function assertServedProjectNotProduction')
    // Empirical: it must fetch, not trust an env file that may disagree with
    // what is actually being served.
    expect(s).toMatch(/await fetch\(/)
    expect(s).toContain('assertNotProduction(`https://${ref}.supabase.co`')
  })

  it('refuses when it cannot tell which project is served', () => {
    const s = readFileSync('scripts/_environment.mjs', 'utf8')
    expect(s).toContain('Refusing rather than guessing')
  })

  it('leaves the non-writing auth harness alone', () => {
    // visual-qa-auth-loam.mjs fills forms, toggles password visibility and
    // signs in. A session is not member data, so it is not mutation-heavy.
    const s = readFileSync('scripts/visual-qa-auth-loam.mjs', 'utf8')
    expect(s).not.toContain('assertServedProjectNotProduction')
  })
})
