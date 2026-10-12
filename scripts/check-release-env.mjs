#!/usr/bin/env node
/**
 * Release environment guard. Runs after `vite build`.
 *
 * Answers one question: could this build ship anything that belongs to a test
 * or staging environment?
 *
 * Three ways that could happen, and one check each:
 *
 *   1. A test credential given a VITE_ prefix. Vite compiles anything
 *      VITE_-prefixed into the bundle, so `VITE_QA_PASSWORD_ADMIN` would
 *      publish a working login to every visitor.
 *   2. A test credential VALUE reaching the bundle by some other route.
 *   3. The bundle pointing at the wrong Supabase project, which is how a
 *      production deployment silently starts writing to staging, or a staging
 *      deployment starts writing to production.
 *   4. The bundle pointing the browser at a LOCAL backend, which ships an app
 *      that calls a machine the visitor does not have.
 *
 * Exits non-zero on any of them, so a bad build fails rather than deploys.
 * Safe to run where `.env` and `.env.test` do not exist, such as on Vercel:
 * the file-based checks simply have nothing to compare and say so.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const CONFIG = JSON.parse(readFileSync(new URL('../config/environments.json', import.meta.url), 'utf8'))
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const DIST = join(ROOT, 'dist')

const failures = []
const notes = []

function readEnvFile(name) {
  const p = join(ROOT, name)
  if (!existsSync(p)) return null
  return Object.fromEntries(
    readFileSync(p, 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  )
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(js|css|html|json|map)$/.test(p)) out.push(p)
  }
  return out
}

// ---------------------------------------------------------------------------
// 1. No test-shaped variable may carry a VITE_ prefix, in this process or in
//    any env file this machine has.
// ---------------------------------------------------------------------------
const TEST_SHAPED = /^VITE_(QA_|LOAMY_TEST_|TEST_|STAGING_)/
const offendingNames = new Set()
for (const k of Object.keys(process.env)) if (TEST_SHAPED.test(k)) offendingNames.add(`${k} (process env)`)
for (const file of ['.env', '.env.test', '.env.production']) {
  const vars = readEnvFile(file)
  if (!vars) continue
  for (const k of Object.keys(vars)) if (TEST_SHAPED.test(k)) offendingNames.add(`${k} (${file})`)
}
if (offendingNames.size) {
  failures.push(
    'Test credentials carry a VITE_ prefix and would be compiled into the bundle:\n    ' +
    [...offendingNames].join('\n    '),
  )
}

// ---------------------------------------------------------------------------
// 2. No test credential VALUE may appear in the built output.
// ---------------------------------------------------------------------------
const bundleFiles = walk(DIST)
if (!bundleFiles.length) {
  notes.push('no dist/ to scan (run after `vite build` to include the bundle checks)')
} else {
  const secrets = []
  for (const file of ['.env', '.env.test']) {
    const vars = readEnvFile(file)
    if (!vars) { notes.push(`${file} absent, so its values were not compared`); continue }
    for (const [k, v] of Object.entries(vars)) {
      // Only credential-shaped names, and only values long enough to be real.
      if (!/^(QA_|LOAMY_TEST_)/.test(k)) continue
      if (!v || v.length < 8) continue
      secrets.push({ k, v })
    }
  }
  const leaked = []
  for (const f of bundleFiles) {
    const body = readFileSync(f, 'utf8')
    for (const { k, v } of secrets) if (body.includes(v)) leaked.push(`${k} -> ${f.replace(ROOT, '')}`)
  }
  if (leaked.length) failures.push('Test credential values found inside dist/:\n    ' + leaked.join('\n    '))
  if (secrets.length === 0 && bundleFiles.length) {
    notes.push('no local test credentials available to compare against the bundle')
  }
}

// ---------------------------------------------------------------------------
// 3. The bundle must point at the intended project.
// ---------------------------------------------------------------------------
const target = process.env.LOAMY_BUILD_TARGET ?? 'production'
if (bundleFiles.length) {
  const refs = new Set()
  for (const f of bundleFiles) {
    for (const m of readFileSync(f, 'utf8').matchAll(/https:\/\/([a-z0-9]{16,})\.supabase\.co/g)) refs.add(m[1])
  }
  if (!refs.size) {
    notes.push('no Supabase project reference found in the bundle')
  } else if (target === 'production') {
    const wrong = [...refs].filter((r) => r !== CONFIG.production.ref)
    if (wrong.length) {
      failures.push(
        `A production build points at a non-production Supabase project: ${wrong.join(', ')}.\n` +
        `    Expected ${CONFIG.production.ref}. Set LOAMY_BUILD_TARGET=staging if this is deliberate.`,
      )
    }
  } else {
    const prod = [...refs].filter((r) => CONFIG.protectedRefs.includes(r))
    if (prod.length) {
      failures.push(`A ${target} build points at the PRODUCTION project (${prod.join(', ')}).`)
    }
  }
}

// ---------------------------------------------------------------------------
// 4. A production bundle must not point the browser at a local backend.
//
//    `VITE_LOAM_API_BASE_URL` tells the browser where the Loam backend lives.
//    It is public by design -- a URL, not a credential -- but a PRODUCTION
//    build carrying a loopback address would ship an app that calls a machine
//    the visitor does not have. That failure is invisible until someone opens
//    the network tab, which is exactly the kind of thing a build gate should
//    catch instead.
//
//    Empty is currently correct and is NOT an error: no backend is deployed
//    yet, so same-origin is the honest default. This checks the value when
//    one is set.
// ---------------------------------------------------------------------------
const apiBase = (process.env.VITE_LOAM_API_BASE_URL ?? '').trim()
if (apiBase) {
  let parsed = null
  try { parsed = new URL(apiBase) } catch { /* reported below */ }

  if (!parsed) {
    failures.push(
      `VITE_LOAM_API_BASE_URL "${apiBase}" is not a valid absolute URL.\n` +
      '    The browser would silently fall back to same-origin and find no backend.',
    )
  } else {
    const LOCAL = ['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0']
    if (target === 'production' && LOCAL.includes(parsed.hostname)) {
      failures.push(
        `VITE_LOAM_API_BASE_URL "${apiBase}" is a local address in a production build.\n` +
        '    A visitor cannot reach the developer machine. Point it at the deployed backend.',
      )
    }
    if (target === 'production' && parsed.protocol !== 'https:') {
      failures.push(
        `VITE_LOAM_API_BASE_URL "${apiBase}" is not HTTPS in a production build.\n` +
        '    A member JWT must not travel in plaintext.',
      )
    }
    if (!failures.length) notes.push(`frontend backend base: ${parsed.origin}`)
  }
} else {
  notes.push('VITE_LOAM_API_BASE_URL unset: the frontend calls /loam/chat same-origin')
}

