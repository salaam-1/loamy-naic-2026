/**
 * Credentials for the QA and verification harnesses.
 *
 * WHY THIS EXISTS
 *   These scripts sign in to the LIVE Supabase project, so they need real
 *   account credentials. Those credentials used to be written straight into
 *   each script as string literals — including the platform admin account —
 *   which meant every harness was one `git push` away from publishing a
 *   working production login.
 *
 *   The values now live in `.env`, which is gitignored (`.gitignore:5`), and
 *   are read from there at run time. Nothing secret stays in a tracked file.
 *
 * WHY `.env` AND NOT `import.meta.env`
 *   Vite only exposes variables prefixed `VITE_` to the browser bundle. These
 *   are deliberately NOT prefixed, so they are readable by these Node scripts
 *   and are never shipped to the client.
 *
 * ADDING A NEW ACCOUNT
 *   Add `QA_PASSWORD_<NAME>=...` to `.env`, then call `secret('QA_PASSWORD_<NAME>')`.
 */
import { readFileSync } from 'node:fs'

let cache = null

function load() {
  if (cache) return cache
  cache = {}
  try {
    const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8')
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#') || !t.includes('=')) continue
      cache[t.slice(0, t.indexOf('=')).trim()] = t.slice(t.indexOf('=') + 1).trim()
    }
  } catch {
    // No .env is a legitimate state (a fresh clone). `secret()` reports it.
  }
  return cache
}

/**
 * Read a credential, or fail loudly.
 *
 * Deliberately throws rather than returning undefined: a harness that silently
 * signs in as nobody produces vacuous passes, which is the exact failure mode
 * this project has been bitten by before.
 */
export function secret(name) {
  const value = process.env[name] ?? load()[name]
  if (!value) {
    throw new Error(
      `Missing credential ${name}.\n` +
      `Add it to .env (gitignored) or export it in your shell before running this script.`,
    )
  }
  return value
}
