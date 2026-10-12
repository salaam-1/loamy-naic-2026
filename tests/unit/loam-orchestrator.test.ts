import { describe, expect, it } from 'vitest'
import { runLoam } from '@/lib/loam/orchestrator'
import { MockAdapter, ModelUnavailable } from '@/lib/loam/model/adapter'
import type { EvidenceClient } from '@/lib/loam/evidence'

/**
 * The Phase 1 vertical slice, end to end, with the model scripted.
 *
 * WHY THE MODEL IS MOCKED HERE
 *   N-ATLaS is non-deterministic and runs at ~3 tok/s, so asserting on its
 *   prose would be both flaky and slow. These tests assert the things that must
 *   hold for ANY model output: that the gate stops a question with no evidence
 *   BEFORE inference, that a forecast never reaches the model at all, that
 *   Level 1 data is scoped to the caller, and that the guard decides what is
 *   shown. The real model is exercised separately by scripts/loam-demo.mjs.
 *
 * The five scenarios the Phase 1 brief asked to demonstrate are each one test
 * below, tagged DEMO.
 */

/** A chainable Postgrest stand-in. Records what was asked for. */
function fakeClient(
  tables: Record<string, unknown[]>,
  rpc: Record<string, unknown> = {},
): EvidenceClient & { selects: string[]; rpcCalls: string[] } {
  const selects: string[] = []
  const rpcCalls: string[] = []

  const builder = (table: string) => {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    for (const m of ['eq', 'in', 'ilike', 'order', 'limit', 'gte', 'lte', 'or', 'not']) {
      chain[m] = self
    }
    chain.select = (cols: string) => { selects.push(`${table}:${cols}`); return chain }
    // Awaiting the chain resolves like a Postgrest response.
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve)
    return chain
  }

  return {
    from: ((table: string) => builder(table)) as EvidenceClient['from'],
    rpc: ((name: string) => {
      rpcCalls.push(name)
      return Promise.resolve({ data: rpc[name] ?? null, error: null })
    }) as unknown as EvidenceClient['rpc'],
    selects,
    rpcCalls,
  }
}

const FARM = {
  id: 'farm-1', farm_name: 'Rafin Kaya', state: 'Kaduna', lga: 'Giwa',
  size_hectares: 3.5, primary_crops: ['Maize', 'Soybeans'],
}
const CROP_RECORD = {
  id: 'cr-1', farm_id: 'farm-1', crop: 'Maize', season_year: 2026,
  planting_date: '2026-06-02', expected_harvest_date: '2026-09-20',
  actual_harvest_date: null, expected_yield_kg: 4200, actual_yield_kg: null,
}
const PRICE_CONTEXT = {
  row_count: 812, latest_date: '2026-09-30', latest_per_kg: 420,
  years_from: 2011, years_to: 2026,
  recent_low: 380, recent_high: 520, recent_avg: 445, recent_months: 24,
  cheapest_month: 11, dearest_month: 7, seasonal: [],
}

describe('DEMO 1 — a specific agricultural question, answered from retrieved evidence', () => {
  it('grounds the Kaduna planting answer in the knowledge pack', async () => {
    // Phase 1.5: the model must cite. `[2]` is the planting entry (the zone
    // entry sorts first as contextOnly Level 2).
    const model = new MockAdapter(
      '[2] Plant maize once the rains are established, usually from late May into mid-June.',
    )
    const r = await runLoam(
      { message: 'When should I plant maize in Kaduna?', language: 'en' },
      { model, client: fakeClient({}), userId: 'u1' },
    )
    expect(r.demand).toBe('specific')
    expect(r.declined).toBe(false)
    expect(r.modelUsed).toBe(true)
    expect(r.level).toBe(2)
    // The model was handed the planting window rather than asked to recall it.
    expect(model.lastRequest!.user).toContain('Northern Guinea Savanna')
    expect(model.lastRequest!.user).toContain('late May into mid-June')
    expect(r.evidence.some((e) => e.source.includes('PENDING AGRONOMIST REVIEW'))).toBe(true)
  })

  it('replaces a wrong model answer with the evidence, even for a good question', async () => {
    // The real Phase 0 output, routed through the whole pipeline.
    const model = new MockAdapter(
      '[2] The ideal time to plant maize is towards the end of the rainy season, '
      + 'specifically in September and October.',
    )
    const r = await runLoam(
      { message: 'When should I plant maize in Kaduna?', language: 'en' },
      { model, client: fakeClient({}), userId: 'u1' },
    )
    expect(r.guard.fellBack).toBe(true)
    expect(r.modelUsed).toBe(false)
    expect(r.answer).not.toContain('September')
    expect(r.answer).toContain('late May into mid-June')
  })
})

