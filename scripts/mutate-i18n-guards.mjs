/**
 * Prove the localization guards actually fail.
 *
 * WHY THIS IS A SCRIPT AND NOT A ONE-OFF
 *   Every guard in this area has been written at least once in a form that
 *   passed while proving nothing. Two examples, both real:
 *
 *     - the first dynamic-key guard used a regex to describe the DANGEROUS
 *       namespaces and matched none of them, including the offender it was
 *       written for. Green, and worthless.
 *     - the interpolation guard read only the remainder of a call's own LINE
 *       and reported ten multi-line calls as passing no variables at all.
 *       Red, and worthless in the other direction.
 *
 *   So "the guard is green" is not evidence. The evidence is that each fault
 *   the guard claims to catch, injected deliberately, turns it red. This runs
 *   that experiment and restores every file afterwards, so the claim can be
 *   re-checked by anybody rather than taken from a report.
 *
 * Usage:  node scripts/mutate-i18n-guards.mjs
 *         node scripts/mutate-i18n-guards.mjs --only=plural-suffix
 *
 * Read-only in effect: it writes a mutation, runs vitest, and restores the
 * original bytes in a finally block. It touches no database and no network.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const SPECS = 'tests/unit/i18n-source-contract.test.ts tests/unit/i18n-pack-invariants.test.ts'
  + ' tests/unit/i18n-formatters.test.ts'

/**
 * Each mutation names the fault class from the brief, the file it breaks, and
 * the exact replacement. `expect` is the test name that must go red.
 */
const MUTATIONS = [
  {
    id: 'missing-key',
    fault: 'referenced key does not exist in canonical English',
    file: 'src/pages/processor/Logistics.tsx',
    from: "t('processor.logistics.hide')",
    to: "t('processor.logistics.hideaway')",
  },
  {
    id: 'stale-rename',
    fault: 'stale key left behind by a rename',
    file: 'src/lib/i18n/packs/en/processor.ts',
    // No newline in the anchor: the packs are CRLF, so a '\n' literal never
    // matched and the run reported this fault class as unproven when it was
    // the SPEC that was broken, not the guard.
    from: "'processor.logistics.hide': 'Hide',",
    to: "'processor.logistics.hidden': 'Hide',",
  },
  {
    id: 'namespace-typo',
    fault: 'namespace typo in a runtime-built key',
    file: 'src/pages/processor/RfqBidsPanel.tsx',
    from: 'processor.awardStage.${stage.slug}',
    to: 'processor.awardStages.${stage.slug}',
  },
  {
    id: 'plural-suffix',
    fault: 'plural key uses a suffix the engine cannot produce',
    file: 'src/lib/i18n/packs/en/processor.ts',
    from: "'processor.bid.awardN_plural'",
    to: "'processor.bid.awardN_other'",
  },
  {
    id: 'source-missing-var',
    fault: 'call site does not supply a variable the English declares',
    file: 'src/pages/processor/Logistics.tsx',
    from: 'quantity: a.awarded_quantity,',
    to: '',
  },
  {
    id: 'translation-new-var',
    fault: 'translation introduces a variable the source cannot supply',
    file: 'src/lib/i18n/packs/fr/bank.ts',
    from: "'bank.facility.instalmentHint': 'Échéance du {date} · {amount}',",
    to: "'bank.facility.instalmentHint': 'Échéance du {date} · {montant}',",
  },
  {
    id: 'translation-drops-var',
    fault: 'translation drops a variable the English declares',
    file: 'src/lib/i18n/packs/ha/bank.ts',
    from: "'bank.decision.requestedHint': 'An nemi {amount}. Kamfaninka ne ke sa adadin.',",
    to: "'bank.decision.requestedHint': 'Kamfaninka ne ke sa adadin.',",
  },
  {
    id: 'duplicate-key',
    fault: 'the same key declared twice in one pack',
    file: 'src/lib/i18n/packs/en/bank.ts',
    from: "  'bank.col.applicant': 'Applicant',",
    to: "  'bank.col.applicant': 'Applicant',\n  'bank.col.amount': 'Sum',",
  },
  {
    id: 'empty-translation',
    fault: 'a translation is an empty string',
    file: 'src/lib/i18n/packs/fr/bank.ts',
    from: "'bank.col.risk': 'Risque',",
    to: "'bank.col.risk': '',",
  },
  {
    id: 'english-copied',
    fault: 'English copied into another pack and counted as translation',
    file: 'src/lib/i18n/packs/ig/bank.ts',
    from: "'bank.decision.title': 'Mkpebi',",
    to: "'bank.decision.title': 'Decision',",
  },
  {
    id: 'legacy-formatter',
    fault: 'a new file starts using the locale-hardcoded date helper',
    file: 'src/pages/bank/BankAlerts.tsx',
    from: "import { useT } from '@/lib/i18n'",
    to: "import { useT } from '@/lib/i18n'\nimport { formatDateLong } from '@/lib/utils'\nconst _unused = formatDateLong",
  },
  {
    id: 'hardcoded-locale',
    fault: 'a formatter is given a locale literal instead of the member locale',
    file: 'src/lib/i18n/format.ts',
    from: 'return new Intl.NumberFormat(LOCALE_META[locale].intl).format(value)',
    to: "return new Intl.NumberFormat('en-NG').format(value)",
  },
]

