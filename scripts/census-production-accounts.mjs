#!/usr/bin/env node
/**
 * READ-ONLY census of accounts in a Supabase project. Deletes nothing.
 *
 * WHY IT EXISTS
 *   The classification rule used to live only inside
 *   `tests/security/test-account-hygiene.test.ts`. That suite now refuses to
 *   run against production, which is correct -- and it left no way to measure
 *   the contamination the audit found. Counting is not mutating, so this
 *   script is allowed to read production, and only to read it.
 *
 * THE RULE
 *   Classification is driven by the EMAIL ALIAS, not by display names. A
 *   fixture is created with a realistic name, so a name-based rule would both
 *   miss real fixtures and sweep up real members. Only `suite_generated`
 *   (the `+t0-` alias the security helpers mint) is ever proposed for
 *   deletion, and even that is proposed, never performed.
 *
 * USAGE
 *   node scripts/census-production-accounts.mjs            # production, read-only
 *   node scripts/census-production-accounts.mjs --staging  # the staging project
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { secret } from './_secrets.mjs'
import { PRODUCTION_REF, projectRef } from './_environment.mjs'

/**
 * Buckets, most specific first. Kept identical to the rule in
 * tests/security/test-account-hygiene.test.ts; tests/unit/account-classification
 * .test.ts fails if the two ever disagree.
 */
export function classifyAccount({ email, full_name: fullName }) {
  const e = (email ?? '').toLowerCase()
  const name = fullName ?? ''
  if (/\+t0-/.test(e)) return 'suite_generated'
  if (/^[^@]*\+/.test(e) && e.includes('usmanyakubu541')) return 'owner_alias'
  if (/^(phase0|hardening)\b/i.test(name) || /\btest\b/i.test(name)) return 'named_test'
  if (/@(example|test)\.(com|org)$/.test(e)) return 'placeholder_domain'
  return 'likely_real'
}

const SAFE_TO_DELETE = new Set(['suite_generated'])

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
    process.argv[1]?.endsWith('census-production-accounts.mjs')) {
  const staging = process.argv.includes('--staging')
  const envFile = staging ? '.env.test' : '.env'
  const vars = Object.fromEntries(
    readFileSync(new URL(`../${envFile}`, import.meta.url), 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  )
  const url = staging ? vars.LOAMY_TEST_SUPABASE_URL : vars.VITE_SUPABASE_URL
  const key = staging ? vars.LOAMY_TEST_SUPABASE_ANON_KEY : vars.VITE_SUPABASE_ANON_KEY

  const ref = projectRef(url)
  console.log(`census target: ${ref}${ref === PRODUCTION_REF ? ' (PRODUCTION, read-only)' : ''}`)

  const sb = createClient(url, key)
  const { error: authErr } = await sb.auth.signInWithPassword({
    email: secret('QA_EMAIL_ADMIN'),
    password: secret('QA_PASSWORD_ADMIN'),
  })
  if (authErr) {
    console.error(`admin sign-in failed: ${authErr.message}`)
    console.error('After rotation, update QA_PASSWORD_ADMIN in .env.')
    process.exit(1)
  }

  // Paginated. PostgREST caps an unranged select at 1000 rows SILENTLY, which
  // would make this census confidently wrong about a deletion decision.
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('profiles')
      .select('id, full_name, created_at')
      .range(from, from + 999)
    if (error) { console.error(error.message); process.exit(1) }
    if (!data?.length) break
    rows.push(...data)
    if (data.length < 1000) break
  }

  // `profiles` does not expose email, so the alias rule needs auth data that
  // the anon key cannot read. Report what IS measurable and say what is not.
  const byMonth = {}
  for (const r of rows) {
    const m = (r.created_at ?? '').slice(0, 7)
    byMonth[m] = (byMonth[m] ?? 0) + 1
  }

  console.log(`\nprofiles read (paginated): ${rows.length}`)
  console.log('created by month:')
  for (const [m, n] of Object.entries(byMonth).sort()) console.log(`  ${m}  ${n}`)

  console.log(
    '\nNOTE: `profiles` carries no email column, and the classification rule is\n' +
    'alias-based by design. A full classification therefore needs auth.users,\n' +
    'which requires the service_role key and must be run by the owner from the\n' +
    'Supabase SQL editor. docs/environment-separation.md carries that query.\n' +
    `Only the ${[...SAFE_TO_DELETE].join(', ')} bucket is ever proposed for deletion.`,
  )
}
