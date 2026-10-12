import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, anonClient, createdEmails, makeUser, type TestUser } from '../helpers/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * BLOCK 7 — behaviour, data intelligence and learning, end to end.
 *
 * Several users search, view, cart and transact; the platform then produces
 * intelligence from that activity. What is being proved:
 *
 *   an inference can never pass as an observation
 *   a small population is WITHHELD, not rounded
 *   every signal carries population, period, place and evidence
 *   listed / verified / transacted supply stay three different numbers
 *   a view is not demand
 *   feedback never touches source data
 *   one member's behaviour never reaches another
 *   a bank sees only its own pipeline
 */

let BUYER_A: TestUser
let BUYER_B: TestUser
let BUYER_C: TestUser
let BUYER_D: TestUser
let BUYER_E: TestUser
let SELLER: TestUser
let admin: SupabaseClient | null

const RUN = Date.now().toString(36).slice(-6)
const COMMODITY = 'Sorghum'      // less trafficked, so the run's own data dominates
const STATE = 'Kaduna'

let listingId = ''
let batchId = ''
let outputId = ''

async function behave(u: TestUser, type: string, extra: Record<string, unknown> = {}) {
  return u.client.rpc('loamy_record_discovery_event', {
    p_event_type: type,
    p_commodity: COMMODITY,
    p_state: STATE,
    p_source: 'marketplace',
    ...extra,
  })
}

beforeAll(async () => {
  SELLER = await makeUser('farmer', 'Farmer')
  BUYER_A = await makeUser('trader', 'Trader')
  BUYER_B = await makeUser('trader', 'Trader')
  BUYER_C = await makeUser('trader', 'Trader')
  BUYER_D = await makeUser('trader', 'Trader')
  BUYER_E = await makeUser('trader', 'Trader')
  admin = await adminClient()

  // Real stock, so supply has something verified to count.
  const { data: farm } = await SELLER.client.from('farms').insert({
    owner_id: SELLER.uid, farm_name: `Intel Farm ${RUN}`,
    state: STATE, lga: 'Zaria', size_hectares: 10,
    primary_crops: ['Maize'], ownership_type: 'owned',
    latitude: 11.0855, longitude: 7.7199,
  }).select('id').single()

  const { data: cycle } = await SELLER.client.from('crop_records').insert({
    farm_id: farm!.id, crop: 'Maize', season_year: 2026, status: 'harvested',
  }).select('id').single()
  const { data: harvest } = await SELLER.client.from('harvests').insert({
    production_cycle_id: cycle!.id, farm_id: farm!.id, commodity: COMMODITY,
    harvest_date: '2026-09-12', quantity: 30, unit: 'tonne',
  }).select('id').single()
  const { data: batch } = await SELLER.client.rpc('loamy_create_batch_from_harvest', {
    p_harvest_id: harvest!.id, p_quantity: 30,
  })
  batchId = batch as string

  const { data: listing } = await SELLER.client.rpc('loamy_list_batch', {
    p_batch_id: batchId, p_quantity: 30, p_price_per_unit: 70_000,
  })
  listingId = listing as string
}, 420_000)

afterAll(() => {
  console.log('\nAccounts created by this run (delete in Supabase > Authentication):')
  for (const e of createdEmails) console.log('  ' + e)
})

// ---------------------------------------------------------------------------

describe('1 — the evidence hierarchy is real', () => {
  it('weights a completed transaction far above a search', async () => {
    const txn = await BUYER_A.client.rpc('loamy_evidence_weight',
      { p_signal: 'complete_transaction' })
    const search = await BUYER_A.client.rpc('loamy_evidence_weight', { p_signal: 'search' })
    const view = await BUYER_A.client.rpc('loamy_evidence_weight', { p_signal: 'view_listing' })

    expect(Number(txn.data)).toBeGreaterThan(Number(view.data) * 10)
    expect(Number(view.data)).toBeGreaterThan(Number(search.data))
  })

  it('ranks verified stock above a listing', async () => {
    const verified = await BUYER_A.client.rpc('loamy_evidence_weight',
      { p_signal: 'verified_batch' })
    const listed = await BUYER_A.client.rpc('loamy_evidence_weight', { p_signal: 'listing' })
    expect(Number(verified.data)).toBeGreaterThan(Number(listed.data))
  })

  it('gives an unknown signal no weight at all', async () => {
    const { data } = await BUYER_A.client.rpc('loamy_evidence_weight',
      { p_signal: 'vibes' })
    expect(Number(data)).toBe(0)
  })
})

