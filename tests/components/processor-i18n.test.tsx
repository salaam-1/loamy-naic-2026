import { describe, expect, it } from 'vitest'
import { translate } from '../../src/lib/i18n'
import { en } from '../../src/lib/i18n/packs/en'
import { PACKS } from '../../src/lib/i18n/packs'
import { LOCALES } from '../../src/lib/i18n/types'
import {
  GRADES, GRADE_SLUG, INSPECTION_LABELS, PACKAGING_SLUG, PACKAGING_TYPES,
  PAYMENT_LABELS, UNITS, UNIT_SLUG, VISIBILITY_LABELS,
} from '../../src/lib/rfqs'
import { AWARD_STAGES } from '../../src/lib/awards'
import { DOC_TYPES, DOC_TYPE_LABELS } from '../../src/lib/contracts'
import { FACTOR_LABELS } from '../../src/lib/bids'
import { COMPANY_ROLES } from '../../src/lib/companies'

/**
 * Wave A.3: the Processor interface, in five languages.
 *
 * COVERAGE IS ASSERTED WHERE IT WAS CLAIMED, AND NOT WHERE IT WAS NOT.
 *   English and French are complete for `processor.*`, so a fallback there is
 *   a regression and fails. Hausa, Igbo and Yoruba carry the operable
 *   vocabulary -- every status, label, button, column, form field, validation
 *   message and failure -- while 19 long explanatory paragraphs stay English
 *   until a native reviewer has been through them. Holding those three to
 *   100% would assert a translation that was deliberately not made.
 *
 * WHAT THIS FILE PROTECTS BEYOND COVERAGE
 *   The procurement pipeline is a sequence of states whose whole value is
 *   that they are DIFFERENT from each other. A translation that renders two
 *   of them identically does not read as a translation bug; it reads as a
 *   supplier being told they have been paid. So the collapse checks below
 *   run per language, not only in English.
 */

const scoped = Object.keys(en).filter((k) => k.startsWith('processor.'))

/**
 * The Processor surfaces the brief names, key by key. Every language must
 * render these, including the three partial ones: this is the set that decides
 * whether a processor can actually operate the product in their language.
 */
const REPRESENTATIVE = [
  // overview
  'processor.overview.activeBuyRequests', 'processor.overview.bidsAwaitingReview',
  'processor.overview.awardsInProgress', 'processor.overview.fundsInEscrow',
  'processor.overview.postBuyRequest', 'processor.overview.registerCompany',
  // company and team
  'processor.company.profile', 'processor.company.name', 'processor.company.rcNumber',
  'processor.company.saveChanges', 'processor.company.nameRequired',
  'processor.team.addMember', 'processor.team.colRole', 'processor.team.remove',
  'processor.team.role.procurementDirector', 'processor.team.role.financeOfficer',
  // buy requests
  'processor.rfq.newBuyRequest', 'processor.rfq.commodity', 'processor.rfq.quantity',
  'processor.rfq.closeBidding', 'processor.rfq.cancelRequest', 'processor.rfq.delete',
  'processor.rfqStatus.draft', 'processor.rfqStatus.open', 'processor.rfqStatus.awarded',
  // the wizard
  'processor.wizard.step.commodity', 'processor.wizard.step.payment',
  'processor.wizard.publish', 'processor.wizard.chooseCommodity',
  'processor.wizard.enterMaxPrice', 'processor.wizard.next', 'processor.wizard.back',
  // bids and awards
  'processor.bid.awardLabel', 'processor.bid.verified', 'processor.bid.unverified',
  'processor.bid.proceedWithSupplier', 'processor.bid.factor.price',
  'processor.awardStage.awarded', 'processor.awardStage.escrowFunded',
  'processor.awardStage.paymentReleased',
  // escrow
  'processor.escrow.fund', 'processor.escrow.release', 'processor.escrow.refund',
  'processor.escrowStatus.funded', 'processor.escrowStatus.released',
  'processor.escrow.heldByPartner',
  // inspection, logistics, contracts
  'processor.inspection.titleCount', 'processor.report.accept', 'processor.report.dispute',
  'processor.awardLogistics.arrange', 'processor.awardLogistics.reserve',
  'processor.contractView.signContract', 'processor.contractView.awaitingSignature',
  'processor.contract.uploadAction',
]