describe('DEMO 2 — a general agricultural question', () => {
  it('answers from Level 2 and reads no member data', async () => {
    /**
     * This asserted that a general question touched the database NOT AT ALL.
     * That stopped being true when the concept and unit capabilities were
     * migrated out of the legacy engine: both are consulted for any
     * non-personal question, which is how "what is Murabaha?" now gets the
     * team's own reviewed explanation instead of a decline.
     *
     * The property worth protecting was never "no queries" -- it was "no
     * MEMBER data". Both migrated readers hit institutional tables that RLS
     * grants to every signed-in member, and neither can reach a farm, a crop
     * record, an order or a listing. That is what is asserted now.
     */
    const client = fakeClient({})
    const model = new MockAdapter('[1] Rotating cereals with legumes keeps soil nitrogen up and breaks pest cycles.')
    const r = await runLoam(
      { message: 'Why does crop rotation matter?', language: 'en' },
      { model, client, userId: 'u1' },
    )
    expect(r.demand).toBe('general')
    expect(r.declined).toBe(false)
    expect(r.level).toBe(2)

    const INSTITUTIONAL = ['copilot_concepts', 'commodity_units']
    for (const s of client.selects) {
      const table = s.split(':')[0]
      expect(INSTITUTIONAL, `a general question read ${table}`).toContain(table)
    }
    for (const member of ['farms', 'crop_records', 'orders', 'listings', 'profiles']) {
      expect(client.selects.join(' '), `${member} is member data`).not.toContain(member)
    }
  })
})

describe('DEMO 3 — a question answered from real Loamy data', () => {
  it('answers "what is on my farm" from the member\'s own rows', async () => {
    const client = fakeClient({ farms: [FARM], crop_records: [CROP_RECORD] })
    const model = new MockAdapter(
      '[1] You have one farm recorded, Rafin Kaya in Giwa, Kaduna, at 3.5 hectares, '
      + 'growing Maize and Soybeans.\n'
      + '[2] A crop record shows Maize for the 2026 season, planted 2026-06-02, '
      + 'with 4200 kg expected by 2026-09-20.',
    )
    const r = await runLoam(
      { message: "What's on my farm?", language: 'en' },
      { model, client, userId: 'u1' },
    )
    expect(r.demand).toBe('personal')
    expect(r.level).toBe(1)
    expect(r.declined).toBe(false)
    expect(r.guard.fellBack).toBe(false)
    expect(r.evidence.some((e) => e.claim.includes('Rafin Kaya'))).toBe(true)
    expect(r.evidence.some((e) => e.claim.includes('4200 kg expected'))).toBe(true)
  })

  it('never selects farm coordinates', async () => {
    const client = fakeClient({ farms: [FARM] })
    await runLoam(
      { message: 'What do I have on my farm?', language: 'en' },
      { model: new MockAdapter('[1] ok'), client, userId: 'u1' },
    )
    const farmSelects = client.selects.filter((s) => s.startsWith('farms:'))
    expect(farmSelects.length).toBeGreaterThan(0)
    for (const s of farmSelects) {
      expect(s, 'farm GPS coordinates must never be read into a prompt').not.toMatch(/latitude|longitude/)
      expect(s).not.toMatch(/address/)
      expect(s, 'select(*) would sweep in coordinates').not.toContain('*')
    }
  })
})