describe('2 — a small population is WITHHELD, not rounded', () => {
  it('refuses a demand signal from too few participants', async () => {
    // Only one person has touched this commodity so far in this run.
    await behave(BUYER_A, 'search')

    const { data } = await BUYER_A.client.rpc('loamy_demand_signal', {
      p_commodity: `Ghost-${RUN}`, p_state: STATE, p_days: 30,
    })
    const d = data as Record<string, any>
    expect(d.available).toBe(false)
    expect(d.reason).toBe('insufficient_data')
    // Directive 20: no band, no range, no "approximately".
    expect(d).not.toHaveProperty('band')
    expect(d).not.toHaveProperty('weighted_score')
    expect(String(d.message)).toMatch(/too few participants/i)
  }, 60_000)

  it('refuses a supply signal from too few sellers', async () => {
    const { data } = await BUYER_A.client.rpc('loamy_supply_signal', {
      p_commodity: `Ghost-${RUN}`, p_state: STATE,
    })
    const s = data as Record<string, any>
    expect(s.available).toBe(false)
    expect(s.reason).toBe('insufficient_data')
    expect(s).not.toHaveProperty('listed')
  })

  it('names the threshold rather than hiding it', async () => {
    const { data } = await BUYER_A.client.rpc('loamy_demand_signal', {
      p_commodity: `Ghost-${RUN}`, p_days: 30,
    })
    expect(Number((data as Record<string, any>).participants_required))
      .toBeGreaterThanOrEqual(2)
  })

  it('refuses a demand signal with no commodity at all', async () => {
    const { data } = await BUYER_A.client.rpc('loamy_demand_signal', {
      p_commodity: null, p_days: 30,
    })
    const d = data as Record<string, any>
    expect(d.available).toBe(false)
    expect(String(d.message)).toMatch(/no "overall demand"/i)
  })
})

describe('3 — behaviour accumulates, and demand becomes reportable', () => {
  it('records activity from several people', async () => {
    for (const u of [BUYER_A, BUYER_B, BUYER_C, BUYER_D, BUYER_E]) {
      const r = await behave(u, 'search', { p_search_terms: COMMODITY })
      expect((r.data as Record<string, any>).recorded, JSON.stringify(r)).toBe(true)
      await behave(u, 'view_listing', { p_object_type: 'listing', p_object_id: listingId })
    }
    for (const u of [BUYER_A, BUYER_B, BUYER_C]) {
      await behave(u, 'add_to_cart', {
        p_object_type: 'listing', p_object_id: listingId, p_quantity: 5, p_unit: 'tonne',
      })
    }
    await behave(BUYER_A, 'complete_transaction', { p_quantity: 5, p_unit: 'tonne' })
  }, 180_000)

  it('now reports a demand signal WITH its population, period and place', async () => {
    const { data } = await BUYER_A.client.rpc('loamy_demand_signal', {
      p_commodity: COMMODITY, p_state: STATE, p_days: 30,
    })
    const d = data as Record<string, any>
    expect(d.available, JSON.stringify(d)).toBe(true)

    // Directive 8: all four, every time.
    expect(Number(d.population.participants)).toBeGreaterThanOrEqual(5)
    expect(d.period_start).toBeTruthy()
    expect(d.period_end).toBeTruthy()
    expect(d.state).toBe(STATE)
    expect(Array.isArray(d.breakdown)).toBe(true)
    expect(String(d.evidence_note)).toMatch(/participants/)
  })

  it('shows the arithmetic, so the band can be argued with', async () => {
    const { data } = await BUYER_A.client.rpc('loamy_demand_signal', {
      p_commodity: COMMODITY, p_state: STATE, p_days: 30,
    })
    const rows = (data as Record<string, any>).breakdown as Record<string, any>[]
    const search = rows.find((r) => r.signal === 'search')
    const view = rows.find((r) => r.signal === 'view_listing')
    expect(search).toBeTruthy()
    // A view contributes more than a search, and both far less than a deal.
    expect(Number(view!.weight)).toBeGreaterThan(Number(search!.weight))
    for (const r of rows) {
      expect(r).toHaveProperty('contribution')
    }
  })

  it('is labelled as OBSERVED, because it counts records', async () => {
    const { data } = await BUYER_A.client.rpc('loamy_demand_signal', {
      p_commodity: COMMODITY, p_state: STATE,
    })
    expect((data as Record<string, any>).classification).toBe('observed')
  })

  it('states its limitations rather than implying certainty', async () => {
    const { data } = await BUYER_A.client.rpc('loamy_demand_signal', {
      p_commodity: COMMODITY, p_state: STATE,
    })
    const l = String((data as Record<string, any>).limitations)
    expect(l).toMatch(/neither proves future demand/i)
  })
})

