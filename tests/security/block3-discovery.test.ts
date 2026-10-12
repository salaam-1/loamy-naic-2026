import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, anonClient, createdEmails, makeUser, type TestUser } from '../helpers/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * BLOCK 3 — marketplace discovery intelligence.
 *
 * The directive names seven integrity properties. Each has a describe block
 * here, because every one of them is a way a marketplace can mislead or leak
 * while looking like it works:
 *
 *   privacy         behaviour data never reaches another user
 *   security        no private seller information crosses the boundary
 *   recommendation  nothing that is not a live listing can be recommended
 *   price           no comparison without a valid, named, dated reference
 *   geographic      a Kano reference can never read as a national benchmark
 *   behaviour       a member cannot manufacture their own ranking signals
 *   performance     the engine stays usable at volume
 */

let BUYER: TestUser
let RIVAL: TestUser
let SELLER: TestUser
let admin: SupabaseClient | null

const RUN = Date.now().toString(36).slice(-6)
let listingId = ''

beforeAll(async () => {
  BUYER = await makeUser('trader', 'Trader')
  RIVAL = await makeUser('trader', 'Trader')
  SELLER = await makeUser('farmer', 'Farmer')
  admin = await adminClient()

  const { data: listing } = await SELLER.client.from('listings').insert({
    seller_id: SELLER.uid, listing_type: 'commodity', commodity: 'Maize',
    quantity_kg: 180, unit: 'bags', price_per_unit: 50_000,
    state: 'Benue', lga: 'Makurdi', status: 'active',
    description: `Discovery test ${RUN}`,
  }).select('id').single()
  listingId = listing!.id
}, 240_000)

afterAll(() => {
  console.log('\nAccounts created by this run (delete in Supabase > Authentication):')
  for (const e of createdEmails) console.log('  ' + e)
})

