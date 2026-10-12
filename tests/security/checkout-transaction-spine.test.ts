import { beforeAll, describe, expect, it } from 'vitest'
import { adminClient, makeUser, type TestUser } from '../helpers/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * PHASE 4 SLICE 1 — checkout must produce the AUTHORITATIVE transaction.
 *
 * Against the live database, because the properties that matter are
 * server-side: identity derived from auth.uid(), RLS visibility, idempotency
 * under a real unique index, and the refusals.
 *
 * The central assertion is the one the audit was written about: an ordinary
 * cart checkout now lands in `transactions` with a batch reference and a
 * lifecycle event, and lands in `orders` not at all.
 */

let SELLER: TestUser
let BUYER: TestUser
let OUTSIDER: TestUser
let admin: SupabaseClient | null

let listingId = ''
let batchId: string | null = null
const LISTED_QTY = 100
const BUY_QTY = 20

beforeAll(async () => {
  SELLER = await makeUser('farmer', 'Farmer')
  BUYER = await makeUser('buyer', 'Buyer')
  OUTSIDER = await makeUser('trader', 'Trader')
  admin = await adminClient()

  // A batch-backed listing, so the batch reference can be asserted end to end.
  const { data: farm } = await SELLER.client.from('farms').insert({
    owner_id: SELLER.uid, farm_name: 'Spine Farm', state: 'Kaduna', lga: 'Zaria',
    size_hectares: 3, primary_crops: ['Maize'], ownership_type: 'owned',
  }).select('id').maybeSingle()

  const { data: cycle } = await SELLER.client.from('crop_records').insert({
    farm_id: (farm as { id: string }).id, crop: 'Maize', season_year: 2026,
  }).select('id').maybeSingle()

  const { data: harvest } = await SELLER.client.from('harvests').insert({
    farm_id: (farm as { id: string }).id,
    production_cycle_id: (cycle as { id: string }).id,
    commodity: 'Maize', harvest_date: '2026-09-10', quantity: 500, unit: 'kg',
  }).select('id').maybeSingle()

  const { data: bId } = await SELLER.client.rpc('loamy_create_batch_from_harvest', {
    p_harvest_id: (harvest as { id: string }).id, p_quantity: 300,
  })
  batchId = bId as string

  const { data: lId, error } = await SELLER.client.rpc('loamy_list_batch', {
    p_batch_id: batchId, p_quantity: LISTED_QTY, p_price_per_unit: 500,
    p_state: 'Kaduna', p_lga: 'Zaria',
  })
  expect(error, `listing failed: ${error?.message}`).toBeFalsy()
  listingId = lId as string
}, 240_000)

async function cartCheckout(user: TestUser, qty: number, opts: {
  state?: string | null; lga?: string | null; note?: string | null
} = {}) {
  await user.client.rpc('loamy_add_to_cart', { p_listing_id: listingId, p_quantity: qty })
    .then(() => undefined, () => undefined)
  // Fall back to a direct insert where the cart RPC is not the name used.
  const { data: cart } = await user.client.from('cart_items').select('id').eq('user_id', user.uid)
  if ((cart ?? []).length === 0) {
    await user.client.from('cart_items').insert({
      user_id: user.uid, listing_id: listingId, quantity: qty,
    })
  }
  return user.client.rpc('loamy_checkout_cart', {
    p_delivery_state: opts.state ?? null,
    p_delivery_lga: opts.lga ?? null,
    p_note: opts.note ?? null,
  })
}

