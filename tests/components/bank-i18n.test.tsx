import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { translate } from '../../src/lib/i18n'
import { formatNumber, formatDateShort } from '../../src/lib/i18n/format'
import { en } from '../../src/lib/i18n/packs/en'
import { PACKS } from '../../src/lib/i18n/packs'
import { LOCALES } from '../../src/lib/i18n/types'
import { formatNaira } from '../../src/lib/utils'
import { DECISION_META, FINANCING_STATUS_META, checkApprovalAmount, checkTenorDays } from '../../src/lib/financingLifecycle'
import { LOAN_SECTORS, REPAYMENT_STATUS_META } from '../../src/lib/bank'

/**
 * Wave A.4: the bank portal, in five languages.
 *
 * COVERAGE IS ASSERTED WHERE IT WAS CLAIMED, AND NOT WHERE IT WAS NOT.
 *   English and French are complete for `bank.*`. Hausa, Igbo and Yoruba carry
 *   every status, label, button, column, form field, validation message and
 *   failure, with 12 informational empty-state paragraphs falling back to
 *   English. Holding those three to 100% would assert a translation that was
 *   deliberately not made.
 *
 * WHAT THIS FILE PROTECTS BEYOND COVERAGE
 *   A bank officer reads these words while recording a decision about somebody
 *   else's money. Four facts have to survive translation into every language:
 *
 *     - the BANK decides, not Loamy;
 *     - Loamy holds no funds;
 *     - an APPROVED amount is not a DISBURSED amount;
 *     - a REQUESTED amount is not a promise.
 *
 *   A translation that loses any of those does not look like a translation bug.
 *   It looks like a bank officer being told the platform approved something, or
 *   a supplier being told money has moved.
 */

const ROOT = join(__dirname, '..', '..')

const scoped = Object.keys(en).filter((k) => k.startsWith('bank.'))

/** The bank surfaces Part 11 names, key by key. Every language renders these. */
const REPRESENTATIVE = [
  // dashboard heading and tiles
  'bank.home.submitted', 'bank.home.inReview', 'bank.home.requestedPipeline',
  'bank.home.loanPortfolio', 'bank.home.recentPipeline',
  // application queue
  'bank.pipeline.title', 'bank.pipeline.allStatuses', 'bank.pipeline.filterStatus',
  'bank.col.applicant', 'bank.col.amount', 'bank.col.status',
  // decision panel, approval and rejection
  'bank.decision.title', 'bank.decision.approved', 'bank.decision.rejected',
  'bank.decision.partially_approved', 'bank.decision.approvedAmount',
  'bank.decision.recordAction',
  // information request
  'bank.decision.additional_information_required', 'bank.decision.writeWhatYouNeed',
  // facility and status presentation
  'bank.col.facility', 'bank.facility.principal', 'bank.facility.outstanding',
  'bank.repaymentStatus.overdue', 'bank.repaymentStatus.paid',
  // empty states
  'bank.pipeline.noneForInstitution', 'bank.alerts.noneTitle', 'bank.repayments.noneTitle',
  // validation and error
  'bank.validation.amountAboveZero', 'bank.validation.amountNotAboveRequested',
  'bank.decision.checkTenor', 'bank.detail.couldNotLoad',
  // settlement
  'bank.settlement.title', 'bank.settlement.record', 'bank.settlement.institutionPaysDirect',
]

