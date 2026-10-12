import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CONSENT_VERSION, NEEDS_LEGAL_REVIEW, NOTICE_COPY, NOTICE_VERSION, OPERATOR,
  POLICY_EFFECTIVE_DATE, POLICY_VERSION, PRIVACY_CONTACT, PRIVACY_POLICY,
} from '../../src/content/legal/privacy-policy'

const ALL_TEXT = JSON.stringify(PRIVACY_POLICY).toLowerCase()
const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

describe('the policy is one document with one version', () => {
  it('has a parseable effective date that is not in the future', () => {
    const d = Date.parse(`${POLICY_EFFECTIVE_DATE}T00:00:00Z`)
    expect(Number.isNaN(d)).toBe(false)
    expect(d).toBeLessThanOrEqual(Date.now() + 86_400_000)
  })

  it('carries a version for the policy, the categories and the notice', () => {
    for (const v of [POLICY_VERSION, CONSENT_VERSION, NOTICE_VERSION]) {
      expect(typeof v).toBe('string')
      expect(v.length).toBeGreaterThan(0)
    }
  })

  it('defines the date in exactly one place', () => {
    // A "last updated" that has to be changed in two files is a "last
    // updated" that will eventually be wrong in one of them.
    const hits = ['src/pages/public/Privacy.tsx', 'src/components/PrivacyNotice.tsx',
      'src/components/PrivacyPreferences.tsx', 'src/pages/shared/PrivacySettings.tsx']
      .filter((f) => src(f).includes(POLICY_EFFECTIVE_DATE))
    expect(hits, 'the date must be imported, never re-typed').toEqual([])
  })

  it('gives every section a unique anchor', () => {
    // Anchors are a public API: an inbound link to #financing must not break
    // because two sections quietly shared an id.
    const ids = PRIVACY_POLICY.flatMap((p) => p.sections.map((s) => s.id))
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/)
  })

  it('has real content in every section', () => {
    for (const part of PRIVACY_POLICY) {
      expect(part.sections.length, `${part.id} has no sections`).toBeGreaterThan(0)
      for (const s of part.sections) {
        const hasContent = (s.body?.length ?? 0) > 0 || (s.bullets?.length ?? 0) > 0 || Boolean(s.callout)
        expect(hasContent, `${s.id} is empty`).toBe(true)
        expect(s.heading.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('policy content can never become an injection', () => {
  it('contains no HTML or script markup', () => {
    // The page renders every string as text. This test is what keeps that
    // true after a future edit by someone who assumes markdown or HTML works.
    const strings: string[] = []
    for (const part of PRIVACY_POLICY) {
      strings.push(part.title)
      for (const s of part.sections) {
        strings.push(s.heading, ...(s.body ?? []), s.callout ?? '')
        for (const b of s.bullets ?? []) strings.push(b.term ?? '', b.text)
      }
    }
    for (const str of strings) {
      expect(str, 'no angle-bracket markup in policy content').not.toMatch(/<[a-z/!]/i)
      expect(str.toLowerCase()).not.toContain('javascript:')
      expect(str.toLowerCase()).not.toContain('onerror=')
    }
  })

  it('is never rendered as raw HTML', () => {
    for (const f of ['src/pages/public/Privacy.tsx', 'src/components/PrivacyNotice.tsx',
      'src/components/PrivacyPreferences.tsx', 'src/pages/shared/PrivacySettings.tsx']) {
      // The JSX form specifically -- a comment saying it is not used is not
      // a use of it.
      expect(src(f), `${f} must not set inner HTML`).not.toMatch(/dangerouslySetInnerHTML\s*=\s*\{/)
    }
  })
})

describe('contact details are the ones the app already uses', () => {
  it('does not invent an email address', () => {
    // support@loamy.ng already appears on the public marketplace and the
    // dashboard. Inventing dpo@loamy.ng would route privacy requests into a
    // mailbox nobody reads.
    expect(PRIVACY_CONTACT).toBe('support@loamy.ng')
    expect(src('src/pages/public/PublicMarketplace.tsx')).toContain(OPERATOR.supportEmail)
  })

  it('does not invent a phone number', () => {
    const digits = OPERATOR.whatsappUrl.replace(/\D/g, '')
    expect(src('src/pages/public/PublicMarketplace.tsx')).toContain(digits)
  })

  it('names the operator the footer already names', () => {
    expect(src('src/pages/public/PublicShell.tsx')).toContain(OPERATOR.company)
  })
})

describe('the policy describes what Loamy actually does', () => {
  const mustMention: [string, string][] = [
    ['bvn', 'the non-storage of BVN'],
    ['nin', 'the non-storage of NIN'],
    ['paystack', 'the payment provider'],
    ['open-meteo', 'the weather provider that receives farm coordinates'],
    ['openstreetmap', 'the map tile provider that sees an IP address'],
    ['supabase', 'the database and storage provider'],
    ['copilot', 'the assistant'],
    ['escrow', 'how marketplace payments are held'],
    ['traceab', 'batch traceability'],
    ['warehouse', 'storage coordination'],
    ['logistics', 'transport coordination'],
    ['gps', 'location captured during verification'],
    ['nigeria data protection', 'the governing law'],
    ['retention', 'how long information is kept'],
    ['referral code', 'the code held in browser storage from a referral link'],
  ]
  it.each(mustMention)('covers %s (%s)', (needle) => {
    expect(ALL_TEXT).toContain(needle)
  })

  it('states plainly that Loamy is not the lender', () => {
    expect(ALL_TEXT).toMatch(/not a lender|is the lender and the decision-maker/)
  })

  it('states that Loamy does not hold members money', () => {
    expect(ALL_TEXT).toMatch(/do not hold your money|never holds your money/)
  })

  it('states that BVN and NIN are not stored', () => {
    expect(ALL_TEXT).toMatch(/does not store your bvn|stores no bvn/)
  })
})

describe('the policy does not claim processing Loamy has no code for', () => {
  // Each of these is checked as a POSITIVE claim. The policy is allowed to
  // say it does NOT do a thing; it is not allowed to say it does.
  const forbiddenClaims: [string, RegExp][] = [
    ['biometrics', /\bwe (collect|use|process|store)[^.]*\b(biometric|fingerprint scan|facial)/],
    ['credit scoring', /\bwe (calculate|compute|assign|produce)[^.]*credit (score|rating)/],
    ['selling data', /\bwe (sell|share|trade)[^.]*(for advertising|to advertisers|to data brokers)/],
    ['ad profiles', /\bwe (build|create|maintain)[^.]*advertising profile/],
    ['continuous tracking', /\bwe (continuously|constantly) track/],
    ['model training', /\bwe (use|train)[^.]*to train[^.]*model/],
  ]
  it.each(forbiddenClaims)('makes no %s claim', (_label, pattern) => {
    expect(ALL_TEXT).not.toMatch(pattern)
  })

  it('explicitly denies device fingerprinting', () => {
    expect(ALL_TEXT).toContain('we do not fingerprint your device')
  })

  it('explicitly denies selling personal information', () => {
    expect(ALL_TEXT).toContain('does not sell personal information')
  })

  it('explicitly denies using Copilot conversations for model training', () => {
    expect(ALL_TEXT).toContain('not used to train any ai model')
  })
})

describe('the notice and the policy cannot drift apart', () => {
  it('keeps the notice copy in the same module as the policy', () => {
    expect(NOTICE_COPY.title.length).toBeGreaterThan(0)
    expect(NOTICE_COPY.body.length).toBeGreaterThan(0)
  })

  it('offers a decline label as plain as the accept label', () => {
    expect(NOTICE_COPY.acceptAll).toMatch(/accept/i)
    expect(NOTICE_COPY.essentialOnly).toMatch(/essential/i)
    // Not "reject all cookies and lose functionality" or similar steering.
    expect(NOTICE_COPY.essentialOnly.length).toBeLessThan(30)
  })

  it('describes the offline evidence queue, which is genuinely essential', () => {
    expect(NOTICE_COPY.body.toLowerCase()).toContain('offline')
  })
})

describe('what still needs a lawyer', () => {
  it('lists the open questions rather than implying none exist', () => {
    // A policy that claims to be finished when its retention periods are
    // still qualitative is the kind of thing that gets found later.
    expect(NEEDS_LEGAL_REVIEW.length).toBeGreaterThan(0)
    for (const item of NEEDS_LEGAL_REVIEW) expect(item.length).toBeGreaterThan(20)
  })
})