describe('an ordinary checkout lands in the authoritative model', () => {
  let txnId = ''

  it('creates a transaction, not an order', async () => {
    const { data, error } = await cartCheckout(BUYER, BUY_QTY, {
      state: 'Lagos', lga: 'Ikeja', note: 'Deliver before Friday.',
    })
    expect(error, error?.message).toBeFalsy()
    const ids = data as string[]
    expect(ids).toHaveLength(1)
    txnId = ids[0]

    // The whole point of the slice.
    const { data: orders } = await BUYER.client.from('orders').select('id').eq('buyer_id', BUYER.uid)
    expect(orders ?? [], 'checkout must not create an order').toHaveLength(0)
  })

  it('carries every field the spine needs', async () => {
    const { data } = await BUYER.client
      .from('transactions')
      .select('id, ref, buyer_id, seller_id, listing_id, batch_id, commodity, quantity, unit, price_per_unit, subtotal, status, delivery_state, delivery_lga, buyer_note')
      .eq('id', txnId).maybeSingle()
    const t = data as Record<string, unknown>

    expect(t.buyer_id).toBe(BUYER.uid)      // server-derived from auth.uid()
    expect(t.seller_id).toBe(SELLER.uid)    // server-derived from the listing
    expect(t.listing_id).toBe(listingId)
    expect(t.batch_id).toBe(batchId)        // traceability preserved
    expect(t.commodity).toBe('Maize')
    expect(Number(t.quantity)).toBe(BUY_QTY)
    expect(Number(t.subtotal)).toBe(BUY_QTY * 500)
    expect(t.status).toBe('proposed')
    expect(String(t.ref ?? '')).toMatch(/^TXN-/)
  })

  it('persists the delivery state and buyer note that were typed', async () => {
    // These were silently discarded before this slice: the form collected
    // them and the caller passed only listing and quantity.
    const { data } = await BUYER.client
      .from('transactions').select('delivery_state, delivery_lga, buyer_note')
      .eq('id', txnId).maybeSingle()
    const t = data as Record<string, string | null>
    expect(t.delivery_state).toBe('Lagos')
    expect(t.delivery_lga).toBe('Ikeja')
    expect(t.buyer_note).toBe('Deliver before Friday.')
  })

  it('emits exactly one lifecycle event, server-side', async () => {
    const { data } = await BUYER.client
      .from('transaction_events').select('event_type, machine, new_value')
      .eq('transaction_id', txnId)
    const events = (data ?? []) as { event_type: string; new_value: string }[]
    expect(events).toHaveLength(1)
    expect(events[0].event_type).toBe('proposed')
  })

  it('empties the cart lines it bought', async () => {
    const { data } = await BUYER.client.from('cart_items').select('id').eq('user_id', BUYER.uid)
    expect(data ?? []).toHaveLength(0)
  })

  it('is a partial sale: the listing keeps the rest', async () => {
    const { data } = await BUYER.client
      .from('loamy_public_listings').select('quantity').eq('id', listingId).maybeSingle()
    // 20 of 100 bought; the listing is untouched until the deal progresses,
    // which is the existing authoritative behaviour and not a reservation.
    expect(Number((data as { quantity: number } | null)?.quantity ?? 0)).toBe(LISTED_QTY)
  })

  it('can be referenced by a financing application', async () => {
    const { data: partners } = await BUYER.client.rpc('loamy_financing_partners')
    const banks = (partners as { id: string }[] | null) ?? []
    if (banks.length === 0) return // no active partner configured; nothing to assert
    const { error } = await BUYER.client.rpc('loamy_apply_financing_for_transaction', {
      p_transaction_id: txnId, p_bank_id: banks[0].id,
    })
    // Either it applies, or it refuses for a stated business reason. What must
    // NOT happen is a second transaction being created for the same purchase.
    const { data: mine } = await BUYER.client
      .from('transactions').select('id').eq('buyer_id', BUYER.uid).eq('listing_id', listingId)
    expect((mine ?? []).length, `financing created a duplicate transaction: ${error?.message ?? ''}`).toBe(1)
  })
})

describe('idempotency is server-side, not a disabled button', () => {
  it('returns the same transaction for a repeated proposal', async () => {
    const a = await BUYER.client.rpc('loamy_propose_transaction', {
      p_listing_id: listingId, p_quantity: 7, p_note: null,
      p_delivery_state: null, p_delivery_lga: null,
    })
    const b = await BUYER.client.rpc('loamy_propose_transaction', {
      p_listing_id: listingId, p_quantity: 7, p_note: null,
      p_delivery_state: null, p_delivery_lga: null,
    })
    expect(a.error, a.error?.message).toBeFalsy()
    expect(b.error, b.error?.message).toBeFalsy()
    expect(b.data).toBe(a.data)
  })

  it('survives concurrent submission', async () => {
    // Two in flight at once: the unique partial index is what makes this safe,
    // because both can pass the existence check before either inserts.
    const [x, y] = await Promise.all([
      BUYER.client.rpc('loamy_propose_transaction', {
        p_listing_id: listingId, p_quantity: 9, p_note: null,
        p_delivery_state: null, p_delivery_lga: null,
      }),
      BUYER.client.rpc('loamy_propose_transaction', {
        p_listing_id: listingId, p_quantity: 9, p_note: null,
        p_delivery_state: null, p_delivery_lga: null,
      }),
    ])
    const { data } = await BUYER.client
      .from('transactions').select('id')
      .eq('buyer_id', BUYER.uid).eq('listing_id', listingId).eq('quantity', 9)
    expect(data ?? [], `double submit produced ${(data ?? []).length} rows`).toHaveLength(1)
    expect(x.error && y.error).toBeFalsy()
  })

  it('still allows a genuinely different quantity', async () => {
    const { data, error } = await BUYER.client.rpc('loamy_propose_transaction', {
      p_listing_id: listingId, p_quantity: 11, p_note: null,
      p_delivery_state: null, p_delivery_lga: null,
    })
    expect(error, error?.message).toBeFalsy()
    expect(data).toBeTruthy()
  })
})

