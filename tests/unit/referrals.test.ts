import { describe, expect, it, vi } from 'vitest'
import {
  ACTIONABLE_REFUSALS, ATTRIBUTION_REASONS, BENEFIT_KIND_LABEL, REFERRAL_STATE,
  assertNoMoney, attributionRefusal, benefitsHeadline, qualificationLabel, referralUrl,
  type Benefit, type ReferralStatus, type ReferralSummary,
} from '../../src/lib/referrals'

const benefit = (over: Partial<Benefit> = {}): Benefit => ({
  id: 'b1', ref: 'BEN-000001', code: 'recognition', label: 'Recognition',
  kind: 'recognition', status: 'earned',
  awarded_at: '2026-09-20T00:00:00Z', expires_at: null, ...over,
})

const summary = (benefits: Benefit[]): ReferralSummary => ({
  code: {
    code: 'musa', is_username: true, link_path: '/u/musa',
    programme: {
      ref: 'RPG-000001', name: 'Growth', qualification: { type: 'first_listing' },
      attribution_window_hours: 72, benefits: [],
    },
    note: 'Referrals earn Loamy platform benefits.',
  },
  counts: { registered: 2, qualified: 1, invalidated: 0, total: 3 },
  people: [], benefits, is_cash_programme: false,
  note: 'Loamy referrals earn platform benefits.',
})

describe('the invite surface never shows money', () => {
  it('says "None yet", not ₦0', () => {
    const h = benefitsHeadline(summary([]))
    expect(h.value).toBe('None yet')
    // The exact failure this guards: a zero that reads as an unpaid balance.
    expect(h.value).not.toMatch(/[₦$0]/)
    expect(h.caption).not.toMatch(/[₦$]/)
  })

  it('counts benefits, never currency', () => {
    const h = benefitsHeadline(summary([benefit(), benefit({ id: 'b2', code: 'early' })]))
    expect(h.value).toBe('2 benefits')
    expect(h.value).not.toMatch(/[₦$]/)
  })

  it('separates available from used', () => {
    const h = benefitsHeadline(summary([
      benefit(), benefit({ id: 'b2', status: 'redeemed' }),
    ]))
    expect(h.caption).toBe('1 available · 1 used')
  })

  it('singularises one benefit', () => {
    expect(benefitsHeadline(summary([benefit()])).value).toBe('1 benefit')
  })

  it('survives a member with no summary at all', () => {
    expect(benefitsHeadline(null).value).toBe('None yet')
  })

  it('warns loudly if money-shaped copy reaches the surface', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    assertNoMoney('₦0 earned')
    expect(warn, 'a naira figure passed the guard silently').toHaveBeenCalled()
    warn.mockRestore()
  })

  it('flags the specific phrasings that imply an affiliate programme', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const bad of ['NGN 0', 'Pending payout', 'Your commission', '5000 naira']) {
      warn.mockClear()
      assertNoMoney(bad)
      expect(warn, `"${bad}" was not flagged`).toHaveBeenCalled()
    }
    warn.mockRestore()
  })

  it('leaves ordinary benefit copy alone', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const ok of ['2 benefits available', 'Early access to new features',
                      'Referral recognition on your profile']) {
      warn.mockClear()
      expect(assertNoMoney(ok)).toBe(ok)
      expect(warn, `"${ok}" was wrongly flagged`).not.toHaveBeenCalled()
    }
    warn.mockRestore()
  })
})

describe('registered is not successful', () => {
  it('gives "Signed up" a different tone from "Qualified"', () => {
    expect(REFERRAL_STATE.registered.label).toBe('Signed up')
    expect(REFERRAL_STATE.registered.tone).not.toBe('good')
    expect(REFERRAL_STATE.qualified.tone).toBe('good')
  })

  it('labels every state', () => {
    for (const s of Object.keys(REFERRAL_STATE) as ReferralStatus[]) {
      expect(REFERRAL_STATE[s].label, s).toBeTruthy()
    }
  })

  it('does not call an invalidated referral a failure of the person', () => {
    expect(REFERRAL_STATE.invalidated.label).toBe('Not counted')
    expect(REFERRAL_STATE.invalidated.label.toLowerCase()).not.toContain('fraud')
  })
})

