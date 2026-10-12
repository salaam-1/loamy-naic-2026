import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  FEE_LABEL, buyerTotal, describeRate, isBuyerPayable,
  type FeeScope, type ResolvedFee,
} from '../../src/lib/fees'

const fee = (over: Partial<ResolvedFee> = {}): ResolvedFee => ({
  scope: 'marketplace_transaction',
  applies: true,
  amount: 50_000,
  basis: 'bps',
  value: 500,
  payer: 'buyer',
  scheduleRef: 'FEE-000001',
  ...over,
})

describe('no rate is written into the product', () => {
  const root = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p, out)
      else if (/\.tsx?$/.test(p)) out.push(p)
    }
    return out
  }

  it('never hardcodes the published fee percentages in a component', () => {
    // §28, in capitals: "DO NOT hardcode these percentages into random UI
    // components." A rate baked into React disagrees with the ledger the
    // moment someone edits the schedule -- and the number the buyer saw is
    // the one they will hold you to.
    const offenders: string[] = []
    for (const f of walk(join(root, 'src'))) {
      const code = readFileSync(f, 'utf8')
      // A percentage applied to a money variable, or the basis-point values
      // for 5% / 3% / 10% used as a literal multiplier.
      if (/\*\s*0\.0[35]\b|\*\s*0\.1\b(?!\d)|\bsubtotal\s*\*\s*\d|\btotal\s*\*\s*0\./.test(code)) {
        offenders.push(f.slice(root.length).replace(/\\/g, '/'))
      }
    }
    expect(offenders, 'fee rates must come from fee_schedules').toEqual([])
  })

  it('resolves fees through the authoritative RPC', () => {
    const lib = readFileSync(join(root, 'src/lib/fees.ts'), 'utf8')
    expect(lib).toContain("rpc('loamy_resolve_fee'")
  })

  it('does not snapshot from the client', () => {
    // Freezing the schedule is the server's job -- the
    // loamy_snapshot_transaction_fee trigger at `accepted`. A client-side
    // snapshot is a number the buyer's browser chose.
    // Comments stripped: a note explaining that snapshotting is the
    // server's job is not a call to it.
    const lib = readFileSync(join(root, 'src/lib/fees.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    expect(lib).not.toContain('loamy_snapshot_transaction_fee')
  })
})

describe('a fee that does not resolve is not a zero fee', () => {
  it('adds nothing to the total', () => {
    expect(buyerTotal(1_000_000, [])).toBe(1_000_000)
  })

  it('is excluded from the payable set', () => {
    expect(isBuyerPayable(fee({ applies: false, amount: 0 }))).toBe(false)
  })

  it('has no rate to describe', () => {
    expect(describeRate(fee({ applies: false }))).toBeNull()
  })
})

describe('who actually pays', () => {
  it('charges the buyer a buyer-payable fee', () => {
    expect(buyerTotal(1_000_000, [fee({ amount: 50_000, payer: 'buyer' })])).toBe(1_050_000)
  })

  it('does NOT charge the buyer a seller-borne fee', () => {
    // Shown for transparency, never added to what the buyer owes.
    expect(buyerTotal(1_000_000, [fee({ amount: 50_000, payer: 'seller' })])).toBe(1_000_000)
    expect(isBuyerPayable(fee({ payer: 'seller' }))).toBe(false)
  })

  it('does NOT charge the buyer a platform-borne fee', () => {
    expect(buyerTotal(1_000_000, [fee({ amount: 50_000, payer: 'platform' })])).toBe(1_000_000)
  })

  it('charges a split fee to the buyer until the schedule carries a ratio', () => {
    // fee_schedules has no split ratio column. Treating half as zero would
    // understate what the buyer owes, which is the error that matters.
    expect(buyerTotal(1_000_000, [fee({ amount: 50_000, payer: 'split' })])).toBe(1_050_000)
  })

  it('sums several payable fees', () => {
    const total = buyerTotal(1_000_000, [
      fee({ scope: 'marketplace_transaction', amount: 50_000, payer: 'buyer' }),
      fee({ scope: 'logistics', amount: 30_000, payer: 'buyer' }),
      fee({ scope: 'warehouse', amount: 20_000, payer: 'seller' }),
    ])
    expect(total).toBe(1_080_000)
  })
})

describe('a rate is shown the way a person reads it', () => {
  it('turns basis points into a percentage', () => {
    // 500bps is how the schedule stores it and is meaningless to a buyer.
    expect(describeRate(fee({ basis: 'bps', value: 500 }))).toBe('5%')
    expect(describeRate(fee({ basis: 'bps', value: 300 }))).toBe('3%')
    expect(describeRate(fee({ basis: 'bps', value: 1000 }))).toBe('10%')
  })

  it('keeps two decimals for a fractional rate', () => {
    expect(describeRate(fee({ basis: 'bps', value: 250 }))).toBe('2.5%')
    expect(describeRate(fee({ basis: 'bps', value: 125 }))).toBe('1.25%')
  })

  it('does not present a flat fee as a percentage', () => {
    expect(describeRate(fee({ basis: 'flat', value: 5000 }))).toBe('fixed')
  })
})

describe('every scope the schedule accepts has a label', () => {
  it('covers every scope present in the live schedule', () => {
    // fee_schedules.scope is a CHECK constraint. A scope with no label would
    // render as a raw enum value in front of a buyer.
    const scopes: FeeScope[] = [
      'marketplace_transaction', 'verification', 'verification_commission',
      'logistics', 'warehouse', 'financing_facilitation', 'withdrawal',
    ]
    for (const s of scopes) {
      expect(FEE_LABEL[s], `${s} has no label`).toBeTruthy()
      expect(FEE_LABEL[s]).not.toContain('_')
    }
  })
})
