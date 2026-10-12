/**
 * Translation coverage, and what the layer still cannot reach.
 *
 * WHY THIS WAS REWRITTEN IN A.5
 *   The previous version reported two numbers, and both were wrong in ways
 *   that flattered the project:
 *
 *   1. Its key regex was `[a-zA-Z][\w.]*`, which rejects spaces, hyphens and
 *      `&`. So `bank.sector.Trading & Distribution`, `nav.my-listings` and 24
 *      others were INVISIBLE to it: not counted in the canonical total, and
 *      therefore never reportable as untranslated in any locale. A key the
 *      tool cannot see is a key it cannot tell you is missing.
 *
 *   2. Its "still hard-coded" counter scanned JSX text and four attributes.
 *      That is exactly the scan that undercounted every wave: A.1 found 126
 *      strings where it had reported 67, A.3 found 547 where the audit said
 *      278. Copy lives in module constants, status maps, label props and
 *      action metadata, and none of that is a JSX text node.
 *
 *   It also counted things that are not copy at all: Tailwind class strings,
 *   SQL column lists, i18n keys being passed to the translator, and the
 *   English fallback argument of `tOr`, which exists on purpose.
 *
 * WHAT IT DOES NOW
 *   Reads the shared contract in scripts/lib/i18n-contract.mjs, the same
 *   module the test guards use, so the tool and the tests cannot disagree.
 *   Classifies every source string into one of five buckets and prints the
 *   counts with the limitation stated.
 *
 * THE MEASUREMENT IS DELIBERATELY CONSERVATIVE
 *   `candidate` means "this module could not rule out that a member reads
 *   this". It includes dead code it cannot prove dead, server values it cannot
 *   distinguish from copy, and `tOr` fallbacks that are copy by design. A
 *   false positive is preferable to a confident wrong number, because the
 *   confident wrong number is what the last four waves each had to correct.
 *
 * Read-only. No network, no database.
 */
import { readFileSync } from 'node:fs'
import {
  LOCALES, appSources, candidateStrings, classify, fallbackArguments, isDataModule,
  isReferenceKey, packEntries, packMap, stripComments,
} from './lib/i18n-contract.mjs'

// ---------------------------------------------------------------------------
// 1. Pack coverage
// ---------------------------------------------------------------------------

const canonical = packMap('en')
const canonicalValues = new Set(canonical.values())
const renderable = [...canonical.keys()].filter((k) => !isReferenceKey(k))

console.log(`canonical English keys: ${canonical.size}`)
console.log(`  of which rendered interface: ${renderable.length}`)
console.log(`  of which reference vocabulary (term.*, never rendered directly): `
  + `${canonical.size - renderable.length}`)
console.log()
console.log('  locale   keys   coverage   status')
for (const loc of LOCALES) {
  const keys = new Set(packEntries(loc).map((e) => e.key))
  const covered = renderable.filter((k) => keys.has(k)).length
  const pct = renderable.length ? Math.round((covered / renderable.length) * 100) : 0
  const gaps = renderable.length - covered
  const status = loc === 'en' ? 'canonical'
    : pct === 0 ? 'NOT TRANSLATED (falls back to English)'
      : gaps === 0 ? 'complete extraction - NOT native-reviewed'
        : `partial - ${gaps} keys fall back`
  console.log(`  ${loc.padEnd(8)} ${String(covered).padStart(4)}   ${String(pct).padStart(6)}%   ${status}`)

  const stray = [...keys].filter((k) => !canonical.has(k))
  if (stray.length) {
    console.log(`           ${stray.length} key(s) NOT in the English pack (dead or misspelt):`)
    for (const k of stray.slice(0, 8)) console.log(`             ${k}`)
  }
}
console.log()
console.log('  NOTE: "complete extraction" is a claim about keys, not about quality.')
console.log('  No language has been reviewed by a native speaker. See REVIEW_STATUS')
console.log('  in src/lib/i18n/packs/index.ts and src/lib/i18n/glossary.md.')

// ---------------------------------------------------------------------------
// 2. What the layer cannot reach, classified
// ---------------------------------------------------------------------------

const buckets = { class: 0, internal: 0, key: 0, keyed: 0, data: 0, candidate: 0 }
const byFile = new Map()
const files = appSources()

for (const file of files) {
  const raw = readFileSync(file, 'utf8')
  const fileRoutesThroughT = /\buseT\(\)/.test(raw)
  const fallbacks = fallbackArguments(stripComments(raw))
  const isData = isDataModule(file)
  // Count every bucket, so the proportion that IS copy is visible rather than
  // implied. The same stripping the candidate pass uses, so the totals relate.
  let src = stripComments(raw).replace(/^import .*$/gm, '')
  src = src.replace(/\b(t|tOr|tPlural)\(\s*'[^']*'/g, '$1(KEY')
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) {
    const value = (m[1] ?? m[2] ?? '').replace(/\\'/g, "'")
    if (!value) continue
    const bucket = classify(value, {
      canonicalValues, fileRoutesThroughT, isFallbackArg: fallbacks.has(value), isData,
    })
    buckets[bucket]++
  }
  const found = candidateStrings(file, canonicalValues)
  if (found.size) byFile.set(file, found.size)
}

const candidates = [...byFile.values()].reduce((a, b) => a + b, 0)

console.log()
console.log('source strings by classification:')
console.log(`  A  interface candidates        ${String(candidates).padStart(6)}  across ${byFile.size} files`)
console.log(`  B  already-keyed vocabulary    ${String(buckets.keyed).padStart(6)}  (value matches a canonical key in a file that uses useT)`)
console.log(`  C  i18n keys being passed      ${String(buckets.key).padStart(6)}  (the key, not the copy)`)
console.log(`  D  user / business data       ${String(buckets.data).padStart(6)}  (place names, commodity lists, legal text)`)
console.log(`  E  internal identifiers        ${String(buckets.internal).padStart(6)}  (routes, DB columns, enum values, ids)`)
console.log(`      class names and styles     ${String(buckets.class).padStart(6)}`)
console.log()
console.log('  LIMITATIONS, stated rather than hidden:')
console.log('   - A is a CANDIDATE count, not a defect count. It still includes')
console.log('     server-supplied values and dead code this tool cannot prove dead.')
console.log('   - the English fallback argument of tOr is counted in B, not A: the')
console.log('     key exists and the English renders until a pack reaches it.')
console.log('   - No static reachability is attempted. A string behind a condition')
console.log('     is counted.')
console.log('   - B only fires where the file calls useT(); a literal that happens')
console.log('     to match a canonical value in a file with no translator is')
console.log('     counted in A, which is the conservative direction.')
console.log('   - the LIB MAP pattern is not detected. src/lib/roles.ts holds nav')
console.log('     labels that AppShell renders through tOr(`nav.${section}`, label),')
console.log('     so they are keyed; but the English lives in a map in roles.ts and')
console.log('     the tOr call is in another file, so it counts in A. The same')
console.log('     applies to fulfilment.ts, financingLifecycle.ts, rfqs.ts and')
console.log('     fieldops.ts, which is most of the list below. Read a lib file')
console.log('     high in this list as "check whether its map is keyed", not as')
console.log('     "this many strings are unreachable".')

console.log()
console.log('worst 12 files by interface candidates:')
for (const [f, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(n).padStart(4)}  ${f}`)
}

process.exitCode = 0