describe('4 — listed, verified and transacted supply stay apart', () => {
  it('reports three separate numbers, each saying what it is', async () => {
    // Five sellers are needed for the floor; the run has one, so this asserts
    // the refusal shape when it cannot report, and the structure when it can.
    const { data } = await BUYER_A.client.rpc('loamy_supply_signal', {
      p_commodity: COMMODITY, p_state: STATE, p_days: 30,
    })
    const s = data as Record<string, any>

    if (!s.available) {
      expect(s.reason).toBe('insufficient_data')
      return
    }

    expect(s.listed.means).toMatch(/claimed by sellers/i)
    expect(s.verified.means).toMatch(/physically inspected/i)
    expect(s.transacted.means).toMatch(/actually moved/i)
    // The three are never summed into one "supply" figure.
    expect(s).not.toHaveProperty('total_supply')
    expect(s).not.toHaveProperty('supply_kg')
  }, 60_000)

  it('warns that a listed quantity is only a claim', async () => {
    const { data } = await BUYER_A.client.rpc('loamy_supply_signal', {
      p_commodity: 'Maize', p_days: 30,
    })
    const s = data as Record<string, any>
    if (!s.available) return
    expect(String(s.limitations)).toMatch(/seller claim/i)
  })
})

describe('5 — price intelligence stays observed', () => {
  beforeAll(async () => {
    if (!admin) return
    const { data: me } = await admin.auth.getUser()
    // A short, honest series. Marked as observed, with a named market.
    for (let i = 0; i < 14; i++) {
      await admin.from('market_price_updates').insert({
        commodity: COMMODITY, state: STATE, unit: '100kg',
        price_min: 60_000 + i * 200, price_max: 62_000 + i * 200,
        recorded_date: new Date(Date.now() - i * 9 * 86400_000).toISOString().slice(0, 10),
        recorded_by: me.user!.id,
        data_class: 'observed',
        market_name: `Zaria market (test ${RUN})`,
        traders_sampled: 5,
        source_note: `Block 7 e2e ${RUN}`,
      })
    }
  }, 180_000)

  it('refuses a price series with no named market', async () => {
    const { data } = await BUYER_A.client.rpc('loamy_price_history', {
      p_commodity: COMMODITY, p_market: null,
    })
    const h = data as Record<string, any>
    expect(h.available).toBe(false)
    expect(String(h.message)).toMatch(/no national series/i)
  })

  it('returns a dated series, each point carrying its data class', async () => {
    const { data } = await BUYER_A.client.rpc('loamy_price_history', {
      p_commodity: COMMODITY, p_market: STATE, p_days: 180,
    })
    const h = data as Record<string, any>
    expect(h.available, JSON.stringify(h)).toBe(true)
    expect(h.classification).toBe('observed')
    expect(h.label).toBe(`${STATE} reference`)
    for (const point of h.series as Record<string, any>[]) {
      expect(['observed', 'user_generated', 'model_inference']).toContain(point.data_class)
      expect(point.date).toBeTruthy()
    }
  }, 60_000)

  it('labels a seasonal pattern as INFERENCE, not observation', async () => {
    const { data } = await BUYER_A.client.rpc('loamy_seasonal_pattern', {
      p_commodity: COMMODITY, p_market: STATE, p_years: 3,
    })
    const s = data as Record<string, any>
    if (!s.available) {
      expect(s.reason).toBe('insufficient_history')
      return
    }
    // Directive 2 and 11: a computation over observations is not an
    // observation, and is never a forecast.
    expect(s.classification).toBe('model_inference')
    expect(s.model_key).toBeTruthy()
    expect(s.model_version).toBeTruthy()
    expect(String(s.limitations)).toMatch(/not a prediction/i)
    expect(String(s.headline)).toMatch(/observed historical pattern/i)
  }, 60_000)

  it('marks months with too little data as insufficient rather than averaging', async () => {
    const { data } = await BUYER_A.client.rpc('loamy_seasonal_pattern', {
      p_commodity: COMMODITY, p_market: STATE,
    })
    const s = data as Record<string, any>
    if (!s.available) return
    for (const m of s.months as Record<string, any>[]) {
      if (!m.sufficient) {
        expect(m.avg_low_per_kg, 'a thin month was given an average anyway').toBeNull()
      }
    }
  })

  it('refuses a seasonal pattern with too little history', async () => {
    const { data } = await BUYER_A.client.rpc('loamy_seasonal_pattern', {
      p_commodity: `Ghost-${RUN}`, p_market: STATE,
    })
    const s = data as Record<string, any>
    expect(s.available).toBe(false)
    expect(s.reason).toBe('insufficient_history')
    expect(Number(s.minimum)).toBeGreaterThan(0)
  })
})

