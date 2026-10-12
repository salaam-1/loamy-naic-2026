import { describe, expect, it } from 'vitest'
import { runLoam } from '@/lib/loam/orchestrator'
import { MockAdapter } from '@/lib/loam/model/adapter'
import { detectSocial } from '@/lib/loam/social'
import { SOCIAL_KINDS } from '@/lib/loam/types'
import type { EvidenceClient } from '@/lib/loam/evidence'

/**
 * The conversational pre-router.
 *
 * A new member typed "Hi" and Loam replied "I do not have recorded
 * information to answer that reliably, so I will not guess." Consistent with
 * the evidence rules and completely wrong as a product: a greeting is not a
 * failed lookup.
 *
 * Two properties are under test, and the second matters more than the first.
 * Social phrases must be answered deterministically. And a social phrase
 * ATTACHED TO A REAL REQUEST must not be: "Hi, what is the maize price?" is a
 * market question, and answering it with a welcome message would be a worse
 * bug than the one being fixed.
 */

/** Records every table read and whether the model was reached. */
function spyClient(tables: Record<string, unknown[]> = {}, rpc: Record<string, unknown> = {}) {
  const selects: string[] = []
  const builder = (table: string) => {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    for (const m of ['eq', 'in', 'ilike', 'order', 'limit', 'gte', 'lte', 'or']) chain[m] = self
    chain.select = (cols: string) => { selects.push(`${table}:${cols}`); return chain }
    chain.then = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: tables[table] ?? [], error: null }).then(res)
    return chain
  }
  return {
    from: ((t: string) => builder(t)) as EvidenceClient['from'],
    rpc: ((n: string) => Promise.resolve({ data: rpc[n] ?? null, error: null })) as unknown as EvidenceClient['rpc'],
    selects,
  }
}

const PRICE_ROWS = [{
  commodity: 'Maize', state: 'Kano', unit: '100kg', price_min: 52000, price_max: 53200,
  recorded_date: new Date().toISOString().slice(0, 10), source_note: null,
}]
const FARM = {
  id: 'farm-1', farm_name: 'Rafin Kaya', state: 'Kaduna', lga: 'Giwa',
  size_hectares: 3.5, primary_crops: ['Maize'],
}

async function ask(message: string, tables: Record<string, unknown[]> = {}) {
  const model = new MockAdapter('[1] a model answer')
  const client = spyClient(tables, { loamy_copilot_price_context: null })
  const r = await runLoam({ message, language: 'en' }, { model, client, userId: 'u1' })
  return { r, model, client }
}

describe('social messages are answered deterministically', () => {
  const CASES: [string, string, string][] = [
    ['1', 'Hi', 'greeting'],
    ['2', 'Hello', 'greeting'],
    ['3', 'Hey Loam', 'greeting'],
    ['4', 'Good morning', 'greeting'],
    ['5', 'Thanks', 'courtesy'],
    ['6', 'Bye', 'goodbye'],
    ['7', 'What can you do?', 'capability'],
  ]

  for (const [n, message, kind] of CASES) {
    it(`${n}. "${message}" -> ${kind}, and N-ATLaS is never called`, async () => {
      const { r, model, client } = await ask(message)
      expect(r.kind).toBe(kind)
      expect(r.modelUsed, 'a greeting must not cost 60 seconds of inference').toBe(false)
      expect(model.lastRequest, 'the model was not asked').toBeNull()
      expect(client.selects, 'no retrieval for a social turn').toEqual([])
      expect(r.answer.length).toBeGreaterThan(20)
    })
  }

  it('a greeting is NOT an evidence failure', () => {
    // The original bug: "Hi" came back as L4 / no_evidence / declined.
    return ask('Hi').then(({ r }) => {
      expect(r.level, 'null means "no evidential claim", not "nothing found"').toBeNull()
      expect(r.declined).toBe(false)
      expect(r.refusal).toBeUndefined()
      expect(r.answer).not.toMatch(/I will not guess|not have recorded information/)
    })
  })

  it('the greeting introduces Loam without inventing capabilities', async () => {
    const { r } = await ask('Hi')
    expect(r.answer).toMatch(/Loam/)
    // Only what is actually implemented.
    for (const invented of ['weather', 'NAFDAC', 'WhatsApp', 'disease', 'alert', 'negotiat']) {
      expect(r.answer.toLowerCase(), `claims ${invented}, which does not exist`)
        .not.toContain(invented.toLowerCase())
    }
  })

  it('the capability answer lists only shipped capabilities', async () => {
    const { r } = await ask('What can you do?')
    expect(r.answer).toMatch(/plant/i)
    expect(r.answer).toMatch(/price/i)
    expect(r.answer).toMatch(/farm/i)
    // And states the limits rather than overselling.
    expect(r.answer).toMatch(/do not predict future prices/i)
    for (const invented of ['weather', 'NAFDAC', 'WhatsApp', 'disease detection', 'sell', 'logistics']) {
      expect(r.answer.toLowerCase()).not.toContain(invented.toLowerCase())
    }
  })

  it('every social kind is recognised as social', () => {
    for (const kind of SOCIAL_KINDS) expect(SOCIAL_KINDS).toContain(kind)
    expect(SOCIAL_KINDS).not.toContain('answer')
    expect(SOCIAL_KINDS).not.toContain('no_evidence')
  })
})

