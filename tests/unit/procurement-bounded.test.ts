import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROCUREMENT_LIST_LIMIT, isCapped } from '../../src/lib/limits'

/**
 * No Processor list read may be unbounded.
 *
 * WHY THIS IS A TEST AND NOT A CODE REVIEW NOTE
 *   PostgREST caps `.select()` at 1000 rows on its own, so an unbounded read
 *   does not fail, does not warn and does not look wrong in the UI. It returns
 *   the first thousand rows in whatever order the planner liked and the screen
 *   presents them as the whole set. The only moment anybody finds out is when
 *   a procurement director asks where their contract went.
 *
 *   So the bound has to be asserted mechanically. A new query added to any of
 *   these modules without `.limit()` fails here.
 *
 * SCOPE IS THE PROCUREMENT CLUSTER, DELIBERATELY
 *   `logistics.ts` also serves the carrier and warehouse-owner boards, and
 *   three of its reads belong to those surfaces rather than to Processor.
 *   They are listed in KNOWN_OUT_OF_WAVE so this test does not quietly become
 *   a platform-wide pagination project, and so that list is the record of what
 *   is still owed.
 */

const ROOT = join(__dirname, '..', '..')

/** Modules the Processor surfaces read through. */
const FILES = [
  'src/lib/rfqs.ts', 'src/lib/bids.ts', 'src/lib/awards.ts', 'src/lib/contracts.ts',
  'src/lib/inspections.ts', 'src/lib/escrow.ts', 'src/lib/procurement.ts',
  'src/lib/companies.ts', 'src/lib/logistics.ts',
]

/**
 * The Bank portal, added in Wave A.4.
 *
 * Its reads live in the COMPONENTS rather than in a lib, because the bank
 * screens query Supabase directly. The tables are a loan book -- facilities,
 * repayment schedules, disbursement records, collateral -- so a silent
 * truncation hides an instalment rather than a listing.
 */
const BANK_FILES = [
  'src/lib/bank.ts', 'src/lib/financing.ts', 'src/lib/financingLifecycle.ts',
  'src/pages/bank/BankAlerts.tsx', 'src/pages/bank/BankApplicationDetail.tsx',
  'src/pages/bank/BankCollateral.tsx', 'src/pages/bank/BankCustomers.tsx',
  'src/pages/bank/BankDisbursements.tsx', 'src/pages/bank/BankFacilityDetail.tsx',
  'src/pages/bank/BankHome.tsx', 'src/pages/bank/BankLoans.tsx',
  'src/pages/bank/BankMonitoring.tsx', 'src/pages/bank/BankRepayments.tsx',
  'src/pages/bank/BankRiskCompliance.tsx', 'src/pages/bank/BankShell.tsx',
  'src/pages/bank/BankTransactions.tsx',
]

/**
 * Reads that belong to the carrier and warehouse-owner surfaces, not to
 * Processor. Each is still unbounded and each is still owed a bound; bounding
 * them belongs to the wave that owns those screens, with their own ordering
 * and their own "showing the first N" copy.
 */
const KNOWN_OUT_OF_WAVE = [
  'loamy_open_transport_jobs',     // the carrier's job board
  'loamy_transport_jobs_v',        // a carrier's own assigned jobs
  'loamy_warehouse_reservations_v', // a warehouse owner's own reservations
]

/** Join each supabase chain into one statement before judging it. */
function statements(src: string): { line: number; text: string }[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const out: { line: number; text: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!(lines[i].includes('.from(') && lines[i].includes('supabase'))) continue
    let text = lines[i]
    let j = i + 1
    while (j < lines.length && lines[j].trimStart().startsWith('.')) {
      text += ' ' + lines[j].trim()
      j++
    }
    out.push({ line: i + 1, text })
    i = j - 1
  }
  return out
}

