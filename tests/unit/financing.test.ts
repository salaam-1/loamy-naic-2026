import { describe, expect, it } from 'vitest'
import {
  ELIGIBILITY_DISCLAIMER, STAGE_TONE, STAGE_WORD,
  bankOffers, blockingReasons, currentStage, decisionLabel, eligibilityLabel,
  paymentLabel, progress, responsibleLabel,
  type BankCapabilities, type Journey, type JourneyStage, type Readiness,
} from '../../src/lib/financing'

const stage = (over: Partial<JourneyStage>): JourneyStage => ({
  step: 1, code: 'x', label: 'X', status: 'pending', responsible: 'buyer',
  detail: null, next: null, ...over,
})

describe('never say "paid" before a settlement exists', () => {
  const journey = (over: Partial<Journey>): Pick<Journey, 'financing' | 'transaction'> => ({
    transaction: {
      ref: 'TXN-000001', commodity: 'Maize', quantity: 100, unit: 'tonne',
      subtotal: 9_000_000, currency: 'NGN', status: 'accepted',
      payment_state: 'not_started', fulfilment_state: 'not_started',
    },
    financing: null,
    ...over,
  })

  it('says nothing has moved when nothing has', () => {
    expect(paymentLabel(journey({}))).toBe('No payment yet')
  })

  it('does NOT claim payment merely because the bank approved', () => {
    // The dangerous case: an approval rendered as "paid", so a seller
    // releases goods against money that has not moved.
    expect(paymentLabel(journey({
      financing: {
        ref: 'FIN-1', status: 'approved', is_sandbox: false,
        amount_requested: 9_000_000, approved_amount: 9_000_000,
        disbursed_amount: 0, repayment_status: null,
      },
    }))).toBe('No payment yet')
  })

  it('says the institution settled only once a disbursement is on record', () => {
    expect(paymentLabel(journey({
      financing: {
        ref: 'FIN-1', status: 'disbursed', is_sandbox: false,
        amount_requested: 9_000_000, approved_amount: 9_000_000,
        disbursed_amount: 9_000_000, repayment_status: 'active',
      },
    }))).toBe('Seller settled by the institution')
  })

  it('reports the real payment state on a direct purchase', () => {
    for (const [state, label] of [
      ['held', 'Payment held'], ['released', 'Payment released'],
      ['failed', 'Payment failed'], ['refunded', 'Payment refunded'],
    ] as const) {
      const j = journey({})
      j.transaction.payment_state = state
      expect(paymentLabel(j)).toBe(label)
    }
  })
})

describe('a sandbox decision is labelled every time', () => {
  const fin = (over: Partial<NonNullable<Journey['financing']>> = {}) => ({
    ref: 'FIN-1', status: 'approved', is_sandbox: true,
    amount_requested: 1, approved_amount: 1, disbursed_amount: 0,
    repayment_status: null, ...over,
  })

  it('marks a simulated approval as a simulation', () => {
    expect(decisionLabel(fin())).toMatch(/not a real credit decision/i)
  })

  it('marks a simulated decline too', () => {
    expect(decisionLabel(fin({ status: 'rejected' }))).toMatch(/sandbox simulation/i)
  })

  it('says nothing extra for a real decision', () => {
    expect(decisionLabel(fin({ is_sandbox: false }))).toBe('Approved by the institution')
  })

  it('always attributes the decision to the institution, never to Loamy', () => {
    for (const status of ['approved', 'rejected', 'submitted', 'under_review',
                          'info_requested']) {
      const l = decisionLabel(fin({ status, is_sandbox: false })) ?? ''
      expect(l.toLowerCase(), status).not.toContain('loamy')
    }
  })
})

describe('an eligibility signal is never an amount', () => {
  it('offers words, not naira', () => {
    expect(eligibilityLabel({ available: true })).toBe('Eligibility assessment available')
    expect(eligibilityLabel(null)).toBe('Bank assessment required')
  })

  it('has no path that produces a figure', () => {
    for (const s of [null, { available: false }, { available: true, band: 'high' }]) {
      expect(eligibilityLabel(s)).not.toMatch(/\d/)
    }
  })

  it('carries a disclaimer that names who actually decides', () => {
    expect(ELIGIBILITY_DISCLAIMER).toMatch(/not a credit decision/i)
    expect(ELIGIBILITY_DISCLAIMER).toMatch(/institution decides/i)
  })
})

