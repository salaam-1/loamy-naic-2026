import { describe, expect, it } from 'vitest'
import {
  fulfilmentLabel, loadingFlagLabel, nextLogisticsEvents, whoseMove,
  LOGISTICS_EVENT_LABEL, type Fulfilment,
} from '../../src/lib/fulfilment'

/**
 * The fulfilment spine's presentation contract.
 *
 * These are mostly about not saying something false: not offering a carrier
 * step the transition rules forbid, not telling a buyer to act when it is the
 * seller's move, and not hiding an evidence gap the server flagged.
 */

function make(over: Partial<Fulfilment> = {}): Fulfilment {
  return {
    available: true,
    transaction: {
      ref: 'TXN-000207', commodity: 'Maize', quantity: 10, unit: 'tonne',
      status: 'accepted', payment_state: 'not_started',
      fulfilment_state: 'not_started', delivery_state: 'Abia', delivery_lga: null,
      viewer_role: 'buyer',
      ...(over.transaction ?? {}),
    },
    loading: over.loading ?? [],
    transport: over.transport ?? null,
    storage: over.storage ?? [],
    receipts: over.receipts ?? [],
    financing: over.financing ?? null,
  }
}

const job = (over: Record<string, unknown> = {}) => ({
  job_id: 'j1', status: 'broadcast', mode: 'loamy',
  pickup_location: null, dropoff_location: null, agreed_price: null,
  external_provider_name: null, assigned_provider: null,
  offers: [], events: [], ...over,
}) as Fulfilment['transport']

describe('the carrier is only offered steps the rules allow', () => {
  // Mirrors logistics_transition_rules.allowed_from, verbatim.
  it.each([
    ['booked', ['loading', 'loaded', 'failed']],
    ['assigned', ['loading', 'loaded', 'failed']],
    ['loading', ['loaded', 'failed']],
    ['loaded', ['departed', 'failed']],
    ['picked_up', ['departed', 'failed']],
    ['in_transit', ['position', 'arrived', 'delivered', 'failed']],
    ['arrived', ['delivered', 'failed']],
  ])('offers %s -> %j', (status, expected) => {
    expect(nextLogisticsEvents(status)).toEqual(expected)
  })

  it('offers nothing on a job that has not been awarded', () => {
    expect(nextLogisticsEvents('broadcast')).toEqual([])
    expect(nextLogisticsEvents('requested')).toEqual([])
  })

  it('offers nothing once delivered or cancelled', () => {
    for (const s of ['delivered', 'completed', 'cancelled', 'failed']) {
      expect(nextLogisticsEvents(s), s).toEqual([])
    }
  })

  it('never offers a step the rules do not list for that status', () => {
    // 'departed' requires loaded/picked_up. Offering it from 'booked' would
    // put a carrier in front of a refusal they could not have predicted.
    expect(nextLogisticsEvents('booked')).not.toContain('departed')
    expect(nextLogisticsEvents('loaded')).not.toContain('delivered')
  })

  it('has a label for every event it can offer', () => {
    const all = new Set(
      ['booked', 'assigned', 'loading', 'loaded', 'picked_up', 'in_transit', 'arrived']
        .flatMap(nextLogisticsEvents),
    )
    for (const e of all) expect(LOGISTICS_EVENT_LABEL[e], e).toBeTruthy()
  })
})

describe('whose move it is', () => {
  it('tells the seller to schedule loading first', () => {
    const m = whoseMove(make({ transaction: { viewer_role: 'seller' } as never }))
    expect(m?.actor).toBe('You')
    expect(m?.action).toMatch(/schedule loading/i)
  })

  it('tells the buyer they are waiting on the seller', () => {
    const m = whoseMove(make())
    expect(m?.actor).toBe('The seller')
    expect(m?.action).toMatch(/yet to schedule loading/i)
  })

  it('tells the buyer to arrange transport once loading has started', () => {
    const m = whoseMove(make({ transaction: { fulfilment_state: 'loaded' } as never }))
    expect(m?.actor).toBe('You')
    expect(m?.action).toMatch(/arrange transport/i)
  })

  it('tells the buyer to choose when offers have arrived', () => {
    const m = whoseMove(make({
      transaction: { fulfilment_state: 'loaded' } as never,
      transport: job({ offers: [{ offer_id: 'o1' }, { offer_id: 'o2' }] }),
    }))
    expect(m?.action).toMatch(/2 carrier offers/i)
  })

  it('does not tell the SELLER to choose a carrier', () => {
    // Only the buyer arranges delivery; saying otherwise sends them to a
    // button they do not have.
    const m = whoseMove(make({
      transaction: { viewer_role: 'seller', fulfilment_state: 'loaded' } as never,
      transport: job({ offers: [{ offer_id: 'o1' }] }),
    }))
    expect(m?.actor).toBe('The buyer')
  })

  it('says carriers are being invited while there are no offers', () => {
    const m = whoseMove(make({
      transaction: { fulfilment_state: 'loaded' } as never,
      transport: job(),
    }))
    expect(m?.actor).toBe('Carriers')
  })

  it('hands over to the carrier once one is booked', () => {
    const m = whoseMove(make({
      transaction: { fulfilment_state: 'loaded' } as never,
      transport: job({ status: 'assigned', assigned_provider: 'Zenith Haulage' }),
    }))
    expect(m?.actor).toBe('The carrier')
  })

  it('reports delivery plainly', () => {
    const m = whoseMove(make({
      transaction: { fulfilment_state: 'delivered' } as never,
      transport: job({ status: 'delivered' }),
    }))
    expect(m?.actor).toBe('Delivered')
  })
})

describe('evidence gaps are put in words, never hidden', () => {
  it.each([
    ['no_loading_photo', /photograph/i],
    ['no_waybill', /waybill/i],
    ['no_gps', /location/i],
    ['quantity_mismatch', /does not match/i],
    ['no_quantity_confirmed', /no quantity/i],
  ])('explains %s', (flag, expected) => {
    expect(loadingFlagLabel(flag)).toMatch(expected)
  })

  it('shows an unrecognised flag rather than swallowing it', () => {
    // A new server-side flag must look unfamiliar, not invisible.
    expect(loadingFlagLabel('some_new_flag')).toBe('some new flag')
  })

  it('never softens a mismatch into something reassuring', () => {
    expect(loadingFlagLabel('quantity_mismatch')).not.toMatch(/minor|small|ok|fine/i)
  })
})

describe('fulfilment state reads as words', () => {
  it.each([
    ['not_started', 'Not started'],
    ['loading_scheduled', 'Loading scheduled'],
    ['loaded', 'Loaded'],
    ['in_transit', 'In transit'],
    ['at_warehouse', 'At warehouse'],
    ['delivered', 'Delivered'],
    ['received', 'Received'],
  ])('renders %s as %s', (state, label) => {
    expect(fulfilmentLabel(state)).toBe(label)
  })

  it('never returns an empty label', () => {
    for (const s of [null, undefined, '', 'something_new']) {
      expect(fulfilmentLabel(s).length).toBeGreaterThan(0)
    }
  })

  it('shows an unknown state as itself', () => {
    expect(fulfilmentLabel('awaiting_customs')).toBe('awaiting customs')
  })
})
