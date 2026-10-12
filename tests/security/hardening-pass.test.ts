import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, anonClient, createdEmails, makeUser, type TestUser } from '../helpers/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Hardening pass: the four findings from the full re-audit.
 *
 *   §11/§27  no BVN storage path exists at all
 *   §7       a Growth Partner's identity is not disclosed to the parties
 *   §16      fees are a resolvable schedule and are snapshot onto transactions
 *   §15      reconciliation classifies and audits, and never auto-corrects
 */

let FARMER: TestUser
let BUYER: TestUser
let AGENT: TestUser
let admin: SupabaseClient | null
let farmId = ''
let caseId = ''

beforeAll(async () => {
  FARMER = await makeUser('farmer', 'Farmer')
  BUYER = await makeUser('trader', 'Trader')
  AGENT = await makeUser('growth_partner', 'Growth Partner')
  admin = await adminClient()

  const { data: farm } = await FARMER.client.from('farms').insert({
    owner_id: FARMER.uid, farm_name: 'Hardening Farm', state: 'Benue', lga: 'Makurdi',
    size_hectares: 4, primary_crops: ['Maize'], ownership_type: 'owned',
    latitude: 7.7322, longitude: 8.5391,
  }).select('id').single()
  farmId = farm!.id

  await FARMER.client.rpc('loamy_request_farm_verification_guarded', { p_farm_id: farmId })

  if (admin) {
    const { data: c } = await admin
      .from('verification_tasks').select('id').eq('subject_farm_id', farmId).maybeSingle()
    caseId = c!.id
    await admin.rpc('loamy_set_can_verify', { p_user: AGENT.uid, p_value: true })
    await admin.rpc('loamy_assign_verification_task', { p_task: caseId, p_partner: AGENT.uid })
  }
}, 240_000)

afterAll(() => {
  console.log('\nAccounts created by this run (delete in Supabase > Authentication):')
  for (const e of createdEmails) console.log('  ' + e)
})

describe('§11 — there is no BVN storage path', () => {
  it('has dropped bvn_encrypted and nin_encrypted from profiles', async () => {
    if (!admin) return
    const { error: bvnErr } = await admin.from('profiles').select('bvn_encrypted').limit(1)
    const { error: ninErr } = await admin.from('profiles').select('nin_encrypted').limit(1)
    expect(bvnErr, 'profiles.bvn_encrypted still exists').toBeTruthy()
    expect(ninErr, 'profiles.nin_encrypted still exists').toBeTruthy()
  })

  it('keeps the verified STATUS booleans, which are not the number', async () => {
    const { error } = await FARMER.client
      .from('profiles').select('bvn_verified, nin_verified').eq('id', FARMER.uid).single()
    expect(error).toBeFalsy()
  })

  it('exposes no column that could HOLD a BVN', async () => {
    // The status booleans are explicitly allowed -- they say whether a bank
    // verified someone, not what the number is. Anything else matching /bvn/
    // would be a value-bearing column and is a violation.
    const ALLOWED_STATUS = new Set(['bvn_verified', 'nin_verified'])
    for (const t of ['profiles', 'bank_account_links', 'financing_applications', 'role_details']) {
      const { data } = await FARMER.client.from(t).select('*').limit(1)
      for (const c of Object.keys(data?.[0] ?? {})) {
        if (ALLOWED_STATUS.has(c)) continue
        expect(c.toLowerCase(), `${t}.${c} could hold a BVN`).not.toContain('bvn')
        expect(c.toLowerCase(), `${t}.${c} could hold a NIN`).not.toMatch(/nin_(?!verified)/)
      }
    }
  })
})