describe('the refusals', () => {
  it('refuses a quantity beyond what is listed', async () => {
    const { error } = await BUYER.client.rpc('loamy_propose_transaction', {
      p_listing_id: listingId, p_quantity: LISTED_QTY + 1, p_note: null,
      p_delivery_state: null, p_delivery_lga: null,
    })
    expect(error).toBeTruthy()
  })

  it('refuses zero and negative quantities', async () => {
    for (const q of [0, -5]) {
      const { error } = await BUYER.client.rpc('loamy_propose_transaction', {
        p_listing_id: listingId, p_quantity: q, p_note: null,
        p_delivery_state: null, p_delivery_lga: null,
      })
      expect(error, `quantity ${q} was accepted`).toBeTruthy()
    }
  })

  it('refuses a seller buying their own listing', async () => {
    const { error } = await SELLER.client.rpc('loamy_propose_transaction', {
      p_listing_id: listingId, p_quantity: 1, p_note: null,
      p_delivery_state: null, p_delivery_lga: null,
    })
    expect(error).toBeTruthy()
  })

  it('refuses an empty cart rather than reporting success', async () => {
    const { error } = await OUTSIDER.client.rpc('loamy_checkout_cart', {
      p_delivery_state: null, p_delivery_lga: null, p_note: null,
    })
    expect(error).toBeTruthy()
    expect(error?.message ?? '').toMatch(/nothing to check out/i)
  })
})

describe('a client cannot forge a purchase', () => {
  it('cannot insert a transaction directly', async () => {
    const { error } = await BUYER.client.from('transactions').insert({
      buyer_id: BUYER.uid, seller_id: SELLER.uid, listing_id: listingId,
      commodity: 'Maize', quantity: 1, unit: 'kg', price_per_unit: 1, subtotal: 1,
      status: 'proposed',
    })
    expect(error, 'a client wrote a transaction directly').toBeTruthy()
  })

  it('cannot alter economics or status after creation', async () => {
    const { data: rows } = await BUYER.client
      .from('transactions').select('id').eq('buyer_id', BUYER.uid).limit(1)
    const id = (rows as { id: string }[] | null)?.[0]?.id
    expect(id, 'the buyer has no transaction, so this asserts nothing').toBeTruthy()
    // No UPDATE policy: zero rows match rather than an error being raised.
    const { data: after } = await BUYER.client
      .from('transactions')
      .update({ subtotal: 1, status: 'completed', seller_id: BUYER.uid })
      .eq('id', id).select('id')
    expect(after ?? []).toHaveLength(0)
  })

  it('cannot buy on another member behalf', async () => {
    // buyer_id is taken from auth.uid(); there is no parameter to spoof.
    const { data } = await OUTSIDER.client.rpc('loamy_propose_transaction', {
      p_listing_id: listingId, p_quantity: 3, p_note: null,
      p_delivery_state: null, p_delivery_lga: null,
    })
    const { data: row } = await OUTSIDER.client
      .from('transactions').select('buyer_id').eq('id', data as string).maybeSingle()
    expect((row as { buyer_id: string } | null)?.buyer_id).toBe(OUTSIDER.uid)
  })
})

describe('who can see a purchase', () => {
  let txnId = ''

  beforeAll(async () => {
    const { data } = await BUYER.client
      .from('transactions').select('id').eq('buyer_id', BUYER.uid).limit(1)
    txnId = (data as { id: string }[])[0].id
  })

  it('the buyer can', async () => {
    const { data } = await BUYER.client.from('transactions').select('id').eq('id', txnId).maybeSingle()
    expect(data).toBeTruthy()
  })

  it('the seller can', async () => {
    const { data } = await SELLER.client.from('transactions').select('id').eq('id', txnId).maybeSingle()
    expect(data).toBeTruthy()
  })

  it('an unrelated member cannot', async () => {
    const { data } = await OUTSIDER.client.from('transactions').select('id').eq('id', txnId).maybeSingle()
    expect(data, 'an unrelated member saw a purchase').toBeNull()
  })

  it('an unrelated member cannot see its events either', async () => {
    const { data } = await OUTSIDER.client
      .from('transaction_events').select('id').eq('transaction_id', txnId)
    expect(data ?? []).toHaveLength(0)
  })

  it('an admin can', async () => {
    if (!admin) return
    const { data } = await admin.from('transactions').select('id').eq('id', txnId).maybeSingle()
    expect(data).toBeTruthy()
  })
})

describe('no sensitive data reaches a transaction', () => {
  it('carries no bank or identity fields', async () => {
    const { data } = await BUYER.client
      .from('transactions').select('*').eq('buyer_id', BUYER.uid).limit(1).maybeSingle()
    const keys = Object.keys((data ?? {}) as Record<string, unknown>).map((k) => k.toLowerCase())
    for (const bad of ['bvn', 'nin', 'account_number', 'bank_code', 'password', 'token']) {
      expect(keys, `transaction exposed ${bad}`).not.toContain(bad)
    }
  })
})
