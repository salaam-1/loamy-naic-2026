import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Credential literals must not reach tracked source.
 *
 * The admin fixture's email and password sat in `tests/helpers/supabase.ts`
 * for 16 published commits. Rotating that account fixes the exposure; this
 * test is what stops the next one, because the failure mode is not that
 * somebody decided to commit a secret, it is that a quick local edit becomes a
 * commit nobody re-reads.
 *
 * It flags an assignment whose VALUE is a string literal. Anything resolved at
 * run time -- `secret('X')`, `process.env.X`, a destructured variable -- is
 * accepted, because that is the shape a credential is supposed to have.
 */

const ROOTS = ['src', 'scripts', 'tests', 'supabase/functions']
const SKIP_FILE = /\.(png|jpg|jpeg|webp|svg|ico|lock|map)$/i

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.git') continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (!SKIP_FILE.test(p)) out.push(p)
  }
  return out
}

/** A credential-shaped key assigned a string literal of any real length. */
const LITERAL_ASSIGNMENT =
  /(password|passwd|secret|api[_-]?key|token|service_role)\s*[:=]\s*(['"`])([^'"`\n]{8,})\2/gi

/** Values that are obviously not credentials. */
const BENIGN = [
  /^[A-Z_]+$/,                    // an env var NAME being referenced
  /^(REPLACE|CHANGE|YOUR|EXAMPLE|PLACEHOLDER|REDACTED|TODO)/i,
  /^https?:\/\//,                 // a URL
  /^[a-z-]+\/[a-z-]+$/,           // a mime type or path fragment
  /^\s*$/,
]

function isBenign(value: string): boolean {
  return BENIGN.some((re) => re.test(value))
}

/**
 * A literal that is concatenated with something dynamic is a PREFIX, not a
 * credential: `'LoamyStage1-Test!' + Math.random()` produces a value nobody
 * can predict from the source. Flagging those would train people to ignore
 * this test, which is worse than not having it.
 */
function isInterpolated(value: string): boolean {
  // `LoamyWave1-QA!${RUN}` is a template literal whose tail is computed at run
  // time, so the source does not contain the password.
  return value.includes('${')
}

function isDynamicPrefix(line: string): boolean {
  return /\+\s*(Math\.random|Date\.now|[A-Za-z_$][\w$]*)/.test(line)
}

describe('no credential literals in tracked source', () => {
  const files = ROOTS.flatMap((r) => walk(r))
    // This file contains a fabricated example so the pattern can be proven to
    // work; excluding it keeps that demonstration from failing the run.
    .filter((f) => !f.endsWith('no-hardcoded-credentials.test.ts'))

  it('scans a meaningful number of files', () => {
    // Guards the guard: a broken walk() would make this test vacuously green.
    expect(files.length).toBeGreaterThan(100)
  })

  it('finds no password, key or token assigned a string literal', () => {
    const offenders: string[] = []
    for (const f of files) {
      let body: string
      try { body = readFileSync(f, 'utf8') } catch { continue }
      for (const m of body.matchAll(LITERAL_ASSIGNMENT)) {
        const value = m[3]
        if (isBenign(value) || isInterpolated(value)) continue
        const at = m.index ?? 0
        const lineStart = body.lastIndexOf(String.fromCharCode(10), at) + 1
        const nextBreak = body.indexOf(String.fromCharCode(10), at)
        const lineText = body.slice(lineStart, nextBreak === -1 ? undefined : nextBreak)
        if (isDynamicPrefix(lineText)) continue
        const line = body.slice(0, at).split(String.fromCharCode(10)).length
        // Report the location and the KEY only. Never the value.
        offenders.push(`${f}:${line} (${m[1]} assigned a ${value.length}-character literal)`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('accepts run-time resolution, so the rule is followable', () => {
    // The shapes the codebase actually uses must not trip the scanner.
    const samples = [
      "password: secret('QA_PASSWORD_STAGE3')",
      'password: process.env.LOAMY_TEST_ADMIN_PASSWORD',
      'password: ACC[who].password',
      'const { url, key } = testEnv()',
    ]
    for (const s of samples) {
      const hits = [...s.matchAll(LITERAL_ASSIGNMENT)].filter((m) => !isBenign(m[3]))
      expect(hits, s).toEqual([])
    }
  })

  it('would catch a real hardcoded credential', () => {
    // Proves the pattern is not inert. This string is a fabricated example and
    // is not, and never was, a credential for anything.
    const planted = "password: 'NotARealSecret-000'"
    const hits = [...planted.matchAll(LITERAL_ASSIGNMENT)].filter((m) => !isBenign(m[3]))
    expect(hits.length).toBe(1)
  })
})

describe('env files stay out of version control', () => {
  it('ignores .env and .env.test but tracks their templates', () => {
    const ignore = readFileSync('.gitignore', 'utf8')
    expect(ignore).toMatch(/^\.env$/m)
    expect(ignore).toMatch(/^\.env\.\*$/m)
    expect(ignore).toMatch(/^!\.env\.example$/m)
    expect(ignore).toMatch(/^!\.env\.test\.example$/m)
  })

  it('the staging template carries names only, never values', () => {
    const tpl = readFileSync('.env.test.example', 'utf8')
    for (const line of tpl.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#') || !t.includes('=')) continue
      const value = t.slice(t.indexOf('=') + 1).trim()
      if (!value) continue
      // The only permitted values are obvious placeholders.
      expect(value, `${t.slice(0, t.indexOf('='))} has a real-looking value`)
        .toMatch(/REPLACE|EXAMPLE|YOUR/i)
    }
  })
})