describe('§7 — Growth Partner anonymity', () => {
  it('does NOT reveal the agent to the farmer being inspected', async () => {
    const { data } = await FARMER.client.rpc('loamy_my_verification_cases')
    const mine = (data as Record<string, any>[]).find((c) => c.case_id === caseId)
    expect(mine, 'the farmer cannot see their own case at all').toBeTruthy()
    expect(mine!.agent_display).toBe('Loamy Verification Agent')
    // The identity column is not even present in the payload.
    expect(mine!.assigned_to).toBeUndefined()
  })

  it('no longer lets the inspected party read the raw task row', async () => {
    const { data } = await FARMER.client
      .from('verification_tasks').select('assigned_to').eq('id', caseId)
    expect(data ?? [], 'the raw task row still leaks assigned_to').toHaveLength(0)
  })

  it('masks the agent in the cases view for everyone but the agent and admin', async () => {
    const { data } = await BUYER.client
      .from('loamy_verification_cases').select('assigned_to, agent_display').eq('case_id', caseId)
    for (const row of data ?? []) {
      expect(row.assigned_to, 'agent id leaked through the view').toBeNull()
      expect(row.agent_display).toBe('Loamy Verification Agent')
    }
  })

  it('still shows the agent their OWN assignment', async () => {
    const { data } = await AGENT.client
      .from('loamy_verification_cases').select('assigned_to, agent_display').eq('case_id', caseId).maybeSingle()
    expect(data?.assigned_to).toBe(AGENT.uid)
    expect(data?.agent_display).toBe('You')
  })

  it('keeps anti-fraud flags away from the parties', async () => {
    const { data } = await BUYER.client
      .from('loamy_verification_cases').select('flags, sampled_for_review').eq('case_id', caseId)
    for (const row of data ?? []) {
      expect(row.flags, 'a party can see which fraud checks fired').toBeNull()
      expect(row.sampled_for_review).toBeNull()
    }
  })

  it('surfaces repeated agent pairings for conflict review', async () => {
    if (!admin) return
    const { error } = await admin.from('loamy_agent_conflict_signals').select('*').limit(1)
    expect(error, 'conflict signals unreadable by admin').toBeFalsy()
  })
})

describe('§16 — fees are a schedule, not one global number', () => {
  it('resolves a marketplace fee from the schedule', async () => {
    const { data, error } = await BUYER.client.rpc('loamy_resolve_fee', {
      p_scope: 'marketplace_transaction', p_amount: 1_000_000,
    })
    expect(error, error?.message).toBeFalsy()
    const f = data as Record<string, any>
    expect(f.resolved).toBe(true)
    expect(f.schedule_ref).toMatch(/^FEE-\d{6}$/)
    expect(Number(f.fee)).toBeGreaterThanOrEqual(0)
  })

  it('prefers the MORE SPECIFIC rule when one exists', async () => {
    if (!admin) return
    const { data: me } = await admin.auth.getUser()
    await admin.from('fee_schedules').insert({
      scope: 'marketplace_transaction', transaction_type: 'export',
      basis: 'bps', value: 50, payer: 'seller',
      note: 'Test: export-specific', created_by: me.user!.id,
    })
    // Recorded for cleanup. A fee rule written by a test is a LIVE rule:
    // loamy_resolve_fee will hand it to a real member's checkout. Leaving it
    // behind is not untidiness, it is a pricing change.
    FEE_RULE_NOTES.add('Test: export-specific')

    const generic = await BUYER.client.rpc('loamy_resolve_fee', {
      p_scope: 'marketplace_transaction', p_amount: 1_000_000,
    })
    const specific = await BUYER.client.rpc('loamy_resolve_fee', {
      p_scope: 'marketplace_transaction', p_amount: 1_000_000, p_transaction_type: 'export',
    })
    expect((specific.data as Record<string, any>).value).toBe(50)
    expect((specific.data as Record<string, any>).schedule_ref)
      .not.toBe((generic.data as Record<string, any>).schedule_ref)
  }, 60_000)

  it('says so honestly when no rule covers a scope', async () => {
    const { data } = await BUYER.client.rpc('loamy_resolve_fee', {
      p_scope: 'withdrawal', p_amount: 5000,
    })
    const f = data as Record<string, any>
    expect(f.resolved).toBe(false)
    expect(f.reason).toBe('no_rule')
    expect(Number(f.fee)).toBe(0)
  })

  it('respects a flat basis with a cap', async () => {
    if (!admin) return
    const { data: me } = await admin.auth.getUser()
    await admin.from('fee_schedules').insert({
      scope: 'verification', basis: 'flat', value: 7500, payer: 'buyer',
      max_fee: 5000, note: 'Test: capped flat', created_by: me.user!.id,
    })
    FEE_RULE_NOTES.add('Test: capped flat')
    const { data } = await BUYER.client.rpc('loamy_resolve_fee', {
      p_scope: 'verification', p_amount: 0,
    })
    expect(Number((data as Record<string, any>).fee)).toBe(5000)
  }, 60_000)

  it('lets any member read the schedule but not write it', async () => {
    const read = await BUYER.client.from('fee_schedules').select('scope').limit(1)
    expect(read.error).toBeFalsy()

    const { error } = await BUYER.client.from('fee_schedules').insert({
      scope: 'marketplace_transaction', basis: 'bps', value: 0, payer: 'buyer',
    })
    expect(error, 'a member edited the fee schedule').toBeTruthy()
  })
})