describe('DEMO 4 — no evidence, so no answer', () => {
  it('declines a specific question the knowledge pack does not cover', async () => {
    const model = new MockAdapter('I should never be called.')
    const r = await runLoam(
      { message: 'When should I plant pineapple in Sokoto?', language: 'en' },
      { model, client: fakeClient({}), userId: 'u1' },
    )
    /**
     * PHASE 2. This used to decline: the knowledge pack has no pineapple
     * entry, so the gate refused and the model was never asked. Nothing was
     * protected by that -- there is no Loamy record about planting pineapple
     * to get wrong -- and the same question about maize was answered, which
     * made the assistant look arbitrary.
     *
     * It now takes the GENERAL lane. The protection that matters is still
     * here: the answer is Level 3, it carries no evidence, and the narrowed
     * guard forbids it from stating a price, a listing or a Loamy fact.
     */
    expect(r.lane).toBe('general')
    expect(r.declined).toBe(false)
    expect(r.level, 'model reasoning, not a platform record').toBe(3)
    expect(r.modelUsed).toBe(true)
    expect(r.evidence, 'no evidence was claimed').toHaveLength(0)
    expect(model.lastRequest, 'the model IS asked now').not.toBeNull()
  })

  it('declines a personal question when the member has no records', async () => {
    const model = new MockAdapter('I should never be called.')
    const r = await runLoam(
      { message: 'What is on my farm?', language: 'en' },
      { model, client: fakeClient({ farms: [], crop_records: [] }), userId: 'u1' },
    )
    expect(r.declined).toBe(true)
    expect(model.lastRequest).toBeNull()
    expect(r.answer).toContain('adding your farm and crop records')
  })

  it('declines rather than generalising when there is no signed-in member', async () => {
    const r = await runLoam(
      { message: 'What is on my farm?', language: 'en' },
      { model: new MockAdapter('x'), client: fakeClient({ farms: [FARM] }), userId: null },
    )
    expect(r.declined).toBe(true)
    expect(r.level).toBe(4)
  })

  it('declines when the database read fails, instead of inventing', async () => {
    const broken: EvidenceClient = {
      from: (() => { throw new Error('connection reset') }) as EvidenceClient['from'],
      rpc: (() => { throw new Error('connection reset') }) as unknown as EvidenceClient['rpc'],
    }
    const model = new MockAdapter('I should never be called.')
    const r = await runLoam(
      { message: 'What is on my farm?', language: 'en' },
      { model, client: broken, userId: 'u1' },
    )
    expect(r.declined).toBe(true)
    expect(model.lastRequest).toBeNull()
  })
})

describe('DEMO 5 — English and Hausa', () => {
  it('detects Hausa from the message and asks for a Hausa answer', async () => {
    const model = new MockAdapter('[2] Ka shuka masara daga ƙarshen Mayu zuwa tsakiyar Yuni.')
    const r = await runLoam(
      { message: 'Yaushe zan shuka masara a Kaduna?', language: 'en' },
      { model, client: fakeClient({}), userId: 'u1' },
    )
    expect(r.language, 'a Hausa message overrides an English app setting').toBe('ha')
    expect(model.lastRequest!.system).toContain('Write in Hausa')
    expect(r.guard.fellBack).toBe(false)
  })

  it('declines in Hausa when there is no evidence', async () => {
    const r = await runLoam(
      { message: 'Yaushe zan shuka abarba a Sokoto?', language: 'ha' },
      { model: new MockAdapter('x'), client: fakeClient({}), userId: 'u1' },
    )
    // PHASE 2: the general lane serves Hausa too, and the prompt names the
    // language, so the refusal phrase is no longer what comes back.
    expect(r.lane).toBe('general')
    expect(r.declined).toBe(false)
    expect(r.language).toBe('ha')
  })
})

