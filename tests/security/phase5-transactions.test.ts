import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonClient, createdEmails, makeUser, type TestUser } from '../helpers/supabase'

/**
 * Phase 5: the transaction state machine.
 *
 * The two things worth proving:
 *
 *   1. The three machines are genuinely independent. A transaction can be
 *      accepted while payment has not started and nothing has shipped.
 *   2. NO MEMBER CAN ASSERT THAT MONEY MOVED. Payment state is provider-
 *      reported; if a buyer could set payment_state='released' the whole
 *      settlement model is decorative.
 */

let SELLER: TestUser
let BUYER: TestUser
let OUTSIDER: TestUser
let batchId: string
let listingId: string
let txnId: string

const BATCH_QTY = 50

beforeAll(async () => {
  SELLER = await makeUser('farmer', 'Farmer')
  BUYER = await makeUser('trader', 'Trader')
  OUTSIDER = await makeUser('trader', 'Trader')

  const { data: farm } = await SELLER.client.from('farms').insert({
    owner_id: SELLER.uid, farm_name: 'Phase5 Farm', state: 'Benue', lga: 'Makurdi',
    size_hectares: 9, primary_crops: ['Maize'], ownership_type: 'owned',
  }).select('id').single()

  const { data: cycle } = await SELLER.client.from('crop_records').insert({
    farm_id: farm!.id, crop: 'Maize', season_year: 2026, status: 'harvested',
  }).select('id').single()

  const { data: harvest } = await SELLER.client.from('harvests').insert({
    production_cycle_id: cycle!.id, farm_id: farm!.id, commodity: 'Maize',
    harvest_date: '2026-09-05', quantity: BATCH_QTY, unit: 'tonne',
  }).select('id').single()

  const { data: b } = await SELLER.client.rpc('loamy_create_batch_from_harvest', {
    p_harvest_id: harvest!.id, p_quantity: BATCH_QTY,
  })
  batchId = b as string

  const { data: l, error } = await SELLER.client.rpc('loamy_list_batch', {
    p_batch_id: batchId, p_quantity: 30, p_price_per_unit: 200_000,
  })
  if (error) throw new Error('list: ' + error.message)
  listingId = l as string
}, 240_000)

afterAll(() => {
  console.log('\nAccounts created by this run (delete in Supabase > Authentication):')
  for (const e of createdEmails) console.log('  ' + e)
})

describe('proposing', () => {
  it('computes the subtotal server-side from the listing price', async () => {
    const { data, error } = await BUYER.client.rpc('loamy_propose_transaction', {
      p_listing_id: listingId, p_quantity: 10, p_note: 'Need it by October',
    })
    expect(error, error?.message).toBeFalsy()
    txnId = data as string

    const { data: t } = await BUYER.client
      .from('transactions')
      .select('ref, status, payment_state, fulfilment_state, subtotal, price_per_unit, quantity, batch_id')
      .eq('id', txnId).single()

    expect(t!.ref).toMatch(/^TXN-\d{6}$/)
    expect(t!.status).toBe('proposed')
    // The three machines start independent.
    expect(t!.payment_state).toBe('not_started')
    expect(t!.fulfilment_state).toBe('not_started')
    // 10 x 200,000 -- computed from the listing, not sent by the client.
    expect(Number(t!.subtotal)).toBe(2_000_000)
    expect(t!.batch_id).toBe(batchId)
  })

  it('does not reserve stock on proposal — proposing must not grief a seller', async () => {
    const { data: b } = await SELLER.client
      .from('commodity_batches').select('available_quantity').eq('id', batchId).single()
    expect(Number(b!.available_quantity)).toBe(BATCH_QTY)
  })

  it('refuses a seller buying their own listing', async () => {
    const { error } = await SELLER.client.rpc('loamy_propose_transaction', {
      p_listing_id: listingId, p_quantity: 1,
    })
    expect(error).toBeTruthy()
  })

  it('refuses more than is listed', async () => {
    const { error } = await BUYER.client.rpc('loamy_propose_transaction', {
      p_listing_id: listingId, p_quantity: 999,
    })
    expect(error).toBeTruthy()
  })

  it('has no client insert path — a transaction cannot be conjured', async () => {
    const { error } = await BUYER.client.from('transactions').insert({
      buyer_id: BUYER.uid, seller_id: SELLER.uid, commodity: 'Maize',
      quantity: 1, unit: 'tonne', price_per_unit: 1, subtotal: 1,
    })
    expect(error, 'a member created a transaction directly').toBeTruthy()
  })
})