// Belt and braces: whatever the env said, the BUILT bundle must not contain a
// loopback backend address. This catches a value baked in by a different
// mechanism, such as a committed .env.production.
if (bundleFiles.length && target === 'production') {
  /**
   * Matches a loopback origin IMMEDIATELY FOLLOWED BY the chat path, which is
   * the only shape that actually means "the browser will call a local
   * backend".
   *
   * A blunter pattern was tried first and was a false positive: the bundle
   * legitimately contains `http://localhost` from `src/lib/supabase.ts`'s
   * guarded "configure your env" fallback and from supabase-js's own
   * allowlist, plus `http://127.0.0.1:11434` as an ADMIN FORM default in
   * `aiSettings.ts` that the browser never fetches. A check that fires on
   * correct code gets ignored, which is worse than not having it.
   */
  const LOOPBACK_ENDPOINT =
    /https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)(?::\d+)?\/loam\//
  const hits = []
  for (const f of bundleFiles) {
    const m = readFileSync(f, 'utf8').match(LOOPBACK_ENDPOINT)
    if (m) hits.push(`${f.replace(ROOT, '')} (${m[0]})`)
  }
  if (hits.length) {
    failures.push(
      'A loopback backend address is compiled into the production bundle:\n    ' +
      hits.join('\n    '),
    )
  }
}

// ---------------------------------------------------------------------------
console.log(`release env check (target: ${target})`)
for (const n of notes) console.log(`  note: ${n}`)
if (failures.length) {
  console.error('\nFAILED:')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('  OK: no test credential or foreign project reference in this build')
