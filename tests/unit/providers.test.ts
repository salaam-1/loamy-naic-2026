import { afterEach, describe, expect, it } from 'vitest'
import {
  anySandboxActive, providerStatus, idempotencyKey, providerError,
  financingProvider, noFinancingProvider, sandboxFinancingProvider, setFinancingProvider,
  weatherProvider, noWeatherProvider, openMeteoProvider, setWeatherProvider,
  geoProvider, haversineMetres, plausiblyNigeria,
  messagingProvider, sandboxMessagingProvider, noMessagingProvider, setMessagingProvider,
} from '../../src/lib/providers'

/**
 * The provider boundary.
 *
 * Most of these are negative assertions, because the risk a provider seam
 * carries is not that it fails — it is that it QUIETLY SUCCEEDS with
 * something invented. A sandbox that approves financing, or a reference that
 * cannot be told apart from a bank's, is worse than no adapter at all.
 */

afterEach(() => {
  setFinancingProvider(noFinancingProvider)
  setWeatherProvider(openMeteoProvider)
  setMessagingProvider(noMessagingProvider)
})

describe('nothing live is registered by default', () => {
  it('has no financing provider', () => {
    expect(financingProvider().info.mode).toBe('disabled')
  })

  it('has no messaging provider', () => {
    expect(messagingProvider().info.mode).toBe('disabled')
  })

  it('names no bank anywhere in the default state', () => {
    const json = JSON.stringify(providerStatus()).toLowerCase()
    // Sterling is a later adapter, not an assumption baked into the domain.
    expect(json).not.toMatch(/sterling|paystack|gtb|access|zenith/)
  })

  it('reports weather and maps as live, because they genuinely are', () => {
    expect(providerStatus().weather.mode).toBe('live')
    expect(providerStatus().geo.mode).toBe('live')
  })

  it('reports no sandbox active by default', () => {
    expect(anySandboxActive()).toBe(false)
  })

  it('notices when a sandbox adapter is registered', () => {
    setFinancingProvider(sandboxFinancingProvider)
    expect(anySandboxActive()).toBe(true)
    expect(providerStatus().financing.mode).toBe('sandbox')
  })
})

describe('an unconfigured provider refuses rather than pretending', () => {
  it('refuses every financing operation', async () => {
    const p = noFinancingProvider
    const calls = [
      p.verifyAccount({ idempotencyKey: 'k', bankId: 'b', accountLast4: '1234' }),
      p.submitApplication({
        idempotencyKey: 'k', bankId: 'b', applicationRef: 'FIN-1',
        productType: 'commodity_purchase', structure: 'murabaha',
        amountRequested: 1, currency: 'NGN', purpose: 'x',
        applicant: { displayName: 'A', digitalId: 'D', phone: '0', state: null, verifiedBadge: false, memberSince: '' },
      }),
      p.getApplicationStatus('FIN-1'),
      p.instructSettlement({
        idempotencyKey: 'k', bankId: 'b', applicationRef: 'FIN-1', transactionRef: 'TXN-1',
        amount: 1, currency: 'NGN', supplierReference: 's', narration: 'n',
      }),
    ]
    for (const c of calls) {
      const r = await c
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.kind).toBe('not_configured')
    }
  })

  it('refuses a weather call with no provider', async () => {
    setWeatherProvider(noWeatherProvider)
    const r = await weatherProvider().forecast({ lat: 9, lng: 8 })
    expect(r.ok).toBe(false)
  })

  it('refuses to send a message with no provider', async () => {
    const r = await messagingProvider().send({
      idempotencyKey: 'k', channel: 'sms', to: '+2348000000000',
      purpose: 'transactional', templateKey: 'x',
    })
    expect(r.ok).toBe(false)
  })
})

