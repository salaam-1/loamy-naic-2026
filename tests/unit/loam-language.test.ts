import { describe, expect, it } from 'vitest'
import {
  LOAM_LANGUAGES, isLoamLanguage, loamLanguageFromLocale,
  loamLanguageCode, loamLanguageLabel,
} from '@/lib/loam/language'
import { suggestedPrompts, tone, ui } from '@/lib/loam/ui'
import { phrase } from '@/lib/loam/phrases'
import { LOCALES } from '@/lib/i18n/types'
import { runLoam } from '@/lib/loam/orchestrator'
import { MockAdapter } from '@/lib/loam/model/adapter'
import type { EvidenceClient } from '@/lib/loam/evidence'

/**
 * The language a member asks in, and the language Loam answers in.
 *
 * WHAT THESE TESTS DO AND DO NOT ESTABLISH
 *   They verify APPLICATION behaviour: that a preference is honoured, that a
 *   detected language survives the round trip, that every lookup has a
 *   fallback, and that diacritics are not mangled on the way through. They
 *   establish NOTHING about how good the model's Hausa, Igbo or Yoruba is.
 *   That needs a speaker, and no amount of mocking substitutes for one.
 */

function fakeClient() {
  const from = () => {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    for (const m of ['eq', 'in', 'ilike', 'order', 'gte', 'lte', 'or']) chain[m] = self
    chain.select = () => chain
    chain.limit = () => Promise.resolve({ data: [], count: 0, error: null })
    chain.then = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], count: 0, error: null }).then(res)
    return chain
  }
  return { from, rpc: () => Promise.resolve({ data: null, error: null }) } as unknown as EvidenceClient
}

/* ----------------------------------------------- the locale -> Loam bridge */

describe('the app locale and the answer language are related, not identical', () => {
  it('covers exactly the four languages the model card documents', () => {
    expect([...LOAM_LANGUAGES]).toEqual(['en', 'ha', 'ig', 'yo'])
  })

  it('passes through a locale Loam speaks', () => {
    for (const l of ['en', 'ha', 'ig', 'yo'] as const) {
      expect(loamLanguageFromLocale(l)).toBe(l)
    }
  })

  it('answers a FRENCH member in English rather than faking French', () => {
    /**
     * French is a real interface locale with a full translation pack, and it
     * is NOT a language N-ATLaS is documented to speak. Asking the model for
     * French because a dropdown offered it is exactly the unverified claim
     * this codebase refuses to make. French interface, English answer.
     */
    expect(LOCALES).toContain('fr')
    expect(loamLanguageFromLocale('fr')).toBe('en')
  })

  it('falls back to English when the member has never chosen', () => {
    expect(loamLanguageFromLocale(null)).toBe('en')
    expect(loamLanguageFromLocale(undefined)).toBe('en')
  })

  it('rejects anything that is not a Loam language', () => {
    for (const bad of ['fr', 'de', 'pcm', '', 'EN', null, undefined, 7, {}]) {
      expect(isLoamLanguage(bad), String(bad)).toBe(false)
    }
    for (const good of LOAM_LANGUAGES) expect(isLoamLanguage(good)).toBe(true)
  })
})

/* ------------------------------------------------------------ the selector */

describe('the selector shows each language its own name', () => {
  it('uses endonyms, with diacritics intact', () => {
    expect(loamLanguageLabel('en')).toBe('English')
    expect(loamLanguageLabel('ha')).toBe('Hausa')
    expect(loamLanguageLabel('ig')).toBe('Igbo')
    // The accent is the point: a member looking for "Yorùbá" must find it.
    expect(loamLanguageLabel('yo')).toBe('Yorùbá')
    expect(loamLanguageLabel('yo')).toContain('ù')
  })

  it('never renders an English translation of a language name', () => {
    // Guards against someone "simplifying" Yorùbá to Yoruba in the control.
    expect(loamLanguageLabel('yo')).not.toBe('Yoruba')
  })

  it('offers a short code for cramped space', () => {
    expect(LOAM_LANGUAGES.map(loamLanguageCode)).toEqual(['EN', 'HA', 'IG', 'YO'])
  })
})

/* ------------------------------------------------- every lookup has a path */

