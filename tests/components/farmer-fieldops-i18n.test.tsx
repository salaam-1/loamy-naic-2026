import { describe, expect, it } from 'vitest'
import { translate } from '../../src/lib/i18n'
import { en } from '../../src/lib/i18n/packs/en'
import { PACKS } from '../../src/lib/i18n/packs'
import { LOCALES } from '../../src/lib/i18n/types'
import { VERIFICATION_META } from '../../src/lib/farming'

/**
 * Wave A.2: farmer and field operations, in five languages.
 *
 * COVERAGE IS ASSERTED WHERE IT WAS CLAIMED, AND NOT WHERE IT WAS NOT.
 *   French and English are complete for these namespaces, so a fallback there
 *   is a regression and fails. Hausa, Igbo and Yoruba carry the VOCABULARY --
 *   statuses, labels, buttons, form fields -- while the long explanatory and
 *   compliance prose stays English until a native reviewer has been through
 *   it. Asserting those three at 100% would assert a translation that was
 *   deliberately not made.
 *
 *   So the test holds each language to what was actually done, and the
 *   representative-key list below is the part every language must render.
 */

const NS = ['farm.', 'verification.'] as const
const scoped = Object.keys(en).filter((k) => NS.some((n) => k.startsWith(n)))

/** The farmer and field-ops surfaces the brief names, key by key. */
const REPRESENTATIVE = [
  // farmer
  'farm.myFarms', 'farm.registerFarm', 'farm.addFarm', 'farm.editFarm',
  'farm.crops', 'farm.cropRecords', 'farm.recordHarvest', 'farm.harvestDate',
  'farm.noFarmsRegistered', 'farm.loadingFarms', 'farm.notYours',
  'farm.validation.nameRequired', 'farm.validation.sizePositive',
  'farm.status.verified', 'farm.status.pending', 'farm.status.unverified',
  // field operations
  'verification.task.allTasks', 'verification.task.acceptThisTask',
  'verification.task.captureGpsNow', 'verification.task.takeAddPhotographs',
  'verification.task.submitForReview', 'verification.task.awaitingReview',
  'verification.task.couldNotSave', 'verification.task.loadingTask',
  'verification.taskState.approved', 'verification.taskState.submitted',
]

describe('every farmer and field-ops key renders in all five languages', () => {
  it('covers a meaningful number of keys', () => {
    expect(scoped.length).toBeGreaterThan(300)
  })

  for (const loc of LOCALES) {
    it(`${loc}: never blank, never a key name`, () => {
      for (const key of scoped) {
        const text = translate(loc, key)
        expect(text.trim().length, `${loc}:${key} is blank`).toBeGreaterThan(0)
        expect(text, `${loc}:${key} rendered the key name`).not.toBe(key)
      }
    })
  }

  for (const loc of LOCALES) {
    it(`${loc}: the representative farmer and field-ops surfaces are translated`, () => {
      const missing = REPRESENTATIVE.filter(
        (k) => (PACKS[loc] as Record<string, string | undefined>)[k] === undefined,
      )
      expect(
        missing,
        `${loc} falls back to English on ${missing.length} representative key(s):\n${missing.join('\n')}`,
      ).toEqual([])
    })
  }
})

describe('English and French are complete for these namespaces', () => {
  for (const loc of ['en', 'fr'] as const) {
    it(`${loc}: no farmer or field-ops key falls back`, () => {
      const missing = scoped.filter(
        (k) => (PACKS[loc] as Record<string, string | undefined>)[k] === undefined,
      )
      expect(missing, `${loc} is missing ${missing.length}`).toEqual([])
    })
  }
})

describe('the farm verification vocabulary mirrors the lib', () => {
  // Same contract as financing and field-ops: VERIFICATION_META keeps the
  // chip and the state, the pack keeps the words, and English must not fork.
  it('every status label matches VERIFICATION_META word for word', () => {
    for (const [status, meta] of Object.entries(VERIFICATION_META)) {
      expect(
        en[`farm.status.${status}` as keyof typeof en],
        `farm.status.${status} disagrees with VERIFICATION_META.${status}.label`,
      ).toBe(meta.label)
    }
  })

  it('keeps DECLARED and VERIFIED visibly different, in every language', () => {
    // The whole trust model. "Not verified" and "Verified" must never render
    // as the same string, which is the failure a loose translation produces.
    for (const loc of LOCALES) {
      const unverified = translate(loc, 'farm.status.unverified')
      const verified = translate(loc, 'farm.status.verified')
      expect(unverified, `${loc} collapsed unverified and verified`).not.toBe(verified)
    }
  })
})

describe('the claims that do work survive translation', () => {
  it('registering a farm never reads as having verified it', () => {
    expect(en['farm.notVerifiedYet']).toMatch(/has not been verified/i)
    for (const loc of LOCALES) {
      expect(translate(loc, 'farm.notVerifiedYet').length, loc).toBeGreaterThan(30)
    }
  })

  it('the bank decides and disburses, not Loamy', () => {
    expect(en['farm.financingExplainer']).toMatch(/Loamy never holds or moves funds/i)
    for (const loc of LOCALES) {
      const text = translate(loc, 'farm.financingExplainer')
      expect(text.length, `${loc} shortened the financing explainer`).toBeGreaterThan(80)
    }
  })

  it('a GPS mismatch is flagged for review, not treated as failure', () => {
    // The sentence an agent reads before capturing. If a translation turns
    // "flagged for review" into "rejected", agents stop trusting the system.
    expect(en['verification.task.gpsExplainer']).toMatch(/does not fail you/i)
    for (const loc of LOCALES) {
      expect(translate(loc, 'verification.task.gpsExplainer').length, loc).toBeGreaterThan(80)
    }
  })

  it('evidence is superseded, never erased', () => {
    expect(en['verification.task.discardExplainer']).toMatch(/superseded, never erased/i)
    for (const loc of LOCALES) {
      expect(translate(loc, 'verification.task.discardExplainer').length, loc).toBeGreaterThan(60)
    }
  })

  it('commission is tracked here and settled off-platform', () => {
    expect(en['verification.earnings.noBalance']).toMatch(/holds no balance/i)
    expect(en['verification.payoutCopy']).toMatch(/outside the platform/i)
    for (const loc of LOCALES) {
      expect(translate(loc, 'verification.earnings.noBalance').length, loc).toBeGreaterThan(15)
    }
  })
})
