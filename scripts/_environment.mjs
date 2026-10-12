/**
 * Environment separation guard for mutation-heavy scripts.
 *
 * WHY THIS EXISTS
 *   Until now every verification script and QA harness read VITE_SUPABASE_URL
 *   from `.env`, which is production. The audit counted 2,011 profiles in the
 *   production member database against a documented real base of 247, and test
 *   bank rows sitting beside a real institution. The contamination was not an
 *   accident by any one script: it was the default target.
 *
 * HOW IT WORKS
 *   Mutation-heavy code no longer resolves a project from `.env` at all. It
 *   calls `testEnv()`, which reads a SEPARATE `.env.test`, and refuses to
 *   return anything if that file is missing or points at a protected project.
 *
 *   There is deliberately no override flag. "Fail closed" means a missing
 *   staging project stops the run, rather than silently falling back to the one
 *   database that must not be written to.
 *
 * WHAT IS STILL ALLOWED AGAINST PRODUCTION
 *   Read-only work. `scripts/live-smoke.mjs` navigates and reads the live site
 *   and does not call anything here. Reading production is how we verify a
 *   deployment; writing to it is what this module prevents.
 */
import { readFileSync } from 'node:fs'

const CONFIG = JSON.parse(
  readFileSync(new URL('../config/environments.json', import.meta.url), 'utf8'),
)

/** The `<ref>` in https://<ref>.supabase.co, or null if the URL is unusable. */
export function projectRef(url) {
  if (!url) return null
  try {
    const host = new URL(url).host
    const [ref] = host.split('.')
    return ref || null
  } catch {
    return null
  }
}

export function isProtected(url) {
  const ref = projectRef(url)
  return ref !== null && CONFIG.protectedRefs.includes(ref)
}

function parseEnvFile(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8')
        .split('\n')
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
    )
  } catch {
    return null
  }
}

/**
 * Refuse to continue if `url` is a protected project.
 *
 * Call this from anything that writes. It throws rather than returning a
 * boolean so that a forgotten `if` cannot turn the guard into a no-op.
 */
export function assertNotProduction(url, context = 'this script') {
  if (!isProtected(url)) return url
  throw new Error(
    `REFUSED: ${context} would write to the PRODUCTION Supabase project ` +
    `(${projectRef(url)}).\n` +
    `Production holds real Founding Member data and must never be the target ` +
    `of mutation-heavy tests.\n` +
    `Point ${CONFIG.requiredTestVars[0]} at a staging project instead. ` +
    `See docs/environment-separation.md.`,
  )
}

/**
 * Resolve the staging project for mutation-heavy work, or throw.
 *
 * Never falls back to `.env`. A missing `.env.test` is a hard stop.
 */
export function testEnv(context = 'this script') {
  const fromProcess = {
    LOAMY_TEST_SUPABASE_URL: process.env.LOAMY_TEST_SUPABASE_URL,
    LOAMY_TEST_SUPABASE_ANON_KEY: process.env.LOAMY_TEST_SUPABASE_ANON_KEY,
  }
  const fromFile = parseEnvFile(new URL(`../${CONFIG.testEnvFile}`, import.meta.url)) ?? {}
  const url = fromProcess.LOAMY_TEST_SUPABASE_URL || fromFile.LOAMY_TEST_SUPABASE_URL
  const key = fromProcess.LOAMY_TEST_SUPABASE_ANON_KEY || fromFile.LOAMY_TEST_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error(
      `REFUSED: ${context} is mutation-heavy and has no staging project configured.\n` +
      `Set ${CONFIG.requiredTestVars.join(' and ')} in ${CONFIG.testEnvFile} ` +
      `(gitignored) or in the environment.\n` +
      `It deliberately does NOT fall back to .env, because .env is production. ` +
      `See docs/environment-separation.md.`,
    )
  }
  assertNotProduction(url, context)
  return { url, key, ref: projectRef(url) }
}

export const PRODUCTION_REF = CONFIG.production.ref
export const PROTECTED_REFS = CONFIG.protectedRefs

/**
 * Guard for BROWSER fixtures that write through the UI.
 *
 * A harness that clicks "Add to cart" or toggles a wishlist heart persists
 * rows just as surely as an API call does, but it never constructs a Supabase
 * client, so `testEnv()` never sees it. What decides the target is whichever
 * project the DEV SERVER was built against.
 *
 * So ask the running app. Fetch its bundle and read the project reference it
 * actually carries. This is empirical rather than configuration-based: it
 * cannot be fooled by an env file that disagrees with what is being served.
 *
 * Run mutating browser QA against `npm run dev:test`, which loads .env.test.
 */
export async function assertServedProjectNotProduction(baseUrl, context = 'this browser harness') {
  let html
  try {
    html = await (await fetch(baseUrl)).text()
  } catch (e) {
    throw new Error(`REFUSED: ${context} could not reach ${baseUrl} to check which project it serves (${e.message}).`)
  }
  const refs = new Set()
  const scan = (body) => {
    for (const m of body.matchAll(/https:\/\/([a-z0-9]{16,})\.supabase\.co/g)) refs.add(m[1])
  }

  // A production or preview build inlines the URL into a hashed bundle.
  for (const src of [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1])) {
    const u = src.startsWith('http') ? src : new URL(src, baseUrl).href
    try { scan(await (await fetch(u)).text()) } catch { /* unloadable module writes nothing */ }
  }

  // A Vite DEV server serves modules unbundled, so the URL is not in any one
  // script tag. Vite still substitutes import.meta.env at transform time, so
  // the module that reads it carries the value. Without this the guard could
  // never tell what `npm run dev:test` serves, and would refuse every time --
  // which would make it useless for the case it exists to cover.
  if (!refs.size) {
    for (const mod of ['/src/lib/supabase.ts', '/src/main.tsx']) {
      try { scan(await (await fetch(new URL(mod, baseUrl).href)).text()) } catch { /* not a dev server */ }
      if (refs.size) break
    }
  }
  if (!refs.size) {
    throw new Error(
      `REFUSED: ${context} could not determine which Supabase project ${baseUrl} serves. ` +
      `Refusing rather than guessing, because this harness writes through the UI.`,
    )
  }
  for (const ref of refs) {
    assertNotProduction(`https://${ref}.supabase.co`, `${context} (via the dev server at ${baseUrl})`)
  }
  return [...refs]
}

/**
 * A value from `.env.test`, for harnesses that now only ever run against
 * staging. Throws rather than falling back to `.env`, for the same reason
 * `testEnv()` does: `.env` is production.
 */
export function testSecret(name) {
  const fromProcess = process.env[name]
  if (fromProcess) return fromProcess
  const file = parseEnvFile(new URL(`../${CONFIG.testEnvFile}`, import.meta.url)) ?? {}
  const value = file[name]
  if (!value) {
    throw new Error(
      `REFUSED: ${name} is not set in ${CONFIG.testEnvFile}. ` +
      `Staging fixtures are configured there, never in .env, which is production.`,
    )
  }
  return value
}
