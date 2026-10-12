import { describe, expect, it } from 'vitest'
import { runLoam } from '@/lib/loam/orchestrator'
import { MockAdapter } from '@/lib/loam/model/adapter'
import {
  listingCatalogueEvidence, listingEvidence, wantsListings,
  type EvidenceClient,
} from '@/lib/loam/evidence'

/**
 * The marketplace listings reader.
 *
 * THE PROPERTY THAT MATTERS MOST
 *   A listing price is what ONE seller is asking. A market price update is a
 *   recorded observation of what a commodity trades at. If Loam ever presents
 *   the first as the second, Loamy becomes the source of a benchmark it never
 *   measured. Several tests below exist only to pin that distinction, in the
 *   claim wording and in the attribution.
 *
 * WHAT IS REAL AND WHAT IS NOT
 *   The reader, its routing and its normalisation are real. The database is a
 *   spy that records every query it is asked to make, so the tests assert the
 *   READ as well as the output: which view, which columns, which filters,
 *   which limit. A reader that returned the right sentence from the wrong
 *   query would pass an output-only test.
 */

interface SpyCall { table: string; columns: string; opts: unknown; ops: string[] }

function spyClient(rows: unknown[], count: number | null = null) {
  const calls: SpyCall[] = []
  const from = (table: string) => {
    const call: SpyCall = { table, columns: '', opts: null, ops: [] }
    const chain: Record<string, unknown> = {}
    const self = (name: string) => (...args: unknown[]) => {
      call.ops.push(`${name}(${args.map((a) => JSON.stringify(a)).join(',')})`)
      return chain
    }
    for (const m of ['eq', 'in', 'ilike', 'order', 'gte', 'lte', 'or']) chain[m] = self(m)
    chain.select = (columns: string, opts?: unknown) => {
      call.columns = columns
      call.opts = opts ?? null
      calls.push(call)
      return chain
    }
    chain.limit = (n: number) => {
      call.ops.push(`limit(${n})`)
      return Promise.resolve({ data: rows, count, error: null })
    }
    // `head: true` queries never call .limit, so the chain itself resolves.
    chain.then = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: rows, count, error: null }).then(res)
    return chain
  }
  return { client: { from, rpc: () => Promise.resolve({ data: null, error: null }) } as unknown as EvidenceClient, calls }
}

const listing = (over: Record<string, unknown> = {}) => ({
  commodity: 'Maize', quantity: 100, unit: 'tonne', price_per_unit: 90000,
  currency: 'NGN', state: 'Benue', lga: 'Makurdi',
  created_at: '2026-09-23T15:04:45.000Z',
  seller_display_name: 'Phase0 farmer', seller_verified: false, ...over,
})

/* ------------------------------------------------------------------ routing */

describe('routing: only availability questions select listings', () => {
  const YES: [string, string | null, string | null][] = [
    ['what maize is available', 'Maize', null],
    ['maize listings', 'Maize', null],
    ['who sells maize', 'Maize', null],
    ['maize sellers', 'Maize', null],
    ['maize in Kaduna', 'Maize', 'Kaduna'],
    ['what are sellers asking for maize', 'Maize', null],
    ['available rice listings', 'Rice', null],
    ['agricultural products listed', null, null],
    ['rice', 'Rice', null],
    ['show me available rice listings', 'Rice', null],
  ]
  for (const [q, c, s] of YES) {
    it(`selects listings for "${q}"`, () => {
      expect(wantsListings(q, c, s)).toBe(true)
    })
  }

  const TRANSPORT: [string, string | null][] = [
    ['Are there transport offers for maize?', 'Maize'],
    ['What transport is available?', null],
    ['How much does transport cost?', 'Maize'],
    ['Can I transport maize from Benue to Kaduna?', 'Maize'],
    ['I need transport for maize.', 'Maize'],
    ['Can someone move my rice?', 'Rice'],
    ['who can haul my maize', 'Maize'],
    ['is there a truck available for rice', 'Rice'],
    ['what are the delivery options for maize', 'Maize'],
  ]
  for (const [q, c] of TRANSPORT) {
    it(`does NOT answer the transport question "${q}" with listings`, () => {
      /**
       * `offers` and `available` are listing words, so these reached the
       * listings reader and a live turn logged as "transport offers" was
       * answered with six Level 1 marketplace claims. Seller asking prices
       * are not an answer to a haulage question; declining is correct until
       * logistics evidence exists.
       */
      expect(wantsListings(q, c, null)).toBe(false)
    })
  }

  const NO: [string, string | null, string | null][] = [
    ['what is rice?', 'Rice', null],
    ['what is maize?', 'Maize', null],
    ['what is Loamy?', null, null],
    ['what is the official maize market price?', 'Maize', null],
    ['what is the price of maize in Kano?', 'Maize', 'Kano'],
    ['what is the recorded market price for rice', 'Rice', null],
    ['when should I plant maize in Kaduna?', 'Maize', 'Kaduna'],
    ['hello', null, null],
    ['how many kg in a bag of maize?', 'Maize', null],
  ]
  for (const [q, c, s] of NO) {
    it(`does NOT select listings for "${q}"`, () => {
      expect(wantsListings(q, c, s)).toBe(false)
    })
  }
})

