import { describe, expect, it } from 'vitest'
import { translate } from '../../src/lib/i18n'
import { en } from '../../src/lib/i18n/packs/en'
import { PACKS } from '../../src/lib/i18n/packs'
import { LOCALES } from '../../src/lib/i18n/types'

/**
 * Wave A.1: marketplace and checkout, in five languages.
 *
 * The bar here is higher than the rest of the journey suite. Elsewhere a key
 * may legitimately fall back to English -- the bank portal is left English for
 * Igbo and Yoruba on purpose, and asserting otherwise would assert a decision
 * that was deliberately not taken.
 *
 * This wave translated marketplace.*, checkout.* and cart.* to 100% in every
 * language. So on THESE surfaces an English fallback is a regression, and the
 * test says so rather than tolerating it.
 *
 * "Add to cart is translated but 'Unable to add this item' is not" is the
 * failure this is written to catch, so the errors, empty states and
 * accessibility labels are asserted alongside the buttons.
 */

const NS = ['marketplace.', 'checkout.', 'cart.'] as const
const scoped = Object.keys(en).filter((k) => NS.some((n) => k.startsWith(n)))

/** Keys whose English is a proper noun or an identifier, so sameness is right. */
const LEGITIMATELY_SAME = new Set([
  'marketplace.whatsappUs',      // WhatsApp is a brand name in some renderings
  'marketplace.sellOnLoamy',     // contains the product name
])

describe('every marketplace and checkout key exists in all five languages', () => {
  it('has a non-trivial number of keys, so the sweep means something', () => {
    expect(scoped.length).toBeGreaterThan(150)
  })

  for (const loc of LOCALES) {
    it(`${loc}: no key is missing, blank, or rendered as its own name`, () => {
      const missing: string[] = []
      for (const key of scoped) {
        const text = translate(loc, key)
        expect(text.trim().length, `${loc}:${key} is blank`).toBeGreaterThan(0)
        expect(text, `${loc}:${key} rendered the key name`).not.toBe(key)
        if ((PACKS[loc] as Record<string, string | undefined>)[key] === undefined) {
          missing.push(key)
        }
      }
      expect(
        missing,
        `${loc} falls back to English on ${missing.length} marketplace/checkout key(s). `
          + 'This wave translated them all, so a fallback here is a regression:\n'
          + missing.slice(0, 20).join('\n'),
      ).toEqual([])
    })
  }
})

describe('the translations are real, not English copied across', () => {
  for (const loc of LOCALES.filter((l) => l !== 'en')) {
    it(`${loc}: the visible text actually differs from English`, () => {
      const identical = scoped.filter(
        (k) => !LEGITIMATELY_SAME.has(k) && translate(loc, k) === en[k as keyof typeof en],
      )
      // A handful may coincide (a loanword, a number-only string). A large
      // overlap means English was pasted in to inflate the count.
      expect(
        identical.length,
        `${loc} renders ${identical.length} of ${scoped.length} keys identically to English. `
          + `Sample:\n${identical.slice(0, 15).join('\n')}`,
      ).toBeLessThan(scoped.length * 0.1)
    })
  }
})

describe('money, units and references survive translation', () => {
  it('no marketplace or checkout string hard-codes a currency word', () => {
    // Money renders through format.ts on the Nigerian convention in every
    // locale. A pack that writes "naira" or "euros" into a sentence has
    // started formatting money itself.
    for (const loc of LOCALES) {
      for (const key of scoped) {
        expect(translate(loc, key), `${loc}:${key}`).not.toMatch(/\b(naira|euros?|dollars?|USD|EUR)\b/i)
      }
    }
  })

  it('interpolation placeholders survive in every language', () => {
    // A dropped {unit} or {quantity} renders a sentence with a hole in it.
    for (const key of scoped) {
      const slots = [...String(en[key as keyof typeof en]).matchAll(/\{(\w+)\}/g)].map((m) => m[1])
      if (slots.length === 0) continue
      for (const loc of LOCALES) {
        const text = translate(loc, key)
        for (const slot of slots) {
          expect(text, `${loc}:${key} dropped {${slot}}`).toContain(`{${slot}}`)
        }
      }
    }
  })
})

describe('the claims that do legal work survive translation', () => {
  it('never says Loamy holds or moves the money', () => {
    // The settlement copy exists to say the opposite. English is checked
    // directly; a translated version is checked for length, because a
    // collapsed one-word rendering has dropped a clause.
    expect(en['marketplace.trust.bankRailsBody']).toMatch(/never holds or moves money/i)
    for (const loc of LOCALES) {
      const text = translate(loc, 'marketplace.trust.bankRailsBody')
      expect(text.length, `${loc} shortened the custody claim`).toBeGreaterThan(40)
    }
  })

  it('never says no payment happens on Loamy in fewer words than the claim needs', () => {
    expect(en['marketplace.noPaymentOnLoamy']).toMatch(/No payment happens on Loamy/i)
    for (const loc of LOCALES) {
      expect(translate(loc, 'marketplace.noPaymentOnLoamy').length, loc).toBeGreaterThan(40)
    }
  })

  it('keeps Loamy out of the lending decision at checkout', () => {
    expect(en['checkout.financingAgainstPurchase']).toMatch(/not the lender/i)
    for (const loc of LOCALES) {
      const text = translate(loc, 'checkout.financingAgainstPurchase')
      expect(text.length, `${loc} shortened the financing disclaimer`).toBeGreaterThan(60)
      if (text === en['checkout.financingAgainstPurchase']) continue
      // A translated version must still name the deciding institution.
      expect(text, `${loc} dropped the partner institution`)
        .toMatch(/institution|cibiya|ụlọ ọrụ|ilé-iṣẹ́|banki|báńkì/i)
    }
  })

  it('still says when fees freeze, which is a fact about the snapshot', () => {
    expect(en['checkout.feesFrozenOnAccept']).toMatch(/frozen when a seller accepts/i)
    for (const loc of LOCALES) {
      expect(translate(loc, 'checkout.feesFrozenOnAccept').length, loc).toBeGreaterThan(60)
    }
  })

  it('keeps contact exchange conditional on the seller accepting', () => {
    expect(en['marketplace.contactAfterAccept']).toMatch(/only after the seller accepts/i)
    for (const loc of LOCALES) {
      expect(translate(loc, 'marketplace.contactAfterAccept').length, loc).toBeGreaterThan(40)
    }
  })
})
