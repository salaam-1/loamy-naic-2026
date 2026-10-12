/**
 * Which database functions does the product actually need a UI for?
 * Run with: node scripts/function-reachability.mjs   (npm run reachability)
 *
 * WHY THE EARLIER NUMBER WAS WRONG
 *
 *   The first version of this report counted every client-granted function
 *   that src/ did not call and declared the difference "missing features".
 *   That inflated the gap badly. `loamy_trace_batch_for_ref`,
 *   `loamy_trace_scope` and `loamy_trace_resolve` all appeared as gaps while
 *   being server-side helpers that `loamy_trace` calls -- and `loamy_trace`
 *   IS wired, to the Trace Explorer. Wiring them would have exposed internals
 *   to raise a number.
 *
 *   So this version classifies by DEPENDENCY GRAPH rather than by grant:
 *
 *     A USER-FACING     granted to a client role, not a helper/trigger, and
 *                       either already called from src/ or genuinely missing
 *                       a route. Only these can be a product gap.
 *     B ADMIN-FACING    gated on loamy_is_admin()/loamy_is_bank(), or only
 *                       called from admin/bank screens.
 *     C INTERNAL HELPER called from inside another SQL function and not from
 *                       src/. Not a feature; exposing it would be a mistake.
 *     D TRIGGER/EVENT   bound to a CREATE TRIGGER. Never client-invoked.
 *     E SCHEDULED       run on a schedule or by an operator job.
 *     F DEPRECATED      superseded, and documented as such.
 *
 *   Only category A with no caller is a real gap. That is the number to act
 *   on; everything else is noise.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

/**
 * Functions superseded by a newer path. Listed explicitly rather than
 * detected, because a deprecation is a DECISION and the reason belongs with
 * it. The SQL usually carries no note -- the replacement happened in the
 * client, so grepping the migration would never find it.
 *
 * A function here still exists and still has its grant; it is simply no
 * longer the way to do the thing, and must not be counted as a missing
 * feature that somebody should go and wire up.
 */
const DEPRECATED = {
  loamy_gps_check:
    'Superseded by loamy_submit_evidence (P0-3). Wrote a distance into a JSON blob; the replacement writes a real verification_evidence row with a content hash, clock skew and the fraud checks.',
  loamy_review_verification_task:
    'Superseded by loamy_review_verification_case (P0-2). Admin-gated but carried no separation-of-duties check.',
  loamy_wallet_balance:
    'Superseded by loamy_my_financial_activity (P0-1). Implied Loamy holds member funds.',
}
const MIG = join(ROOT, 'supabase', 'migrations')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

// ---- 1. Read every migration once. ----------------------------------------
const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()
const sqlByFile = new Map(files.map((f) => [f, readFileSync(join(MIG, f), 'utf8')]))
const allSql = [...sqlByFile.values()].join('\n')

// ---- 2. Definitions, grants, and each function's own body. -----------------
/** name -> { roles:Set, lastSeen, bodies:string[] } */
const fns = new Map()
const touch = (name) => {
  if (!fns.has(name)) fns.set(name, { roles: new Set(), lastSeen: null, bodies: [] })
  return fns.get(name)
}

for (const [file, sql] of sqlByFile) {
  // Definitions, with their bodies, so we can see who calls whom.
  const defRe = /create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*returns[\s\S]*?\$\$([\s\S]*?)\$\$\s*;/gi
  let d
  while ((d = defRe.exec(sql)) !== null) {
    const e = touch(d[1].toLowerCase())
    e.lastSeen = file
    e.bodies.push(d[3])
  }
  const grantRe = /grant\s+execute\s+on\s+function\s+public\.([a-z0-9_]+)\s*\([^)]*\)\s*to\s+([a-z_,\s]+);/gi
  let g
  while ((g = grantRe.exec(sql)) !== null) {
    const e = touch(g[1].toLowerCase())
    for (const r of g[2].split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) e.roles.add(r)
    e.lastSeen = e.lastSeen ?? file
  }
}