describe('who may move the agreement', () => {
  it('refuses the buyer accepting their own proposal', async () => {
    const { error } = await BUYER.client.rpc('loamy_transaction_transition', {
      p_transaction_id: txnId, p_event_type: 'accept', p_machine: 'status',
    })
    expect(error, 'a buyer accepted their own proposal').toBeTruthy()
  })

  it('refuses an unrelated member touching it at all', async () => {
    const { error } = await OUTSIDER.client.rpc('loamy_transaction_transition', {
      p_transaction_id: txnId, p_event_type: 'accept', p_machine: 'status',
    })
    expect(error).toBeTruthy()
  })

  it('lets the seller accept, and commits the stock at that point', async () => {
    const { error } = await SELLER.client.rpc('loamy_transaction_transition', {
      p_transaction_id: txnId, p_event_type: 'accept', p_machine: 'status',
    })
    expect(error, error?.message).toBeFalsy()

    const { data: t } = await SELLER.client
      .from('transactions').select('status, payment_state').eq('id', txnId).single()
    expect(t!.status).toBe('accepted')
    // Still independent: accepting an agreement moves no money.
    expect(t!.payment_state).toBe('not_started')

    const { data: b } = await SELLER.client
      .from('commodity_batches').select('available_quantity').eq('id', batchId).single()
    expect(Number(b!.available_quantity)).toBe(BATCH_QTY - 10)
  })

  it('refuses an out-of-order transition', async () => {
    // Already accepted, so it cannot be accepted again.
    const { error } = await SELLER.client.rpc('loamy_transaction_transition', {
      p_transaction_id: txnId, p_event_type: 'accept', p_machine: 'status',
    })
    expect(error).toBeTruthy()
  })

  it('refuses an unknown event', async () => {
    const { error } = await SELLER.client.rpc('loamy_transaction_transition', {
      p_transaction_id: txnId, p_event_type: 'teleport', p_machine: 'status',
    })
    expect(error).toBeTruthy()
  })
})

describe('no member can assert that money moved', () => {
  const PAYMENT_EVENTS = [
    'payment_initiated', 'payment_authorized', 'payment_held',
    'payment_released', 'payment_refunded', 'payment_failed',
  ]

  for (const ev of PAYMENT_EVENTS) {
    it(`refuses the buyer claiming ${ev}`, async () => {
      const { error } = await BUYER.client.rpc('loamy_transaction_transition', {
        p_transaction_id: txnId, p_event_type: ev, p_machine: 'payment',
      })
      expect(error, `a buyer set payment_state via ${ev}`).toBeTruthy()
    })
  }

  it('refuses the seller claiming payment was released', async () => {
    const { error } = await SELLER.client.rpc('loamy_transaction_transition', {
      p_transaction_id: txnId, p_event_type: 'payment_released', p_machine: 'payment',
    })
    expect(error).toBeTruthy()
  })

  it('leaves payment_state untouched after all those attempts', async () => {
    const { data } = await BUYER.client
      .from('transactions').select('payment_state').eq('id', txnId).single()
    expect(data!.payment_state).toBe('not_started')
  })

  it('has no client update path on the transaction row', async () => {
    await BUYER.client.from('transactions')
      .update({ payment_state: 'released', subtotal: 1 }).eq('id', txnId)
    const { data } = await BUYER.client
      .from('transactions').select('payment_state, subtotal').eq('id', txnId).single()
    expect(data!.payment_state).toBe('not_started')
    expect(Number(data!.subtotal)).toBe(2_000_000)
  })
})

describe('fulfilment moves on its own machine', () => {
  it('lets the seller mark it loaded without touching status or payment', async () => {
    const { error } = await SELLER.client.rpc('loamy_transaction_transition', {
      p_transaction_id: txnId, p_event_type: 'loaded', p_machine: 'fulfilment',
    })
    expect(error, error?.message).toBeFalsy()

    const { data: t } = await SELLER.client
      .from('transactions').select('status, payment_state, fulfilment_state').eq('id', txnId).single()
    expect(t!.fulfilment_state).toBe('loaded')
    // The whole point of Part 19: these do not drag each other along.
    expect(t!.status).toBe('accepted')
    expect(t!.payment_state).toBe('not_started')
  })

  it('refuses the buyer marking goods loaded', async () => {
    const { error } = await BUYER.client.rpc('loamy_transaction_transition', {
      p_transaction_id: txnId, p_event_type: 'ready_for_pickup', p_machine: 'fulfilment',
    })
    expect(error).toBeTruthy()
  })

  it('refuses a fulfilment event from the wrong state', async () => {
    const { error } = await BUYER.client.rpc('loamy_transaction_transition', {
      p_transaction_id: txnId, p_event_type: 'received', p_machine: 'fulfilment',
    })
    expect(error, 'goods were received without being delivered').toBeTruthy()
  })
})

