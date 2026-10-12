import { describe, expect, it } from 'vitest'
import {
  COMMISSION_STATE, FLAG_DISCLAIMER, TASK_STATE,
  blocksSubmission, completionRate, earningsBreakdown, eligibilityReasons,
  flagLabel, gpsQuality, taskTypeLabel,
  type CommissionSummary, type Performance, type TaskStatus,
} from '../../src/lib/fieldops'

describe('a flag is a review signal, not an accusation', () => {
  it('never uses the word fraud', () => {
    for (const code of [
      'no_gps', 'low_gps_accuracy', 'gps_far_from_subject', 'duplicate_evidence',
      'repeated_identical_coordinates', 'impossible_travel', 'rapid_completion',
      'quantity_mismatch', 'captured_before_case_existed',
    ]) {
      const l = flagLabel(code).toLowerCase()
      expect(l, code).not.toContain('fraud')
      expect(l, code).not.toContain('fake')
      expect(l, code).not.toContain('lie')
    }
  })

  it('describes what happened, not what it means', () => {
    // "Captured away from the registered location" is a fact.
    // "Agent was not at the farm" is a conclusion the evidence does not support.
    expect(flagLabel('gps_far_from_subject')).toMatch(/captured away/i)
    expect(flagLabel('impossible_travel')).toMatch(/faster than road travel/i)
  })

  it('falls back to readable words for an unknown code', () => {
    expect(flagLabel('some_new_signal')).toBe('some new signal')
  })

  it('carries a disclaimer that says what a flag actually does', () => {
    expect(FLAG_DISCLAIMER).toMatch(/not an accusation/i)
    expect(FLAG_DISCLAIMER).toMatch(/reviewer will look/i)
  })

  it('never blocks an agent from submitting', () => {
    // Flags route work to review. An agent stuck in a field cannot fix a
    // duplicate-hash warning, and blocking them just loses the evidence.
    expect(blocksSubmission()).toBe(false)
  })
})

describe('GPS accuracy is shown as a quality', () => {
  it('tells the agent when a fix is good enough to proceed', () => {
    expect(gpsQuality(8).quality).toBe('good')
    expect(gpsQuality(8).advice).toBeNull()
  })

  it('accepts a fair fix without nagging', () => {
    expect(gpsQuality(60).quality).toBe('fair')
    expect(gpsQuality(60).advice).toBeNull()
  })

  it('warns BEFORE capture when the fix is poor, and says what to do', () => {
    const q = gpsQuality(450)
    expect(q.quality).toBe('poor')
    expect(q.advice).toMatch(/step into the open/i)
    // Honest about the consequence rather than silently flagging later.
    expect(q.advice).toMatch(/flagged for review/i)
  })

  it('handles no fix at all', () => {
    expect(gpsQuality(null).quality).toBe('none')
    expect(gpsQuality(undefined).label).toBe('No fix')
  })

  it('always shows the number, never just a tick', () => {
    expect(gpsQuality(37).label).toBe('±37 m')
  })
})

describe('owed and paid are never one number', () => {
  const summary = (over: Partial<CommissionSummary> = {}): CommissionSummary => ({
    currency: 'NGN', pending: 4000, approved: 2500, payable: 3500,
    paid: 12000, reversed: 0, disputed: 0, count: 7, ...over,
  })

  it('separates what is owed from what has actually arrived', () => {
    const b = earningsBreakdown(summary())
    expect(b.owed).toBe(10_000)
    expect(b.paid).toBe(12_000)
    expect(b.owed + b.paid).not.toBe(b.owed) // they are never combined
  })

  it('does not count reversed or disputed as owed', () => {
    const b = earningsBreakdown(summary({ reversed: 9999, disputed: 8888 }))
    expect(b.owed).toBe(10_000)
  })

  it('explains the difference in words', () => {
    expect(earningsBreakdown(summary()).note).toMatch(/actually been settled/i)
  })

  it('survives an agent with no earnings at all', () => {
    const b = earningsBreakdown(null)
    expect(b.owed).toBe(0)
    expect(b.paidLabel).toBe('₦0')
  })

  it('has honest help text for every commission state', () => {
    for (const s of ['estimated', 'pending', 'approved', 'payable', 'paid',
                     'reversed', 'disputed'] as const) {
      expect(COMMISSION_STATE[s].help.length, s).toBeGreaterThan(20)
    }
    // The distinction that matters most.
    expect(COMMISSION_STATE.payable.help).toMatch(/has not moved yet/i)
    expect(COMMISSION_STATE.paid.help).toMatch(/reference on record/i)
  })
})

