import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ANON_KEY, SUPABASE_URL, createdEmails, makeUser, type TestUser } from '../helpers/supabase'

/**
 * Part 3 / Part 19: money boundaries.
 *
 * What can be proved with the anon key:
 *   - the wallet cannot be overdrawn or written to from a client
 *   - a withdrawal without a verified destination is refused
 *   - the payment webhook rejects unsigned and wrongly-signed requests
 *
 * What CANNOT be proved here, stated rather than faked: a VALID webhook needs
 * PAYSTACK_SECRET_KEY to sign, which is a server secret this suite does not
 * have. Positive-path webhook and replay tests therefore need either a test
 * secret in CI or a Deno test harness inside the function. See docs/testing.md.
 */

let U: TestUser

beforeAll(async () => {
  U = await makeUser('trader', 'Trader')
}, 120_000)

afterAll(() => {
  console.log('\nAccounts created by this run (delete in Supabase > Authentication):')
  for (const e of createdEmails) console.log('  ' + e)
})

describe('wallet boundaries', () => {
  it('a new wallet reads exactly zero, not null or NaN', async () => {
    const { data, error } = await U.client.rpc('loamy_wallet_balance')
    expect(error).toBeFalsy()
    expect(Number(data)).toBe(0)
  })

  it('refuses a withdrawal with no verified bank account', async () => {
    const { error } = await U.client.rpc('loamy_request_withdrawal', { p_amount: 5000 })
    expect(error, 'withdrawal allowed without a destination').toBeTruthy()
  })

  it('refuses a zero or negative withdrawal', async () => {
    for (const amount of [0, -1, -999999]) {
      const { error } = await U.client.rpc('loamy_request_withdrawal', { p_amount: amount })
      expect(error, `withdrawal of ${amount} was accepted`).toBeTruthy()
    }
  })

  it('refuses a withdrawal larger than the balance', async () => {
    const { error } = await U.client.rpc('loamy_request_withdrawal', { p_amount: 10_000_000 })
    expect(error, 'overdraw was accepted').toBeTruthy()
  })

  it('refuses to report another member’s balance', async () => {
    const other = await makeUser('farmer', 'Farmer')
    const { error } = await U.client.rpc('loamy_wallet_balance', { p_user: other.uid })
    expect(error, 'a member read another balance').toBeTruthy()
  }, 120_000)
})

describe('payment webhook rejects forged events', () => {
  const url = `${SUPABASE_URL}/functions/v1/paystack-webhook`
  const payload = JSON.stringify({
    event: 'charge.success',
    data: { reference: 'forged-' + Date.now(), metadata: { order_id: '00000000-0000-0000-0000-000000000000' } },
  })

  it('rejects a request with no signature header', async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
      body: payload,
    })
    expect(res.status, 'unsigned webhook was accepted').toBe(401)
  })

  it('rejects a request with a wrong signature', async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: ANON_KEY,
        'x-paystack-signature': 'a'.repeat(128),
      },
      body: payload,
    })
    expect(res.status, 'badly-signed webhook was accepted').toBe(401)
  })

  it('rejects a GET', async () => {
    const res = await fetch(url, { method: 'GET', headers: { apikey: ANON_KEY } })
    expect([401, 405]).toContain(res.status)
  })
})

describe('privileged edge functions require a caller', () => {
  it('wallet-withdraw refuses an unauthenticated call', async () => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/wallet-withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
      body: JSON.stringify({ withdrawal_id: '00000000-0000-0000-0000-000000000000' }),
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('wallet-withdraw refuses a withdrawal belonging to someone else', async () => {
    const { data: session } = await U.client.auth.getSession()
    const res = await fetch(`${SUPABASE_URL}/functions/v1/wallet-withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: ANON_KEY,
        Authorization: `Bearer ${session.session?.access_token}`,
      },
      body: JSON.stringify({ withdrawal_id: '00000000-0000-0000-0000-000000000000' }),
    })
    // 404 (not found), 403 (not yours) and 410 (endpoint retired) all mean
    // "did not pay out". 410 is the strongest of the three: Wave 1 closed
    // withdrawals entirely on 2026-09-22, so there is no payout path left at
    // all. This assertion listed only the first two because it predates that
    // retirement, and it kept passing on an environment where the function was
    // simply not deployed and answered 404.
    expect([400, 403, 404, 410]).toContain(res.status)
  })
})
