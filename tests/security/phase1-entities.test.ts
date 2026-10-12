import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonClient, createdEmails, makeUser, type TestUser } from '../helpers/supabase'

/**
 * Phase 1: identity, provenance, and the farm -> cycle -> harvest chain.
 *
 * The chain carries quantity and location of real stock, so the read boundary
 * matters as much as the shape. These tests prove both: that the entities work
 * for their owner, and that they are invisible to everyone else.
 */

let A: TestUser   // farmer who owns everything
let B: TestUser   // unrelated farmer
let farmId: string
let farmRef: string
let cycleId: string
let harvestId: string

beforeAll(async () => {
  A = await makeUser('farmer', 'Farmer')
  B = await makeUser('farmer', 'Farmer')

  const { data: farm, error: fErr } = await A.client.from('farms').insert({
    owner_id: A.uid,
    farm_name: 'Phase1 Test Farm',
    state: 'Benue',
    lga: 'Makurdi',
    community: 'Wurukum',
    size_hectares: 10,
    primary_crops: ['Maize'],
    ownership_type: 'owned',
  }).select('id, ref').single()
  if (fErr) throw new Error('farm insert: ' + fErr.message)
  farmId = farm.id
  farmRef = farm.ref

  const { data: cycle, error: cErr } = await A.client.from('crop_records').insert({
    farm_id: farmId,
    crop: 'Maize',
    season_year: 2026,
    planting_date: '2026-04-01',
    expected_harvest_date: '2026-09-01',
    expected_quantity: 12,
    quantity_unit: 'tonne',
    status: 'planted',
  }).select('id, ref').single()
  if (cErr) throw new Error('cycle insert: ' + cErr.message)
  cycleId = cycle.id

  const { data: harvest, error: hErr } = await A.client.from('harvests').insert({
    production_cycle_id: cycleId,
    farm_id: farmId,
    commodity: 'Maize',
    harvest_date: '2026-09-05',
    quantity: 11.4,
    unit: 'tonne',
    quality_grade: 'Grade A',
    location_state: 'Benue',
    location_lga: 'Makurdi',
  }).select('id, ref').single()
  if (hErr) throw new Error('harvest insert: ' + hErr.message)
  harvestId = harvest.id
}, 180_000)

afterAll(() => {
  console.log('\nAccounts created by this run (delete in Supabase > Authentication):')
  for (const e of createdEmails) console.log('  ' + e)
})

describe('reference IDs', () => {
  it('assigns a human-readable ref to every new entity', async () => {
    const { data: c } = await A.client.from('crop_records').select('ref').eq('id', cycleId).single()
    const { data: h } = await A.client.from('harvests').select('ref').eq('id', harvestId).single()
    expect(farmRef).toMatch(/^FARM-\d{6}$/)
    expect(c?.ref).toMatch(/^PROD-\d{6}$/)
    expect(h?.ref).toMatch(/^HARV-\d{6}$/)
  })

  it('registers each ref so it can be resolved back to its entity', async () => {
    const { data } = await A.client
      .from('loamy_entity_refs')
      .select('entity_type, entity_id')
      .eq('ref', farmRef)
      .maybeSingle()
    expect(data?.entity_type).toBe('farm')
    expect(data?.entity_id).toBe(farmId)
  })

  it('never issues the same ref twice', async () => {
    const refs: string[] = []
    for (let i = 0; i < 3; i++) {
      const { data } = await A.client.from('harvests').insert({
        production_cycle_id: cycleId, farm_id: farmId, commodity: 'Maize',
        harvest_date: '2026-09-06', quantity: 1, unit: 'tonne',
      }).select('ref').single()
      refs.push(data!.ref)
    }
    expect(new Set(refs).size).toBe(refs.length)
  }, 60_000)
})

describe('the farm -> cycle -> harvest chain holds together', () => {
  it('exposes the cycle through the directive-named view', async () => {
    const { data } = await A.client
      .from('loamy_production_cycles')
      .select('production_cycle_ref, farm_ref, commodity, season, status')
      .eq('production_cycle_id', cycleId)
      .maybeSingle()
    expect(data?.farm_ref).toBe(farmRef)
    expect(data?.commodity).toBe('Maize')
    expect(data?.season).toBe(2026)
  })

  it('refuses a harvest whose cycle belongs to a different farm', async () => {
    const { data: other } = await A.client.from('farms').insert({
      owner_id: A.uid, farm_name: 'Second Farm', state: 'Benue', lga: 'Gboko',
      size_hectares: 2, primary_crops: ['Rice'], ownership_type: 'owned',
    }).select('id').single()

    const { error } = await A.client.from('harvests').insert({
      production_cycle_id: cycleId,      // cycle on farm 1
      farm_id: other!.id,                // but claiming farm 2
      commodity: 'Maize', harvest_date: '2026-09-07', quantity: 1, unit: 'tonne',
    })
    expect(error, 'a harvest was attached to the wrong farm').toBeTruthy()
  }, 60_000)

  it('refuses a harvest on a farm the caller does not own', async () => {
    const { error } = await B.client.from('harvests').insert({
      production_cycle_id: cycleId, farm_id: farmId, commodity: 'Maize',
      harvest_date: '2026-09-08', quantity: 1, unit: 'tonne',
    })
    expect(error, 'a stranger recorded a harvest on another farm').toBeTruthy()
  })

  it('rejects livestock at the database, not just the form', async () => {
    const { error } = await A.client.from('harvests').insert({
      production_cycle_id: cycleId, farm_id: farmId, commodity: 'Cattle',
      harvest_date: '2026-09-09', quantity: 1, unit: 'unit',
    })
    expect(error).toBeTruthy()
  })

  it('rejects a non-positive quantity', async () => {
    const { error } = await A.client.from('harvests').insert({
      production_cycle_id: cycleId, farm_id: farmId, commodity: 'Maize',
      harvest_date: '2026-09-10', quantity: 0, unit: 'tonne',
    })
    expect(error).toBeTruthy()
  })
})

