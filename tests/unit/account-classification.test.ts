import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { classifyAccount } from '../../scripts/census-production-accounts.mjs'

/**
 * The rule that decides which production accounts are safe to delete.
 *
 * Two properties matter more than the buckets themselves:
 *
 *   1. Deletion is decided by EMAIL ALIAS, never by a display name. Fixtures
 *      are created with realistic names, so a name-based rule would miss real
 *      fixtures and sweep up real members. The audit brief says so explicitly.
 *   2. There is exactly ONE implementation. It lives in the read-only census
 *      script, because that is the only thing still allowed to look at
 *      production; the security suite re-exports it rather than restating it,
 *      so a deletion rule and the tool that measures it cannot drift apart.
 */

const SAMPLES: Array<{ email: string; full_name: string; expect: string; why: string }> = [
  { email: 'usmanyakubu541+t0-abc123-4@gmail.com', full_name: 'Aisha Bello', expect: 'suite_generated', why: 'the +t0- alias the security helpers mint' },
  { email: 'usmanyakubu541+admin-explore@gmail.com', full_name: 'Admin', expect: 'owner_alias', why: 'operator alias, not suite-generated' },
  { email: 'usmanyakubu541+loamy3-b-mrj1fc26@gmail.com', full_name: 'Fahad Zakari', expect: 'owner_alias', why: 'QA harness account, still operator-owned' },
  { email: 'someone@example.com', full_name: 'Ngozi Okafor', expect: 'placeholder_domain', why: 'placeholder domain' },
  { email: 'real.member@gmail.com', full_name: 'Ibrahim Musa', expect: 'likely_real', why: 'nothing marks it as a fixture' },
  { email: 'real.member@gmail.com', full_name: 'Phase0 Fixture', expect: 'named_test', why: 'name announces itself, but see the deletion test below' },
]

describe('account classification rule', () => {
  it.each(SAMPLES)('classifies $email as $expect ($why)', ({ email, full_name, expect: want }) => {
    expect(classifyAccount({ email, full_name })).toBe(want)
  })

  it('NEVER marks an account deletable on the strength of its display name', () => {
    // A real member called "Test Ibrahim" must not be deletable. Only the
    // alias decides, which is the whole safety property.
    const nameOnly = classifyAccount({ email: 'genuine.person@gmail.com', full_name: 'Test Ibrahim' })
    expect(nameOnly).toBe('named_test')
    expect(nameOnly).not.toBe('suite_generated')
  })

  it('does not treat a realistic fixture name as evidence either way', () => {
    // The 1,851 September profiles carry realistic names. The rule must key on
    // the alias, so a realistic name changes nothing.
    expect(classifyAccount({ email: 'usmanyakubu541+t0-zz9-1@gmail.com', full_name: 'Chidi Okeke' }))
      .toBe('suite_generated')
    expect(classifyAccount({ email: 'chidi.okeke@gmail.com', full_name: 'Chidi Okeke' }))
      .toBe('likely_real')
  })

  it('treats a missing email as NOT deletable', () => {
    // Absent data must fail safe: unknown means keep.
    expect(classifyAccount({ email: null as unknown as string, full_name: 'Someone' })).toBe('likely_real')
    expect(classifyAccount({ email: '', full_name: '' })).toBe('likely_real')
  })

  it('is defined in exactly one place', () => {
    // There is no second copy to drift. The security suite re-exports this
    // implementation rather than restating it.
    const suite = readFileSync('tests/security/test-account-hygiene.test.ts', 'utf8')
    // Pin the PROPERTY, not the syntax: the suite must take the rule from the
    // census script and must not define one of its own. An earlier version of
    // this assertion quoted the exact `export ... from` line, so it broke when
    // that had to become an import (a bare re-export does not bind the name in
    // the importing module, which is what made the staging run throw
    // "classifyAccount is not defined").
    expect(suite).toContain('census-production-accounts.mjs')
    expect(suite).toMatch(/classifyAccount/)
    expect(suite).not.toMatch(/(export\s+)?function classifyAccount/)
    expect(suite).not.toMatch(/suite_generated'\s*$/m)
  })
})

describe('the census script cannot delete', () => {
  it('contains no delete or update call', () => {
    const s = readFileSync('scripts/census-production-accounts.mjs', 'utf8')
    expect(s).not.toMatch(/\.delete\(/)
    expect(s).not.toMatch(/\.update\(/)
    expect(s).not.toMatch(/\.insert\(/)
    expect(s).not.toMatch(/\.upsert\(/)
  })

  it('paginates, so it cannot silently classify only the first 1000 rows', () => {
    const s = readFileSync('scripts/census-production-accounts.mjs', 'utf8')
    expect(s).toMatch(/\.range\(/)
  })
})
