import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { adminClient } from '../helpers/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * THE MODEL FREEZE.
 *
 * docs/model-freeze.json names, for each concept, the one authoritative table
 * and the functions that own it. This file holds the live database to that
 * manifest.
 *
 * It exists because a prose-only freeze does not survive the next build. The
 * schema already contains five tables that claim to mean "a deal" and four
 * that claim to mean "money moved" — each was added by someone who could not
 * tell which existing table to use. This test makes the next one a failing
 * build rather than a discovery six months later.
 *
 * A failure here is NOT automatically a bug. It means the model changed. The
 * fix is to update docs/model-freeze.json AND
 * docs/loamy-system-of-record.md in the same commit as the migration — which
 * is exactly the deliberation the freeze is for.
 */

interface Concept {
  authoritative_table: string
  authoritative_functions?: string[]
  supporting_tables?: string[]
  views?: string[]
  retained_not_authoritative?: string[]
  rule: string
}

interface Freeze {
  frozen_at: string
  concepts: Record<string, Concept>
  forbidden_new_tables: Record<string, string>
  invariants: string[]
}

const freeze = JSON.parse(
  readFileSync(new URL('../../docs/model-freeze.json', import.meta.url), 'utf8'),
) as Freeze

let admin: SupabaseClient | null
let inventory: {
  tables: string[]
  views: string[]
  loamy_functions: string[]
  tables_without_rls: string[]
} | null = null

beforeAll(async () => {
  admin = await adminClient()
  if (!admin) return
  const { data, error } = await admin.rpc('loamy_model_inventory')
  if (error) throw new Error(`model inventory unavailable: ${error.message}`)
  inventory = data as typeof inventory
}, 120_000)

describe('the frozen model still exists', () => {
  it('has every authoritative table the manifest names', () => {
    if (!inventory) return
    for (const [name, c] of Object.entries(freeze.concepts)) {
      expect(inventory.tables, `${name}: authoritative table is gone`)
        .toContain(c.authoritative_table)
    }
  })

  it('has every authoritative function the manifest names', () => {
    if (!inventory) return
    for (const [name, c] of Object.entries(freeze.concepts)) {
      for (const fn of c.authoritative_functions ?? []) {
        expect(inventory.loamy_functions, `${name}: ${fn} is gone`).toContain(fn)
      }
    }
  })

  it('has every supporting table and view', () => {
    if (!inventory) return
    for (const [name, c] of Object.entries(freeze.concepts)) {
      for (const t of c.supporting_tables ?? []) {
        expect(inventory.tables, `${name}: supporting table ${t} is gone`).toContain(t)
      }
      for (const v of c.views ?? []) {
        expect(inventory.views, `${name}: view ${v} is gone`).toContain(v)
      }
    }
  })

  it('names one authoritative table per concept, and only one', () => {
    // A concept with two authorities has no authority.
    for (const [name, c] of Object.entries(freeze.concepts)) {
      expect(typeof c.authoritative_table, name).toBe('string')
      expect(c.retained_not_authoritative ?? [], `${name} lists its authority as also retained`)
        .not.toContain(c.authoritative_table)
    }
  })

  it('states a rule for every concept, so the freeze is readable by a person', () => {
    for (const [name, c] of Object.entries(freeze.concepts)) {
      expect(c.rule?.length ?? 0, `${name} has no stated rule`).toBeGreaterThan(30)
    }
  })
})

describe('no new abstraction has appeared', () => {
  it('has no unregistered table matching a forbidden concept name', () => {
    if (!inventory) return

    // Everything the manifest already accounts for.
    const known = new Set<string>()
    for (const c of Object.values(freeze.concepts)) {
      known.add(c.authoritative_table)
      for (const t of c.supporting_tables ?? []) known.add(t)
      for (const t of c.retained_not_authoritative ?? []) known.add(t)
    }

    const offenders: string[] = []
    for (const [concept, pattern] of Object.entries(freeze.forbidden_new_tables)) {
      if (concept.startsWith('$')) continue
      const re = new RegExp(pattern)
      for (const t of inventory.tables) {
        if (known.has(t)) continue
        if (re.test(t)) offenders.push(`${t} (looks like another "${concept}")`)
      }
    }

    expect(offenders,
      'A new table appeared in a frozen concept area. If this is intended, update ' +
      'docs/model-freeze.json and docs/loamy-system-of-record.md in the same commit.')
      .toEqual([])
  })

  it('keeps the deal count at exactly one authority and four retained', () => {
    const deal = freeze.concepts.deal
    expect(deal.authoritative_table).toBe('transactions')
    expect(deal.retained_not_authoritative).toHaveLength(4)
  })

  it('keeps money movement double-entry and single-authority', () => {
    const money = freeze.concepts.money_movement
    expect(money.authoritative_table).toBe('ledger_entries')
    expect(money.retained_not_authoritative).toContain('wallet_entries')
  })
})

describe('the invariants the freeze depends on', () => {
  it('has row-level security on EVERY table in public', () => {
    if (!inventory) return
    expect(inventory.tables_without_rls, 'a table in public has no RLS').toEqual([])
  })

  it('still has no column anywhere that could hold a BVN', () => {
    // The column-level assertion lives in hardening-pass.test.ts; this is the
    // structural half — the concept must still name the rule.
    expect(freeze.concepts.financing.rule).toMatch(/no bvn column/i)
  })

  it('lists discovery_events among the append-only logs', () => {
    // Block 3 adds behavioural events. They are a log, not a table members
    // may write to freely, and the freeze says so before the build starts.
    expect(freeze.invariants.join(' ')).toContain('discovery_events')
  })
})
