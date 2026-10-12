/**
 * Classify every user-facing string in the application.
 *
 * WHY A CLASSIFIER AND NOT A COUNT
 *   "1,690 hard-coded strings" is not actionable, because they are not all the
 *   same kind of thing. A heading must be translated; a commodity name coming
 *   out of the database must NOT be; a console warning is neither. Counting
 *   them together produces a number that cannot be driven to zero honestly and
 *   tells nobody what to do next.
 *
 *   So each candidate lands in exactly one bucket:
 *
 *     INTERFACE   platform-authored copy a member reads. Must route through
 *                 useT(), even when the translation itself is still English.
 *     DATA        business content rendered from a value: names, references,
 *                 descriptions, commodity text. Never translated.
 *     INTERNAL    developer-facing: console output, thrown Error text that is
 *                 not surfaced, test ids, class names, routes.
 *     DONE        already routed through t().
 *
 * Usage:
 *   node scripts/i18n-extract-audit.mjs            summary + per-area table
 *   node scripts/i18n-extract-audit.mjs --file <p> every candidate in one file
 *   node scripts/i18n-extract-audit.mjs --todo     the INTERFACE backlog, worst first
 *
 * Read-only.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const only = args.includes('--file') ? args[args.indexOf('--file') + 1] : null
const todo = args.includes('--todo')

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(n)) out.push(p.replace(/\\/g, '/'))
  }
  return out
}

/** Strings that are plainly not interface copy. */
const INTERNAL_HINTS = [
  /^https?:/, /^\//, /^#/, /^[a-z]+-[a-z-]+$/, /^[A-Z_]{3,}$/,
  /^\d+$/, /^[a-z]+\.[a-z]+$/i, /^(px|rem|em|vh|vw)$/,
]
/** Props whose value is interface copy. */
const UI_PROPS = /\b(aria-label|aria-description|placeholder|title|label|alt|aria-valuetext)=(?:"([^"]{2,200})"|\{\s*'([^']{2,200})'\s*\})/g
/** JSX text nodes. */
const JSX_TEXT = />\s*([A-Z][^<>{}\n]{1,160}?)\s*</g
/** Sentence-ish literals in TS (toasts, errors, messages built in code). */
const TS_SENTENCE = /[`'"]([A-Z][a-z][^`'"]{8,200}?[.?!])[`'"]/g

function classify(file, value) {
  const v = value.trim()
  if (!v) return null
  if (INTERNAL_HINTS.some((r) => r.test(v))) return 'INTERNAL'
  // Anything with no lowercase letter is almost always a token or an acronym.
  if (!/[a-z]/.test(v)) return 'INTERNAL'
  // Business references are data by definition.
  if (/^(TXN|BATCH|FEE|FIN|BNK)-/.test(v)) return 'DATA'
  if (/^src\/|\.tsx?$|^@\//.test(v)) return 'INTERNAL'
  return 'INTERFACE'
}

const files = only ? [only] : walk('src')
const rows = []

for (const file of files) {
  if (file.includes('/lib/i18n/')) continue // the packs are the translations
  const raw = readFileSync(file, 'utf8')
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const usesT = /\buseT\(\)/.test(raw)

  const seen = new Set()
  const add = (value, kind) => {
    const v = value.trim()
    if (!v || seen.has(v)) return
    seen.add(v)
    const c = kind ?? classify(file, v)
    if (c) rows.push({ file, value: v, kind: c, usesT })
  }

  for (const m of src.matchAll(JSX_TEXT)) add(m[1])
  for (const m of src.matchAll(UI_PROPS)) add(m[2] ?? m[3] ?? '')
  // console.* and thrown errors are developer-facing.
  for (const m of src.matchAll(/console\.\w+\(\s*[`'"]([^`'"]{4,160})/g)) add(m[1], 'INTERNAL')
  if (/\.tsx?$/.test(file) && !/\.tsx$/.test(file)) {
    for (const m of src.matchAll(TS_SENTENCE)) add(m[1])
  }
}

const byKind = (k) => rows.filter((r) => r.kind === k)
const iface = byKind('INTERFACE')

if (only) {
  for (const r of rows) console.log(`  ${r.kind.padEnd(9)} ${r.value.slice(0, 110)}`)
  console.log(`\n${rows.length} candidate(s) in ${only}`)
  process.exit(0)
}

const area = (f) => {
  const m = f.match(/^src\/(pages|components|lib)\/([^/]+)/)
  if (!m) return 'other'
  return m[1] === 'pages' ? `pages/${m[2]}` : m[1]
}

if (todo) {
  const by = new Map()
  for (const r of iface) by.set(r.file, (by.get(r.file) ?? 0) + 1)
  console.log('INTERFACE strings still hard-coded, worst first:\n')
  for (const [f, n] of [...by.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${f}`)
  }
  process.exit(0)
}

console.log('CLASSIFICATION OF USER-FACING STRINGS\n')
console.log(`  INTERFACE (must route through useT)   ${iface.length}`)
console.log(`  DATA      (never translated)          ${byKind('DATA').length}`)
console.log(`  INTERNAL  (developer-facing)          ${byKind('INTERNAL').length}`)
console.log(`  ----------------------------------------------`)
console.log(`  candidates examined                   ${rows.length}`)
console.log()
console.log(`  files containing INTERFACE strings    ${new Set(iface.map((r) => r.file)).size}`)
console.log(`  of those, already calling useT()      ${new Set(iface.filter((r) => r.usesT).map((r) => r.file)).size}`)
console.log()

const perArea = new Map()
for (const r of iface) perArea.set(area(r.file), (perArea.get(area(r.file)) ?? 0) + 1)
console.log('INTERFACE strings by area:')
for (const [a, n] of [...perArea.entries()].sort((x, y) => y[1] - x[1])) {
  console.log(`  ${a.padEnd(26)} ${String(n).padStart(4)}`)
}
process.exitCode = 0