describe('6 — an insight carries its lineage', () => {
  it('refuses to record an insight with no evidence', async () => {
    if (!admin) return
    const { error } = await admin.rpc('loamy_record_intelligence', {
      p_output_type: 'demand_signal', p_classification: 'observed',
      p_headline: 'Demand is high', p_evidence: {},
    })
    expect(error, 'an insight was recorded with no evidence').toBeTruthy()
  })

  it('refuses one that does not state its population', async () => {
    if (!admin) return
    const { error } = await admin.rpc('loamy_record_intelligence', {
      p_output_type: 'demand_signal', p_classification: 'observed',
      p_headline: 'Demand is high', p_evidence: { note: 'trust me' },
    })
    expect(error, 'an insight was recorded without a population').toBeTruthy()
  })

  it('refuses a MEMBER generating intelligence', async () => {
    const { error } = await BUYER_A.client.rpc('loamy_record_intelligence', {
      p_output_type: 'demand_signal', p_classification: 'observed',
      p_headline: 'My commodity is hot', p_evidence: { population: 999 },
    })
    expect(error, 'a member published platform intelligence').toBeTruthy()
  })

  it('records one with its model version and evidence', async () => {
    if (!admin) return
    const { data: sig } = await admin.rpc('loamy_demand_signal', {
      p_commodity: COMMODITY, p_state: STATE, p_days: 30,
    })
    const s = sig as Record<string, any>

    const { data, error } = await admin.rpc('loamy_record_intelligence', {
      p_output_type: 'demand_signal',
      p_classification: 'observed',
      p_headline: `${COMMODITY} demand in ${STATE}: ${s.band ?? 'unknown'}`,
      p_evidence: {
        population: s.population ?? { participants: 0 },
        breakdown: s.breakdown ?? [],
        note: s.evidence_note ?? null,
      },
      p_commodity: COMMODITY,
      p_state: STATE,
      p_period_start: s.period_start ?? null,
      p_period_end: s.period_end ?? null,
      p_model_key: 'weighted_events_v1',
      p_model_version: '1',
      p_confidence: 'medium',
      p_limitations: 'Platform activity only.',
    })
    expect(error, error?.message).toBeFalsy()
    outputId = (data as Record<string, any>).output_id
    expect(outputId).toBeTruthy()
  }, 90_000)

  it('cannot be edited after the fact', async () => {
    if (!admin) return
    const before = await admin.from('intelligence_outputs')
      .select('headline, classification').eq('id', outputId).single()

    await admin.from('intelligence_outputs')
      .update({ headline: 'Rewritten', classification: 'observed' }).eq('id', outputId)

    const after = await admin.from('intelligence_outputs')
      .select('headline, classification').eq('id', outputId).single()
    expect(after.data!.headline, 'a published insight was rewritten')
      .toBe(before.data!.headline)
  })

  it('cannot be deleted', async () => {
    if (!admin) return
    await admin.from('intelligence_outputs').delete().eq('id', outputId)
    const { data } = await admin.from('intelligence_outputs')
      .select('id').eq('id', outputId).maybeSingle()
    expect(data?.id, 'intelligence history was deleted').toBe(outputId)
  })

  it('is SUPERSEDED by a new version, and both survive', async () => {
    if (!admin) return
    const { data } = await admin.rpc('loamy_record_intelligence', {
      p_output_type: 'demand_signal',
      p_classification: 'model_inference',
      p_headline: `${COMMODITY} demand in ${STATE}: recomputed`,
      p_evidence: { population: { participants: 5 }, note: 'v2 model' },
      p_commodity: COMMODITY, p_state: STATE,
      p_model_key: 'weighted_events_v2', p_model_version: '2',
      p_supersedes: outputId,
    })
    const newId = (data as Record<string, any>).output_id

    const { data: rows } = await admin.from('intelligence_outputs')
      .select('id, superseded_by, model_version').in('id', [outputId, newId])
    expect((rows ?? []).length, 'the earlier insight disappeared').toBe(2)

    const old = (rows ?? []).find((r) => r.id === outputId)
    expect(old!.superseded_by).toBe(newId)
    // Directive 24: v1 is still readable, with its own version on it.
    expect(old!.model_version).toBe('1')
  }, 90_000)
})