describe('eligibility tells an agent what to fix', () => {
  it('turns every reason into something actionable', () => {
    const r = eligibilityReasons([
      'training_incomplete', 'outside_service_area', 'workload_at_capacity',
    ])
    expect(r[0]).toMatch(/training/i)
    expect(r[1]).toMatch(/service area/i)
    expect(r[2]).toMatch(/maximum number/i)
  })

  it('reports ALL reasons, not the first', () => {
    expect(eligibilityReasons(['suspended', 'training_incomplete'])).toHaveLength(2)
  })

  it('leaves no raw code on screen', () => {
    for (const r of eligibilityReasons(['not_cleared_for_this_task_type', 'brand_new'])) {
      expect(r).not.toMatch(/_/)
    }
  })

  it('says nothing when an agent is eligible', () => {
    expect(eligibilityReasons([])).toEqual([])
    expect(eligibilityReasons(undefined)).toEqual([])
  })
})

describe('an agent is never given a score', () => {
  const perf = (approved: number, rejected: number): Performance => ({
    training_status: 'trained', availability: 'available', suspended: false,
    tasks: { approved, rejected, total: approved + rejected },
    average_turnaround_hours: 3.2,
    review_outcomes: { approved, rejected },
    evidence: { submitted: 20, flagged: 2, superseded: 1 },
    flags_by_kind: { low_gps_accuracy: 2 },
    commission: { pending: 0, approved: 0, payable: 0, paid: 0 },
    service_areas: [],
  })

  it('WITHHOLDS a completion rate below five decided cases', () => {
    const r = completionRate(perf(2, 0))
    expect(r.shown, '100% from two cases was presented as a rate').toBe(false)
    expect(r.caption).toMatch(/at least 5/)
  })

  it('shows the rate WITH its denominator once it means something', () => {
    const r = completionRate(perf(9, 1))
    expect(r.shown).toBe(true)
    expect(r.percent).toBe(90)
    expect(r.sample).toBe(10)
    expect(r.caption).toBe('9 approved of 10 decided')
  })

  it('counts only decided cases, not open ones', () => {
    const p = perf(6, 2)
    p.tasks.in_progress = 40
    expect(completionRate(p).sample).toBe(8)
  })

  it('handles an agent who has done nothing yet', () => {
    expect(completionRate(null).shown).toBe(false)
    expect(completionRate(null).caption).toMatch(/0 decided cases/)
  })
})

describe('task vocabulary', () => {
  it('labels every status with a tone', () => {
    for (const s of Object.keys(TASK_STATE) as TaskStatus[]) {
      expect(TASK_STATE[s].label, s).toBeTruthy()
      expect(['good', 'busy', 'warn', 'bad', 'idle']).toContain(TASK_STATE[s].tone)
    }
  })

  it('distinguishes "with Loamy" from "approved"', () => {
    // An agent must never read submission as approval.
    expect(TASK_STATE.submitted.label).toBe('With Loamy')
    expect(TASK_STATE.submitted.tone).not.toBe('good')
    expect(TASK_STATE.approved.tone).toBe('good')
  })

  it('reads a task type in plain words', () => {
    expect(taskTypeLabel('warehouse_arrival_verification')).toBe('Warehouse arrival')
    expect(taskTypeLabel('something_new')).toBe('something new')
  })
})