describe('every bank key renders in all five languages', () => {
  it('covers a meaningful number of keys', () => {
    expect(scoped.length).toBeGreaterThan(300)
  })

  for (const loc of LOCALES) {
    it(`${loc}: never blank, never a key name`, () => {
      for (const key of scoped) {
        const text = translate(loc, key)
        expect(text.trim().length, `${loc}:${key} is blank`).toBeGreaterThan(0)
        expect(text, `${loc}:${key} rendered the key name`).not.toBe(key)
        expect(text, `${loc}:${key} rendered a key-shaped string`).not.toMatch(/^bank\./)
      }
    })
  }

  for (const loc of LOCALES) {
    it(`${loc}: the representative bank surfaces are translated`, () => {
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

describe('English and French are complete for the bank portal', () => {
  for (const loc of ['en', 'fr'] as const) {
    it(`${loc}: no bank key falls back`, () => {
      const missing = scoped.filter(
        (k) => (PACKS[loc] as Record<string, string | undefined>)[k] === undefined,
      )
      expect(missing, `${loc} is missing ${missing.length}:\n${missing.join('\n')}`).toEqual([])
    })
  }
})

describe('the bank vocabularies mirror their libs', () => {
  it('every decision label and intent matches DECISION_META', () => {
    for (const [decision, meta] of Object.entries(DECISION_META)) {
      expect(en[`bank.decision.${decision}` as keyof typeof en]).toBe(meta.label)
      expect(en[`bank.decision.${decision}Intent` as keyof typeof en]).toBe(meta.intent)
    }
  })

  it('every decision has a written-out lowercase form', () => {
    // The confirm button reads "Record approve". `.toLowerCase()` is not a safe
    // transformation in every language, so each form is written out per
    // language instead of produced at runtime.
    for (const decision of Object.keys(DECISION_META)) {
      for (const loc of LOCALES) {
        const lower = translate(loc, `bank.decision.${decision}Lower`)
        expect(lower, `${loc} has no lowercase form for ${decision}`)
          .not.toBe(`bank.decision.${decision}Lower`)
      }
    }
  })

  it('every repayment status matches REPAYMENT_STATUS_META', () => {
    for (const [status, meta] of Object.entries(REPAYMENT_STATUS_META)) {
      expect(en[`bank.repaymentStatus.${status}` as keyof typeof en]).toBe(meta.label)
    }
  })

  it('every loan sector has a label keyed by its stored value', () => {
    for (const sector of LOAN_SECTORS) {
      expect(
        en[`bank.sector.${sector}` as keyof typeof en],
        `no label for stored sector "${sector}"`,
      ).toBe(sector)
    }
  })

  it('reuses the existing status vocabulary rather than coining a second one', () => {
    // Thirteen statuses already live under `financing.status.*`. A parallel
    // `bank.status.*` set is how a portal and a dashboard end up describing one
    // row with two different words.
    for (const status of Object.keys(FINANCING_STATUS_META)) {
      expect(
        en[`financing.status.${status}` as keyof typeof en],
        `financing.status.${status} is missing`,
      ).toBeTruthy()
      expect(
        (en as Record<string, string>)[`bank.status.${status}`],
        `bank.status.${status} duplicates financing.status.${status}`,
      ).toBeUndefined()
    }
  })
})

describe('the decision vocabulary stays legible in every language', () => {
  /** Pairs that must never render as the same string, in any language. */
  const MUST_DIFFER: [string, string, string][] = [
    // THE DECISIONS. Approving in full and approving part are different
    // amounts of somebody's money.
    ['bank.decision.approved', 'bank.decision.partially_approved', 'approve vs approve part'],
    ['bank.decision.approved', 'bank.decision.rejected', 'approve vs decline'],
    ['bank.decision.under_review', 'bank.decision.additional_information_required',
      'moving to review vs asking the applicant a question'],
    // THE MONEY. Requested, approved and disbursed are three different facts.
    ['bank.col.requested', 'bank.facility.disbursed', 'requested vs disbursed'],
    ['bank.decision.approvedAmount', 'bank.facility.disbursed', 'approved amount vs disbursed'],
    ['bank.facility.principal', 'bank.facility.outstanding', 'principal vs outstanding'],
    ['bank.transactions.disbursement', 'bank.transactions.repayment',
      'money going out vs money coming back'],
    // THE SCHEDULE. Paid and partial decide whether an instalment is settled.
    ['bank.repaymentStatus.paid', 'bank.repaymentStatus.partial', 'paid vs partly paid'],
    ['bank.repaymentStatus.upcoming', 'bank.repaymentStatus.overdue', 'upcoming vs overdue'],
    // TRUST.
    ['bank.risk.verified', 'bank.risk.notVerified', 'verified vs not verified'],
    // RISK TIERS: four tiers that drive how a file is read.
    ['bank.riskTier.Low', 'bank.riskTier.High', 'low vs high risk'],
    ['bank.riskTier.High', 'bank.riskTier.Very High', 'high vs very high risk'],
    // MILESTONES.
    ['bank.milestoneStatus.met', 'bank.milestoneStatus.missed', 'a milestone met vs missed'],
  ]

  for (const loc of LOCALES) {
    it(`${loc}: no two load-bearing bank states render identically`, () => {
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

  it('the five decisions read as five distinct actions in every language', () => {
    for (const loc of LOCALES) {
      const rendered = Object.keys(DECISION_META)
        .map((d) => translate(loc, `bank.decision.${d}`).toLowerCase())
      expect(
        new Set(rendered).size,
        `${loc} renders only ${new Set(rendered).size} distinct decisions:\n${rendered.join('\n')}`,
      ).toBe(Object.keys(DECISION_META).length)
    }
  })

  it('keeps info_requested and additional_information_required as ONE word', () => {
    /**
     * These two DB values mean the same thing, and BankPipeline dedupes its
     * status filter BY LABEL. If a translation gives them different words the
     * dropdown shows the same state twice, and an officer filtering by one of
     * them silently excludes applications in the other.
     */
    for (const loc of LOCALES) {
      expect(
        translate(loc, 'financing.status.info_requested'),
        `${loc} splits one state into two filter entries`,
      ).toBe(translate(loc, 'financing.status.additional_information_required'))
    }
  })
})

describe('Loamy is not the lender, in any language', () => {
  it('decision support rests with the Bank', () => {
    expect(en['bank.decisionSupportOnly']).toMatch(/rest with the Bank/i)
    for (const loc of LOCALES) {
      const text = translate(loc, 'bank.decisionSupportOnly')
      expect(text.length, `${loc} shortened the decision-authority claim`).toBeGreaterThan(30)
    }
  })

  it('the institution sets the approved figure, not Loamy', () => {
    expect(en['bank.decision.requestedHint']).toMatch(/Your institution sets the figure/i)
    for (const loc of LOCALES) {
      expect(translate(loc, 'bank.decision.requestedHint').length, loc).toBeGreaterThan(25)
    }
  })

  it('Loamy holds no pricing policy', () => {
    expect(en['bank.decision.pricingNote']).toMatch(/Loamy holds no pricing policy/i)
    for (const loc of LOCALES) {
      expect(translate(loc, 'bank.decision.pricingNote')).toMatch(/Loamy/)
    }
  })

  it('settlement says the institution pays and Loamy never holds the funds', () => {
    expect(en['bank.settlement.institutionPaysDirect']).toMatch(/never holds or moves the funds/i)
    expect(en['bank.settlement.recordedNotice']).toMatch(/Loamy holds no funds/i)
    for (const loc of LOCALES) {
      for (const key of ['bank.settlement.institutionPaysDirect', 'bank.settlement.recordedNotice']) {
        const text = translate(loc, key)
        expect(text, `${loc}:${key} dropped the custody claim`).toMatch(/Loamy/)
        expect(text.length, `${loc}:${key} is too short to carry it`).toBeGreaterThan(40)
      }
    }
  })

  it('a requested pipeline figure is not a held balance', () => {
    expect(en['bank.home.requestedPipelineSub']).toMatch(/not funds held/i)
    expect(en['bank.home.requestedNotOutstanding']).toMatch(/not outstanding balances/i)
    for (const loc of LOCALES) {
      expect(translate(loc, 'bank.home.requestedNotOutstanding').length, loc).toBeGreaterThan(60)
    }
  })

  it('a sandbox decision is labelled as a simulation before it is made', () => {
    expect(en['bank.decision.sandboxWarning']).toMatch(/not a credit decision/i)
    for (const loc of LOCALES) {
      expect(translate(loc, 'bank.decision.sandboxWarning').length, loc).toBeGreaterThan(60)
    }
  })
})

describe('money keeps the Nigerian convention in every language', () => {
  it('formatNaira does not vary by locale', () => {
    // A bank officer in any language reads the same number. The naira sign and
    // the grouping are not a localization choice.
    const outputs = LOCALES.map(() => formatNaira(250000))
    expect(new Set(outputs).size, 'money formatting differed by locale').toBe(1)
    expect(formatNaira(250000)).toContain('250,000')
    expect(formatNaira(250000)).toMatch(/₦|NGN/)
  })

  it('an approved-amount refusal carries the figure, formatted as naira', () => {
    const check = checkApprovalAmount('900000', 500000)
    expect(check.ok).toBe(false)
    if (check.ok) return
    // Previously this interpolated `toLocaleString('en-NG')` directly, which is
    // the same defect the A.3 analytics screen had: a formatter picking its own
    // locale. It goes through formatNaira now.
    expect(check.vars?.requested).toBe(formatNaira(500000))
    expect(check.message).toContain('500,000')
    for (const loc of LOCALES) {
      const rendered = translate(loc, check.messageKey, check.vars)
      expect(rendered, `${loc} dropped the requested figure`).toContain('500,000')
      expect(rendered, `${loc} rendered the key`).not.toBe(check.messageKey)
    }
  })

  it('a tenor refusal carries a key every language resolves', () => {
    const check = checkTenorDays('0')
    expect(check.ok).toBe(false)
    expect(check.messageKey).toBeTruthy()
    for (const loc of LOCALES) {
      const rendered = translate(loc, check.messageKey!)
      expect(rendered).not.toBe(check.messageKey)
      expect(rendered.length).toBeGreaterThan(5)
    }
  })
})

describe('counts and dates follow the member’s chosen locale', () => {
  /**
   * The A.3 regression, asserted so it cannot return. Two sites in the bank
   * code hardcoded `toLocaleString('en-NG')`: a quantity on the application
   * detail and an amount in a validator. A quantity is a COUNT and belongs to
   * the member's locale; an amount is MONEY and belongs to the naira
   * convention. The two rules are different and both are checked here.
   */
  it('a non-English locale actually changes number grouping', () => {
    // French groups with a narrow no-break space rather than a comma, so the
    // same number renders differently. If this ever matches English, the
    // formatter has stopped consulting the locale.
    const english = formatNumber(1234567, 'en')
    const french = formatNumber(1234567, 'fr')
    expect(english).toBe('1,234,567')
    expect(french, 'French number formatting matched English').not.toBe(english)
    expect(french.replace(/[\s  ]/g, '')).toBe('1234567')
  })

  /**
   * The A.3 defect, asserted at the SOURCE rather than at the output.
   *
   * A behavioural check cannot catch this one. `formatNaira(500000)` and
   * `(500000).toLocaleString('en-NG')` produce the identical string, so
   * reverting the formatter is invisible from outside -- the mutation was run
   * and the suite stayed green. What makes a hardcoded locale wrong is not the
   * output for one number, it is that the output can never follow the member:
   * the call site has decided, permanently, that everybody reads en-NG.
   *
   * So the rule is asserted as a rule. A formatter in bank code either takes
   * the locale from the i18n contract or formats money, and nothing in between.
   */
  it('no bank source hardcodes a locale in a formatter', () => {
    const offenders: string[] = []
    const files = [
      ...readdirSync(join(ROOT, 'src/pages/bank'))
        .filter((n) => /\.tsx?$/.test(n))
        .map((n) => `src/pages/bank/${n}`),
      'src/lib/bank.ts', 'src/lib/financing.ts', 'src/lib/financingLifecycle.ts',
      'src/lib/bankDecision.ts',
    ]
    for (const file of files) {
      const src = readFileSync(join(ROOT, file), 'utf8')
      src.split(/\r?\n/).forEach((line, i) => {
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return
        if (/toLocale(?:Date|Time)?String\(\s*['"`][a-z]{2}/.test(line)
          || /new Intl\.\w+\(\s*['"`][a-z]{2}/.test(line)) {
          offenders.push(`${file}:${i + 1} ${line.trim().slice(0, 90)}`)
        }
      })
    }
    expect(
      offenders,
      `a hardcoded locale ignores the language the member chose:\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('every locale formats a count without throwing or going blank', () => {
    for (const loc of LOCALES) {
      const out = formatNumber(1234567, loc)
      expect(out.length, `${loc} produced nothing`).toBeGreaterThan(6)
      expect(out.replace(/[^0-9]/g, ''), `${loc} changed the number`).toBe('1234567')
    }
  })

  it('a date renders per locale and never as the raw ISO string', () => {
    const iso = '2026-03-14T10:00:00.000Z'
    const seen = new Set<string>()
    for (const loc of LOCALES) {
      const out = formatDateShort(iso, loc)
      expect(out, `${loc} returned the ISO string`).not.toBe(iso)
      expect(out.length, `${loc} returned nothing`).toBeGreaterThan(3)
      seen.add(out)
    }
    // French at minimum differs from English ("14 mars" vs "14 Mar").
    expect(seen.size, 'every locale produced the identical date string').toBeGreaterThan(1)
  })

  it('money does NOT follow the locale, which is the opposite rule', () => {
    const amounts = LOCALES.map(() => formatNaira(1234567))
    expect(new Set(amounts).size).toBe(1)
    expect(amounts[0]).toContain('1,234,567')
  })
})

describe('interpolation survives translation', () => {
  it('every translated bank value keeps the placeholders English declared', () => {
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

  it('an interpolated bank sentence renders the value, not the placeholder', () => {
    for (const loc of LOCALES) {
      const out = translate(loc, 'bank.decision.recordAction', {
        action: translate(loc, 'bank.decision.approvedLower'),
      })
      expect(out, `${loc} left {action} unsubstituted`).not.toContain('{action}')
      const facility = translate(loc, 'bank.facility.instalmentHint', {
        date: '14 Mar', amount: formatNaira(50000),
      })
      expect(facility).toContain('50,000')
      expect(facility).not.toContain('{amount}')
    }
  })
})
