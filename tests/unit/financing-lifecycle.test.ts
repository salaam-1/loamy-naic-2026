import { describe, expect, it } from 'vitest'
import {
  DECISION_META, FINANCING_STATUS_META,
  checkApprovalAmount, checkTenorDays, offeredDecisions,
  provenanceLabel, statusMeta, wouldBeSandbox,
  type FinancingDecision, type FinancingStatus,
} from '../../src/lib/financingLifecycle'
import { decisionLabel } from '../../src/lib/financing'
import { APPLICATION_STATUS_META } from '../../src/lib/farming'

/**
 * The lifecycle contract. These tests exist because the product carried three
 * separate status maps covering 4, 5 and ~9 of the 13 statuses the database
 * permits, so an approved or declined application rendered as nothing at all
 * on two of the three surfaces.
 */

/** Verbatim from `financing_applications_status_check` in the live database. */
const DB_STATUSES: FinancingStatus[] = [
  'draft', 'submitted', 'under_review', 'info_requested',
  'additional_information_required', 'approved', 'partially_approved',
  'rejected', 'expired', 'cancelled', 'disbursed', 'completed',
  'decided_external',
]

describe('every status the database permits has a presentation', () => {
  it.each(DB_STATUSES)('renders %s for the bank', (status) => {
    const m = statusMeta(status)
    expect(m.label).toBeTruthy()
    expect(m.label).not.toMatch(/undefined/)
    expect(m.chip).toBeTruthy()
  })

  it.each(DB_STATUSES)('renders %s for the applicant', (status) => {
    expect(statusMeta(status).applicant).toBeTruthy()
  })

  it('covers exactly the database list, with nothing invented', () => {
    expect(Object.keys(FINANCING_STATUS_META).sort()).toEqual([...DB_STATUSES].sort())
  })

  it('reaches the farmer dashboard through the same map', () => {
    // farming.ts used to hold its own five-value copy.
    for (const s of DB_STATUSES) {
      expect(APPLICATION_STATUS_META[s], s).toBeTruthy()
      expect(APPLICATION_STATUS_META[s].label).toBe(statusMeta(s).label)
    }
  })

  it('reaches the buyer purchase page through decisionLabel', () => {
    for (const s of DB_STATUSES) {
      const label = decisionLabel({
        ref: 'FIN-1', status: s, is_sandbox: false,
        amount_requested: 1, approved_amount: null, disbursed_amount: 0,
        repayment_status: null,
      })
      expect(label, s).toBeTruthy()
      // A raw enum value leaking through means the switch missed a case.
      expect(label, s).not.toBe(s)
    }
  })

  it('never returns undefined for a status it has not heard of', () => {
    const m = statusMeta('some_future_status')
    expect(m.label).toBe('some future status')
    expect(m.chip).toBeTruthy()
  })

  it('says something for null and undefined rather than crashing', () => {
    expect(statusMeta(null).label).toBeTruthy()
    expect(statusMeta(undefined).label).toBeTruthy()
  })
})

describe('the two words for one state read identically', () => {
  it('shows info_requested and additional_information_required the same way', () => {
    // They are written by two different functions and both exist live.
    expect(statusMeta('info_requested').label)
      .toBe(statusMeta('additional_information_required').label)
    expect(statusMeta('info_requested').applicant)
      .toBe(statusMeta('additional_information_required').applicant)
  })
})

describe('a partial approval is not called an approval', () => {
  it('says "partly approved" to the borrower', () => {
    const label = decisionLabel({
      ref: 'FIN-1', status: 'partially_approved', is_sandbox: false,
      amount_requested: 10, approved_amount: 4, disbursed_amount: 0, repayment_status: null,
    })
    expect(label).toMatch(/partly approved/i)
  })

  it('does not tell a borrower an external decision went their way', () => {
    const label = decisionLabel({
      ref: 'FIN-1', status: 'decided_external', is_sandbox: false,
      amount_requested: 10, approved_amount: null, disbursed_amount: 0, repayment_status: null,
    })
    // Loamy does not know the outcome of a decision made outside it.
    expect(label).not.toMatch(/approved|declined/i)
    expect(label).toMatch(/communicates/i)
  })
})

describe('offered actions come from the server, never from the client', () => {
  it('offers nothing when the server sent nothing', () => {
    expect(offeredDecisions(undefined)).toEqual([])
    expect(offeredDecisions(null)).toEqual([])
    expect(offeredDecisions([])).toEqual([])
  })

  it('offers nothing when the server sent something unusable', () => {
    // A portal that invents actions when the backend goes quiet is worse
    // than one that offers none.
    expect(offeredDecisions('approved')).toEqual([])
    expect(offeredDecisions({ approved: true })).toEqual([])
  })

  it('offers exactly what the server permitted', () => {
    expect(offeredDecisions(['approved', 'rejected']))
      .toEqual(['approved', 'rejected'])
  })

  it('ignores a decision the server named that this build does not support', () => {
    expect(offeredDecisions(['approved', 'teleport'])).toEqual(['approved'])
  })

  it('puts the decisions in a stable order regardless of server order', () => {
    expect(offeredDecisions(['rejected', 'approved', 'under_review']))
      .toEqual(['under_review', 'approved', 'rejected'])
  })

  it('has metadata for every decision the server can permit', () => {
    const fromServer: FinancingDecision[] = [
      'under_review', 'additional_information_required',
      'approved', 'partially_approved', 'rejected',
    ]
    for (const d of fromServer) expect(DECISION_META[d], d).toBeTruthy()
  })
})