describe('price forecasting is refused before inference', () => {
  it('never calls the model, and offers the observed record instead', async () => {
    const model = new MockAdapter('Maize will cost ₦700 in March.')
    const client = fakeClient({}, { loamy_copilot_price_context: PRICE_CONTEXT })
    const r = await runLoam(
      { message: 'What will maize cost in March?', language: 'en' },
      { model, client, userId: 'u1' },
    )
    expect(r.demand).toBe('forecast')
    expect(r.modelUsed).toBe(false)
    expect(model.lastRequest, 'a forecast must never reach the model').toBeNull()
    expect(r.answer).toMatch(/not something Loam provides/i)
    expect(r.answer).toMatch(/does not predict prices/i)
    // Still useful: what IS recorded comes back with it.
    expect(r.answer).toContain('What I can show you is what has actually been recorded')
    expect(r.answer).toContain('₦420')
    expect(r.answer).toContain('not a prediction')
  })

  it('declares the refusal as POLICY, not as missing information', () => {
    /**
     * A live demo showed why this distinction has to be carried in the data.
     * Both refusals surfaced as "Not enough verified information", so a
     * deliberate boundary read as ignorance -- and contradicted the refusal's
     * own offer to show recorded prices.
     */
    return runLoam(
      { message: 'What will maize cost in March?', language: 'en' },
      {
        model: new MockAdapter('[1] x'),
        client: fakeClient({}, { loamy_copilot_price_context: PRICE_CONTEXT }),
        userId: 'u1',
      },
    ).then((r) => {
      expect(r.declined).toBe(true)
      expect(r.refusal).toBe('policy')
    })
  })

  it('does not promise recorded prices it does not have', async () => {
    // Staging has no maize price history, and the refusal used to end "what I
    // can show you is what has actually been recorded" with nothing after it.
    const r = await runLoam(
      { message: 'What will maize cost in March?', language: 'en' },
      { model: new MockAdapter('[1] x'), client: fakeClient({}), userId: 'u1' },
    )
    expect(r.refusal).toBe('policy')
    expect(r.answer).not.toContain('What I can show you')
    expect(r.answer).toMatch(/do not have recorded prices/i)
  })

  it('a refusal for lack of evidence is labelled differently', async () => {
    /**
     * PHASE 2 repointed this. The old subject -- planting pineapple -- is now
     * ordinary knowledge and takes the general lane, so it is no longer a
     * refusal of any kind. A PRICE question with no recorded price still is:
     * it asks for a current figure only Loamy can state, and model knowledge
     * must never stand in for one. That is the distinction this test exists
     * to hold, and it still holds.
     */
    const r = await runLoam(
      { message: 'What is the price of cocoa in Ondo?', language: 'en' },
      { model: new MockAdapter('[1] x'), client: fakeClient({}), userId: 'u1' },
    )
    expect(r.lane, 'controlled data was required and is unavailable').toBe('withheld')
    expect(r.declined).toBe(true)
    expect(r.refusal, 'this one really is missing information').toBe('no_evidence')
  })
})

describe('personal evidence addresses the member directly', () => {
  it('says "your farm", not "the member has a farm"', async () => {
    const client = fakeClient({ farms: [FARM], crop_records: [CROP_RECORD] })
    const r = await runLoam(
      { message: "What's on my farm?", language: 'en' },
      { model: new MockAdapter('[1] ok'), client, userId: 'u1' },
    )
    const claims = r.evidence.map((e) => e.claim).join(' ')
    expect(claims).toContain('Your farm "Rafin Kaya"')
    expect(claims).toContain('Your crop record shows')
    expect(claims, 'Loam is talking TO them, not about them').not.toContain('The member')
  })

  it('still carries every fact from the row', async () => {
    const client = fakeClient({ farms: [FARM], crop_records: [CROP_RECORD] })
    const r = await runLoam(
      { message: "What's on my farm?", language: 'en' },
      { model: new MockAdapter('[1] ok'), client, userId: 'u1' },
    )
    const claims = r.evidence.map((e) => e.claim).join(' ')
    for (const fact of ['Giwa', 'Kaduna', '3.5 hectares', 'Maize', 'Soybeans', '4200 kg expected']) {
      expect(claims, `${fact} must survive the rewording`).toContain(fact)
    }
  })

  it('the prompt asks the model to keep the direct address', async () => {
    const model = new MockAdapter('[1] ok')
    await runLoam(
      { message: "What's on my farm?", language: 'en' },
      { model, client: fakeClient({ farms: [FARM] }), userId: 'u1' },
    )
    expect(model.lastRequest!.system).toMatch(/directly as "you"/)
    expect(model.lastRequest!.system).toMatch(/Never call them "the member"/)
  })
})

