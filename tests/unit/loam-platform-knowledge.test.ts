import { describe, expect, it } from 'vitest'
import { runLoam } from '@/lib/loam/orchestrator'
import { MockAdapter } from '@/lib/loam/model/adapter'
import { platformEvidence } from '@/lib/loam/evidence'
import { publicSite } from '@/lib/i18n/packs/en/publicSite'
import type { EvidenceClient } from '@/lib/loam/evidence'

/**
 * "What is Loamy?" -- the question a new member asks first.
 *
 * The forensic trace found it declined, and the reason was not the gate being
 * strict. No reader covered the product at all: `content_entries` holds zero
 * rows, and the social router's capability phrase is `what is loam`, whose
 * word-boundary match fails against "loamy" by exactly one character. So the
 * question reached the gate carrying nothing and was correctly refused.
 *
 * The fix is evidence, not a special case. These tests assert the claims come
 * from the PUBLISHED site copy rather than from text invented for the model.
 */
function spyClient(tables: Record<string, unknown[]> = {}) {
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
    rpc: (() => Promise.resolve({ data: null, error: null })) as unknown as EvidenceClient['rpc'],
    selects,
  }
}

async function ask(message: string) {
  const model = new MockAdapter((req) => `[1] ${req.user.slice(0, 20)}`)
  const client = spyClient()
  const r = await runLoam({ message, language: 'en' }, { model, client, userId: 'u1' })
  return { r, model, client }
}

describe('platformEvidence is drawn from published copy, not invented', () => {
  it('fires for product questions', () => {
    for (const q of [
      'What is Loamy?', 'what is loamy', 'tell me about Loamy',
      'How does Loamy work?', 'who is Loamy for', 'what does loamy do',
    ]) {
      expect(platformEvidence(q).length, q).toBeGreaterThan(0)
    }
  })

  it('fires for the phrasings a live session actually used', () => {
    /**
     * These are verbatim from a real session, and every one of them was
     * DECLINED by the first pattern. "what is loam all about?" says `loam`,
     * not `loamy`; "loamy" on its own carries no question word. Both are
     * ordinary ways to ask what the product is.
     */
    for (const q of ['what is loam all about?', 'loamy', 'loam', 'what is loamy']) {
      expect(platformEvidence(q), q).not.toHaveLength(0)
    }
  })

  it('survives a commodity carried over from an earlier turn', () => {
    /**
     * The panel sends `lastCommodity` and `classify` honours it, so after
     * "show me rice listings" the next question arrives with commodity='Rice'
     * whether or not it mentions rice. A live session asked "What is Loamy?"
     * at that point and was declined. The guard must look at THIS message.
     */
    expect(platformEvidence('What is Loamy?', 'Rice')).not.toHaveLength(0)
    expect(platformEvidence('what is loam all about?', 'Maize')).not.toHaveLength(0)
    expect(platformEvidence('loamy', 'Maize')).not.toHaveLength(0)
  })

  it('stands aside when a commodity makes it a trading question', () => {
    // "what is the maize price on Loamy?" wants the price, not the pillars.
    expect(platformEvidence('what is the maize price on Loamy?', 'Maize')).toHaveLength(0)
    // ...but the same sentence with no commodity resolved is still about Loamy.
    expect(platformEvidence('what is the price on Loamy?', null)).not.toHaveLength(0)
  })

  it('does NOT fire for ordinary farming questions', () => {
    for (const q of [
      'when should I plant maize in Kaduna?', 'what is the price of rice?',
      'how many kg in a bag of maize?', 'hello',
    ]) {
      expect(platformEvidence(q), q).toHaveLength(0)
    }
  })

  it('is Level 2 and attributed to the platform, never a table name', () => {
    for (const e of platformEvidence('what is Loamy?')) {
      expect(e.level).toBe(2)
      expect(e.source).toMatch(/Loamy platform description/)
      expect(e.source).not.toMatch(/content_entries|publicSite|table/i)
      expect(e.contextOnly).not.toBe(true)
    }
  })

  it('carries the published lender disclaimer verbatim', () => {
    // "Loamy lends money" is the most consequential thing the model could get
    // wrong about the product, so the published correction travels with it.
    const claims = platformEvidence('what is Loamy?').map((e) => e.claim)
    expect(claims).toContain(publicSite['public.disclaimer'])
    expect(claims.join(' ')).toContain(publicSite['public.heroSubtitle'])
  })
})

describe('the runtime answers the product question', () => {
  it('"What is Loamy?" is no longer declined', async () => {
    const { r, model } = await ask('What is Loamy?')
    expect(r.declined).toBe(false)
    expect(r.refusal ?? null, 'an answered turn carries no refusal').toBeNull()
    expect(r.evidence.some((e) => e.source.includes('Loamy platform description'))).toBe(true)
    expect(model.lastRequest, 'the model must be reached').not.toBeNull()
  })

  it('"tell me about Loamy" is no longer declined', async () => {
    const { r } = await ask('tell me about Loamy')
    expect(r.declined).toBe(false)
  })

  it('an unrelated question is still declined when nothing backs it', async () => {
    // The fix must not become a catch-all that answers everything.
    const { r } = await ask('what is the price of cocoa in Ondo?')
    expect(r.declined).toBe(true)
  })
})

describe('greetings stay deterministic and never reach the model', () => {
  for (const g of ['Hi', 'hello', 'Good morning', 'thanks', 'bye']) {
    it(`"${g}" is answered without inference or retrieval`, async () => {
      const { r, model, client } = await ask(g)
      expect(r.declined).toBe(false)
      expect(r.modelUsed).toBe(false)
      expect(model.lastRequest, 'a greeting must not reach N-ATLaS').toBeNull()
      expect(client.selects, 'a greeting must not hit the database').toHaveLength(0)
      expect(r.level, 'a greeting carries no evidential claim').toBeNull()
    })
  }
})

describe('N-ATLaS receives evidence, never database access', () => {
  it('the prompt carries claims and no table or column names', async () => {
    const { model } = await ask('What is Loamy?')
    const prompt = `${model.lastRequest!.system}\n${model.lastRequest!.user}`
    expect(prompt).toContain('verified identity')
    for (const leak of [
      'content_entries', 'platform_config', 'select ', 'from(', 'supabase',
      'service_role', 'rest/v1',
    ]) {
      expect(prompt.toLowerCase(), `prompt must not contain ${leak}`)
        .not.toContain(leak.toLowerCase())
    }
  })
})