const BOUNDED = /\.limit\(|\.maybeSingle\(\)|\.single\(\)|count:/

/**
 * A query assigned to a variable and finished elsewhere.
 *
 * `let q = supabase.from('x').select('*')` followed by a conditional `.eq()`
 * and a `.limit()` at the point of use is bounded, but the declaration line is
 * not. Judging the line alone called BankRepayments unbounded when its limit
 * sits six lines down, so the variable is followed instead.
 */
function boundedElsewhere(src: string, stmt: string): boolean {
  const assigned = /(?:const|let)\s+(\w+)\s*=\s*supabase\s*\.from\(/.exec(stmt)
  if (!assigned) return false
  const name = assigned[1]
  // Scanned by hand rather than with a built RegExp: the variable name is
  // interpolated, and a name containing a regex metacharacter would either
  // throw or quietly match the wrong thing.
  const after = src.slice(src.indexOf(stmt) + stmt.length)
  let from = after.indexOf(name)
  while (from !== -1) {
    const window = after.slice(from, from + 400)
    if (window.includes('.limit(')) return true
    from = after.indexOf(name, from + 1)
  }
  return false
}

describe('every procurement read is bounded', () => {
  const offenders: string[] = []
  let readsSeen = 0

  for (const file of [...FILES, ...BANK_FILES]) {
    const src = readFileSync(join(ROOT, file), 'utf8')
    for (const { line, text } of statements(src)) {
      if (!text.includes('.select(')) continue
      readsSeen++
      if (BOUNDED.test(text) || boundedElsewhere(src, text)) continue
      const table = /\.from\('([^']+)'\)/.exec(text)?.[1] ?? '?'
      if (KNOWN_OUT_OF_WAVE.includes(table)) continue
      offenders.push(`${file}:${line} reads ${table} without a limit`)
    }
  }

  it('finds the reads at all', () => {
    // A zero here would make the assertion below vacuous.
    expect(readsSeen).toBeGreaterThan(20)
  })

  it('leaves no unbounded read in the procurement cluster', () => {
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('keeps the out-of-wave list honest', () => {
    // If somebody bounds one of these, it should leave this list rather than
    // sit here implying work that is already done.
    const stillUnbounded = new Set<string>()
    for (const file of FILES) {
      const src = readFileSync(join(ROOT, file), 'utf8')
      for (const { text } of statements(src)) {
        if (!text.includes('.select(') || BOUNDED.test(text)) continue
        const table = /\.from\('([^']+)'\)/.exec(text)?.[1]
        if (table) stillUnbounded.add(table)
      }
    }
    for (const table of KNOWN_OUT_OF_WAVE) {
      expect(
        stillUnbounded.has(table),
        `${table} is now bounded; remove it from KNOWN_OUT_OF_WAVE`,
      ).toBe(true)
    }
  })
})

describe('the cap is legible to the surfaces that use it', () => {
  it('sits below PostgREST’s own ceiling, so ours is the cap that applies', () => {
    expect(PROCUREMENT_LIST_LIMIT).toBeLessThan(1000)
    expect(PROCUREMENT_LIST_LIMIT).toBeGreaterThan(50)
  })

  it('isCapped tells a full page from a partial one', () => {
    expect(isCapped(new Array(PROCUREMENT_LIST_LIMIT).fill(0))).toBe(true)
    expect(isCapped(new Array(PROCUREMENT_LIST_LIMIT - 1).fill(0))).toBe(false)
    expect(isCapped([])).toBe(false)
  })

  it('every bounded read orders by something unique as a tiebreaker', () => {
    // A cap without a deterministic order is a list whose last row changes
    // between loads: two contracts share a created_at, they swap, and the one
    // that falls off the end of the page appears to have been deleted.
    const missing: string[] = []
    for (const file of [...FILES, ...BANK_FILES]) {
      const src = readFileSync(join(ROOT, file), 'utf8')
      for (const { line, text } of statements(src)) {
        if (!/\.limit\((PROCUREMENT_LIST_LIMIT|BANK_LIST_LIMIT)\)/.test(text)) continue
        if (!/\.order\('(id|owner_id)'/.test(text)) {
          missing.push(`${file}:${line} caps without a unique tiebreaker`)
        }
      }
    }
    expect(missing, missing.join('\n')).toEqual([])
  })
})