describe('every processor key renders in all five languages', () => {
  it('covers a meaningful number of keys', () => {
    expect(scoped.length).toBeGreaterThan(500)
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
    it(`${loc}: the representative processor surfaces are translated`, () => {
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

describe('English and French are complete for processor', () => {
  for (const loc of ['en', 'fr'] as const) {
    it(`${loc}: no processor key falls back`, () => {
      const missing = scoped.filter(
        (k) => (PACKS[loc] as Record<string, string | undefined>)[k] === undefined,
      )
      expect(missing, `${loc} is missing ${missing.length}:\n${missing.join('\n')}`).toEqual([])
    })
  }
})

describe('the procurement vocabularies mirror their libs', () => {
  /**
   * Same contract as financing and field-ops: the lib map keeps the DB value
   * and the shape, the pack keeps the words, and the English must not fork.
   * A fork is invisible in the UI -- `tOr` renders the pack -- and shows up
   * later as an export and a screen disagreeing about the same row.
   */
  it('every award stage label matches AWARD_STAGES word for word', () => {
    for (const stage of AWARD_STAGES) {
      expect(
        en[`processor.awardStage.${stage.slug}` as keyof typeof en],
        `processor.awardStage.${stage.slug} disagrees with AWARD_STAGES`,
      ).toBe(stage.en)
    }
  })

  it('every document type matches DOC_TYPE_LABELS', () => {
    for (const d of DOC_TYPES) {
      expect(en[`processor.docType.${d}` as keyof typeof en]).toBe(DOC_TYPE_LABELS[d])
    }
  })

  it('every ranking factor matches FACTOR_LABELS', () => {
    for (const [factor, label] of Object.entries(FACTOR_LABELS)) {
      expect(en[`processor.bid.factor.${factor}` as keyof typeof en]).toBe(label)
    }
  })

  it('every visibility, inspection and payment mode matches src/lib/rfqs.ts', () => {
    for (const [value, meta] of Object.entries(VISIBILITY_LABELS)) {
      expect(en[`processor.visibility.${value}.label` as keyof typeof en]).toBe(meta.label)
      expect(en[`processor.visibility.${value}.help` as keyof typeof en]).toBe(meta.help)
    }
    for (const [value, meta] of Object.entries(INSPECTION_LABELS)) {
      expect(en[`processor.inspectionMode.${value}.label` as keyof typeof en]).toBe(meta.label)
      expect(en[`processor.inspectionMode.${value}.help` as keyof typeof en]).toBe(meta.help)
    }
    for (const [value, meta] of Object.entries(PAYMENT_LABELS)) {
      expect(en[`processor.paymentMode.${value}.label` as keyof typeof en]).toBe(meta.label)
      expect(en[`processor.paymentMode.${value}.help` as keyof typeof en]).toBe(meta.help)
    }
  })

  it('every unit, packaging type and grade has a slug and an English label', () => {
    // The slug maps are what let the label translate while `rfqs.unit` and
    // `rfqs.grade` keep their English value in the database. A unit present in
    // UNITS but absent from UNIT_SLUG would silently render its raw DB value
    // in all five languages.
    for (const u of UNITS) {
      expect(UNIT_SLUG[u], `UNIT_SLUG is missing ${u}`).toBeTruthy()
      expect(en[`processor.unit.${UNIT_SLUG[u]}` as keyof typeof en]).toBe(u)
    }
    for (const p of PACKAGING_TYPES) {
      expect(PACKAGING_SLUG[p], `PACKAGING_SLUG is missing ${p}`).toBeTruthy()
      expect(en[`processor.packaging.${PACKAGING_SLUG[p]}` as keyof typeof en]).toBe(p)
    }
    for (const g of GRADES) {
      expect(GRADE_SLUG[g], `GRADE_SLUG is missing ${g}`).toBeTruthy()
      expect(en[`processor.grade.${GRADE_SLUG[g]}` as keyof typeof en]).toBe(g)
    }
  })

  it('every company role has a label and a permission explanation', () => {
    // A role rendered as its key would be a member unable to tell the Finance
    // Officer seat from the Executive Viewer seat.
    for (const role of COMPANY_ROLES) {
      const slug = role[0].toLowerCase() + role.slice(1).replace(/ /g, '')
      expect(
        en[`processor.team.role.${slug}` as keyof typeof en],
        `no label for company role ${role} (expected slug ${slug})`,
      ).toBe(role)
      expect(
        en[`processor.team.roleHelp.${slug}` as keyof typeof en],
        `no permission explanation for ${role}`,
      ).toBeTruthy()
    }
  })
})

describe('the procurement pipeline stays legible in every language', () => {
  /** Two keys must never render as the same string, in any language. */
  const MUST_DIFFER: [string, string, string][] = [
    // THE MONEY. "funded" says a licensed partner is holding it; "released"
    // says the supplier has it. Collapsing them tells a supplier they have
    // been paid when nothing has moved.
    ['processor.escrowStatus.funded', 'processor.escrowStatus.released', 'escrow funded vs released'],
    ['processor.awardStage.escrowFunded', 'processor.awardStage.paymentReleased', 'escrow stage vs payment stage'],
    ['processor.escrow.fund', 'processor.escrow.release', 'the fund button vs the release button'],
    ['processor.escrowStatus.released', 'processor.escrowStatus.partially_released', 'fully vs partly released'],
    ['processor.escrowStatus.refunded', 'processor.escrowStatus.released', 'refunded to buyer vs released to supplier'],
    // THE PIPELINE. Each of these is a different thing a processor can do, and
    // doing the wrong one is not recoverable in the same way.
    ['processor.rfqStatus.draft', 'processor.rfqStatus.open', 'an unpublished draft vs a live request'],
    ['processor.rfqStatus.closed', 'processor.rfqStatus.cancelled', 'closed to new bids vs cancelled outright'],
    ['processor.rfq.closeBidding', 'processor.rfq.cancelRequest', 'closing bidding vs cancelling the request'],
    ['processor.rfq.delete', 'processor.rfq.keep', 'the destructive button vs the one that backs out'],
    // TRUST. Verified is a thing a Growth Partner checked on the ground.
    ['processor.bid.verified', 'processor.bid.unverified', 'a verified supplier vs an unverified one'],
    ['processor.company.verified', 'processor.company.unverified', 'a verified company vs an unverified one'],
    // INSPECTION. Accepted and disputed drive whether escrow can be released.
    ['processor.inspectionStatus.accepted', 'processor.inspectionStatus.disputed', 'accepted vs disputed inspection'],
    ['processor.report.accept', 'processor.report.dispute', 'the accept button vs the dispute button'],
    ['processor.report.pass', 'processor.report.fail', 'a passing finding vs a failing one'],
    ['processor.report.conditional', 'processor.report.pass', 'conditional vs outright pass'],
  ]

  for (const loc of LOCALES) {
    it(`${loc}: no two load-bearing states render identically`, () => {
      for (const [a, b, why] of MUST_DIFFER) {
        const left = translate(loc, a)
        const right = translate(loc, b)
        expect(
          left.toLowerCase(),
          `${loc} collapsed ${why}: both render "${left}"`,
        ).not.toBe(right.toLowerCase())
      }
    })
  }

  it('the full award tracker reads as eight distinct stages in every language', () => {
    for (const loc of LOCALES) {
      const rendered = AWARD_STAGES.map((s) => translate(loc, `processor.awardStage.${s.slug}`).toLowerCase())
      expect(
        new Set(rendered).size,
        `${loc} renders only ${new Set(rendered).size} distinct stage names:\n${rendered.join('\n')}`,
      ).toBe(AWARD_STAGES.length)
    }
  })
})

describe('the money claims survive translation', () => {
  it('escrow is held by the payment partner, never by Loamy', () => {
    expect(en['processor.escrow.heldByPartner']).toMatch(/payment partner/i)
    expect(en['processor.escrowStatus.funded']).toMatch(/payment partner/i)
    expect(en['processor.overview.heldByPartner']).toMatch(/payment partner/i)
    for (const loc of LOCALES) {
      for (const key of ['processor.escrow.heldByPartner', 'processor.escrowStatus.funded']) {
        const text = translate(loc, key)
        expect(text.length, `${loc}:${key} is too short to carry the custody claim`).toBeGreaterThan(10)
        expect(text.toLowerCase(), `${loc}:${key} claims Loamy holds the funds`).not.toMatch(/loamy/)
      }
    }
  })

  it('release stays conditional on the inspection being accepted', () => {
    expect(en['processor.escrow.releaseAfterInspection']).toMatch(/once the inspection is accepted/i)
    for (const loc of LOCALES) {
      expect(
        translate(loc, 'processor.escrow.releaseAfterInspection').length,
        `${loc} shortened the release precondition`,
      ).toBeGreaterThan(30)
    }
  })

  it('direct bank transfer still says there is no escrow protection', () => {
    expect(en['processor.paymentMode.bank_transfer.help']).toMatch(/No escrow protection/i)
    for (const loc of ['en', 'fr', 'ha', 'ig', 'yo'] as const) {
      const text = translate(loc, 'processor.paymentMode.bank_transfer.help')
      expect(text.length, `${loc} dropped the no-protection warning`).toBeGreaterThan(40)
    }
  })

  it('a supplier phone number is only disclosed after the award', () => {
    // The disclosure gate. If a translation implies the number is shared on
    // "proceed", a processor will expect it and a supplier will have leaked it.
    expect(en['processor.bid.disclosureNote']).toMatch(/only once you award/i)
    for (const loc of LOCALES) {
      expect(
        translate(loc, 'processor.bid.disclosureNote').length,
        `${loc} shortened the disclosure note`,
      ).toBeGreaterThan(80)
    }
  })

  it('the signature is an acknowledgement, not a notarised instrument', () => {
    expect(en['processor.contractView.signExplainer']).toMatch(/v1 acknowledgement/i)
    for (const loc of LOCALES) {
      expect(translate(loc, 'processor.contractView.signExplainer').length, loc).toBeGreaterThan(50)
    }
  })
})

describe('interpolation survives translation', () => {
  /**
   * A dropped placeholder is the one translation bug that silently removes
   * data: `'Release {amount}'` losing `{amount}` becomes a button that does
   * not say how much money it moves.
   */
  it('every translated value keeps the placeholders English declared', () => {
    const offenders: string[] = []
    for (const key of scoped) {
      const english = (en as Record<string, string>)[key]
      const wanted = [...english.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      if (!wanted.length) continue
      for (const loc of LOCALES) {
        const value = (PACKS[loc] as Record<string, string | undefined>)[key]
        if (value === undefined) continue // deliberate English fallback
        const got = [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
        if (got.join(',') !== wanted.join(',')) {
          offenders.push(`${loc}:${key} wants {${wanted.join('} {')}} but has {${got.join('} {')}}`)
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
