import { describe, expect, it } from 'vitest'
import { adminClient } from '../helpers/supabase'

/**
 * §29 — test-account hygiene.
 *
 * Production auth holds both real Founding Member profiles and accounts this
 * test suite created. The directive is explicit: DO NOT delete them blindly.
 *
 * So this file does not delete anything. It asserts the one property that
 * makes a cleanup safe later — that every test account is *identifiable by
 * rule*, not by eyeballing a list — and prints the classification so the
 * cleanup can be reviewed by a human before anything is removed.
 *
 * The rules, most specific first:
 *
 *   suite_generated     +t0- alias. Created by tests/security. Safe to delete.
 *   owner_alias         any other usmanyakubu541+ alias, incl. admin-explore.
 *                       Operational. NOT safe to delete without asking.
 *   named_test          display name announces itself as a test fixture.
 *   placeholder_domain  @example.com / @test.com.
 *   likely_real         everything else. Never touch.
 */

type Row = {
  id: string
  email: string | null
  full_name: string | null
  platform_role: string | null
  created_at: string
}

/**
 * The rule now lives in scripts/census-production-accounts.mjs, which is
 * READ-ONLY and can therefore still be pointed at production for a census.
 * This suite refuses to run against production at all, so keeping a second
 * copy here would mean the deletion rule and the thing that measures it could
 * silently disagree. Re-exported so existing callers are unaffected.
 */
import { classifyAccount } from '../../scripts/census-production-accounts.mjs'

// Re-exported so existing importers are unaffected. The bare `export ... from`
// form does NOT bring the binding into this module's scope, which is why the
// tests below threw "classifyAccount is not defined" on the first staging run.
export { classifyAccount }

describe('§29 — test accounts are identifiable without guesswork', () => {
  it('classifies every profile by rule, and leaves them all in place', async () => {
    const admin = await adminClient()
    if (!admin) return

    // PAGINATED, and that is the whole point. A .select() with no .range()
    // is capped at 1000 rows by PostgREST, silently. This test was written
    // before production crossed that line, so from then on it classified the
    // first thousand profiles and asserted the exact count matched what it
    // had actually read -- which is both a failing assertion AND, far worse,
    // a safety check on a deletion rule that was only ever validated against
    // a fraction of the accounts it is supposed to protect.
    const PAGE = 1000
    const rows: Row[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from('profiles')
        .select('id, email, full_name, platform_role, created_at')
        .order('created_at', { ascending: true })
        .range(from, from + PAGE - 1)
      expect(error, error?.message).toBeFalsy()
      const page = (data ?? []) as Row[]
      rows.push(...page)
      if (page.length < PAGE) break
    }
    const buckets = new Map<Bucket, Row[]>()
    for (const p of rows) {
      const b = classifyAccount(p)
      buckets.set(b, [...(buckets.get(b) ?? []), p])
    }

    console.log(`\n§29 classification of ${rows.length} profiles:`)
    for (const [b, list] of [...buckets].sort((a, z) => z[1].length - a[1].length)) {
      console.log(
        `  ${b.padEnd(20)} ${String(list.length).padStart(4)}` +
        `   ${list[0].created_at.slice(0, 10)} .. ${list[list.length - 1].created_at.slice(0, 10)}`)
    }

    const real = buckets.get('likely_real') ?? []
    const byRole = new Map<string, number>()
    for (const p of real) {
      const r = p.platform_role ?? '(none)'
      byRole.set(r, (byRole.get(r) ?? 0) + 1)
    }
    console.log('  likely_real by role:',
      [...byRole].sort((a, z) => z[1] - a[1]).map(([r, n]) => `${r}=${n}`).join(' '))

    // Every profile lands in exactly one bucket. An "unclassifiable" row would
    // mean a cleanup script had to guess, which is how real users get deleted.
    expect(rows.length).toBe([...buckets.values()].reduce((n, l) => n + l.length, 0))

    // Nothing here deletes. If that ever changes, this assertion fails first.
    // It also proves the pagination above reached the end: an exact count
    // that exceeds what we read means a page was missed, and a cleanup rule
    // would be judged on accounts it never saw.
    const { count } = await admin
      .from('profiles').select('id', { count: 'exact', head: true })
    expect(count, 'this file must never remove a profile').toBe(rows.length)
  }, 120_000)

  it('never classifies a real-looking account as suite_generated', () => {
    // The dangerous direction is a false positive: a real member matched by a
    // deletion rule. These are the shapes a Nigerian member account takes.
    for (const email of [
      'aisha.bello@gmail.com', 'info@sahelagro.ng', 'musa+farm@yahoo.com',
      'contact@olamnigeria.com', 'usman.yakubu541@gmail.com',
    ]) {
      expect(classifyAccount({ email, full_name: 'Aisha Bello' }),
        `${email} would be deleted by the cleanup rules`).toBe('likely_real')
    }
  })

  it('does classify the suite\'s own accounts', () => {
    expect(classifyAccount({
      email: 'usmanyakubu541+t0-mu8ytsuf-0@gmail.com', full_name: 'Phase0 farmer',
    })).toBe('suite_generated')
  })
})
