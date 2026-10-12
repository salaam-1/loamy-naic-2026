import { describe, expect, it } from 'vitest'
import {
  COMMISSION_STATE, FLAG_DISCLAIMER, TASK_STATE, TASK_TYPE_LABEL,
  eligibilityReasons, flagLabel, taskTypeLabel,
} from '../../src/lib/fieldops'
import { TASK_STATUS_META } from '../../src/lib/partner'
import { en } from '../../src/lib/i18n/packs/en'
import { translate } from '../../src/lib/i18n'
import { LOCALES } from '../../src/lib/i18n/types'

/**
 * The field-ops vocabulary has one English, same rule as financing.
 *
 * These words are read by an agent standing in a field deciding whether to
 * claim a case, and by a reviewer deciding whether to approve one. A pack
 * that paraphrases the lib's English forks the vocabulary between the two
 * surfaces that use it, and nobody notices until the words disagree.
 */

const K = (k: string) => en[k as keyof typeof en] as string | undefined

describe('task states mirror src/lib/fieldops.ts', () => {
  it('every state in the lib has a key, with the same words', () => {
    for (const [status, meta] of Object.entries(TASK_STATE)) {
      expect(K(`verification.taskState.${status}`), `missing key for ${status}`).toBeTruthy()
      expect(
        K(`verification.taskState.${status}`),
        `verification.taskState.${status} disagrees with TASK_STATE.${status}.label`,
      ).toBe(meta.label)
    }
  })

  it('every task type has a key, with the same words', () => {
    for (const [type, label] of Object.entries(TASK_TYPE_LABEL)) {
      expect(K(`verification.taskType.${type}`), `missing key for ${type}`).toBe(label)
    }
  })

  it('an unknown task type still renders as itself, never as a key', () => {
    // taskTypeLabel is the fallback a component passes to tOr.
    expect(taskTypeLabel('some_new_check')).toBe('some new check')
  })
})

describe('the partner vocabulary is kept separate, on purpose', () => {
  it('has its own namespace and its own words', () => {
    for (const [status, meta] of Object.entries(TASK_STATUS_META)) {
      expect(
        K(`verification.partnerTaskState.${status}`),
        `missing partner key for ${status}`,
      ).toBe(meta.label)
    }
  })

  it('does not accidentally agree with the field-ops words where the product says it should not', () => {
    // The two maps describe the same database statuses for different readers.
    // `pending` is the clearest case: "Not published" to the agent looking at
    // the pool, "Awaiting partner" to the queue watching the same row. If a
    // refactor ever merges them, this fails and the merge becomes a decision
    // rather than an accident.
    expect(K('verification.taskState.pending')).toBe('Not published')
    expect(K('verification.partnerTaskState.pending')).toBe('Awaiting partner')
  })
})

describe('flags accuse nobody, in any language', () => {
  it('every flag the lib knows has a key with the same words', () => {
    for (const code of [
      'no_gps', 'low_gps_accuracy', 'gps_far_from_subject', 'no_reference_location',
      'future_timestamp', 'captured_before_case_existed', 'duplicate_evidence',
      'repeated_identical_coordinates', 'impossible_travel', 'rapid_completion',
      'quantity_mismatch', 'no_loading_photo', 'no_waybill', 'no_quantity_confirmed',
    ]) {
      expect(K(`verification.flag.${code}`), `missing key for ${code}`).toBe(flagLabel(code))
    }
  })

  it('the standing disclaimer matches the lib and survives every translation', () => {
    expect(en['verification.flagDisclaimer']).toBe(FLAG_DISCLAIMER)
    for (const loc of LOCALES) {
      const text = translate(loc, 'verification.flagDisclaimer')
      expect(text.trim().length, loc).toBeGreaterThan(20)
      // The disclaimer's whole job is to say a flag is NOT an accusation.
      // A translation that drops the negation inverts its meaning.
      if (text !== FLAG_DISCLAIMER) {
        expect(text, `${loc} may have dropped the "not an accusation" clause`)
          .toMatch(/not|pas|ne |ba |non/i)
      }
    }
  })
})

describe('eligibility reasons tell an agent what to fix', () => {
  it('every reason has a key with the same words', () => {
    for (const code of [
      'not_a_growth_partner', 'account_inactive', 'suspended', 'marked_unavailable',
      'training_incomplete', 'not_cleared_for_this_task_type', 'workload_at_capacity',
      'outside_service_area',
    ]) {
      expect(K(`verification.eligibility.${code}`), `missing key for ${code}`)
        .toBe(eligibilityReasons([code])[0])
    }
  })
})

describe('commission wording does not promise money that has not moved', () => {
  it('every state has a label key matching the lib', () => {
    // `accrued` and `paid_externally` deliberately reuse another state's
    // label, so only the help text is distinct for them.
    for (const [status, meta] of Object.entries(COMMISSION_STATE)) {
      if (status === 'accrued' || status === 'paid_externally') continue
      expect(K(`verification.commission.${status}`), `missing key for ${status}`).toBe(meta.label)
    }
  })

  it('keeps "cleared for payment" and "paid" as different statements', () => {
    // Collapsing these in a translation would tell an agent they have been
    // paid when the money has not moved.
    expect(K('verification.commission.payableHelp')).toBe(COMMISSION_STATE.payable.help)
    expect(K('verification.commission.paidHelp')).toBe(COMMISSION_STATE.paid.help)
    expect(K('verification.commission.payableHelp')).not.toBe(K('verification.commission.paidHelp'))
  })
})

describe('the agent and the subject stay anonymous', () => {
  it('the pre-claim notice withholds the location rather than labelling it', () => {
    for (const loc of LOCALES) {
      const text = translate(loc, 'verification.fieldOps.detailsOnClaim')
      expect(text.trim().length, loc).toBeGreaterThan(10)
    }
    // The placeholder shown INSTEAD of a location must not be empty, or the
    // row would render as though a location were simply missing.
    expect(en['verification.fieldOps.locationOnAssignment']).toBeTruthy()
  })

  it('no key in the verification namespace interpolates an agent identity', () => {
    // {name}, {agent} and {email} would each be a way to leak one through
    // wording rather than through the query.
    const offenders = Object.entries(en)
      .filter(([k]) => k.startsWith('verification.'))
      .filter(([, v]) => /\{(agent|agentName|name|email|phone)\}/.test(String(v)))
    expect(offenders.map(([k]) => k), 'a verification string interpolates an identity').toEqual([])
  })
})