/**
 * Fee rules this file creates.
 *
 * These are inserted into the real `fee_schedules` table, which means
 * `loamy_resolve_fee` starts handing them to real members the moment they
 * exist. Before this cleanup was added, every run of the security suite left
 * two more ACTIVE rules behind -- 38 of them had accumulated, including a
 * 0.5% seller-paid rule that would have bound every export transaction.
 *
 * Cleanup is by note, and deletes only rows carrying these exact test
 * markers, so it can never remove a commercial rule.
 */
const FEE_RULE_NOTES = new Set<string>()

afterAll(async () => {
  const client = await adminClient()
  if (!client || FEE_RULE_NOTES.size === 0) return
  for (const note of FEE_RULE_NOTES) {
    const { error } = await client.from('fee_schedules').delete().eq('note', note)
    if (error) console.warn(`fee rule cleanup failed for "${note}": ${error.message}`)
  }
}, 60_000)

describe('§16 — fees are snapshot so history does not move', () => {
  let txnId = ''
  let snapshot: Record<string, any> | null = null

  it('freezes the resolved rule onto the transaction at acceptance', async () => {
    const { data: cycle } = await FARMER.client.from('crop_records').insert({
      farm_id: farmId, crop: 'Maize', season_year: 2026, status: 'harvested',
    }).select('id').single()
    const { data: harvest } = await FARMER.client.from('harvests').insert({
      production_cycle_id: cycle!.id, farm_id: farmId, commodity: 'Maize',
      harvest_date: '2026-09-05', quantity: 10, unit: 'tonne',
    }).select('id').single()
    const { data: batch } = await FARMER.client.rpc('loamy_create_batch_from_harvest', {
      p_harvest_id: harvest!.id, p_quantity: 10,
    })
    const { data: listing } = await FARMER.client.rpc('loamy_list_batch', {
      p_batch_id: batch as string, p_quantity: 10, p_price_per_unit: 100_000,
    })
    const { data: txn } = await BUYER.client.rpc('loamy_propose_transaction', {
      p_listing_id: listing as string, p_quantity: 10,
    })
    await FARMER.client.rpc('loamy_transaction_transition', {
      p_transaction_id: txn as string, p_event_type: 'accept', p_machine: 'status',
    })

    txnId = txn as string
    const { data: t } = await BUYER.client
      .from('transactions').select('fee_snapshot, subtotal').eq('id', txnId).single()
    expect(t!.fee_snapshot, 'no fee was snapshot at acceptance').toBeTruthy()
    const snap = t!.fee_snapshot as Record<string, any>
    expect(snap.resolved).toBe(true)
    expect(snap.schedule_ref).toMatch(/^FEE-\d{6}$/)
    expect(snap.resolved_at).toBeTruthy()
    // The WHOLE rule is frozen, not just the naira figure -- otherwise a
    // partial release would have to re-read the (editable) schedule.
    expect(snap.basis).toBeTruthy()
    expect(snap).toHaveProperty('min_fee')
    expect(snap).toHaveProperty('max_fee')
    snapshot = snap
  }, 120_000)

  it('CHARGES the frozen rule at escrow release, not the live config', async () => {
    if (!admin) return
    expect(snapshot, 'no snapshot to honour').toBeTruthy()

    const { data: esc, error: escErr } = await BUYER.client.rpc('loamy_open_escrow', {
      p_transaction_id: txnId,
    })
    expect(escErr, escErr?.message).toBeFalsy()
    const escrowId = esc as string

    // Move the live global away from the snapshot. If release reads config
    // instead of the snapshot, the numbers below will not match.
    await admin.from('platform_config').update({ platform_fee_bps: 999 }).eq('id', 1)

    try {
      for (const ev of ['funded', 'held', 'loading', 'in_transit', 'delivered']) {
        const { error } = await admin.rpc('loamy_escrow_transition', {
          p_escrow_id: escrowId, p_event_type: ev,
        })
        expect(error, `${ev}: ${error?.message}`).toBeFalsy()
      }
      await BUYER.client.rpc('loamy_escrow_transition', {
        p_escrow_id: escrowId, p_event_type: 'accepted',
      })
      const rel = await admin.rpc('loamy_escrow_transition', {
        p_escrow_id: escrowId, p_event_type: 'released',
      })
      expect(rel.error, rel.error?.message).toBeFalsy()

      const { data: w } = await admin
        .from('escrow_workflows').select('amount').eq('id', escrowId).single()
      const amount = Number(w!.amount)

      let expected = snapshot!.basis === 'bps'
        ? Math.round((amount * Number(snapshot!.value) / 10000) * 100) / 100
        : Number(snapshot!.value)
      if (snapshot!.min_fee != null) expected = Math.max(expected, Number(snapshot!.min_fee))
      if (snapshot!.max_fee != null) expected = Math.min(expected, Number(snapshot!.max_fee))

      const { data: lines } = await admin
        .from('ledger_entries')
        .select('amount, ledger_accounts(account_type)')
        .eq('subject_id', escrowId).eq('event_type', 'escrow_release')
      const revenue = (lines ?? []).find(
        (l: any) => l.ledger_accounts?.account_type === 'platform_revenue')
      expect(revenue, 'release posted no revenue leg').toBeTruthy()
      expect(Math.abs(Number((revenue as any).amount)),
        'the live config was charged instead of the frozen rule').toBeCloseTo(expected, 2)

      // And the release says, on the record, which rule paid.
      const { data: ev } = await admin
        .from('escrow_workflow_events').select('detail')
        .eq('escrow_id', escrowId).eq('event_type', 'released').single()
      const applied = (ev!.detail as Record<string, any>).fee_applied
      expect(applied?.source, 'release did not record which rule it charged').toBe('fee_snapshot')
      expect(applied.schedule_ref).toBe(snapshot!.schedule_ref)
    } finally {
      await admin.from('platform_config').update({ platform_fee_bps: 200 }).eq('id', 1)
    }
  }, 180_000)
})