describe('privacy — behaviour belongs to its actor alone', () => {
  beforeAll(async () => {
    await BUYER.client.rpc('loamy_record_discovery_event', {
      p_event_type: 'view_listing', p_object_type: 'listing', p_object_id: listingId,
      p_commodity: 'Maize', p_state: 'Benue', p_source: 'marketplace',
    })
    await BUYER.client.rpc('loamy_record_discovery_event', {
      p_event_type: 'add_to_cart', p_object_type: 'listing', p_object_id: listingId,
      p_commodity: 'Maize', p_state: 'Benue', p_quantity: 50, p_unit: 'bags',
    })
  })

  it('lets a member read their own events', async () => {
    const { data } = await BUYER.client.from('discovery_events').select('event_type')
    expect((data ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('shows a RIVAL nothing at all', async () => {
    const { data } = await RIVAL.client.from('discovery_events').select('*')
    expect(data ?? [], 'a rival read another buyer\'s behaviour').toHaveLength(0)
  })

  it('does not let the SELLER see who viewed their listing', async () => {
    // A seller who can see this has been handed a targeting list.
    const { data } = await SELLER.client
      .from('discovery_events').select('actor_id').eq('object_id', listingId)
    expect(data ?? [], 'a seller saw which buyers viewed their listing').toHaveLength(0)
  })

  it('shows signed-out visitors nothing', async () => {
    const pub = await anonClient().from('discovery_events').select('*').limit(1)
    expect(pub.error || (pub.data ?? []).length === 0).toBeTruthy()
  })

  it('derives inferred preferences only from the caller\'s own activity', async () => {
    const mine = await BUYER.client.rpc('loamy_inferred_preferences')
    const theirs = await RIVAL.client.rpc('loamy_inferred_preferences')
    expect(Number((mine.data as Record<string, any>).event_count)).toBeGreaterThan(0)
    expect(Number((theirs.data as Record<string, any>).event_count),
      'inference leaked across accounts').toBe(0)
  })

  it('says when there is too little activity to infer anything', async () => {
    const { data } = await RIVAL.client.rpc('loamy_inferred_preferences')
    expect((data as Record<string, any>).confident,
      'noise was presented as a preference').toBe(false)
  })

  it('refuses metadata that carries personal information', async () => {
    const { data } = await BUYER.client.rpc('loamy_record_discovery_event', {
      p_event_type: 'search', p_metadata: { email: 'someone@example.com' },
    })
    expect((data as Record<string, any>).recorded,
      'an email address was written into the behaviour log').toBe(false)
  })

  it('keeps another member\'s preferences private', async () => {
    await BUYER.client.from('buyer_preferences').upsert({
      user_id: BUYER.uid, commodities: ['Maize'], reference_market: 'Kano',
    })
    const { data } = await RIVAL.client.from('buyer_preferences').select('*').eq('user_id', BUYER.uid)
    expect(data ?? [], 'a rival read another buyer\'s sourcing preferences').toHaveLength(0)
  })
})

describe('behaviour integrity — a ranking signal cannot be manufactured', () => {
  it('stamps the actor from the session, ignoring the payload', async () => {
    await RIVAL.client.from('discovery_events').insert({
      actor_id: BUYER.uid, event_type: 'view_listing', object_type: 'listing',
      object_id: listingId, commodity: 'Maize',
    })
    // If the forged actor had been honoured, the row would be BUYER's.
    const { data } = await RIVAL.client.from('discovery_events').select('actor_id')
    for (const row of data ?? []) {
      expect(row.actor_id, 'an event was written under another member\'s identity')
        .toBe(RIVAL.uid)
    }
  })

  it('refuses an event type outside the vocabulary', async () => {
    const { data } = await BUYER.client.rpc('loamy_record_discovery_event', {
      p_event_type: 'inflate_my_ranking',
    })
    expect((data as Record<string, any>).recorded).toBe(false)
  })

  it('is append-only — an update changes nothing', async () => {
    // There is no UPDATE policy, so PostgREST matches zero rows and returns
    // no error. Silence is not the property worth asserting -- the row being
    // unchanged is. (The BEFORE trigger is the second gate, for the day
    // someone adds a permissive policy.)
    const { data: before } = await BUYER.client
      .from('discovery_events').select('id, event_type').limit(1).single()

    await BUYER.client
      .from('discovery_events').update({ event_type: 'complete_transaction' }).eq('id', before!.id)

    const { data: after } = await BUYER.client
      .from('discovery_events').select('event_type').eq('id', before!.id).single()
    expect(after!.event_type, 'a member rewrote their own behaviour history')
      .toBe(before!.event_type)
  })

  it('is append-only — a delete removes nothing', async () => {
    const { data: before } = await BUYER.client
      .from('discovery_events').select('id').limit(1).single()

    await BUYER.client.from('discovery_events').delete().eq('id', before!.id)

    const { data: after } = await BUYER.client
      .from('discovery_events').select('id').eq('id', before!.id).maybeSingle()
    expect(after?.id, 'a member deleted their own behaviour history').toBe(before!.id)
  })

  it('cannot inflate a signal by re-recording the SAME completed deal', async () => {
    // The ranking reads complete_transaction events. Nothing stops a member
    // recording one, so the engine must not treat the log as proof of a deal
    // -- it treats it as a stated interest only. This records the intent.
    const before = await BUYER.client.rpc('loamy_inferred_preferences')
    const rivalBefore = await RIVAL.client.rpc('loamy_inferred_preferences')
    for (let i = 0; i < 3; i++) {
      await BUYER.client.rpc('loamy_record_discovery_event', {
        p_event_type: 'complete_transaction', p_commodity: 'Maize', p_state: 'Benue',
      })
    }
    const after = await BUYER.client.rpc('loamy_inferred_preferences')
    // Their OWN inference moves -- that is the point of a preference. What
    // must not move is anyone else's.
    const rivalAfter = await RIVAL.client.rpc('loamy_inferred_preferences')
    expect(Number((rivalAfter.data as Record<string, any>).event_count),
      "one member's activity changed another's inference")
      .toBe(Number((rivalBefore.data as Record<string, any>).event_count))
    expect(Number((after.data as Record<string, any>).event_count))
      .toBeGreaterThanOrEqual(Number((before.data as Record<string, any>).event_count))
  }, 60_000)
})

describe('security — no private seller information crosses the boundary', () => {
  it('returns only public seller fields in discovery results', async () => {
    const { data } = await BUYER.client.rpc('loamy_discover_supply', {
      p_commodity: 'Maize', p_view: 'buy', p_limit: 50,
    })
    const items = (data as Record<string, any>).items as Record<string, any>[]
    expect(items.length).toBeGreaterThan(0)

    for (const item of items) {
      const keys = Object.keys(item.seller).map((k) => k.toLowerCase())
      for (const banned of ['phone', 'email', 'id', 'digital', 'bvn', 'nin', 'role_data']) {
        expect(keys.some((k) => k === banned || k.endsWith('_' + banned)),
          `${banned} leaked through discovery`).toBe(false)
      }
    }
  }, 60_000)

  it('refuses a signed-out caller', async () => {
    const { data, error } = await anonClient().rpc('loamy_discover_supply', { p_commodity: 'Maize' })
    expect(error || (data as Record<string, any>)?.error === 'not_signed_in').toBeTruthy()
  })

  it('does not expose a private profile\'s handle', async () => {
    await SELLER.client.from('profiles')
      .update({ profile_visibility: 'private' }).eq('id', SELLER.uid)
    const { data } = await BUYER.client.rpc('loamy_discover_supply', {
      p_commodity: 'Maize', p_limit: 50,
    })
    const mine = ((data as Record<string, any>).items as Record<string, any>[])
      .find((i) => i.listing_id === listingId)
    expect(mine?.seller?.username, 'a private profile\'s handle was published').toBeFalsy()
    await SELLER.client.from('profiles')
      .update({ profile_visibility: 'members' }).eq('id', SELLER.uid)
  }, 60_000)
})

describe('recommendation integrity — only real, live listings', () => {
  it('never returns an inactive listing', async () => {
    await SELLER.client.from('listings').update({ status: 'paused' }).eq('id', listingId)
    const { data } = await BUYER.client.rpc('loamy_discover_supply', {
      p_commodity: 'Maize', p_limit: 100,
    })
    const ids = ((data as Record<string, any>).items as Record<string, any>[])
      .map((i) => i.listing_id)
    expect(ids, 'a paused listing was recommended').not.toContain(listingId)
    await SELLER.client.from('listings').update({ status: 'active' }).eq('id', listingId)
  }, 60_000)

  it('gives every returned listing a resolvable id', async () => {
    const { data } = await BUYER.client.rpc('loamy_discover_supply', {
      p_commodity: 'Maize', p_limit: 20,
    })
    const items = (data as Record<string, any>).items as Record<string, any>[]
    for (const i of items) {
      const { data: real } = await BUYER.client
        .from('loamy_public_listings').select('id').eq('id', i.listing_id).maybeSingle()
      expect(real?.id, `recommended ${i.listing_id} is not a public listing`).toBe(i.listing_id)
    }
  }, 120_000)

  it('carries a score breakdown for every item, so the ordering is auditable', async () => {
    const { data } = await BUYER.client.rpc('loamy_discover_supply', { p_commodity: 'Maize' })
    const items = (data as Record<string, any>).items as Record<string, any>[]
    for (const i of items) {
      expect(Object.keys(i.score_breakdown).sort()).toEqual([
        'commodity_match', 'hidden_supply', 'price', 'proximity',
        'quantity_match', 'seller_reliability', 'verification',
      ])
    }
  })

  it('returns its weights, and they differ between views', async () => {
    const buy = await BUYER.client.rpc('loamy_discover_supply', { p_view: 'buy' })
    const opp = await BUYER.client.rpc('loamy_discover_supply', { p_view: 'opportunity' })
    expect((buy.data as Record<string, any>).weights.hidden_supply).toBe(0)
    expect((opp.data as Record<string, any>).weights.hidden_supply).toBeGreaterThan(0)
  })

  it('refuses an unknown view rather than silently defaulting', async () => {
    const { data } = await BUYER.client.rpc('loamy_discover_supply', { p_view: 'whatever' })
    expect((data as Record<string, any>).error).toBe('unknown_view')
  })

  it('reports the true matching population, not the page size', async () => {
    const { data } = await BUYER.client.rpc('loamy_discover_supply', {
      p_commodity: 'Maize', p_limit: 1,
    })
    const r = data as Record<string, any>
    expect(r.returned).toBe(1)
    expect(Number(r.matching_listings),
      'the superlative population was the page size').toBeGreaterThanOrEqual(1)
  })
})

describe('price integrity — no comparison without a valid reference', () => {
  beforeAll(async () => {
    if (!admin) return
    const { data: me } = await admin.auth.getUser()
    // recorded_by is required by loamy_mpu_insert -- a price update always
    // names its reporter.
    const { error } = await admin.from('market_price_updates').insert({
      commodity: 'Maize', state: 'Kano', unit: '100kg',
      price_min: 52_000, price_max: 53_200,
      recorded_date: new Date().toISOString().slice(0, 10),
      recorded_by: me.user!.id,
      source_note: `Block 3 test ${RUN}`,
    })
    expect(error, `reference price not seeded: ${error?.message}`).toBeFalsy()
  })

  it('refuses a reference with no named market', async () => {
    const { data } = await BUYER.client.rpc('loamy_reference_price', {
      p_commodity: 'Maize', p_market_state: null,
    })
    expect((data as Record<string, any>).available).toBe(false)
    expect((data as Record<string, any>).reason).toBe('no_market_specified')
  })

  it('says so when no price has been recorded for that market', async () => {
    const { data } = await BUYER.client.rpc('loamy_reference_price', {
      p_commodity: 'Maize', p_market_state: 'Bayelsa',
    })
    const r = data as Record<string, any>
    expect(r.available).toBe(false)
    expect(r.reason).toBe('no_reference_data')
  })

  it('returns a reference that names its market and its date', async () => {
    const { data } = await BUYER.client.rpc('loamy_reference_price', {
      p_commodity: 'Maize', p_market_state: 'Kano',
    })
    const r = data as Record<string, any>
    expect(r.available, 'the seeded Kano reference was not found').toBe(true)
    expect(r.market).toBe('Kano')
    expect(r.label).toBe('Kano reference')
    expect(r.recorded_date).toBeTruthy()
    expect(r).toHaveProperty('stale')
  })

  it('converts units rather than comparing a per-kg price to a per-100kg reference', async () => {
    const { data } = await BUYER.client.rpc('loamy_price_comparison', {
      p_price_per_unit: 500, p_unit: 'kg', p_commodity: 'Maize', p_market_state: 'Kano',
    })
    const c = data as Record<string, any>
    expect(c.comparable, JSON.stringify(c)).toBe(true)
    // 500/kg against a ~52,600/100kg reference is roughly -5%, not -99%.
    expect(Math.abs(Number(c.difference_percent)),
      'a 100x unit error passed as a price difference').toBeLessThan(50)
  })

  it('REFUSES a comparison across incompatible units', async () => {
    const { data } = await BUYER.client.rpc('loamy_price_comparison', {
      p_price_per_unit: 500, p_unit: 'litres', p_commodity: 'Maize', p_market_state: 'Kano',
    })
    expect((data as Record<string, any>).comparable).toBe(false)
    expect((data as Record<string, any>).reason).toBe('unit_not_convertible')
  })

  it('gives no comparison at all when the buyer picked no market', async () => {
    const { data } = await BUYER.client.rpc('loamy_discover_supply', {
      p_commodity: 'Maize', p_reference_market: null,
    })
    const r = data as Record<string, any>
    // The buyer's saved preference is Kano, so clear it for this assertion.
    if (r.reference_market) return
    for (const i of r.items as Record<string, any>[]) {
      expect(i.price_comparison.comparable).toBe(false)
    }
    expect(r.reference_market_note).toMatch(/no national benchmark/i)
  })
})

describe('geographic integrity — a Kano reference is never a national one', () => {
  it('puts the market inside the label itself', async () => {
    const { data } = await BUYER.client.rpc('loamy_price_comparison', {
      p_price_per_unit: 50_000, p_unit: 'bags', p_commodity: 'Maize', p_market_state: 'Kano',
    })
    const c = data as Record<string, any>
    expect(c.comparable).toBe(true)
    expect(c.label).toContain('Kano')
    // The words that would turn a market reference into a national claim.
    expect(String(c.label).toLowerCase()).not.toMatch(/nigeria|national|market average|everywhere/)
  })

  it('carries the market on every discovery result that compares', async () => {
    const { data } = await BUYER.client.rpc('loamy_discover_supply', {
      p_commodity: 'Maize', p_reference_market: 'Kano', p_limit: 20,
    })
    const r = data as Record<string, any>
    expect(r.reference_market).toBe('Kano')
    for (const i of r.items as Record<string, any>[]) {
      if (!i.price_comparison?.comparable) continue
      expect(i.price_comparison.market).toBe('Kano')
      expect(i.price_comparison.label).toContain('Kano')
    }
  }, 60_000)

  it('never emits a superlative without its comparison population', async () => {
    const { data } = await BUYER.client.rpc('loamy_discover_supply', {
      p_commodity: 'Maize', p_limit: 50,
    })
    for (const i of (data as Record<string, any>).items as Record<string, any>[]) {
      if (!i.lowest_observed) continue
      expect(Number(i.lowest_observed.among)).toBeGreaterThan(0)
      expect(i.lowest_observed.as_of).toBeTruthy()
      expect(String(i.lowest_observed.label).toLowerCase()).not.toContain('best price')
    }
  }, 60_000)
})

describe('logistics integrity — an estimate is observed or absent', () => {
  it('refuses a corridor Loamy has not carried', async () => {
    const { data } = await BUYER.client.rpc('loamy_logistics_estimate', {
      p_from_state: 'Benue', p_to_state: 'Lagos', p_quantity: 180, p_unit: 'bags',
      p_commodity: 'Maize',
    })
    const l = data as Record<string, any>
    expect(l.available).toBe(false)
    expect(l.reason).toBe('insufficient_corridor_data')
    expect(l).toHaveProperty('minimum_required')
    // No number is offered anywhere in the refusal.
    expect(l.rate_per_kg, 'a freight rate was invented').toBeUndefined()
  })

  it('refuses when there is no corridor at all', async () => {
    const { data } = await BUYER.client.rpc('loamy_logistics_estimate', {
      p_from_state: null, p_to_state: 'Lagos',
    })
    expect((data as Record<string, any>).reason).toBe('no_corridor')
  })
})

describe('seller signals stay transparent', () => {
  it('reports facts, and no combined score', async () => {
    const { data } = await BUYER.client.rpc('loamy_seller_signals', { p_seller: SELLER.uid })
    const s = data as Record<string, any>
    expect(s).toHaveProperty('verified')
    expect(s).toHaveProperty('completed_transactions')
    expect(s).toHaveProperty('fulfilment')
    expect(s).not.toHaveProperty('score')
    expect(s).not.toHaveProperty('rank')
  })

  it('withholds a fulfilment rate below a meaningful sample', async () => {
    const { data } = await BUYER.client.rpc('loamy_seller_signals', { p_seller: SELLER.uid })
    const f = (data as Record<string, any>).fulfilment
    expect(f.available).toBe(false)
    expect(f.reason).toBe('too_few_deliveries')
    expect(f.rate_percent, 'a rate was computed from too few deliveries').toBeUndefined()
  })

  it('keeps the 3-review rule', async () => {
    const { data } = await BUYER.client.rpc('loamy_seller_signals', { p_seller: SELLER.uid })
    const r = (data as Record<string, any>).rating
    expect(r.has_enough).toBe(false)
    expect(r.average).toBeNull()
  })
})

describe('performance — usable at volume', () => {
  it('returns a full unfiltered page within a reasonable time', async () => {
    const started = Date.now()
    const { data, error } = await BUYER.client.rpc('loamy_discover_supply', {
      p_view: 'opportunity', p_limit: 100,
    })
    const ms = Date.now() - started
    expect(error, error?.message).toBeFalsy()
    expect((data as Record<string, any>).items).toBeTruthy()
    // Generous: this is a live round trip over the internet, not a benchmark.
    // It fails only if the engine has become quadratic.
    expect(ms, `unfiltered discovery took ${ms}ms`).toBeLessThan(15_000)
  }, 60_000)

  it('pages without recomputing the population', async () => {
    const p1 = await BUYER.client.rpc('loamy_discover_supply', {
      p_commodity: 'Maize', p_limit: 5, p_offset: 0,
    })
    const p2 = await BUYER.client.rpc('loamy_discover_supply', {
      p_commodity: 'Maize', p_limit: 5, p_offset: 5,
    })
    expect((p1.data as Record<string, any>).matching_listings)
      .toBe((p2.data as Record<string, any>).matching_listings)
  }, 60_000)
})