describe('the sandbox simulates transport, never judgement', () => {
  it('NEVER returns a financing decision', async () => {
    // The single most important assertion in this file. A simulated approval
    // is a fabricated credit decision.
    const r = await sandboxFinancingProvider.getApplicationStatus('FIN-000123')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.decision).toBeUndefined()
      expect(r.value.status).not.toBe('decided')
    }
  })

  it('accepts a submission without deciding it', async () => {
    const r = await sandboxFinancingProvider.submitApplication({
      idempotencyKey: 'k', bankId: 'b', applicationRef: 'FIN-000123',
      productType: 'commodity_purchase', structure: 'murabaha',
      amountRequested: 900_000, currency: 'NGN', purpose: 'Maize',
      applicant: { displayName: 'A', digitalId: 'D', phone: '0', state: null, verifiedBadge: false, memberSince: '' },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.accepted).toBe(true)
      expect(r.value.status).toBe('in_review')
    }
  })

  it('marks every reference it issues as SANDBOX', async () => {
    const sub = await sandboxFinancingProvider.submitApplication({
      idempotencyKey: 'k', bankId: 'b', applicationRef: 'FIN-000123',
      productType: 'p', structure: 's', amountRequested: 1, currency: 'NGN', purpose: 'x',
      applicant: { displayName: 'A', digitalId: 'D', phone: '0', state: null, verifiedBadge: false, memberSince: '' },
    })
    const stl = await sandboxFinancingProvider.instructSettlement({
      idempotencyKey: 'k2', bankId: 'b', applicationRef: 'FIN-1', transactionRef: 'TXN-1',
      amount: 1, currency: 'NGN', supplierReference: 's', narration: 'n',
    })
    if (sub.ok) expect(sub.value.bankReference).toMatch(/^SANDBOX-/)
    if (stl.ok) expect(stl.value.externalReference).toMatch(/^SANDBOX-/)
  })

  it('says plainly that a settlement instruction moved no money', async () => {
    const r = await sandboxFinancingProvider.instructSettlement({
      idempotencyKey: 'k', bankId: 'b', applicationRef: 'FIN-1', transactionRef: 'TXN-1',
      amount: 500_000, currency: 'NGN', supplierReference: 's', narration: 'n',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.reason).toMatch(/no funds moved/i)
      // An acknowledgement is not a confirmation, and nothing here says it is.
      expect(r.value).not.toHaveProperty('settled')
    }
  })

  it('never reports a simulated event as verified', async () => {
    const r = await sandboxFinancingProvider.parseEvent({ any: 'thing' })
    expect(r.ok).toBe(true)
    // An unverified event must not be allowed to change authoritative state.
    if (r.ok) expect(r.value.verified).toBe(false)
  })

  it('carries sandbox mode on every successful result', async () => {
    const r = await sandboxFinancingProvider.verifyAccount({
      idempotencyKey: 'k', bankId: 'b', accountLast4: '1234',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.mode).toBe('sandbox')
  })

  it('refuses account opening, which Loamy never does', async () => {
    const r = await sandboxFinancingProvider.openAccount({ idempotencyKey: 'k', bankId: 'b' })
    expect(r.ok).toBe(false)
  })

  it('delivers no message and says so', async () => {
    setMessagingProvider(sandboxMessagingProvider)
    const r = await messagingProvider().send({
      idempotencyKey: 'k', channel: 'sms', to: '+2348000000000',
      purpose: 'transactional', templateKey: 'verification_update',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.externalId).toMatch(/^SANDBOX-/)
      expect(r.value.reason).toMatch(/nothing was sent/i)
      // 'queued' is not 'delivered'. The distinction is the whole point.
      expect(r.value.status).toBe('queued')
    }
  })
})

describe('no BVN or NIN can pass through the financing seam', () => {
  it('has no field for one on account verification', () => {
    const req = {
      idempotencyKey: 'k', bankId: 'b', accountLast4: '1234', accountNameHint: 'A B',
    }
    const keys = Object.keys(req).join(' ').toLowerCase()
    expect(keys).not.toMatch(/bvn|nin|national/)
  })

  it('takes only the last four digits, never a full account number', async () => {
    const r = await sandboxFinancingProvider.verifyAccount({
      idempotencyKey: 'k', bankId: 'b', accountLast4: '0123456789',
    })
    expect(r.ok).toBe(true)
    // Anything that is not exactly four digits is not a last-4.
    if (r.ok) expect(r.value.verified).toBe(false)
  })
})