describe('the programme condition is explained, not hidden', () => {
  it('turns each rule into something a member can act on', () => {
    expect(qualificationLabel('first_listing')).toMatch(/first listing/)
    expect(qualificationLabel('profile_complete')).toMatch(/completes their profile/)
    expect(qualificationLabel('first_transaction')).toMatch(/first purchase or sale/)
    expect(qualificationLabel('identity_verified')).toMatch(/identity verified/)
  })

  it('degrades gracefully for a rule it has not seen', () => {
    const l = qualificationLabel('brand_new_rule')
    expect(l).toMatch(/current programme condition/)
    expect(l).not.toMatch(/_/)
  })

  it('names every benefit kind', () => {
    for (const k of Object.keys(BENEFIT_KIND_LABEL) as (keyof typeof BENEFIT_KIND_LABEL)[]) {
      expect(BENEFIT_KIND_LABEL[k], k).toBeTruthy()
      // None of them is money.
      expect(BENEFIT_KIND_LABEL[k].toLowerCase()).not.toMatch(/cash|payout|naira/)
    }
  })
})

describe('the referral link', () => {
  it('builds from the origin and the server-supplied path', () => {
    expect(referralUrl('https://loamy.app', '/u/musa')).toBe('https://loamy.app/u/musa')
  })

  it('does not double the slash', () => {
    expect(referralUrl('https://loamy.app/', '/u/musa')).toBe('https://loamy.app/u/musa')
  })

  it('is empty when there is no path, rather than a broken link', () => {
    expect(referralUrl('https://loamy.app', undefined)).toBe('')
  })
})

describe('refusals are explained', () => {
  it('has copy for every reason the server returns', () => {
    for (const r of ['self_referral', 'unknown_code', 'already_attributed',
                     'circular_referral', 'referrer_inactive', 'referrer_not_eligible',
                     'attribution_window_closed', 'no_active_programme']) {
      expect(attributionRefusal(r).length, r).toBeGreaterThan(15)
      expect(attributionRefusal(r)).not.toMatch(/_/)
    }
  })

  it('is honest that attribution cannot be changed later', () => {
    expect(attributionRefusal('already_attributed')).toMatch(/cannot be changed/i)
  })

  it('falls back rather than showing a raw code', () => {
    expect(attributionRefusal('something_new')).toBe('That referral could not be recorded.')
  })
})

describe('what a new member is told about their referral link', () => {
  it('has copy for every refusal the database can return', () => {
    // These strings are the contract with loamy_attribute_referral. A reason
    // with no copy falls through to a generic line, which is how a mistyped
    // code becomes an unexplained silence.
    for (const reason of ATTRIBUTION_REASONS) {
      expect(attributionRefusal(reason), reason).not.toBe('That referral could not be recorded.')
    }
  })

  it('falls back rather than showing a raw reason code', () => {
    expect(attributionRefusal('something_new')).toBe('That referral could not be recorded.')
    expect(attributionRefusal(undefined)).toBe('That referral could not be recorded.')
  })

  it('only surfaces refusals the member can act on', () => {
    for (const r of ACTIONABLE_REFUSALS) {
      expect(ATTRIBUTION_REASONS, `${r} must be a real reason`).toContain(r)
    }
    // Programme-level refusals are Loamy's problem, not the new member's.
    expect(ACTIONABLE_REFUSALS).not.toContain('no_active_programme')
    expect(ACTIONABLE_REFUSALS).not.toContain('referrer_not_eligible')
  })

  it('never promises money in a refusal', () => {
    // Ordinary referrals earn platform benefits, never cash.
    for (const reason of ATTRIBUTION_REASONS) {
      expect(() => assertNoMoney(attributionRefusal(reason))).not.toThrow()
    }
  })
})