describe('§15 — reconciliation classifies, and never corrects', () => {
  it('is administrative only', async () => {
    const { error } = await BUYER.client.rpc('loamy_run_reconciliation')
    expect(error, 'a member ran reconciliation').toBeTruthy()
  })

  it('runs, records a run, and reports counts', async () => {
    if (!admin) return expect(admin).toBeNull()
    const { data, error } = await admin.rpc('loamy_run_reconciliation')
    expect(error, error?.message).toBeFalsy()

    const r = data as Record<string, any>
    expect(r.run).toBeTruthy()
    expect(typeof r.checked).toBe('number')
    expect(String(r.note)).toMatch(/never auto-corrected/i)

    const { data: run } = await admin
      .from('reconciliation_runs').select('ref, finished_at, entries_checked')
      .eq('id', r.run).single()
    expect(run!.ref).toMatch(/^REC-\d{6}$/)
    expect(run!.finished_at).toBeTruthy()
  }, 90_000)

  it('writes an audit event for the run', async () => {
    if (!admin) return
    const { data } = await admin
      .from('audit_events').select('event_type, detail')
      .eq('event_type', 'reconciliation_run')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    expect(data, 'a reconciliation run left no audit record').toBeTruthy()
  })

  it('finds the books balanced', async () => {
    if (!admin) return
    const { data } = await admin
      .from('loamy_reconciliation_exceptions').select('kind').eq('kind', 'unbalanced_group')
    expect(data ?? [], 'the ledger does not balance').toHaveLength(0)
  })

  it('keeps reconciliation runs away from members', async () => {
    const { data } = await BUYER.client.from('reconciliation_runs').select('*').limit(1)
    expect(data ?? []).toHaveLength(0)
    const pub = await anonClient().from('reconciliation_runs').select('*').limit(1)
    expect(pub.error || (pub.data ?? []).length === 0).toBeTruthy()
  })
})