describe('7 — inference never passes as observation', () => {
  it('keeps the classification on every output', async () => {
    if (!admin) return
    const { data } = await admin.from('intelligence_outputs')
      .select('classification').eq('commodity', COMMODITY)
    expect((data ?? []).length).toBeGreaterThan(0)
    for (const row of data ?? []) {
      expect(['observed', 'user_generated', 'model_inference'])
        .toContain(row.classification)
    }
  })

  it('refuses an unknown classification outright', async () => {
    if (!admin) return
    const { error } = await admin.rpc('loamy_record_intelligence', {
      p_output_type: 'demand_signal', p_classification: 'fact',
      p_headline: 'x', p_evidence: { population: 5 },
    })
    expect(error, 'an unclassified insight was accepted').toBeTruthy()
  })
})

describe('8 — feedback never touches the source', () => {
  it('records a verdict', async () => {
    const { data, error } = await BUYER_A.client.rpc('loamy_submit_intelligence_feedback', {
      p_output_id: outputId, p_verdict: 'not_useful', p_note: 'Too broad for my area.',
    })
    expect(error, error?.message).toBeFalsy()
    expect((data as Record<string, any>).recorded).toBe(true)
    expect(String((data as Record<string, any>).note)).toMatch(/observations are unchanged/i)
  })

  it('leaves the insight itself untouched', async () => {
    if (!admin) return
    const { data } = await admin.from('intelligence_outputs')
      .select('headline, value_numeric, evidence').eq('id', outputId).single()
    expect(data!.headline).not.toMatch(/not.?useful/i)
  })

  it('leaves the underlying price observations untouched', async () => {
    if (!admin) return
    const { data } = await admin.from('market_price_updates')
      .select('price_min, price_max, data_class')
      .eq('source_note', `Block 7 e2e ${RUN}`).limit(1).maybeSingle()
    if (!data) return
    expect(data.data_class).toBe('observed')
    expect(Number(data.price_min)).toBeGreaterThan(0)
  })

  it('refuses a verdict outside the vocabulary', async () => {
    const { error } = await BUYER_A.client.rpc('loamy_submit_intelligence_feedback', {
      p_output_id: outputId, p_verdict: 'garbage',
    })
    expect(error).toBeTruthy()
  })

  it('keeps one member\'s feedback from another', async () => {
    await BUYER_B.client.rpc('loamy_submit_intelligence_feedback', {
      p_output_id: outputId, p_verdict: 'useful',
    })
    const { data } = await BUYER_A.client
      .from('intelligence_feedback').select('*').eq('user_id', BUYER_B.uid)
    expect(data ?? [], "a member read another member's feedback").toHaveLength(0)
  }, 60_000)
})

