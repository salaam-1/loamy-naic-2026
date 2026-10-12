import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { testEnv } from './environment'

/**
 * Fixtures for the security suite.
 *
 * These talk to a REAL Supabase project — the one in .env. There is no local
 * Postgres on the build machine (no Docker), so RLS cannot be exercised in
 * isolation; see docs/testing.md.
 *
 * Every account created here is a +alias of the operator's address and is
 * recorded in `createdEmails` so a run can report exactly what it left behind.
 * Auth users cannot be deleted with the anon key, so cleanup is a reported
 * list, not an automatic teardown — pretending otherwise would be worse than
 * saying so.
 */

/**
 * The project these fixtures target.
 *
 * This used to read VITE_SUPABASE_URL from `.env`, which is PRODUCTION. Every
 * account, listing, transaction and bank row this suite created therefore
 * landed in the real member database; the audit counted 2,011 profiles against
 * a documented real base of 247.
 *
 * `testEnv()` resolves `.env.test` and throws when it is absent or names a
 * protected project. It does not fall back to `.env`, so this suite can no
 * longer reach production even if someone runs it by accident.
 */
function testFileVar(name: string): string {
  try {
    const raw = readFileSync(new URL('../../.env.test', import.meta.url), 'utf8')
    for (const line of raw.split(String.fromCharCode(10))) {
      const t = line.trim()
      if (!t || t.startsWith('#') || !t.includes('=')) continue
      if (t.slice(0, t.indexOf('=')).trim() === name) return t.slice(t.indexOf('=') + 1).trim()
    }
  } catch { /* absent is legitimate; adminClient() returns null */ }
  return ''
}

const resolved = testEnv('the security suite')

export const SUPABASE_URL = resolved.url
export const ANON_KEY = resolved.key
export const TEST_PROJECT_REF = resolved.ref

/**
 * The persistent admin fixture's credentials.
 *
 * These used to be hardcoded here. That put a working production admin login
 * into a tracked file, and this file is already on the remote -- so the
 * account it names must be treated as compromised and rotated, independently
 * of this change. Reading from .env (gitignored) stops the exposure growing.
 */
export const ADMIN_EMAIL = process.env.LOAMY_TEST_ADMIN_EMAIL ?? testFileVar('LOAMY_TEST_ADMIN_EMAIL')
export const ADMIN_PASSWORD = process.env.LOAMY_TEST_ADMIN_PASSWORD ?? testFileVar('LOAMY_TEST_ADMIN_PASSWORD')

/** Accounts this run created, printed at the end for manual cleanup. */
export const createdEmails: string[] = []

export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
}

export interface TestUser {
  client: SupabaseClient
  uid: string
  email: string
  password: string
}

const RUN = Date.now().toString(36)
let seq = 0

/**
 * Supabase rate-limits signups per project. The suite now creates enough
 * accounts in one run to hit it, and a rate limit is an environment
 * condition, not a product failure -- so back off and retry rather than
 * reporting a red suite for something the code did not do wrong.
 */
async function signUpWithBackoff(
  client: SupabaseClient,
  email: string,
  password: string,
  meta: Record<string, unknown>,
) {
  let wait = 2000
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await client.auth.signUp({ email, password, options: { data: meta } })
    if (!res.error || !/rate limit/i.test(res.error.message)) return res
    await new Promise((r) => setTimeout(r, wait))
    wait *= 2
  }
  return client.auth.signUp({ email, password, options: { data: meta } })
}

export async function makeUser(role: string, category: string): Promise<TestUser> {
  const email = `usmanyakubu541+t0-${RUN}-${seq++}@gmail.com`
  const password = 'LoamyPhase0-Test!' + RUN
  const client = anonClient()
  const { data, error } = await signUpWithBackoff(client, email, password, {
    full_name: `Phase0 ${role}`,
    phone: '0809' + Math.floor(1e6 + Math.random() * 8e6),
    category,
    platform_role: role,
    state: 'Kano',
  })
  if (error || !data.session) throw new Error(`signUp(${role}) failed: ${error?.message}`)
  createdEmails.push(email)
  return { client, uid: data.user!.id, email, password }
}

/**
 * Sign in as the persistent admin-explore account when it is available.
 * Returns null rather than throwing, so admin-scoped tests can skip cleanly
 * instead of reporting a false security failure on a machine without it.
 */
export async function adminClient(): Promise<SupabaseClient | null> {
  const client = anonClient()
  const { error } = await client.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  })
  return error ? null : client
}

/** True when the row set is empty — the shape RLS denial usually takes. */
export function isDenied(result: { data: unknown[] | null; error: unknown }): boolean {
  return Boolean(result.error) || (result.data ?? []).length === 0
}
