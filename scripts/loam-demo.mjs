/**
 * The Phase 1 vertical slice against the REAL model.
 *
 * The unit tests script N-ATLaS so they can assert the boundaries
 * deterministically. This does the opposite: it drives the whole slice end to
 * end -- browser-equivalent POST -> Vite middleware -> orchestrator -> evidence
 * retrieval -> prompt -> real N-ATLaS -> guard -> response -- and prints what
 * actually comes back, including whether the guard intervened.
 *
 * Run against a dev server started with `npm run dev:test`, which points at
 * STAGING. The environment guard refuses a protected project, so this cannot be
 * pointed at production by accident.
 *
 *   node scripts/loam-demo.mjs [baseUrl]
 */
import { assertServedProjectNotProduction, testEnv, testSecret } from './_environment.mjs'

const BASE = process.argv[2] ?? 'http://localhost:5200'
await assertServedProjectNotProduction(BASE, 'scripts/loam-demo.mjs')

/** Sign in so the personal scenario has real Level 1 rows to find. */
async function signIn() {
  let env, email, password
  // testEnv and testSecret both THROW when staging is unconfigured, which is
  // the right behaviour for them and the wrong behaviour here: a missing
  // fixture should downgrade the demo, not abort it.
  try {
    env = testEnv('scripts/loam-demo.mjs')
    email = testSecret('LOAMY_TEST_FARMER_EMAIL')
    password = testSecret('LOAMY_TEST_FARMER_PASSWORD')
  } catch (e) {
    console.log(`  (no staging fixture: ${e.message.split(String.fromCharCode(10))[0]})`)
    return null
  }
  const res = await fetch(`${env.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    // testEnv returns { url, key, ref } -- `key`, not `anonKey`. Sending
    // undefined here produced a silent 401 and a demo that quietly skipped
    // the only scenario that exercises Level 1.
    headers: { apikey: env.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    console.log(`  (sign-in failed: HTTP ${res.status})`)
    return null
  }
  const body = await res.json()
  return body.access_token ?? null
}

const LEVEL = { 1: 'L1 Loamy data', 2: 'L2 guidance', 3: 'L3 model reasoning', 4: 'L4 unavailable' }

async function ask(label, body, token) {
  const t0 = Date.now()
  const res = await fetch(`${BASE}/loam/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  })
  const wall = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`\n${'='.repeat(74)}\n${label}`)
  console.log(`Q: ${body.message}`)
  console.log('-'.repeat(74))
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    console.log(`HTTP ${res.status}: ${err.error ?? '(no message)'}`)
    return { label, ok: false }
  }
  const r = await res.json()
  console.log(r.answer)
  if (r.reasoning?.length) {
    console.log()
    console.log("  [model's own reasoning, shown separately, NOT part of the answer]")
    for (const line of r.reasoning) console.log(`    - ${line}`)
  }
  if (r.dropped?.length) {
    console.log()
    console.log('  [DROPPED by the guard]')
    for (const d of r.dropped) console.log(`    x ${d.text.slice(0, 80)}  <- ${d.reason}`)
  }
  console.log('-'.repeat(74))
  console.log(
    `demand=${r.demand}  ${LEVEL[r.level]}  model=${r.modelUsed ? 'YES' : 'no'}`
    + `  declined=${r.declined}  guard.fellBack=${r.guard.fellBack}`
    + `  inference=${r.modelMs ? (r.modelMs / 1000).toFixed(1) + 's' : '-'}  wall=${wall}s`,
  )
  if (r.guard.reason) console.log(`guard: ${r.guard.reason}`)
  if (r.timings) {
    const t = r.timings
    console.log(
      `timings: auth ${r.serverTimings?.authMs ?? '-'}ms | classify ${t.classifyMs}ms`
      + ` | retrieve ${t.retrieveMs}ms | prompt ${t.promptMs}ms | inference ${t.inferenceMs}ms`
      + ` | guard ${t.guardMs}ms | orchestrator ${t.totalMs}ms | request ${r.serverTimings?.requestMs ?? '-'}ms`,
    )
  }
  if (r.evidence.length) {
    console.log('evidence:')
    for (const e of r.evidence) console.log(`  [L${e.level}] ${e.claim.slice(0, 110)}`)
  } else {
    console.log('evidence: (none)')
  }
  return { label, ok: true, r }
}

const token = await signIn()
console.log(`Loam Phase 1 slice against ${BASE}`)
console.log(`signed in: ${token ? 'yes (staging farmer fixture)' : 'no -- the personal scenario will decline'}`)