/* ------------------------------------------------------- the read it performs */

describe('the query is bounded, active-only and public', () => {
  it('reads the public view, never the listings table', async () => {
    const { client, calls } = spyClient([listing()], 348)
    await listingEvidence(client, 'Maize', null)
    expect(calls[0].table).toBe('loamy_public_listings')
    // The view filters status='active' itself, which is why the reader does
    // not and must not reach the base table.
    expect(calls.every((c) => c.table !== 'listings')).toBe(true)
  })

  it('names its columns and requests no contact field', async () => {
    const { client, calls } = spyClient([listing()], 1)
    await listingEvidence(client, 'Maize', null)
    expect(calls[0].columns).not.toBe('*')
    for (const forbidden of ['phone', 'email', 'bvn', 'nin', 'seller_id', 'owner']) {
      expect(calls[0].columns, `must not select ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('caps the rows it pulls', async () => {
    const { client, calls } = spyClient([listing()], 418)
    await listingEvidence(client, 'Maize', null)
    const limit = calls[0].ops.find((o) => o.startsWith('limit('))
    expect(limit).toBeDefined()
    expect(Number(limit!.match(/\d+/)![0])).toBeLessThanOrEqual(20)
  })

  it('filters by commodity, and by state only when one is known', async () => {
    const a = spyClient([listing()], 44)
    await listingEvidence(a.client, 'Maize', 'Kaduna')
    expect(a.calls[0].ops.join(' ')).toContain('ilike("commodity","Maize")')
    expect(a.calls[0].ops.join(' ')).toContain('ilike("state","Kaduna")')

    const b = spyClient([listing()], 348)
    await listingEvidence(b.client, 'Maize', null)
    expect(b.calls[0].ops.join(' ')).not.toContain('"state"')
  })

  it('never filters on lga, which is incomplete in the real data', async () => {
    const { client, calls } = spyClient([listing()], 10)
    await listingEvidence(client, 'Maize', 'Benue')
    expect(calls[0].ops.join(' ')).not.toContain('"lga"')
  })
})

/* ------------------------------------------------------------ normalisation */

describe('rows become claims, never rows', () => {
  it('states the exact total from the count, not the sample size', async () => {
    const { client } = spyClient(Array.from({ length: 12 }, () => listing()), 348)
    const ev = await listingEvidence(client, 'Maize', null)
    expect(ev[0].claim).toContain('348')
    expect(ev[0].numbers).toContain(348)
  })

  it('describes at most three individual listings', async () => {
    const { client } = spyClient(Array.from({ length: 12 }, () => listing()), 348)
    const ev = await listingEvidence(client, 'Maize', null)
    expect(ev.filter((e) => e.claim.startsWith('One active listing:')).length)
      .toBeLessThanOrEqual(3)
  })

  it('never describes the same listing twice', async () => {
    /**
     * REGRESSION. The six newest Rice rows on staging are identical in every
     * field a user sees -- Rice, 100 kg, NGN 900, Benue, no LGA -- differing
     * only by id and timestamp. Taking the first three produced three claims
     * that read the same, and the live answer duly repeated itself. The fix is
     * here, on the visible tuple; the model is not asked to notice.
     */
    const identical = Array.from({ length: 6 }, (_, i) => listing({
      created_at: `2026-10-0${i + 1}T10:00:00.000Z`,
    }))
    const { client } = spyClient(identical, 24)
    const ev = await listingEvidence(client, 'Rice', null)
    const examples = ev.filter((e) => e.claim.startsWith('One active listing:'))
    expect(examples, 'six identical rows must yield ONE example').toHaveLength(1)
    expect(new Set(examples.map((e) => e.claim)).size).toBe(examples.length)
  })

  it('still shows several examples when they genuinely differ', async () => {
    const varied = [
      listing({ quantity: 100, price_per_unit: 90000, unit: 'tonne' }),
      listing({ quantity: 50, price_per_unit: 520, unit: 'kg' }),
      listing({ quantity: 20, price_per_unit: 45000, unit: 'bags', state: 'Kaduna' }),
    ]
    const { client } = spyClient(varied, 3)
    const ev = await listingEvidence(client, 'Maize', null)
    expect(ev.filter((e) => e.claim.startsWith('One active listing:'))).toHaveLength(3)
  })

  it('is Level 1 and attributed to listings, never to a table name', async () => {
    const { client } = spyClient([listing()], 1)
    for (const e of await listingEvidence(client, 'Maize', null)) {
      expect(e.level).toBe(1)
      expect(e.source).toBe('Loamy marketplace listings (seller asking prices)')
      expect(e.source).not.toMatch(/loamy_public_listings|select|table/i)
    }
  })

  it('carries quantity, unit, location and date context', async () => {
    const { client } = spyClient([listing()], 1)
    const ev = await listingEvidence(client, 'Maize', null)
    const example = ev.find((e) => e.claim.startsWith('One active listing:'))!
    expect(example.claim).toContain('100 tonne')
    expect(example.claim).toContain('Makurdi, Benue')
    expect(example.asOf).toBe('2026-09-23')
  })

  it('groups asking prices BY UNIT so a tonne is never averaged with a kg', async () => {
    const { client } = spyClient([
      listing({ unit: 'tonne', price_per_unit: 90000 }),
      listing({ unit: 'tonne', price_per_unit: 95000 }),
      listing({ unit: 'kg', price_per_unit: 520 }),
    ], 3)
    const ev = await listingEvidence(client, 'Maize', null)
    const ranges = ev.filter((e) => e.claim.includes('sellers are asking'))
    expect(ranges).toHaveLength(2)
    const tonne = ranges.find((e) => e.claim.includes('per tonne'))!
    expect(tonne.claim).toContain('90,000')
    expect(tonne.claim).toContain('95,000')
    // The kg range must not have absorbed the tonne figures.
    expect(ranges.find((e) => e.claim.includes('per kg'))!.claim).not.toContain('90,000')
  })

  it('reports sellers by display name and badge only', async () => {
    const { client } = spyClient([
      listing({ seller_display_name: 'Aisha Grains' }),
      listing({ seller_display_name: 'Benue Co-op' }),
      listing({ seller_display_name: 'Aisha Grains' }),
    ], 3)
    const ev = await listingEvidence(client, 'Maize', null)
    const sellers = ev.find((e) => /\d+ sellers? (has|have)/.test(e.claim))!
    expect(sellers.claim).toContain('Aisha Grains')
    expect(sellers.claim).toContain('Benue Co-op')
    expect(sellers.claim).toContain('2 sellers have')
    expect(sellers.claim).toContain('verified badge')
  })
})

/* ---------------------------------------------------------- price semantics */

describe('a listing price is never a market price', () => {
  it('every price claim says so in words', async () => {
    const { client } = spyClient([listing()], 1)
    const ev = await listingEvidence(client, 'Maize', null)
    for (const e of ev.filter((x) => x.claim.includes('sellers are asking'))) {
      expect(e.claim).toContain('not a verified Loamy market price')
    }
  })

  it('the attribution itself says asking prices', async () => {
    const { client } = spyClient([listing()], 1)
    const ev = await listingEvidence(client, 'Maize', null)
    expect(ev[0].source).toContain('asking prices')
  })

  it('never uses benchmark language', async () => {
    const { client } = spyClient([listing({ price_per_unit: 90000 })], 5)
    const text = (await listingEvidence(client, 'Maize', null)).map((e) => e.claim).join(' ')
    for (const word of ['market rate', 'benchmark', 'official price', 'going rate']) {
      expect(text.toLowerCase()).not.toContain(word)
    }
  })
})

/* -------------------------------------------------------------- empty state */

describe('an empty result is a clear answer, not silence', () => {
  it('says so when nothing is listed', async () => {
    const { client } = spyClient([], 0)
    const ev = await listingEvidence(client, 'Yam', null)
    expect(ev).toHaveLength(1)
    expect(ev[0].claim).toContain('no active Yam listings')
    expect(ev[0].level).toBe(1)
  })

  it('distinguishes "none here" from "none anywhere"', async () => {
    // Nothing in Kaduna, but the follow-up count finds some elsewhere.
    const { client } = spyClient([], 0)
    const ev = await listingEvidence(client, 'Maize', 'Kaduna')
    expect(ev[0].claim).toContain('no active Maize listings in Kaduna')
  })
})

/* ---------------------------------------------------------------- catalogue */

describe('the catalogue answers "what is listed?"', () => {
  it('aggregates to one sentence rather than listing rows', async () => {
    const rows = [
      ...Array.from({ length: 8 }, () => ({ commodity: 'Maize' })),
      ...Array.from({ length: 3 }, () => ({ commodity: 'Rice' })),
    ]
    const { client } = spyClient(rows, 418)
    const ev = await listingCatalogueEvidence(client)
    expect(ev).toHaveLength(1)
    expect(ev[0].claim).toContain('418 active listings')
    expect(ev[0].claim).toContain('Maize (8)')
    expect(ev[0].claim).toContain('Rice (3)')
    expect(ev[0].claim).toContain('does not list livestock')
  })

  it('says so when the marketplace is empty', async () => {
    const { client } = spyClient([], 0)
    const ev = await listingCatalogueEvidence(client)
    expect(ev[0].claim).toContain('no active listings')
  })
})

/* ------------------------------------------- the boundary around the model */

describe('N-ATLaS receives claims, never database access', () => {
  async function ask(message: string, rows: unknown[], count: number) {
    const { client } = spyClient(rows, count)
    const model = new MockAdapter('[1] ok')
    const r = await runLoam({ message, language: 'en' }, { model, client, userId: 'u1' })
    return { r, model }
  }

  it('an availability question reaches the model with listing evidence', async () => {
    const { r, model } = await ask('what maize is available', [listing()], 348)
    expect(r.declined).toBe(false)
    expect(r.evidence.some((e) => e.source.includes('marketplace listings'))).toBe(true)
    expect(model.lastRequest).not.toBeNull()
  })

  it('the prompt carries no table, SQL, Supabase or credential text', async () => {
    const { model } = await ask('what maize is available', [listing()], 348)
    const prompt = `${model.lastRequest!.system}\n${model.lastRequest!.user}`.toLowerCase()
    for (const leak of [
      // The VIEW name, not the English word: "348 active maize listings" is a
      // claim, and forbidding the noun would forbid the answer.
      'loamy_public_listings', 'select ', 'from(', 'ilike', 'supabase',
      'service_role', 'rest/v1', 'apikey', 'bearer', 'postgres', 'rpc(', 'sql',
    ]) {
      expect(prompt, `prompt must not contain "${leak}"`).not.toContain(leak)
    }
  })

  it('a definitional question gets no listing evidence', async () => {
    const { r } = await ask('what is rice?', [listing()], 24)
    expect(r.evidence.some((e) => e.source.includes('marketplace listings'))).toBe(false)
  })
})