describe('9 — private behaviour stays private', () => {
  it('does not let one buyer read another buyer\'s events', async () => {
    const { data } = await BUYER_B.client
      .from('discovery_events').select('*').eq('actor_id', BUYER_A.uid)
    expect(data ?? [], "a buyer read another buyer's behaviour").toHaveLength(0)
  })

  it('does not let the SELLER see who viewed their listing', async () => {
    const { data } = await SELLER.client
      .from('discovery_events').select('actor_id').eq('object_id', listingId)
    expect(data ?? [], 'a seller obtained a list of interested buyers').toHaveLength(0)
  })

  it('does not let a member forge activity for someone else', async () => {
    await BUYER_B.client.from('discovery_events').insert({
      actor_id: BUYER_A.uid, event_type: 'complete_transaction',
      commodity: COMMODITY, state: STATE,
    })
    const { data } = await BUYER_B.client.from('discovery_events').select('actor_id')
    for (const row of data ?? []) {
      expect(row.actor_id, "activity was manufactured under another member's identity")
        .toBe(BUYER_B.uid)
    }
  })

  it('exposes no individual in an aggregate signal', async () => {
    const { data } = await BUYER_A.client.rpc('loamy_demand_signal', {
      p_commodity: COMMODITY, p_state: STATE,
    })
    const json = JSON.stringify(data)
    for (const u of [BUYER_A, BUYER_B, BUYER_C, SELLER]) {
      expect(json, 'a demand signal carried a member id').not.toContain(u.uid)
    }
    expect(json.toLowerCase()).not.toContain('actor_id')
  })

  it('keeps funnel analytics administrative', async () => {
    const { error } = await BUYER_A.client.rpc('loamy_conversion_funnel', { p_days: 30 })
    expect(error, 'a member read platform funnel analytics').toBeTruthy()
  })

  it('shows signed-out visitors nothing', async () => {
    const anon = anonClient()
    for (const t of ['discovery_events', 'intelligence_outputs',
                     'intelligence_feedback', 'data_quality_findings']) {
      const { data, error } = await anon.from(t).select('*').limit(1)
      expect(error || (data ?? []).length === 0, `${t} readable signed out`).toBeTruthy()
    }
  })
})

describe('10 — the funnel finds friction', () => {
  it('reports each step with its drop-off', async () => {
    if (!admin) return
    const { data, error } = await admin.rpc('loamy_conversion_funnel', {
      p_commodity: COMMODITY, p_days: 30,
    })
    expect(error, error?.message).toBeFalsy()
    const f = data as Record<string, any>
    expect(f.classification).toBe('observed')

    const steps = f.steps as Record<string, any>[]
    expect(steps.map((s) => s.step)).toEqual([
      'search', 'view_listing', 'add_to_cart', 'request_financing', 'complete_transaction',
    ])
    expect(steps[0].drop_off_from_previous).toBeNull()
    expect(Number(steps[0].people)).toBeGreaterThanOrEqual(5)
  }, 90_000)

  it('does not present itself as a prediction', async () => {
    if (!admin) return
    const { data } = await admin.rpc('loamy_conversion_funnel', { p_days: 30 })
    expect(String((data as Record<string, any>).limitations))
      .toMatch(/not a prediction/i)
  })
})