describe('the event log', () => {
  it('records every move with its machine, actor and both values', async () => {
    const { data } = await BUYER.client
      .from('transaction_events')
      .select('event_type, machine, previous_value, new_value, actor_id')
      .eq('transaction_id', txnId)
      .order('occurred_at', { ascending: true })

    const types = (data ?? []).map((e) => e.event_type)
    expect(types).toContain('proposed')
    expect(types).toContain('accept')
    expect(types).toContain('loaded')

    const accept = (data ?? []).find((e) => e.event_type === 'accept')!
    expect(accept.machine).toBe('status')
    expect(accept.previous_value).toBe('proposed')
    expect(accept.new_value).toBe('accepted')
    expect(accept.actor_id).toBe(SELLER.uid)
  })

  it('cannot be forged, edited or deleted', async () => {
    const ins = await BUYER.client.from('transaction_events').insert({
      transaction_id: txnId, event_type: 'payment_released', machine: 'payment',
      new_value: 'released',
    })
    expect(ins.error, 'a member forged a transaction event').toBeTruthy()

    const { data: row } = await BUYER.client
      .from('transaction_events').select('id, note').eq('transaction_id', txnId).limit(1).single()
    await BUYER.client.from('transaction_events').update({ note: 'tampered' }).eq('id', row!.id)
    await BUYER.client.from('transaction_events').delete().eq('id', row!.id)

    const { data: after } = await BUYER.client
      .from('transaction_events').select('note').eq('id', row!.id).maybeSingle()
    expect(after, 'a transaction event was deleted').toBeTruthy()
    expect(after!.note).not.toBe('tampered')
  })
})

describe('privacy', () => {
  it('keeps a transaction between its two parties', async () => {
    const { data } = await OUTSIDER.client.from('transactions').select('*').eq('id', txnId)
    expect(data ?? [], 'a third party read someone else’s transaction').toHaveLength(0)
  })

  it('is invisible to anon', async () => {
    for (const t of ['transactions', 'transaction_events', 'disputes']) {
      const { data, error } = await anonClient().from(t).select('*').limit(1)
      expect(error || (data ?? []).length === 0, `${t} readable while signed out`).toBeTruthy()
    }
  })
})

describe('disputes', () => {
  let disputeId: string

  it('lets a party raise one, and moves the transaction with it', async () => {
    const { data, error } = await BUYER.client.rpc('loamy_open_dispute', {
      p_transaction_id: txnId, p_category: 'quantity',
      p_detail: 'Short by two tonnes on arrival.',
    })
    expect(error, error?.message).toBeFalsy()
    disputeId = data as string

    const { data: t } = await BUYER.client
      .from('transactions').select('status').eq('id', txnId).single()
    expect(t!.status).toBe('disputed')
  })

  it('names the other party as the respondent automatically', async () => {
    const { data } = await BUYER.client
      .from('disputes').select('raised_by, against_id, status').eq('id', disputeId).single()
    expect(data!.raised_by).toBe(BUYER.uid)
    expect(data!.against_id).toBe(SELLER.uid)
    expect(data!.status).toBe('open')
  })

  it('refuses a second open dispute on the same transaction', async () => {
    const { error } = await SELLER.client.rpc('loamy_open_dispute', {
      p_transaction_id: txnId, p_category: 'payment', p_detail: 'Also unhappy.',
    })
    expect(error).toBeTruthy()
  })

  it('refuses an empty description', async () => {
    const { error } = await BUYER.client.rpc('loamy_open_dispute', {
      p_transaction_id: txnId, p_category: 'other', p_detail: '   ',
    })
    expect(error).toBeTruthy()
  })

  it('refuses a stranger raising one', async () => {
    const { error } = await OUTSIDER.client.rpc('loamy_open_dispute', {
      p_transaction_id: txnId, p_category: 'other', p_detail: 'Not my deal.',
    })
    expect(error).toBeTruthy()
  })

  it('is visible to both parties and nobody else', async () => {
    const sellerView = await SELLER.client.from('disputes').select('id').eq('id', disputeId)
    expect(sellerView.data ?? []).toHaveLength(1)

    const strangerView = await OUTSIDER.client.from('disputes').select('id').eq('id', disputeId)
    expect(strangerView.data ?? []).toHaveLength(0)
  })

  it('writes an audit event', async () => {
    const { data } = await BUYER.client
      .from('transaction_events').select('event_type').eq('transaction_id', txnId)
      .eq('event_type', 'dispute').maybeSingle()
    expect(data, 'the dispute did not appear in the transaction log').toBeTruthy()
  })
})
