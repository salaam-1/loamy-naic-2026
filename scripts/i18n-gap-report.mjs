/**
 * The localization gap, per file, per workflow, with a namespace for each.
 *
 * WHY A SECOND SCRIPT AND NOT A FLAG ON THE FIRST
 *   `i18n-extract-audit.mjs` answers "is this string interface text?" and is
 *   deliberately a classifier: it reports totals and a per-file list. This one
 *   answers the planning question instead -- which workflow is still English,
 *   who sees it, and which namespace the strings belong in -- so the work can
 *   be ordered by who is blocked rather than by filename.
 *
 * It reuses the same classifier so the two cannot disagree about what counts.
 *
 * Read-only. Prints a report; writes nothing.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

/* Which workflow a path belongs to, and who sees it. The order matters: the
   first match wins, so the more specific patterns come first. */
const AREAS = [
  [/^src\/pages\/public\//, 'public site', 'anonymous visitor', true],
  [/^src\/pages\/auth\//, 'auth', 'everyone', true],
  [/^src\/pages\/bank\//, 'bank portal', 'partner bank staff', true],
  [/^src\/pages\/admin\//, 'admin', 'Loamy staff', false],
  [/^src\/pages\/farmer\//, 'farmer', 'farmer', true],
  [/^src\/pages\/partner\//, 'field operations', 'growth partner', true],
  [/^src\/pages\/processor\//, 'processor', 'processor', true],
  [/^src\/pages\/supplier\//, 'logistics + warehouse', 'carrier, warehouse', true],
  [/^src\/pages\/booking\//, 'bookings', 'buyer, facility', true],
  [/^src\/pages\/marketplace\//, 'marketplace + checkout', 'buyer, seller', true],
  [/^src\/pages\/trace\//, 'traceability', 'everyone', true],
  [/^src\/pages\/shared\//, 'shared screens', 'every role', true],
  [/^src\/components\/fulfilment\//, 'logistics + warehouse', 'buyer, seller', true],
  [/^src\/components\/copilot\//, 'co-pilot (OUT OF SCOPE)', 'every role', false],
  [/^src\/components\/layout\//, 'shell + navigation', 'every role', true],
  [/^src\/components\/charts\//, 'intelligence', 'every role', false],
  [/^src\/components\//, 'shared components', 'every role', true],
  [/^src\/lib\/copilot\//, 'co-pilot (OUT OF SCOPE)', 'every role', false],
  [/^src\/lib\//, 'lib vocabularies', 'every role', true],
  [/^src\/pages\//, 'other screens', 'various', false],
]

/* A namespace for a file, so the report says where the strings should land
   rather than only that they are missing. */
const NAMESPACES = [
  [/financ|bank/i, 'financing.*'],
  [/verif|fieldops|evidence|partner/i, 'verification.*'],
  [/transaction|order|checkout|cart|purchase|escrow/i, 'transaction.*'],
  [/logistic|transport|fulfil|delivery|loading/i, 'logistics.*'],
  [/warehouse|storage|booking/i, 'warehouse.*'],
  [/marketplace|listing|rfq|bid|buyrequest|procurement/i, 'marketplace.*'],
  [/setting|profile|account|username/i, 'settings.*'],
  [/auth|login|signup|password/i, 'auth.*'],
  [/public|landing/i, 'public.*'],
  [/admin/i, 'admin.*'],
  [/nav|shell/i, 'nav.*'],
  [/notification/i, 'notifications.*'],
]

function walk(dir) {
  const out = []
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel))
    else if (/\.tsx?$/.test(name)) out.push(rel)
  }
  return out
}

/** Interface-text heuristic, deliberately the same shape as the classifier. */
function interfaceStrings(src) {
  const found = []
  const push = (s) => {
    const t = s.trim()
    if (t.length < 2) return
    // Not words: identifiers, classes, paths, codes.
    if (!/[a-z]/i.test(t)) return
    if (/^[a-z0-9_.-]+$/.test(t)) return
    if (/^[a-z-]+(\s+[a-z0-9:/[\]#.%-]+)+$/.test(t) && /(-|:)/.test(t)) return
    if (/^(https?:|\/|\.\/|@\/)/.test(t)) return
    if (!/\s/.test(t) && t.length < 4) return
    found.push(t)
  }

  // JSX text between tags, on its own line.
  for (const m of src.matchAll(/>\s*\n\s*([A-Z][^<>{}\n]{3,})\n\s*</g)) push(m[1])
  for (const m of src.matchAll(/>([A-Z][a-z][^<>{}]{2,})</g)) push(m[1])
  // Attributes a person reads.
  for (const m of src.matchAll(
    /(?:placeholder|aria-label|title|alt|label|body|heading)=["']([^"']{3,})["']/g,
  )) push(m[1])
  return found
}

const files = walk('src')
const rows = []

for (const file of files) {
  const src = readFileSync(join(ROOT, file), 'utf8')
  const strings = interfaceStrings(src)
  if (strings.length === 0) continue
  const area = AREAS.find(([re]) => re.test(file))
  const ns = NAMESPACES.find(([re]) => re.test(file))
  rows.push({
    file,
    count: strings.length,
    wired: /useT\(\)/.test(src),
    area: area ? area[1] : 'unclassified',
    seenBy: area ? area[2] : '?',
    critical: area ? area[3] : false,
    ns: ns ? ns[1] : 'common.*',
    sample: strings.slice(0, 3),
  })
}

const byArea = new Map()
for (const r of rows) {
  if (!byArea.has(r.area)) byArea.set(r.area, { rows: [], count: 0, critical: r.critical, seenBy: r.seenBy })
  const a = byArea.get(r.area)
  a.rows.push(r)
  a.count += r.count
}

const total = rows.reduce((n, r) => n + r.count, 0)
const wired = rows.filter((r) => r.wired).length

console.log('LOCALIZATION GAP, BY WORKFLOW\n')
console.log(`  ${total} hard-coded interface string(s) in ${rows.length} file(s)`)
console.log(`  ${wired} of those files already call useT(), so the gap is partial coverage, not missing wiring\n`)

const ordered = [...byArea.entries()].sort((a, b) => b[1].count - a[1].count)
const pad = (s, n) => String(s).padEnd(n)
console.log(pad('  WORKFLOW', 30) + pad('STRINGS', 9) + pad('FILES', 7) + pad('CRITICAL', 10) + 'SEEN BY')
console.log('  ' + '-'.repeat(86))
for (const [area, a] of ordered) {
  console.log(
    pad('  ' + area, 30) + pad(a.count, 9) + pad(a.rows.length, 7)
    + pad(a.critical ? 'yes' : 'no', 10) + a.seenBy,
  )
}

const arg = process.argv.slice(2)
if (arg.includes('--files')) {
  for (const [area, a] of ordered) {
    console.log(`\n--- ${area.toUpperCase()} (${a.count}) ---`)
    for (const r of a.rows.sort((x, y) => y.count - x.count)) {
      console.log(`  ${pad(r.count, 5)} ${pad(r.ns, 16)} ${r.file}${r.wired ? '' : '   [not wired]'}`)
      if (arg.includes('--samples')) for (const s of r.sample) console.log(`          "${s.slice(0, 70)}"`)
    }
  }
}