describe('graceful failure when the model is down', () => {
  it('shows the evidence and says the model is unavailable', async () => {
    const model = new MockAdapter('[1] x', { throws: new ModelUnavailable('connection refused') })
    const r = await runLoam(
      { message: 'When should I plant maize in Kaduna?', language: 'en' },
      { model, client: fakeClient({}), userId: 'u1' },
    )
    expect(r.declined).toBe(false)
    expect(r.modelUsed).toBe(false)
    expect(r.answer).toContain('language model is not available')
    expect(r.answer).toContain('late May into mid-June')
    expect(r.guard.reason).toContain('unavailable')
  })

  it('does not leak an internal error message into the answer', async () => {
    const model = new MockAdapter('x', { throws: new Error('ECONNREFUSED 127.0.0.1:11434') })
    const r = await runLoam(
      { message: 'Why does crop rotation matter?', language: 'en' },
      { model, client: fakeClient({}), userId: 'u1' },
    )
    expect(r.answer).not.toContain('ECONNREFUSED')
    expect(r.answer).not.toContain('127.0.0.1')
  })
})

describe('the prompt carries the evidence the guard will authorise', () => {
  it('passes exactly the qualifying evidence, never Level 3 or 4', async () => {
    const model = new MockAdapter('[1] ok')
    await runLoam(
      { message: 'Why does crop rotation matter?', language: 'en' },
      { model, client: fakeClient({}), userId: 'u1' },
    )
    expect(model.lastRequest!.user).toContain('[L2]')
    expect(model.lastRequest!.user).not.toContain('[L3]')
    expect(model.lastRequest!.user).not.toContain('[L4]')
  })
})

/**
 * Market price updates as evidence.
 *
 * `market_price_updates` is institutional platform data: RLS grants SELECT to
 * every authenticated member (`using (true)`) and the table carries no PII.
 * Loam reads it through `loamy_public_price_updates`, the sanctioned view,
 * which drops `recorded_by` -- the only person-identifying column -- and bounds
 * itself to 150 days.
 *
 * Fixtures mirror the real staging rows: 100kg units, min/max ranges, Maize
 * across Benue and Kano.
 */
const TODAY = new Date().toISOString().slice(0, 10)
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)

const PRICE_ROWS = [
  { commodity: 'Maize', state: 'Kano', unit: '100kg', price_min: 52000, price_max: 53200, recorded_date: TODAY, source_note: 'Dawanau wholesale' },
  { commodity: 'Maize', state: 'Benue', unit: '100kg', price_min: 48000, price_max: 49500, recorded_date: TODAY, source_note: null },
  { commodity: 'Maize', state: 'Kano', unit: '100kg', price_min: 51000, price_max: 52000, recorded_date: daysAgo(9), source_note: null },
]