const results = []
// 1. General agricultural knowledge: Level 2, no database access.
results.push(await ask('1. GENERAL agricultural question', {
  message: 'Why does crop rotation matter?', language: 'en',
}, token))
// 2. The Phase 0 question, now evidence-bounded.
results.push(await ask('2. SPECIFIC question requiring retrieved evidence (the Phase 0 failure)', {
  message: 'When should I plant maize in Kaduna?', language: 'en',
}, token))
// 3. The same question in Hausa.
results.push(await ask('3. The same question in HAUSA', {
  message: 'Yaushe zan shuka masara a jihar Kaduna?', language: 'ha',
}, token))
// 3b/3c. Igbo and Yoruba smoke tests. N-ATLaS covers both; Loam's own
// deterministic sentences do not, so a decline in these languages still reads
// in English. The ANSWER is in the right language because the model writes it.
results.push(await ask('3b. The same question in IGBO (smoke test)', {
  message: 'Kedu mgbe m kwesiri iku oka na Kaduna?', language: 'ig',
}, token))
results.push(await ask('3c. The same question in YORUBA (smoke test)', {
  message: 'Nigba wo ni mo le gbin agbado ni ipinle Kaduna?', language: 'yo',
}, token))
// 4. Real Loamy data, scoped to the signed-in member by RLS.
results.push(await ask('4. Answered from REAL LOAMY DATA (RLS-scoped)', {
  message: "What's on my farm?", language: 'en',
}, token))
// 5. No evidence: Loam must decline rather than invent.
results.push(await ask('5. NO EVIDENCE -- must decline, not invent', {
  message: 'When should I plant pineapple in Sokoto?', language: 'en',
}, token))
// 6. Price forecasting, refused before inference.
results.push(await ask('6. PRICE FORECAST -- refused by policy, before the model', {
  message: 'What will maize cost in March?', language: 'en',
}, token))

console.log(`\n${'='.repeat(74)}\nSUMMARY\n${'='.repeat(74)}`)
console.log('scenario                                        demand     level  model  declined')
for (const x of results) {
  if (!x.ok) { console.log(`${x.label.slice(0, 46).padEnd(46)}  REQUEST FAILED`); continue }
  const r = x.r
  console.log(
    `${x.label.slice(0, 46).padEnd(46)}  ${r.demand.padEnd(9)}  L${r.level}     `
    + `${(r.modelUsed ? 'yes' : 'no').padEnd(5)}  ${r.declined ? 'yes' : 'no'}`,
  )
}
// --- latency profile -------------------------------------------------------
// The question Phase 1 could not answer: in a 40-75s response, how much is the
// model and how much is everything Loam puts around it?
const profiled = results.filter((x) => x.ok && x.r.timings && x.r.modelUsed)
if (profiled.length) {
  console.log(`\n${'='.repeat(74)}`)
  console.log('LATENCY PROFILE (model-backed responses only, milliseconds)')
  console.log('='.repeat(74))
  console.log('scenario                                  auth retrieve prompt inference guard request')
  const sum = {
    classifyMs: 0, retrieveMs: 0, promptMs: 0, inferenceMs: 0, guardMs: 0, totalMs: 0,
    authMs: 0, requestMs: 0,
  }
  for (const x of profiled) {
    const t = x.r.timings
    for (const k of Object.keys(t)) sum[k] += t[k]
    sum.authMs += x.r.serverTimings?.authMs ?? 0
    sum.requestMs += x.r.serverTimings?.requestMs ?? t.totalMs
    console.log(
      `${x.label.slice(0, 36).padEnd(36)}  ${String(x.r.serverTimings?.authMs ?? 0).padStart(4)}`
      + ` ${String(t.retrieveMs).padStart(8)} ${String(t.promptMs).padStart(6)}`
      + ` ${String(t.inferenceMs).padStart(9)} ${String(t.guardMs).padStart(5)}`
      + ` ${String(x.r.serverTimings?.requestMs ?? t.totalMs).padStart(7)}`,
    )
  }
  const n = profiled.length
  console.log('-'.repeat(74))
  console.log(
    `${'MEAN'.padEnd(36)}  ${String(Math.round(sum.authMs / n)).padStart(4)}`
    + ` ${String(Math.round(sum.retrieveMs / n)).padStart(8)} ${String(Math.round(sum.promptMs / n)).padStart(6)}`
    + ` ${String(Math.round(sum.inferenceMs / n)).padStart(9)} ${String(Math.round(sum.guardMs / n)).padStart(5)}`
    + ` ${String(Math.round(sum.requestMs / n)).padStart(7)}`,
  )
  const denom = sum.requestMs || sum.totalMs
  console.log(`\ninference is ${((sum.inferenceMs / denom) * 100).toFixed(1)}% of server wall time`)
  console.log(`everything else (auth + retrieve + prompt + guard): ${Math.round((denom - sum.inferenceMs) / n)}ms mean`)
}

const failed = results.filter((x) => !x.ok).length
console.log(`\n${results.length - failed}/${results.length} scenarios returned a response`)
process.exit(failed ? 1 : 0)