describe('the chain is private', () => {
  it('another farmer cannot read the harvest', async () => {
    const { data } = await B.client.from('harvests').select('*').eq('id', harvestId)
    expect(data ?? [], 'harvest quantity and location leaked').toHaveLength(0)
  })

  it('another farmer cannot read the production cycle', async () => {
    const { data } = await B.client.from('crop_records').select('*').eq('id', cycleId)
    expect(data ?? []).toHaveLength(0)
  })

  it('anon cannot read harvests or the cycle view', async () => {
    const a = anonClient()
    const h = await a.from('harvests').select('*').limit(1)
    const c = await a.from('loamy_production_cycles').select('*').limit(1)
    expect(h.error || (h.data ?? []).length === 0).toBeTruthy()
    expect(c.error || (c.data ?? []).length === 0).toBeTruthy()
  })
})

describe('provenance never overwrites', () => {
  it('keeps the declared area and the mapped area as separate values', async () => {
    // A rough 1km x 1km square near Makurdi.
    const boundary = {
      type: 'Polygon',
      coordinates: [[
        [8.5000, 7.7300], [8.5090, 7.7300], [8.5090, 7.7390], [8.5000, 7.7390], [8.5000, 7.7300],
      ]],
    }
    const { error } = await A.client.from('farms').update({ boundary }).eq('id', farmId)
    expect(error, `boundary update failed: ${error?.message}`).toBeFalsy()

    const { data } = await A.client
      .from('farms')
      .select('size_hectares, mapped_area_hectares')
      .eq('id', farmId)
      .single()

    // Declared stays exactly as the farmer said it was.
    expect(Number(data!.size_hectares)).toBe(10)
    // Mapped is computed, and is roughly 1km^2 = 100ha for this square.
    expect(Number(data!.mapped_area_hectares)).toBeGreaterThan(80)
    expect(Number(data!.mapped_area_hectares)).toBeLessThan(120)
  })

  it('records successive observations instead of replacing them', async () => {
    await A.client.rpc('loamy_record_observation', {
      p_subject_type: 'farm', p_subject_id: farmId, p_attribute: 'area_hectares',
      p_source: 'user_declared', p_value_numeric: 10, p_unit: 'hectares',
    })
    await A.client.rpc('loamy_record_observation', {
      p_subject_type: 'farm', p_subject_id: farmId, p_attribute: 'area_hectares',
      p_source: 'user_declared', p_value_numeric: 9.2, p_unit: 'hectares',
    })

    const { data } = await A.client
      .from('entity_observations')
      .select('value_numeric, status, source')
      .eq('subject_id', farmId)
      .eq('attribute', 'area_hectares')
      .order('recorded_at', { ascending: true })

    expect((data ?? []).length, 'the earlier observation was destroyed').toBeGreaterThanOrEqual(2)
    expect(data![0].status).toBe('superseded')
    expect(data![data!.length - 1].status).toBe('recorded')
  })

  it('stamps the actor server-side and refuses to be told otherwise', async () => {
    const { data: id } = await A.client.rpc('loamy_record_observation', {
      p_subject_type: 'farm', p_subject_id: farmId, p_attribute: 'condition',
      p_source: 'user_declared', p_value_text: 'good',
    })
    const { data } = await A.client
      .from('entity_observations').select('actor_id').eq('id', id as string).maybeSingle()
    expect(data?.actor_id).toBe(A.uid)
  })

  it('refuses a declared observation about someone else’s farm', async () => {
    const { error } = await B.client.rpc('loamy_record_observation', {
      p_subject_type: 'farm', p_subject_id: farmId, p_attribute: 'area_hectares',
      p_source: 'user_declared', p_value_numeric: 999,
    })
    expect(error, 'a stranger declared a value about another farm').toBeTruthy()
  })

  it('refuses a member claiming a satellite or partner source', async () => {
    for (const source of ['satellite_derived', 'partner_reported', 'system_derived']) {
      const { error } = await A.client.rpc('loamy_record_observation', {
        p_subject_type: 'farm', p_subject_id: farmId, p_attribute: 'area_hectares',
        p_source: source, p_value_numeric: 1,
      })
      expect(error, `a member recorded a ${source} observation`).toBeTruthy()
    }
  })

  it('another member cannot read observations about this farm', async () => {
    const { data } = await B.client
      .from('entity_observations').select('*').eq('subject_id', farmId)
    expect(data ?? []).toHaveLength(0)
  })

  it('has no client update or delete path — observations are append-only', async () => {
    const { data: rows } = await A.client
      .from('entity_observations').select('id').eq('subject_id', farmId).limit(1)
    const id = rows?.[0]?.id
    expect(id).toBeTruthy()

    await A.client.from('entity_observations').update({ value_numeric: 1 }).eq('id', id)
    await A.client.from('entity_observations').delete().eq('id', id)

    const { data: still } = await A.client
      .from('entity_observations').select('value_numeric').eq('id', id).maybeSingle()
    expect(still, 'an observation was deleted by a client').toBeTruthy()
    expect(Number(still!.value_numeric)).not.toBe(1)
  })
})