describe('market price updates become evidence', () => {
  it('A. "What is the maize price?" answers from recorded observations', async () => {
    const client = fakeClient({ loamy_public_price_updates: PRICE_ROWS })
    const model = new MockAdapter('[1] Maize is 52,000 to 53,200 naira per 100kg in Kano.')
    const r = await runLoam({ message: 'What is the maize price?', language: 'en' },
      { model, client, userId: 'u1' })

    expect(r.level, 'recorded platform data is Level 1').toBe(1)
    expect(r.declined).toBe(false)
    const claims = r.evidence.map((e) => e.claim).join(' ')
    expect(claims).toContain('Recorded price update for Maize in Kano')
    expect(claims).toContain('per 100kg')
    expect(claims, 'an observation is never a forecast').toContain('not a prediction')
  })

  it('keeps one observation per state, newest only', async () => {
    // Staging holds 317 rows, many repeats of the same commodity/state/day.
    const client = fakeClient({ loamy_public_price_updates: PRICE_ROWS })
    const r = await runLoam({ message: 'What is the maize price?', language: 'en' },
      { model: new MockAdapter('[1] ok'), client, userId: 'u1' })
    const priceItems = r.evidence.filter((e) => e.claim.startsWith('Recorded price update'))
    expect(priceItems.length, 'Kano and Benue, not three rows').toBe(2)
    expect(priceItems.some((e) => e.claim.includes('51,000')), 'the older Kano row is dropped').toBe(false)
  })

  it('authorises only the figures the records contain', async () => {
    const client = fakeClient({ loamy_public_price_updates: PRICE_ROWS })
    const r = await runLoam({ message: 'What is the maize price?', language: 'en' },
      { model: new MockAdapter('[1] Maize costs 70,000 naira per 100kg.'), client, userId: 'u1' })
    expect(r.guard.fellBack, 'an invented price must not survive').toBe(true)
    expect(r.answer).not.toContain('70,000')
  })

  it('B. names the gap when the asked-for state has no record', async () => {
    /**
     * The decisive case. Without an explicit negative finding the model sees
     * Kano prices beside a question about Kaduna, and the state named in the
     * question is an authorised anchor -- so the guard alone would not catch
     * "in Kaduna, maize is 52,000".
     *
     * Staged so the state-filtered read returns nothing and the coverage read
     * that follows finds the states that do have data.
     */
    let priceCall = 0
    const staged: EvidenceClient = {
      from: ((table: string) => {
        const chain: Record<string, unknown> = {}
        const self = () => chain
        for (const m of ['eq', 'in', 'ilike', 'order', 'limit', 'gte', 'lte', 'or']) chain[m] = self
        chain.select = () => chain
        chain.then = (res: (v: unknown) => unknown) => {
          let data: unknown[] = []
          if (table === 'loamy_public_price_updates') {
            data = priceCall++ === 0
              ? []
              : [{ state: 'Kano', recorded_date: TODAY }, { state: 'Benue', recorded_date: TODAY }]
          }
          return Promise.resolve({ data, error: null }).then(res)
        }
        return chain
      }) as EvidenceClient['from'],
      rpc: (() => Promise.resolve({ data: null, error: null })) as unknown as EvidenceClient['rpc'],
    }
    const r = await runLoam({ message: 'What are maize prices in Kaduna?', language: 'en' },
      { model: new MockAdapter('[1] There is no recorded price for Maize in Kaduna.'), client: staged, userId: 'u1' })

    const claims = r.evidence.map((e) => e.claim).join(' ')
    expect(claims).toContain('no recorded price update for Maize in Kaduna')
    expect(claims, 'and says where there IS data').toContain('Kano')
    expect(r.declined, 'a true negative finding is an answer').toBe(false)
  })

  it('C. declines when nothing matches at all', async () => {
    const client = fakeClient({ loamy_public_price_updates: [] })
    const model = new MockAdapter('[1] should never be called')
    const r = await runLoam({ message: 'What is the cocoa price in Lagos?', language: 'en' },
      { model, client, userId: 'u1' })
    expect(r.declined).toBe(true)
    expect(r.refusal).toBe('no_evidence')
    expect(model.lastRequest, 'no evidence, no model').toBeNull()
  })

  it('D. a future-price question is still refused by policy', async () => {
    const client = fakeClient({ loamy_public_price_updates: PRICE_ROWS })
    const model = new MockAdapter('[1] Maize will cost 60,000 in March.')
    const r = await runLoam({ message: 'What will maize cost in March?', language: 'en' },
      { model, client, userId: 'u1' })
    expect(r.refusal).toBe('policy')
    expect(model.lastRequest, 'a forecast never reaches the model').toBeNull()
    expect(r.answer).toMatch(/not something Loam provides/i)
    // It now has something real to offer alongside the refusal.
    expect(r.answer).toContain('What I can show you is what has actually been recorded')
    expect(r.answer).toContain('52,000')
    expect(r.answer.match(/What the records show/g), 'one heading, not two').toBeNull()
  })

  it('says how old a stale observation is, rather than presenting it as current', async () => {
    const stale = [{ ...PRICE_ROWS[0], recorded_date: daysAgo(60) }]
    const client = fakeClient({ loamy_public_price_updates: stale })
    const r = await runLoam({ message: 'What is the maize price?', language: 'en' },
      { model: new MockAdapter('[1] ok'), client, userId: 'u1' })
    const claim = r.evidence.find((e) => e.claim.startsWith('Recorded price update'))!.claim
    // The age is stated and is about two months. Not pinned to an exact
    // integer: `recorded_date` is a date, so parsing it against "now" rounds
    // differently depending on the time of day the suite runs.
    const age = Number(/\b(\d+) days old\b/.exec(claim)?.[1])
    expect(age, `no age stated in: ${claim}`).toBeGreaterThanOrEqual(59)
    expect(age).toBeLessThanOrEqual(61)
    expect(claim).toContain('may not reflect')
    // And the stated age is itself an authorised figure, so the model may
    // repeat it without tripping the guard.
    const item = r.evidence.find((e) => e.claim.startsWith('Recorded price update'))!
    expect(item.numbers).toContain(age)
  })

  it('reads the view, never the base table, and never the reporter id', async () => {
    const client = fakeClient({ loamy_public_price_updates: PRICE_ROWS })
    await runLoam({ message: 'What is the maize price?', language: 'en' },
      { model: new MockAdapter('[1] ok'), client, userId: 'u1' })
    const priceSelects = client.selects.filter((s) => s.includes('price_updates'))
    expect(priceSelects.length).toBeGreaterThan(0)
    for (const s of priceSelects) {
      expect(s.startsWith('loamy_public_price_updates:'), 'the view, not the base table').toBe(true)
      expect(s, 'recorded_by identifies a person').not.toContain('recorded_by')
      expect(s).not.toContain('*')
    }
  })

  it('F. no farm coordinates reach market-price evidence or the prompt', async () => {
    const client = fakeClient({ loamy_public_price_updates: PRICE_ROWS, farms: [FARM] })
    const model = new MockAdapter('[1] ok')
    await runLoam({ message: 'What is the maize price?', language: 'en' },
      { model, client, userId: 'u1' })
    expect(model.lastRequest!.user).not.toMatch(/latitude|longitude/)
    for (const s of client.selects) expect(s).not.toMatch(/latitude|longitude/)
  })

  it('E. another member’s farm stays invisible to a price question', async () => {
    // Price data is institutional; farm data is not. A price question must not
    // become a route to someone else’s records.
    const client = fakeClient({ loamy_public_price_updates: PRICE_ROWS, farms: [FARM] })
    const model = new MockAdapter('[1] ok')
    const r = await runLoam({ message: 'What is the maize price?', language: 'en' },
      { model, client, userId: 'someone-else' })
    expect(JSON.stringify(r.evidence)).not.toContain('Rafin Kaya')
    expect(model.lastRequest!.user).not.toContain('Rafin Kaya')
  })
})