describe('a pleasantry attached to a request does NOT become a greeting', () => {
  it('8. "Hi, what’s the price of maize in Kano?" goes to the market flow', async () => {
    const { r, model, client } = await ask(
      "Hi, what's the price of maize in Kano?",
      { loamy_public_price_updates: PRICE_ROWS },
    )
    expect(r.kind, 'not a greeting').toBe('answer')
    expect(r.level, 'answered from recorded platform data').toBe(1)
    expect(model.lastRequest, 'the model WAS asked').not.toBeNull()
    expect(client.selects.some((s) => s.includes('price_updates'))).toBe(true)
  })

  it('9. "Hello, when should I plant maize in Kaduna?" goes to the agriculture flow', async () => {
    const { r, model } = await ask('Hello, when should I plant maize in Kaduna?')
    expect(r.kind).toBe('answer')
    expect(r.level, 'answered from the knowledge pack').toBe(2)
    expect(model.lastRequest!.user).toContain('Northern Guinea Savanna')
  })

  it('10. "Hey Loam, what’s on my farm?" goes to the farm-data flow', async () => {
    const { r, model } = await ask("Hey Loam, what's on my farm?", { farms: [FARM] })
    expect(r.kind).toBe('answer')
    expect(r.demand).toBe('personal')
    expect(r.level).toBe(1)
    expect(model.lastRequest!.user).toContain('Rafin Kaya')
  })

  it('a thank-you with a question in it is still the question', async () => {
    const { r } = await ask('Thanks! And when should I plant maize in Kaduna?')
    expect(r.kind).toBe('answer')
  })

  it('a greeting in front of a capability question still reaches the capability answer', async () => {
    const { r } = await ask('Hi, what can you do?')
    expect(r.kind).toBe('capability')
  })
})

describe('the matcher is narrow on purpose', () => {
  it('matches only on word boundaries', () => {
    // "hi" inside "this", "help" inside "helpful".
    expect(detectSocial('Is this the right season?')).toBeNull()
    expect(detectSocial('Is that helpful for maize?')).toBeNull()
  })

  it('does not treat a request containing a social word as social', () => {
    for (const q of [
      'What is the price of maize?',
      'When should I plant maize in Kaduna?',
      'Help me understand the maize price in Kano',
      'Can you predict the price of maize in March?',
    ]) {
      expect(detectSocial(q), `"${q}" must reach the pipeline`).toBeNull()
    }
  })

  it('tolerates punctuation, case and vocatives', () => {
    for (const q of ['hi!', 'HELLO.', 'Hey, Loam!', 'hi there', 'thanks loam', 'Good Morning!!']) {
      expect(detectSocial(q), `"${q}"`).not.toBeNull()
    }
  })

  it('recognises Hausa greetings and thanks', () => {
    expect(detectSocial('Sannu')?.kind).toBe('greeting')
    expect(detectSocial('Barka')?.kind).toBe('greeting')
    expect(detectSocial('Na gode')?.kind).toBe('courtesy')
    // ...but a Hausa greeting with a question is still a question.
    expect(detectSocial('Sannu, yaushe zan shuka masara a Kaduna?')).toBeNull()
  })

  it('answers a Hausa greeting in Hausa', async () => {
    const { r } = await ask('Sannu')
    expect(r.language).toBe('ha')
    expect(r.answer).toContain('Loam')
    expect(r.answer).toMatch(/maraba|Sannu/i)
  })
})

describe('the social layer does not touch the legacy Co-pilot', () => {
  it('social.ts imports nothing from copilot/', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(__dirname, '..', '..', 'src', 'lib', 'loam', 'social.ts'), 'utf8')
    expect(src).not.toContain('@/lib/copilot/')
    expect(src).not.toContain('engine')
  })

  it('a social turn performs no database read and no inference at all', async () => {
    const { r, model, client } = await ask('Hello')
    expect(client.selects).toEqual([])
    expect(model.lastRequest).toBeNull()
    expect(r.timings!.inferenceMs).toBe(0)
    expect(r.timings!.retrieveMs).toBe(0)
  })
})