describe('a refusal and a question both need words', () => {
  it('requires a note to decline', () => {
    expect(DECISION_META.rejected.requiresNote).toBe(true)
  })

  it('requires a note to ask for information', () => {
    expect(DECISION_META.additional_information_required.requiresNote).toBe(true)
  })

  it('does not force one on an approval', () => {
    expect(DECISION_META.approved.requiresNote).toBe(false)
  })
})

describe('the approval amount mirrors the server and invents no ladder', () => {
  it('accepts exactly what was requested', () => {
    expect(checkApprovalAmount('100000', 100000)).toEqual({ ok: true, value: 100000 })
  })

  it('accepts less than was requested', () => {
    expect(checkApprovalAmount('40000', 100000).ok).toBe(true)
  })

  it('refuses more than was requested, and says the figure', () => {
    const r = checkApprovalAmount('100001', 100000)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/100,000/)
  })

  it('refuses zero and negatives', () => {
    expect(checkApprovalAmount('0', 100).ok).toBe(false)
    expect(checkApprovalAmount('-5', 100).ok).toBe(false)
  })

  it('refuses an empty or malformed amount without producing NaN', () => {
    for (const v of ['', '   ', 'abc', '1.2.3']) {
      const r = checkApprovalAmount(v, 100)
      expect(r.ok, v).toBe(false)
      expect(Number.isNaN(r.value), v).toBe(false)
    }
  })

  it('accepts a fractional amount, because numeric does', () => {
    expect(checkApprovalAmount('99999.5', 100000).ok).toBe(true)
  })

  it('imposes no ladder, tier or platform cap', () => {
    // The ₦500,000 pilot cap was removed from the check constraint in
    // 20260919100001. Reintroducing one in the client would be Loamy setting
    // credit policy.
    expect(checkApprovalAmount('750000000', 900000000).ok).toBe(true)
    const source = FINANCING_STATUS_META // touch, to keep the import honest
    expect(source).toBeTruthy()
  })
})

describe('tenor is validated as the column is, and no further', () => {
  it('treats an empty tenor as "not stated"', () => {
    expect(checkTenorDays('')).toEqual({ ok: true, value: null })
  })

  it('accepts a positive whole number of days', () => {
    expect(checkTenorDays('90')).toEqual({ ok: true, value: 90 })
  })

  it('refuses zero, negatives and fractions', () => {
    expect(checkTenorDays('0').ok).toBe(false)
    expect(checkTenorDays('-30').ok).toBe(false)
    expect(checkTenorDays('30.5').ok).toBe(false)
  })

  it('imposes no maximum, because the column has none', () => {
    expect(checkTenorDays('3650').ok).toBe(true)
  })
})

describe('sandbox is never presented as a real decision', () => {
  it('treats a sandbox integration as sandbox', () => {
    expect(wouldBeSandbox('sandbox')).toBe(true)
  })

  it('treats a missing integration mode as sandbox, not as live', () => {
    // Defaulting the unknown case to "live" would be the dangerous direction.
    expect(wouldBeSandbox(null)).toBe(true)
    expect(wouldBeSandbox(undefined)).toBe(true)
  })

  it('treats a live integration as live', () => {
    expect(wouldBeSandbox('live')).toBe(false)
  })

  it.each(['bank_officer', 'bank_api', 'sandbox_adapter'])(
    'says %s is not a real credit decision when sandbox', (source) => {
      expect(provenanceLabel(source, true)).toMatch(/not a real credit decision/i)
    })

  it('does not add the disclaimer to a live decision', () => {
    expect(provenanceLabel('bank_officer', false)).not.toMatch(/sandbox|simulation/i)
  })

  it('names the officer, the API and the simulator distinctly', () => {
    expect(provenanceLabel('bank_officer', false)).toMatch(/officer/i)
    expect(provenanceLabel('bank_api', false)).toMatch(/system/i)
    expect(provenanceLabel('sandbox_adapter', false)).toMatch(/sandbox adapter/i)
  })

  it('says so plainly when provenance was never recorded', () => {
    expect(provenanceLabel(null, false)).toMatch(/not recorded/i)
    expect(provenanceLabel(null, false)).not.toMatch(/officer|approved/i)
  })

  it('labels a sandbox decision in the borrower-facing line too', () => {
    const label = decisionLabel({
      ref: 'FIN-1', status: 'approved', is_sandbox: true,
      amount_requested: 10, approved_amount: 10, disbursed_amount: 0, repayment_status: null,
    })
    expect(label).toMatch(/sandbox simulation/i)
  })
})