/**
 * Capabilities migrated out of the legacy engine.
 *
 * Both were previously reachable only through `copilot/engine.ts`, which wrapped
 * them in its own prose. Loam takes the ROW and lets N-ATLaS phrase it, which is
 * the whole shape of the migration: the query moves, the answer generator does
 * not.
 */
describe('migrated capability: concept explanations', () => {
  const CONCEPTS = [{
    topic: 'Murabaha',
    aliases: ['murabaha', 'islamic finance', 'halal loan'],
    body_en: 'Murabaha is a Shariah-compliant financing arrangement where the bank buys and resells at a mark-up.',
    body_ha: 'Murabaha wata hanyar kudi ce ta Shariah.',
  }]

  it('answers from the team’s own reviewed content', async () => {
    const client = fakeClient({ copilot_concepts: CONCEPTS })
    const r = await runLoam(
      { message: 'What is Murabaha?', language: 'en' },
      { model: new MockAdapter('[1] Murabaha is a Shariah-compliant financing arrangement.'), client, userId: 'u1' },
    )
    expect(r.level).toBe(2)
    expect(r.declined).toBe(false)
    const concept = r.evidence.find((e) => e.claim.startsWith('Murabaha:'))
    expect(concept, 'the concept row became evidence').toBeTruthy()
  })

  it('is attributed as reviewed, NOT as pending agronomist review', () => {
    /**
     * The distinction matters. `copilot_concepts` is written and reviewed by
     * the Loamy team; the seeded knowledge pack is not. Labelling them the same
     * would either overstate the pack or understate this.
     */
    const client = fakeClient({ copilot_concepts: CONCEPTS })
    return runLoam(
      { message: 'Tell me about murabaha', language: 'en' },
      { model: new MockAdapter('[1] ok'), client, userId: 'u1' },
    ).then((r) => {
      const concept = r.evidence.find((e) => e.claim.startsWith('Murabaha:'))!
      expect(concept.source).toBe('Loamy platform guide')
      expect(concept.source).not.toContain('PENDING AGRONOMIST REVIEW')
    })
  })

  it('stays silent when no concept matches', async () => {
    const client = fakeClient({ copilot_concepts: CONCEPTS })
    const r = await runLoam(
      { message: 'What is a tractor?', language: 'en' },
      { model: new MockAdapter('[1] ok'), client, userId: 'u1' },
    )
    expect(r.evidence.some((e) => e.source === 'Loamy platform guide')).toBe(false)
  })
})