describe('idempotency keys are derived, not random', () => {
  it('is stable for the same operation on the same reference', () => {
    expect(idempotencyKey('FIN-000123', 'submit'))
      .toBe(idempotencyKey('FIN-000123', 'submit'))
  })

  it('differs across operations and references', () => {
    expect(idempotencyKey('FIN-1', 'submit')).not.toBe(idempotencyKey('FIN-1', 'settle'))
    expect(idempotencyKey('FIN-1', 'submit')).not.toBe(idempotencyKey('FIN-2', 'submit'))
  })

  it('contains the business reference, so a support thread can trace it', () => {
    expect(idempotencyKey('TXN-000207', 'settle')).toContain('TXN-000207')
  })

  it('produces the same key on a retry of the same attempt', () => {
    // A random key per attempt would defeat idempotency entirely, which is
    // the usual way this is got wrong.
    const first = idempotencyKey('FIN-1', 'submit', 'attempt-1')
    const retry = idempotencyKey('FIN-1', 'submit', 'attempt-1')
    expect(retry).toBe(first)
  })
})

describe('errors are classified for Loamy, not echoed from a vendor', () => {
  it('marks transient kinds retryable and the rest not', () => {
    for (const k of ['rate_limited', 'timeout', 'unavailable'] as const) {
      expect(providerError(k, 'x').retryable, k).toBe(true)
    }
    for (const k of ['rejected', 'invalid_request', 'unauthorized', 'not_found'] as const) {
      expect(providerError(k, 'x').retryable, k).toBe(false)
    }
  })

  it('never makes a money instruction retryable by default', () => {
    // Retrying a settlement blindly is how a seller gets paid twice.
    expect(providerError('unknown', 'x').retryable).toBe(false)
  })

  it('keeps the vendor code separate from the member-facing message', () => {
    const e = providerError('unavailable', 'The service is unavailable.', { providerCode: 'ERR_9001' })
    expect(e.message).not.toContain('ERR_9001')
    expect(e.providerCode).toBe('ERR_9001')
  })
})

describe('geo maths stays local, because a fraud check must not need a vendor', () => {
  it('measures a known distance', () => {
    // Abuja to Kaduna is roughly 160 km.
    const d = haversineMetres({ lat: 9.0765, lng: 7.3986 }, { lat: 10.5105, lng: 7.4165 })
    expect(d).toBeGreaterThan(150_000)
    expect(d).toBeLessThan(175_000)
  })

  it('is zero for the same point', () => {
    expect(haversineMetres({ lat: 9, lng: 7 }, { lat: 9, lng: 7 })).toBe(0)
  })

  it('accepts a real Nigerian coordinate', () => {
    expect(plausiblyNigeria({ lat: 7.7322, lng: 8.5391 })).toBe(true)
  })

  it('rejects 0,0 and a swapped pair', () => {
    expect(plausiblyNigeria({ lat: 0, lng: 0 })).toBe(false)
    expect(plausiblyNigeria({ lat: 8.5391, lng: 7.7322 })).toBe(true)  // still in range
    expect(plausiblyNigeria({ lat: 51.5, lng: -0.12 })).toBe(false)     // London
  })

  it('rejects NaN rather than treating it as valid', () => {
    expect(plausiblyNigeria({ lat: NaN, lng: 8 })).toBe(false)
  })

  it('always has tiles available, even with no geocoder', () => {
    expect(geoProvider().tiles().template).toContain('{z}')
    expect(geoProvider().tiles().attribution).toBeTruthy()
  })
})

describe('the custodial wallet is gone, not merely unused', () => {
  it('has no module offering a balance or a withdrawal', async () => {
    // src/lib/wallet.ts and src/pages/shared/Wallet.tsx were deleted in the
    // platform completion sprint. They were already unreferenced, but dead
    // code that still compiles is code someone can import: they exported
    // fetchWalletBalance() and requestWithdrawal(), which imply Loamy holds
    // member funds. It does not, and there is now nothing to import.
    await expect(import('../../src/lib/wallet')).rejects.toThrow()
  })
})
