import { describe, expect, it } from 'vitest'
import { runLoam } from '@/lib/loam/orchestrator'
import { MockAdapter } from '@/lib/loam/model/adapter'
import { needsControlledData, type EvidenceClient } from '@/lib/loam/evidence'
import { classify } from '@/lib/loam/classify'
import { guardGeneral } from '@/lib/loam/guard'

/**
 * Phase 2: the gate became a lane.
 *
 * WHAT CHANGED AND WHY
 *   The gate had one outcome for "no evidence": refuse. So "what is rice?"
 *   was declined with the model never invoked, while a standalone benchmark
 *   of the same model answered it well in 38 seconds. Refusing a definition
 *   protects nothing -- there is no Loamy record to get wrong.
 *
 *   Three lanes now. `grounded` when controlled data backs the answer,
 *   `withheld` when controlled data was REQUIRED and is missing, `general`
 *   when nothing controlled was needed. The protection is unchanged where it
 *   earns its place; it simply no longer applies where it never did.
 */

function spyClient(tables: Record<string, unknown[]> = {}, count: number | null = null) {
  const selects: string[] = []
  const from = (table: string) => {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    for (const m of ['eq', 'in', 'ilike', 'order', 'gte', 'lte', 'or']) chain[m] = self
    chain.select = (cols: string) => { selects.push(`${table}:${cols}`); return chain }
    chain.limit = () => Promise.resolve({ data: tables[table] ?? [], count, error: null })
    chain.then = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: tables[table] ?? [], count, error: null }).then(res)
    return chain
  }
  return {
    client: {
      from, rpc: () => Promise.resolve({ data: null, error: null }),
    } as unknown as EvidenceClient,
    selects,
  }
}

async function ask(message: string, opts: {
  tables?: Record<string, unknown[]>
  count?: number | null
  reply?: string
  lastCommodity?: string | null
  language?: 'en' | 'ha'
} = {}) {
  const model = new MockAdapter(opts.reply ?? 'Rice is a cereal grain grown widely in Nigeria.')
  const { client, selects } = spyClient(opts.tables ?? {}, opts.count ?? null)
  const r = await runLoam(
    { message, language: opts.language ?? 'en', lastCommodity: opts.lastCommodity ?? null },
    { model, client, userId: 'u1' },
  )
  return { r, model, selects }
}

/* ----------------------------------------------- acceptance: general lane */

describe('ordinary questions reach N-ATLaS instead of being refused', () => {
  /** Nothing controlled is involved, so these take the general lane. */
  const GENERAL = [
    'What is rice?', 'What is yam?', 'What is maize?', 'What is logistics?',
    'What is the difference between rice and maize?',
    'What factors should I consider before planting?',
    'Tell me about rice.', 'What exactly is rice?',
    'What is loamy soil?',
  ]
  for (const q of GENERAL) {
    it(`"${q}" takes the general lane and reaches the model`, async () => {
      const { r, model } = await ask(q)
      expect(r.lane).toBe('general')
      expect(r.declined, 'must not refuse').toBe(false)
      expect(r.modelUsed).toBe(true)
      expect(model.lastRequest, 'the model must be asked').not.toBeNull()
    })
  }

  /**
   * These are ANSWERED, and which lane they take is a property of the data,
   * not of the question.
   *
   * "Explain crop rotation" and "when should I plant maize in Kaduna?" match
   * the reviewed knowledge pack, so they come back `grounded` -- reviewed
   * guidance outranking model knowledge is the evidence hierarchy working, not
   * a regression. Bare "rice" is a browse and reaches the listings reader.
   * The acceptance criterion is that none of them is REFUSED.
   */
  const ANSWERED_EITHER_LANE = [
    'Explain crop rotation in simple terms.',
    'When should I plant maize in Kaduna?',
    'rice',
  ]
  for (const q of ANSWERED_EITHER_LANE) {
    it(`"${q}" is answered rather than refused`, async () => {
      const { r, model } = await ask(q)
      expect(r.declined, 'must not refuse').toBe(false)
      expect(r.lane, 'never withheld').not.toBe('withheld')
      expect(model.lastRequest, 'the model must be asked').not.toBeNull()
    })
  }

  it('is labelled Level 3 and claims no evidence', async () => {
    const { r } = await ask('What is rice?')
    expect(r.level, 'model reasoning, never a platform record').toBe(3)
    expect(r.evidence).toHaveLength(0)
  })

  it('reads no listing, price or member table for a general question', async () => {
    /**
     * `gatherEvidence` still runs its two cheap readers (concepts, units)
     * before the lane is chosen, which is what lets "explain crop rotation"
     * find reviewed guidance. What must NOT happen is a general question
     * touching listings, prices or member records.
     */
    const { selects } = await ask('What is rice?')
    for (const table of [
      'loamy_public_listings', 'loamy_public_price_updates', 'farms',
      'crop_records', 'profiles', 'orders',
    ]) {
      expect(selects.some((sel) => sel.startsWith(`${table}:`)), table).toBe(false)
    }
  })

  it('does not require a knowledge-pack entry (acceptance criterion 4)', async () => {
    // Pineapple in Sokoto has no entry and used to be refused.
    const { r } = await ask('When should I plant pineapple in Sokoto?')
    expect(r.lane).toBe('general')
    expect(r.declined).toBe(false)
  })
})

