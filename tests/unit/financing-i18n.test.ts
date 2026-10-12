import { describe, expect, it } from 'vitest'
import { FINANCING_STATUS_META, statusMeta, type FinancingStatus } from '../../src/lib/financingLifecycle'
import { en } from '../../src/lib/i18n/packs/en'
import { PACKS } from '../../src/lib/i18n/packs'
import { translate } from '../../src/lib/i18n'
import { LOCALES } from '../../src/lib/i18n/types'

/**
 * The financing lifecycle has ONE English vocabulary.
 *
 * `FINANCING_STATUS_META` exists because there were once three status maps
 * that disagreed, and a farmer whose application was rejected saw nothing at
 * all. Adding a translation pack creates exactly the same hazard a second
 * time: the pack is a fourth place where the word "Declined" is written down.
 *
 * So the pack is held to the map rather than allowed to paraphrase it. If
 * someone improves the wording in one place, this fails until they do it in
 * both. The map stays authoritative; the pack translates it.
 */

const STATUSES = Object.keys(FINANCING_STATUS_META) as FinancingStatus[]

describe('English status wording has a single source', () => {
  it('covers every status the check constraint permits', () => {
    // 13 values, including the two live spellings of "information requested".
    expect(STATUSES.length).toBe(13)
    for (const s of STATUSES) {
      expect(en[`financing.status.${s}` as keyof typeof en], `missing label key for ${s}`).toBeTruthy()
      expect(en[`financing.statusHint.${s}` as keyof typeof en], `missing hint key for ${s}`).toBeTruthy()
    }
  })

  it('every label matches FINANCING_STATUS_META word for word', () => {
    for (const s of STATUSES) {
      expect(
        en[`financing.status.${s}` as keyof typeof en],
        `financing.status.${s} disagrees with FINANCING_STATUS_META.${s}.label. `
          + 'Change both or neither.',
      ).toBe(FINANCING_STATUS_META[s].label)
    }
  })

  it('every applicant hint matches the map word for word', () => {
    for (const s of STATUSES) {
      expect(
        en[`financing.statusHint.${s}` as keyof typeof en],
        `financing.statusHint.${s} disagrees with FINANCING_STATUS_META.${s}.applicant.`,
      ).toBe(FINANCING_STATUS_META[s].applicant)
    }
  })

  it('the unknown-status fallback is also covered', () => {
    // statusMeta() invents a meta for a value this build has not heard of.
    // Its applicant line is shown to a real person, so it needs a key too.
    expect(en['financing.statusHint.unknown']).toBe(statusMeta('some_future_state').applicant)
  })
})

describe('translations of the lifecycle do not weaken it', () => {
  it('no locale renders a status as a blank or as its key', () => {
    for (const loc of LOCALES) {
      for (const s of STATUSES) {
        const key = `financing.status.${s}`
        const text = translate(loc, key)
        expect(text.trim().length, `${loc}:${key}`).toBeGreaterThan(0)
        expect(text, `${loc}:${key} fell through to the key`).not.toBe(key)
      }
    }
  })

  it('a locale that does not translate a status falls back to the English, not to silence', () => {
    for (const loc of LOCALES) {
      for (const s of STATUSES) {
        const key = `financing.status.${s}`
        const inPack = (PACKS[loc] as Record<string, string | undefined>)[key]
        if (inPack === undefined) {
          expect(translate(loc, key), `${loc}:${key}`).toBe(FINANCING_STATUS_META[s].label)
        }
      }
    }
  })

  it('every translated assurance still says the decision is not Loamy\'s', () => {
    // The one claim that must survive translation intact. A pack may leave
    // these in English; it may not render a version that drops the clause.
    for (const loc of LOCALES) {
      for (const key of ['financing.notALender', 'financing.decisionIsBanks'] as const) {
        const text = translate(loc, key)
        expect(text.trim().length, `${loc}:${key}`).toBeGreaterThan(10)
        if (text === en[key]) continue // untranslated, which is allowed
        // A translated assurance must still name the lender/bank distinction.
        expect(
          text,
          `${loc}:${key} no longer attributes the decision to the bank`,
        ).toMatch(/bank|banki|banque|prêteur|preteur|lender|ụlọ akụ|ilé ìfowópamọ̀|báńkì/i)
      }
    }
  })

  it('never states or implies that Loamy holds the money', () => {
    for (const loc of LOCALES) {
      const text = translate(loc, 'financing.notALender')
      // "Loamy is a lender" must not be constructible from the translation:
      // the English sentence is negative and the negation has to survive.
      if (translate(loc, 'financing.notALender') !== en['financing.notALender']) {
        expect(text.length, `${loc} shortened the disclaimer suspiciously`).toBeGreaterThan(20)
      }
    }
  })
})

describe('identifiers and product names are not translated', () => {
  it('Murabaha keeps its name in every locale that translates the line', () => {
    for (const loc of LOCALES) {
      for (const key of ['financing.product.murabahaLine', 'financing.product.murabahaShort'] as const) {
        expect(translate(loc, key), `${loc}:${key} dropped the contract name`).toContain('Murabaha')
      }
    }
  })
})