// ---- 3. Trigger bindings. --------------------------------------------------
const triggerBound = new Set(
  [...allSql.matchAll(/execute\s+function\s+public\.([a-z0-9_]+)\s*\(/gi)].map((m) => m[1].toLowerCase()),
)

// ---- 4. Who calls whom, inside SQL. ---------------------------------------
const calledBySql = new Map() // callee -> Set(caller)
for (const [name, e] of fns) {
  for (const body of e.bodies) {
    for (const m of body.matchAll(/public\.([a-z0-9_]+)\s*\(/gi)) {
      const callee = m[1].toLowerCase()
      if (callee === name) continue
      if (!calledBySql.has(callee)) calledBySql.set(callee, new Set())
      calledBySql.get(callee).add(name)
    }
  }
}

// ---- 5. What the client calls. --------------------------------------------
const srcFiles = walk(join(ROOT, 'src')).filter((f) => /\.(ts|tsx)$/.test(f))
const calledFromSrc = new Map()  // name -> Set(file)
const namedInSrc = new Map()     // name -> Set(file)  (lookup-table dispatch)
const dynamic = []
for (const file of srcFiles) {
  const code = readFileSync(file, 'utf8')
  const rel = file.slice(ROOT.length).replace(/\\/g, '/').replace(/^\/?/, '')
  for (const m of code.matchAll(/\.rpc\(\s*'([a-z0-9_]+)'/gi)) {
    const n = m[1].toLowerCase()
    calledFromSrc.set(n, (calledFromSrc.get(n) ?? new Set()).add(rel))
  }
  for (const m of code.matchAll(/'(loamy_[a-z0-9_]+)'/gi)) {
    const n = m[1].toLowerCase()
    namedInSrc.set(n, (namedInSrc.get(n) ?? new Set()).add(rel))
  }
  for (const m of code.matchAll(/\.rpc\(\s*([`A-Za-z_$][^'\s)]*)/g)) {
    if (!m[1].startsWith("'")) dynamic.push(`${rel}: .rpc(${m[1].slice(0, 40)}`)
  }
}

const isAdminScreen = (f) => /\/pages\/admin\/|\/pages\/bank\//.test(f)

// ---- 6. Classify. ----------------------------------------------------------
const CLASS = { A: 'user-facing', B: 'admin-facing', C: 'internal helper', D: 'trigger/event', E: 'scheduled/background', F: 'deprecated' }
const classified = new Map()

for (const [name, e] of fns) {
  const grantedToClient = e.roles.has('authenticated') || e.roles.has('anon')
  const body = e.bodies.join('\n')
  const callers = calledBySql.get(name) ?? new Set()
  const srcCallers = calledFromSrc.get(name) ?? namedInSrc.get(name) ?? new Set()
  const deprecated = /deprecated|superseded|no longer used|do not use/i.test(
    (sqlByFile.get(e.lastSeen) ?? '').split(`function public.${name}`)[0]?.slice(-400) ?? '',
  )

  let cls
  if (name in DEPRECATED) cls = 'F'
  else if (deprecated) cls = 'F'
  else if (triggerBound.has(name)) cls = 'D'
  else if (/^loamy_(run|expire|reconcile|sweep|refresh)_/.test(name)) cls = 'E'
  else if (!grantedToClient) cls = 'C'
  else if (srcCallers.size > 0) {
    cls = [...srcCallers].every(isAdminScreen) ? 'B' : 'A'
  } else if (callers.size > 0) {
    // Granted, but something server-side already calls it and nothing in the
    // product does. That is a helper with a grant it does not need.
    cls = 'C'
  } else if (/loamy_is_admin\(\)|loamy_is_bank\(\)|only an admin|admins only/i.test(body)) {
    cls = 'B'
  } else cls = 'A'

  classified.set(name, {
    cls,
    grantedToClient,
    reached: srcCallers.size > 0,
    srcCallers: [...srcCallers],
    sqlCallers: [...callers],
    lastSeen: e.lastSeen,
  })
}

const byClass = (c) => [...classified.entries()].filter(([, v]) => v.cls === c).sort()
const gaps = byClass('A').filter(([, v]) => !v.reached)
const ungranted = [...calledFromSrc.keys()].filter((n) => !fns.has(n) || !classified.get(n)?.grantedToClient)

// ---- 7. Report. ------------------------------------------------------------
const today = new Date().toISOString().slice(0, 10)
const L = []
L.push('# Function reachability')
L.push('')
L.push(`_Generated ${today} by \`npm run reachability\`. Do not edit by hand._`)
L.push('')
L.push('Classified by DEPENDENCY GRAPH, not by grant. An earlier version of this')
L.push('report counted every client-granted function that `src/` did not call as a')
L.push('missing feature, which badly overstated the gap: `loamy_trace_scope` and')
L.push('friends are helpers that `loamy_trace` calls, and `loamy_trace` is wired.')
L.push('')
L.push('## Classification')
L.push('')
L.push('| Class | Meaning | Count |')
L.push('|---|---|---:|')
for (const [c, label] of Object.entries(CLASS)) {
  L.push(`| ${c} | ${label} | ${byClass(c).length} |`)
}
L.push(`| | **total defined** | **${classified.size}** |`)
L.push('')
L.push('Only **category A with no caller** is a product gap. Everything else is')
L.push('either already reachable, deliberately internal, or not client-invoked at all.')
L.push('')
L.push('## The real gap')
L.push('')
L.push(`**${gaps.length} user-facing functions have no route in the product.**`)
L.push('')
if (gaps.length === 0) L.push('_None._')
for (const [name, v] of gaps) {
  L.push(`- \`${name}\` — last defined in \`${v.lastSeen}\``)
}
L.push('')

if (ungranted.length) {
  L.push('## Called but not granted — fails at runtime')
  L.push('')
  for (const n of ungranted) L.push(`- \`${n}\` — called from ${[...(calledFromSrc.get(n) ?? [])].map((f) => `\`${f}\``).join(', ')}`)
  L.push('')
}
if (dynamic.length) {
  L.push('## Dynamic call sites')
  L.push('')
  for (const d of [...new Set(dynamic)]) L.push(`- \`${d}\``)
  L.push('')
}

for (const [c, label] of Object.entries(CLASS)) {
  const rows = byClass(c)
  if (!rows.length) continue
  L.push(`## ${c} — ${label} (${rows.length})`)
  L.push('')
  for (const [name, v] of rows) {
    if (c === 'F' && DEPRECATED[name]) {
      L.push(`- \`${name}\` — ${DEPRECATED[name]}`)
      continue
    }
    const where = v.reached
      ? `called from ${v.srcCallers.slice(0, 2).map((f) => `\`${f}\``).join(', ')}${v.srcCallers.length > 2 ? ` +${v.srcCallers.length - 2}` : ''}`
      : v.sqlCallers.length
        ? `called by ${v.sqlCallers.slice(0, 2).map((f) => `\`${f}\``).join(', ')}`
        : c === 'A' ? '**no caller — product gap**' : 'not client-invoked'
    L.push(`- \`${name}\` — ${where}`)
  }
  L.push('')
}

writeFileSync(join(ROOT, 'docs', 'function-reachability.md'), L.join('\n'), 'utf8')

console.log(`defined functions : ${classified.size}`)
for (const [c, label] of Object.entries(CLASS)) {
  console.log(`  ${c} ${label.padEnd(22)} ${String(byClass(c).length).padStart(4)}`)
}
console.log(`\nREAL GAP (user-facing, no route): ${gaps.length}`)
if (gaps.length) console.log(gaps.map(([n]) => `  - ${n}`).join('\n'))
if (ungranted.length) console.log(`called-but-not-granted: ${ungranted.join(', ')}`)
console.log('\nwrote docs/function-reachability.md')