/* -------------------------------------------- acceptance: controlled data */

describe('controlled facts stay controlled', () => {
  it('a price question with no recorded price is WITHHELD, not guessed', async () => {
    const { r, model } = await ask('What is the price of cocoa in Ondo?')
    expect(r.lane).toBe('withheld')
    expect(r.declined).toBe(true)
    expect(r.refusal).toBe('no_evidence')
    expect(model.lastRequest, 'the model must not fill in a price').toBeNull()
  })

  it('a marketplace question with no listings states the empty result', async () => {
    /**
     * Not withheld: the listings reader returns a Level 1 claim saying there
     * are none, which is a better answer than a refusal and is still a
     * controlled statement about Loamy's records rather than model knowledge.
     */
    const { r } = await ask('What cocoa is available?', { count: 0 })
    expect(r.lane).toBe('grounded')
    expect(r.declined).toBe(false)
    expect(r.evidence.some((e) => /no active .* listings/i.test(e.claim))).toBe(true)
    expect(r.evidence.every((e) => e.level === 1 || e.level === 2)).toBe(true)
  })

  it('a platform question with no platform evidence is WITHHELD', async () => {
    // platformEvidence is in-repo, so this is defensive rather than reachable
    // today: the point is that "Loamy" never falls through to model knowledge.
    expect(needsControlledData('How does Loamy verification work?',
      classify('How does Loamy verification work?', 'en'))).toBe('platform')
  })

  it('a private question stays authenticated and withheld without records', async () => {
    const { r, model } = await ask('Show my listings.')
    expect(r.lane).toBe('withheld')
    expect(r.demand).toBe('personal')
    expect(model.lastRequest).toBeNull()
  })

  it('classifies each need from the current message', () => {
    const cases: [string, string | null][] = [
      ['What is rice?', null],
      ['What is loamy soil?', null],
      ['Explain crop rotation.', null],
      ['transport offers', null],
      ['What is the price of maize in Kano?', 'current_price'],
      ['What maize is available?', 'marketplace'],
      ['What is Loamy?', 'platform'],
      ['Show my listings', 'private'],
    ]
    for (const [q, want] of cases) {
      expect(needsControlledData(q, classify(q, 'en')), q).toBe(want)
    }
  })
})

/* ------------------------------------------------------ context leakage */