const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1]
const chosen = only ? MUTATIONS.filter((m) => m.id === only) : MUTATIONS

function runGuards() {
  try {
    execFileSync('npx', ['vitest', 'run', ...SPECS.split(' ')],
      { stdio: 'pipe', encoding: 'utf8', shell: true })
    return { red: false }
  } catch (e) {
    // Vitest colours its output, so the test name has ANSI escapes threaded
    // through it. Without stripping them the match silently produced nothing
    // and every mutation reported "caught <- " with no evidence of BY WHAT.
    const raw = `${e.stdout ?? ''}${e.stderr ?? ''}`
    const out = raw.replace(/\u001b\[[0-9;]*m/g, '')
    const failed = [...out.matchAll(/×\s+(.+?)(?:\s+\d+ms)?$/gm)]
      .map((m) => m[1].trim())
      .filter((n) => n.length > 3)
    return { red: true, failed: [...new Set(failed)] }
  }
}

console.log('baseline: the guards must be GREEN before anything is injected')
const baseline = runGuards()
if (baseline.red) {
  console.log('  ABORT: the guards are already failing. Fix that first.')
  console.log(`  ${baseline.failed?.join('\n  ')}`)
  process.exit(1)
}
console.log('  green\n')

const results = []
for (const m of chosen) {
  const original = readFileSync(m.file, 'utf8')
  if (!original.includes(m.from)) {
    results.push({ ...m, status: 'ANCHOR MISSING' })
    console.log(`${m.id.padEnd(22)} ANCHOR MISSING in ${m.file}`)
    continue
  }
  try {
    writeFileSync(m.file, original.replace(m.from, m.to))
    const r = runGuards()
    results.push({ ...m, status: r.red ? 'caught' : 'NOT CAUGHT', failed: r.failed })
    console.log(`${m.id.padEnd(22)} ${r.red ? 'caught' : 'NOT CAUGHT'}`
      + (r.red ? `  <- ${(r.failed ?? []).slice(0, 2).join(' | ')}` : ''))
  } finally {
    writeFileSync(m.file, original)
  }
}

const missed = results.filter((r) => r.status !== 'caught')
console.log(`\n${results.length - missed.length}/${results.length} mutations caught`)
if (missed.length) {
  console.log('\nNOT CAUGHT -- these fault classes are claimed but not actually guarded:')
  for (const r of missed) console.log(`  ${r.id}: ${r.fault}`)
}
process.exit(missed.length ? 1 : 0)