describe('the tracker tells you whose move it is', () => {
  it('puts a failure first', () => {
    const s = currentStage([
      stage({ code: 'a', status: 'done' }),
      stage({ code: 'b', status: 'waiting' }),
      stage({ code: 'c', status: 'failed' }),
    ])
    expect(s!.code).toBe('c')
  })

  it('prefers YOUR move over something merely in progress', () => {
    const s = currentStage([
      stage({ code: 'a', status: 'waiting' }),
      stage({ code: 'b', status: 'active' }),
    ])
    expect(s!.code).toBe('b')
  })

  it('falls back to the first pending stage', () => {
    const s = currentStage([
      stage({ code: 'a', status: 'done' }),
      stage({ code: 'b', status: 'pending' }),
    ])
    expect(s!.code).toBe('b')
  })

  it('survives an empty journey', () => {
    expect(currentStage([])).toBeNull()
  })

  it('names the responsible party in buyer-facing words', () => {
    expect(responsibleLabel('bank')).toBe('The financing institution')
    expect(responsibleLabel('buyer')).toBe('You')
    expect(responsibleLabel('logistics_provider')).toBe('The carrier')
  })

  it('has a tone and a word for every status', () => {
    for (const s of ['done', 'active', 'waiting', 'blocked', 'failed', 'skipped', 'pending'] as const) {
      expect(STAGE_TONE[s], s).toBeTruthy()
      expect(STAGE_WORD[s], s).toBeTruthy()
    }
  })
})

describe('progress counts only what applies', () => {
  it('ignores skipped stages, so a direct purchase is not stuck at 60%', () => {
    const p = progress([
      stage({ status: 'done' }), stage({ status: 'done' }),
      stage({ status: 'skipped' }), stage({ status: 'skipped' }),
      stage({ status: 'pending' }),
    ])
    expect(p.total).toBe(3)
    expect(p.done).toBe(2)
    expect(p.percent).toBe(67)
  })

  it('does not divide by zero on an all-skipped journey', () => {
    expect(progress([stage({ status: 'skipped' })]).percent).toBe(0)
  })
})

describe('a blocked settlement says what to chase', () => {
  const readiness = (blocked: string[]): Readiness => ({
    ready: false, blocked_by: blocked, conditions: [],
  })

  it('translates every condition code into something actionable', () => {
    const reasons = blockingReasons(readiness([
      'commodity_verified', 'seller_payout_ready', 'approval_current',
    ]))
    expect(reasons[0]).toMatch(/inspect the stock/i)
    expect(reasons[1]).toMatch(/where to send settlement/i)
    expect(reasons[2]).toMatch(/expired/i)
  })

  it('never leaves a raw code on screen', () => {
    for (const r of blockingReasons(readiness(['bank_approved', 'not_already_settled']))) {
      expect(r).not.toMatch(/_/)
    }
  })

  it('degrades gracefully for a code it has not seen', () => {
    expect(blockingReasons(readiness(['brand_new_condition']))[0]).toBe('brand new condition')
  })

  it('says nothing when settlement is ready', () => {
    expect(blockingReasons({ ready: true })).toEqual([])
  })
})

describe('bank capabilities drive what is offered', () => {
  const bank = (over: Partial<BankCapabilities['capabilities']> = {},
                rest: Partial<BankCapabilities> = {}): BankCapabilities => ({
    available: true, bank: 'Test Bank', bank_id: 'x', integration_mode: 'sandbox',
    is_sandbox: true, contact_note: null,
    capabilities: {
      check_eligibility: true, submit_application: true,
      account_opening: false, account_opening_url: null,
      status_callback: false, supplier_direct: false, ...over,
    },
    ...rest,
  })

  it('offers supplier-direct only when the bank supports it', () => {
    expect(bankOffers(bank({ supplier_direct: false })))
      .not.toContain('Pays the seller directly')
    expect(bankOffers(bank({ supplier_direct: true })))
      .toContain('Pays the seller directly')
  })

  it('announces a sandbox bank plainly', () => {
    expect(bankOffers(bank())).toContain('Sandbox - no real money moves')
    expect(bankOffers(bank({}, { is_sandbox: false, integration_mode: 'live' })))
      .not.toContain('Sandbox - no real money moves')
  })

  it('offers nothing for an unavailable bank', () => {
    expect(bankOffers(bank({}, { available: false }))).toEqual([])
    expect(bankOffers(null)).toEqual([])
  })
})