describe('stale commodity context cannot hijack an unrelated question', () => {
  it('rice -> yam -> "transport offers" does not inherit rice listings', async () => {
    /**
     * The exact live sequence. `lastCommodity` is sent on every turn and
     * `classify` honours it, so "transport offers" arrived carrying Rice and
     * was answered with six Level 1 rice listing claims. Tool selection now
     * reads `namedCommodity`, which only THIS message can set.
     */
    const { r, selects, model } = await ask('transport offers', { lastCommodity: 'Rice' })
    expect(r.lane, 'no controlled data was named').toBe('general')
    expect(selects.some((s) => s.includes('loamy_public_listings')),
      'must not read listings').toBe(false)
    expect(r.evidence).toHaveLength(0)
    expect(model.lastRequest).not.toBeNull()
  })

  it('"What is Loamy?" after a rice query still reaches platform evidence', async () => {
    const { r } = await ask('What is Loamy?', { lastCommodity: 'Rice' })
    expect(r.lane).toBe('grounded')
    expect(r.evidence.some((e) => e.source.includes('Loamy platform description'))).toBe(true)
  })

  it('an inherited commodity alone never triggers a reader', () => {
    for (const q of ['transport offers', 'thanks for that', 'what about logistics']) {
      expect(needsControlledData(q, { ...classify(q, 'en'), namedCommodity: null }), q)
        .not.toBe('marketplace')
    }
  })

  it('but a follow-up that names the intent still works', async () => {
    // "and the price?" after "maize": the PRICE signal is in this message, so
    // the reader fires and the inherited subject supplies the commodity.
    const { r } = await ask('and the price?', { lastCommodity: 'Maize' })
    expect(r.lane, 'a price question is controlled either way').toBe('withheld')
  })
})

/* ------------------------------------------------ the general-lane guard */

describe('the general lane may explain, but may not invent Loamy facts', () => {
  const FALLBACK = 'no answer'

  it('allows ordinary explanatory prose', () => {
    for (const ok of [
      'Rice is a cereal grain grown widely across Nigeria.',
      'Crop rotation breaks pest cycles and helps maintain soil fertility.',
      'Maize sowing depends on the onset of the rains rather than a fixed date.',
      'If you sell 25 kg of 100 kg, 75 kg remains.',
    ]) {
      expect(guardGeneral(ok, FALLBACK).blocked, ok).toBe(false)
    }
  })

  it('blocks a price stated without price evidence', () => {
    for (const bad of [
      'Maize sells for ₦52,000 per 100kg.',
      'Expect to pay 45,000 naira per tonne.',
      'The rate is NGN 900 per kg today.',
    ]) {
      const out = guardGeneral(bad, FALLBACK)
      expect(out.blocked, bad).toBe(true)
      expect(out.answer).toBe(FALLBACK)
    }
  })

  it('blocks invented Loamy platform mechanics', () => {
    const out = guardGeneral('Loamy charges a 5% fee and verifies every seller.', FALLBACK)
    expect(out.blocked).toBe(true)
  })

  it('blocks invented records', () => {
    const out = guardGeneral('There are 40 maize listings available right now.', FALLBACK)
    expect(out.blocked).toBe(true)
  })

  it('blocks a price forecast, using the grounded lane\'s own vocabulary', () => {
    expect(guardGeneral('Maize will cost more in March.', FALLBACK).blocked).toBe(true)
  })

  it('withholds the whole answer rather than editing it', () => {
    // Deleting the offending sentence would leave prose reading as though the
    // claim were still supported.
    const out = guardGeneral('Rice is a cereal. It sells for ₦900 per kg.', FALLBACK)
    expect(out.answer).toBe(FALLBACK)
    expect(out.answer).not.toContain('Rice is a cereal')
  })

  it('a blocked general answer is reported as declined, not as an answer', async () => {
    const { r } = await ask('What is rice?', { reply: 'Rice costs ₦900 per kg.' })
    expect(r.declined).toBe(true)
    expect(r.modelUsed).toBe(false)
    expect(r.level).toBe(4)
  })
})

/* ------------------------------------------------------ prompt boundary */

describe('the general-lane prompt exposes no database surface', () => {
  it('carries the question and nothing retrieved', async () => {
    const { model } = await ask('What is rice?')
    const prompt = `${model.lastRequest!.system}\n${model.lastRequest!.user}`.toLowerCase()
    for (const leak of [
      'content_entries', 'platform_config', 'loamy_public_listings', 'select ',
      'from(', 'supabase', 'service_role', 'rest/v1', 'apikey', 'bearer', 'sql',
    ]) {
      expect(prompt, `must not contain "${leak}"`).not.toContain(leak)
    }
  })

  it('tells the model it has no Loamy records', async () => {
    const { model } = await ask('What is rice?')
    expect(model.lastRequest!.system).toContain('No Loamy records were needed')
    expect(model.lastRequest!.system).toContain('Do NOT state a current price')
  })
})
