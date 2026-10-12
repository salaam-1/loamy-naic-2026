/**
 * How often does N-ATLaS actually produce the citation format?
 *
 * The structural guard is SAFE regardless -- a reply with no markers is
 * discarded rather than trusted -- but it is only USEFUL when the model
 * complies, because a non-compliant reply degrades to the evidence verbatim.
 * Compliance is therefore an answer-quality number, not a safety number, and it
 * was observed to vary between runs. This measures it instead of guessing.
 *
 *   node scripts/loam-compliance.mjs [baseUrl] [runsPerCase]
 */
import { assertServedProjectNotProduction } from './_environment.mjs'

const BASE = process.argv[2] ?? 'http://localhost:5200'
const RUNS = Number(process.argv[3] ?? 4)
await assertServedProjectNotProduction(BASE, 'scripts/loam-compliance.mjs')

const CASES = [
  { tag: 'EN specific', message: 'When should I plant maize in Kaduna?', language: 'en' },
  { tag: 'HA specific', message: 'Yaushe zan shuka masara a jihar Kaduna?', language: 'ha' },
  { tag: 'EN general', message: 'Why does crop rotation matter?', language: 'en' },
]

const rows = []
for (const c of CASES) {
  const outcome = { complied: 0, fellBack: 0, dropped: 0, reasoning: 0, ms: [] }
  for (let i = 0; i < RUNS; i++) {
    const res = await fetch(`${BASE}/loam/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(c),
      signal: AbortSignal.timeout(200_000),
    })
    if (!res.ok) { outcome.fellBack++; continue }
    const r = await res.json()
    outcome.ms.push(r.timings?.inferenceMs ?? 0)
    if (r.guard.fellBack) {
      outcome.fellBack++
      process.stdout.write(`  ${c.tag} run ${i + 1}: FELL BACK (${r.guard.reason})\n`)
    } else {
      outcome.complied++
      process.stdout.write(`  ${c.tag} run ${i + 1}: ok, ${r.answer.split('. ').length} statement(s)`
        + `${r.reasoning?.length ? `, ${r.reasoning.length} reasoning` : ''}`
        + `${r.dropped?.length ? `, ${r.dropped.length} dropped` : ''}\n`)
    }
    outcome.dropped += r.dropped?.length ?? 0
    outcome.reasoning += r.reasoning?.length ?? 0
  }
  rows.push({ tag: c.tag, ...outcome })
}

console.log(`\n${'='.repeat(66)}`)
console.log(`FORMAT COMPLIANCE over ${RUNS} runs per case`)
console.log('='.repeat(66))
console.log('case          usable  fell back  dropped  reasoning  mean inference')
for (const r of rows) {
  const mean = r.ms.length ? Math.round(r.ms.reduce((a, b) => a + b, 0) / r.ms.length / 1000) : 0
  console.log(
    `${r.tag.padEnd(13)} ${String(r.complied).padStart(5)}/${RUNS}`
    + ` ${String(r.fellBack).padStart(9)} ${String(r.dropped).padStart(8)}`
    + ` ${String(r.reasoning).padStart(10)} ${String(mean).padStart(12)}s`,
  )
}
const usable = rows.reduce((a, r) => a + r.complied, 0)
const total = rows.length * RUNS
console.log(`\noverall usable: ${usable}/${total} (${((usable / total) * 100).toFixed(0)}%)`)
console.log('A fall-back is SAFE -- it shows the evidence verbatim -- but it is a')
console.log('worse answer than a compliant one, so this is the number to improve.')