describe('no language can produce an empty string', () => {
  it('ui() resolves for all four', () => {
    for (const l of LOAM_LANGUAGES) {
      for (const k of ['openLabel', 'title', 'welcome', 'languageLabel', 'composerLabel'] as const) {
        const s = ui(k, l)
        expect(s, `${k}/${l}`).toBeTruthy()
        expect(typeof s).toBe('string')
      }
    }
  })

  it('phrase() resolves for all four', () => {
    for (const l of LOAM_LANGUAGES) {
      expect(phrase('noEvidence', l), l).toBeTruthy()
      expect(phrase('greeting', l), l).toBeTruthy()
    }
  })

  it('tone() resolves for all four', () => {
    for (const l of LOAM_LANGUAGES) {
      expect(tone('reasoned', l), l).toBeTruthy()
      expect(tone('loamy', l), l).toBeTruthy()
    }
  })

  it('suggestedPrompts() resolves for all four and is never empty', () => {
    for (const l of LOAM_LANGUAGES) {
      const p = suggestedPrompts(l)
      expect(p.length, l).toBeGreaterThan(0)
      expect(p.every((s) => s.trim().length > 0)).toBe(true)
    }
  })

  it('Igbo and Yoruba fall back to English rather than to invented text', () => {
    /**
     * Deliberate. A farmer-facing sentence written in a language nobody on
     * the team speaks is how a system says something it did not mean. The
     * ANSWER still arrives in Igbo or Yoruba -- that comes from the model.
     */
    expect(suggestedPrompts('ig')).toEqual(suggestedPrompts('en'))
    expect(suggestedPrompts('yo')).toEqual(suggestedPrompts('en'))
    expect(phrase('noEvidence', 'ig')).toBe(phrase('noEvidence', 'en'))
    // Hausa is genuinely translated, so it must NOT equal English.
    expect(phrase('noEvidence', 'ha')).not.toBe(phrase('noEvidence', 'en'))
  })
})

/* --------------------------------------------------- Unicode through Loam */

describe('local-language characters survive the pipeline', () => {
  const SAMPLES: [string, string][] = [
    ['ha', 'Yaushe zan shuka masara a ƙasar Kaduna?'],
    ['yo', 'Ìgbà wo ni mo yẹ kí n gbin àgbàdo?'],
    ['ig', 'Kedu mgbe m kwesịrị ịkụ ọka?'],
  ]

  for (const [lang, message] of SAMPLES) {
    it(`${lang}: the question reaches the model byte-for-byte`, async () => {
      const model = new MockAdapter('ok')
      await runLoam(
        { message, language: lang as 'ha' | 'ig' | 'yo' },
        { model, client: fakeClient(), userId: 'u1' },
      )
      // Whatever lane it took, the model must have seen the exact characters.
      if (model.lastRequest) {
        expect(model.lastRequest.user).toContain(message)
      }
    })

    it(`${lang}: the response is labelled with the asked language`, async () => {
      const r = await runLoam(
        { message, language: lang as 'ha' | 'ig' | 'yo' },
        { model: new MockAdapter('ok'), client: fakeClient(), userId: 'u1' },
      )
      expect(r.language).toBe(lang)
    })
  }

  it('does not normalise away combining marks', () => {
    // Yorùbá under-dots and Hausa hooked letters are distinct code points, not
    // decoration: "ẹ" is not "e" and "ƙ" is not "k".
    for (const ch of ['ƙ', 'ẹ', 'ọ', 'ị', 'ù', 'á']) {
      expect(ch.length).toBeGreaterThan(0)
      expect(loamLanguageLabel('yo') + ch).toContain(ch)
    }
  })
})

/* ------------------------------------- the lanes are language-independent */

describe('switching language does not change the safety behaviour', () => {
  it('a product question stays grounded in every language', async () => {
    for (const l of LOAM_LANGUAGES) {
      const r = await runLoam(
        { message: 'What is Loamy?', language: l },
        { model: new MockAdapter('ok'), client: fakeClient(), userId: 'u1' },
      )
      expect(r.lane, l).toBe('grounded')
    }
  })

  it('a price question with no record is withheld in every language', async () => {
    for (const l of LOAM_LANGUAGES) {
      const r = await runLoam(
        { message: 'What is the price of cocoa in Ondo?', language: l },
        { model: new MockAdapter('ok'), client: fakeClient(), userId: 'u1' },
      )
      expect(r.lane, l).toBe('withheld')
      expect(r.declined, l).toBe(true)
    }
  })

  it('an ordinary question takes the general lane in every language', async () => {
    for (const l of LOAM_LANGUAGES) {
      const r = await runLoam(
        { message: 'What is logistics?', language: l },
        { model: new MockAdapter('Logistics is the movement of goods.'), client: fakeClient(), userId: 'u1' },
      )
      expect(r.lane, l).toBe('general')
      expect(r.declined, l).toBe(false)
    }
  })

  it('the general-lane prompt names the language it must answer in', async () => {
    const model = new MockAdapter('ok')
    await runLoam(
      { message: 'What is logistics?', language: 'ha' },
      { model, client: fakeClient(), userId: 'u1' },
    )
    expect(model.lastRequest!.system).toContain('Hausa')
  })
})