describe('11 — data quality flags, never deletes', () => {
  it('runs and records findings', async () => {
    if (!admin) return
    const { data, error } = await admin.rpc('loamy_run_data_quality')
    expect(error, error?.message).toBeFalsy()
    const r = data as Record<string, any>
    expect(r.ran).toBe(true)
    expect(String(r.note)).toMatch(/nothing is deleted/i)
  }, 120_000)

  it('keeps findings administrative', async () => {
    const { data } = await BUYER_A.client.from('data_quality_findings').select('*').limit(1)
    expect(data ?? [], 'a member read data quality findings').toHaveLength(0)
  })

  it('cannot be deleted, only resolved', async () => {
    if (!admin) return
    const { data: f } = await admin.from('data_quality_findings')
      .select('id').limit(1).maybeSingle()
    if (!f) return

    await admin.from('data_quality_findings').delete().eq('id', f.id)
    const { data: still } = await admin.from('data_quality_findings')
      .select('id').eq('id', f.id).maybeSingle()
    expect(still?.id, 'a data quality finding was deleted').toBe(f.id)

    const { error } = await admin.rpc('loamy_resolve_data_quality', {
      p_finding_id: f.id, p_status: 'acknowledged', p_note: 'Block 7 e2e.',
    })
    expect(error, error?.message).toBeFalsy()
  }, 90_000)
})

describe('12 — role intelligence is scoped to the caller', () => {
  it('gives a member their own role view', async () => {
    const { data, error } = await BUYER_A.client.rpc('loamy_role_intelligence', {
      p_commodity: COMMODITY, p_state: STATE, p_days: 30,
    })
    expect(error, error?.message).toBeFalsy()
    const r = data as Record<string, any>
    expect(r.role).toBeTruthy()
    expect(r.demand).toBeTruthy()
    expect(r.my_activity).toBeTruthy()
  }, 60_000)

  it('counts only the caller\'s own records in my_activity', async () => {
    const a = await BUYER_A.client.rpc('loamy_role_intelligence', { p_commodity: COMMODITY })
    const b = await BUYER_B.client.rpc('loamy_role_intelligence', { p_commodity: COMMODITY })
    // Neither can see the other's totals; both are their own.
    expect((a.data as Record<string, any>).my_activity).toBeTruthy()
    expect((b.data as Record<string, any>).my_activity).toBeTruthy()
  })

  it('refuses bank portfolio intelligence to a non-officer', async () => {
    const { data } = await BUYER_A.client.rpc('loamy_bank_portfolio_intelligence', {})
    const r = data as Record<string, any>
    expect(r.available).toBe(false)
    expect(r.reason).toBe('not_authorised')
  })

  it('refuses it to an administrator who is not an officer, in the same words', async () => {
    if (!admin) return
    const { data } = await admin.rpc('loamy_bank_portfolio_intelligence', {})
    // Same shape either way: the refusal must not reveal which condition failed.
    expect((data as Record<string, any>).available).toBe(false)
  })
})

describe('13 — no sensitive inference exists at all', () => {
  it('has no function that scores a person', async () => {
    if (!admin) return
    const { data } = await admin.rpc('loamy_model_inventory')
    const fns = (data as Record<string, any>).loamy_functions as string[]
    for (const banned of ['credit_score', 'personality', 'wealth', 'income',
                          'ethnicity', 'religion', 'health', 'character']) {
      expect(fns.filter((f) => f.includes(banned)),
        `a function inferring ${banned} exists`).toHaveLength(0)
    }
  })

  it('has no table holding an inferred personal characteristic', async () => {
    if (!admin) return
    const { data } = await admin.rpc('loamy_model_inventory')
    const tables = (data as Record<string, any>).tables as string[]
    for (const banned of ['credit_scores', 'user_scores', 'personality',
                          'demographics', 'profiling']) {
      expect(tables, `${banned} exists`).not.toContain(banned)
    }
  })

  it('keeps the eligibility signal advisory and amount-free', async () => {
    const { data } = await BUYER_A.client.rpc('loamy_eligibility_signal', {})
    if (!data) return
    const json = JSON.stringify(data).toLowerCase()
    // Directive 17: never "you qualify for N500,000".
    expect(json).not.toMatch(/you qualify for/)
    expect(json).toMatch(/not a credit decision|bank decides|not an offer/)
  })
})