describe('migrated capability: local measurement units', () => {
  const UNITS = [
    { commodity: null, unit_name: 'bag', kg_equivalent: 100, region: null },
    { commodity: null, unit_name: 'bags', kg_equivalent: 100, region: null },
    { commodity: 'Maize', unit_name: 'mudu', kg_equivalent: 2.5, region: 'North' },
  ]

  it('answers a conversion question from the recorded equivalent', async () => {
    const client = fakeClient({ commodity_units: UNITS })
    const r = await runLoam(
      { message: 'How many kg in a mudu of maize?', language: 'en' },
      { model: new MockAdapter('[1] One mudu of Maize is 2.5 kg.'), client, userId: 'u1' },
    )
    const unit = r.evidence.find((e) => e.source === 'Loamy commodity units')
    expect(unit, 'the unit row became evidence').toBeTruthy()
    expect(unit!.claim).toContain('2.5 kg')
    expect(unit!.numbers).toContain(2.5)
  })

  it('collapses rows that mean the same thing', async () => {
    /**
     * "bag" and "bags" are separate rows with the same kilogram equivalent.
     * Keying on the name produced two claims, one of them reading "One bags is
     * recorded as 100 kg" -- duplicated and ungrammatical.
     */
    const client = fakeClient({ commodity_units: UNITS })
    const r = await runLoam(
      { message: 'How many kg in a bag?', language: 'en' },
      { model: new MockAdapter('[1] A bag is 100 kg.'), client, userId: 'u1' },
    )
    const units = r.evidence.filter((e) => e.source === 'Loamy commodity units')
    expect(units.length, 'bag and bags are one fact').toBe(1)
    expect(units[0].claim).not.toContain('One bags')
  })

  it('does NOT fire when no conversion was asked for', async () => {
    /**
     * Regression. Without the gate this reader matched the word "bags" in "I
     * want to sell 20 bags of maize" and answered with a unit conversion --
     * true, unasked, and standing in for the honest decline that request
     * deserves.
     */
    const client = fakeClient({ commodity_units: UNITS })
    const model = new MockAdapter('[1] should not be reached')
    const r = await runLoam(
      { message: 'I want to sell 20 bags of maize.', language: 'en' },
      { model, client, userId: 'u1' },
    )
    /**
     * PHASE 2. The point of this regression is that `unitEvidence` must not
     * fire on the word "bags" when no conversion was asked for -- and that
     * still holds: no evidence is attached at all. What changed is the
     * outcome when nothing backs an answer. A selling request is ordinary
     * conversation, so it reaches the model on the general lane instead of
     * being refused.
     */
    expect(r.evidence, 'the unit reader must not have fired').toHaveLength(0)
    expect(r.lane).toBe('general')
    // The model IS reached now, and what it is given is the general-lane
    // prompt -- which carries no evidence and forbids stating a price.
    expect(model.lastRequest).not.toBeNull()
    expect(model.lastRequest!.system).toContain('No Loamy records were needed')
    expect(model.lastRequest!.user, 'the question, and nothing retrieved')
      .toBe('I want to sell 20 bags of maize.')
  })

  it('neither migrated reader touches member data', async () => {
    // CONCEPTS lives in the sibling describe; declared locally here.
    const concepts = [{
      topic: 'Murabaha', aliases: ['murabaha'],
      body_en: 'A Shariah-compliant financing arrangement.', body_ha: null,
    }]
    const client = fakeClient({ copilot_concepts: concepts, commodity_units: UNITS, farms: [FARM] })
    await runLoam(
      { message: 'How many kg in a bag? And what is murabaha?', language: 'en' },
      { model: new MockAdapter('[1] ok'), client, userId: 'u1' },
    )
    for (const member of ['farms', 'crop_records', 'orders', 'listings', 'profiles']) {
      expect(client.selects.join(' '), `${member} is member data`).not.toContain(member)
    }
  })
})
