/**
 * Find PostgREST reads that fetch a collection with no bound.
 *
 * WHY THIS EXISTS
 *   PostgREST silently caps an unbounded `.select()` at 1000 rows. That is not
 *   a safety net, it is a trap: the request still returns 200, the UI still
 *   renders, and nobody is told that the tail is missing. On this platform it
 *   had already bitten. `profiles` passed 1000 rows, so the admin role-count
 *   page was under-reporting every role, and the admin trend charts were
 *   plotting an arbitrary 1000-row slice of history because the query carried
 *   no ORDER BY either.
 *
 *   So the rule is: a query that returns rows states its own bound. Either a
 *   `.limit()`, a `.range()`, a `.single()`/`.maybeSingle()`, or it is a
 *   `head: true` count that transfers no rows at all.
 *
 * WHAT THE THREE BUCKETS MEAN
 *   PLATFORM-WIDE  no owner filter and no bound. This is the real exposure:
 *                  the collection grows with the platform, not with one member.
 *   owner-scoped   unbounded, but filtered to one member's own rows. Bounded in
 *                  practice by how much that member has done. Worth fixing, not
 *                  urgent.
 *   bounded        already states a limit, a range, a single row, or is a
 *                  head-only count. Left alone.
 *
 * Usage:  node scripts/audit-unbounded-queries.mjs [--all]
 *         --all also lists the owner-scoped and bounded calls.
 *
 * Read-only. Touches no database and no network.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const OWNER =
  /\.eq\(\s*['"](user_id|owner_id|seller_id|buyer_id|applicant_id|profile_id|borrower_id|requester_id|partner_id|assigned_to|facility_id|batch_id|listing_id|rfq_id|transaction_id|company_id|bank_id|id)['"]/
const FROM = /\.from\(\s*['"]([a-z0-9_]+)['"]\s*\)/g
const BOUNDS = ['.limit(', '.range(', '.maybeSingle(', '.single(']

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(name)) out.push(p.replace(/\\/g, '/'))
  }
  return out
}

/** The chained expression starting at the `.from(...)` line. */
function chunkAt(lines, start) {
  const out = [lines[start]]
  for (let i = start + 1; i < Math.min(start + 22, lines.length); i++) {
    out.push(lines[i])
    const t = lines[i].trim()
    if (t === '' || t.startsWith('const ') || t.startsWith('return ') || t.startsWith('}')) break
  }
  return out.join('\n')
}

const findings = []
for (const file of walk('src')) {
  const src = readFileSync(file, 'utf8')
  const lines = src.split(/\r?\n/)
  for (const m of src.matchAll(FROM)) {
    const line = src.slice(0, m.index).split('\n').length - 1
    const text = chunkAt(lines, line)
    if (!text.includes('.select(')) continue // a write, not a read
    const head = text.includes('head: true')
    const bounded = BOUNDS.some((b) => text.includes(b))
    findings.push({
      file,
      line: line + 1,
      table: m[1],
      head,
      bounded,
      owner: OWNER.test(text),
    })
  }
}

const rows = findings.filter((f) => !f.head)
const unbounded = rows.filter((f) => !f.bounded)
const platform = unbounded.filter((f) => !f.owner)
const owned = unbounded.filter((f) => f.owner)

console.log(`select() calls            : ${findings.length}`)
console.log(`  head-only counts        : ${findings.length - rows.length}  (transfer no rows)`)
console.log(`  row-returning           : ${rows.length}`)
console.log(`    bounded               : ${rows.length - unbounded.length}`)
console.log(`    unbounded, owner-scoped : ${owned.length}`)
console.log(`    UNBOUNDED, PLATFORM-WIDE: ${platform.length}`)
console.log()

const group = (list) => {
  const by = new Map()
  for (const f of list) {
    if (!by.has(f.file)) by.set(f.file, [])
    by.get(f.file).push(`${f.table}@${f.line}`)
  }
  for (const f of [...by.keys()].sort()) {
    console.log(`  ${f}`)
    console.log(`      ${by.get(f).join(', ')}`)
  }
}

console.log('PLATFORM-WIDE, UNBOUNDED (fix these first):')
group(platform)

if (process.argv.includes('--all')) {
  console.log('\nowner-scoped, unbounded:')
  group(owned)
}

process.exitCode = 0 // reporting tool, not a gate: it must not fail a build
