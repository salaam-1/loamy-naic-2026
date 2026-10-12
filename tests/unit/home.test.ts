import { describe, expect, it } from 'vitest'
import {
  buildYieldChart, canBuy, canFinance, canGrow, canSell, greeting,
  isActiveTransaction, isOpenFinancing, leadTransaction,
  type CropRecordRow, type HomeTransaction,
} from '../../src/lib/home'

const txn = (over: Partial<HomeTransaction> = {}): HomeTransaction => ({
  id: 't1', ref: 'TXN-000001', commodity: 'Maize', quantity: 12.5, unit: 'MT',
  subtotal: 18_400_000, status: 'accepted', payment_state: 'pending',
  fulfilment_state: 'not_started', created_at: '2026-09-01T00:00:00.000Z',
  side: 'buying', ...over,
})

describe('role capability gates decide what Home even asks for', () => {
  it('only farmers hold farms', () => {
    expect(canGrow('farmer')).toBe(true)
    expect(canGrow('buyer')).toBe(false)
    expect(canGrow('growth_partner')).toBe(false)
  })

  it('a growth partner is not a seller or a buyer', () => {
    // Querying listings for an agent costs a round trip and produces a
    // section that can only ever be empty.
    expect(canSell('growth_partner')).toBe(false)
    expect(canBuy('growth_partner')).toBe(false)
    expect(canFinance('growth_partner')).toBe(false)
  })

  it('a trader both buys and sells', () => {
    expect(canBuy('trader')).toBe(true)
    expect(canSell('trader')).toBe(true)
  })

  it('treats a missing role as no capability rather than every capability', () => {
    for (const fn of [canGrow, canSell, canBuy, canFinance]) {
      expect(fn(null)).toBe(false)
      expect(fn(undefined)).toBe(false)
    }
  })
})

describe('which deal Home leads with', () => {
  it('shows nothing when there are none', () => {
    expect(leadTransaction([])).toBeNull()
  })

  it('prefers an active deal over a settled one', () => {
    const lead = leadTransaction([
      txn({ id: 'done', status: 'completed' }),
      txn({ id: 'live', status: 'accepted' }),
    ])
    expect(lead?.id).toBe('live')
  })

  it('prefers the side the member is buying', () => {
    // A buyer waiting on settlement has money committed.
    const lead = leadTransaction([
      txn({ id: 'sale', side: 'selling' }),
      txn({ id: 'purchase', side: 'buying' }),
    ])
    expect(lead?.id).toBe('purchase')
  })

  it('falls back to a settled deal rather than showing nothing', () => {
    const lead = leadTransaction([txn({ id: 'old', status: 'completed', side: 'selling' })])
    expect(lead?.id).toBe('old')
  })
})

describe('what counts as still in flight', () => {
  it.each(['proposed', 'accepted', 'in_transit', 'loading'])('%s is active', (status) => {
    expect(isActiveTransaction({ status })).toBe(true)
  })

  it.each(['completed', 'cancelled', 'disputed', 'delivered', 'released'])('%s is not', (status) => {
    expect(isActiveTransaction({ status })).toBe(false)
  })

  it.each(['submitted', 'under_review', 'information_requested'])('%s financing is open', (status) => {
    expect(isOpenFinancing({ status })).toBe(true)
  })

  it.each(['approved', 'rejected', 'withdrawn', 'expired'])('%s financing is closed', (status) => {
    // A decided application is not something Home should nag about.
    expect(isOpenFinancing({ status })).toBe(false)
  })
})

describe('yield history charts only what was measured', () => {
  const rec = (crop: string, year: number, kg: number | null): CropRecordRow =>
    ({ crop, season_year: year, actual_yield_kg: kg })

  it('is empty when nothing has been recorded', () => {
    expect(buildYieldChart([])).toEqual({ rows: [], series: [] })
  })

  it('ignores a season with no recorded yield', () => {
    // Plotting a null as zero would draw a crop failure that did not happen.
    expect(buildYieldChart([rec('Maize', 2026, null)])).toEqual({ rows: [], series: [] })
  })

  it('sums a crop across a season', () => {
    const c = buildYieldChart([rec('Maize', 2026, 1000), rec('Maize', 2026, 500)])
    expect(c.rows).toEqual([{ season: '2026', Maize: 1500 }])
    expect(c.series).toEqual([{ key: 'Maize', label: 'Maize' }])
  })

  it('orders seasons ascending', () => {
    const c = buildYieldChart([rec('Maize', 2026, 10), rec('Maize', 2024, 10), rec('Maize', 2025, 10)])
    expect(c.rows.map((r) => r.season)).toEqual(['2024', '2025', '2026'])
  })

  it('keeps the top four crops and folds the rest into Other', () => {
    const records = [
      rec('A', 2026, 500), rec('B', 2026, 400), rec('C', 2026, 300),
      rec('D', 2026, 200), rec('E', 2026, 100), rec('F', 2026, 50),
    ]
    const c = buildYieldChart(records)
    expect(c.series.map((s) => s.key)).toEqual(['A', 'B', 'C', 'D', 'Other'])
    expect(c.rows[0].Other).toBe(150) // E + F
    expect(c.series.find((s) => s.key === 'Other')?.other).toBe(true)
  })

  it('adds no Other series when there is nothing to fold', () => {
    const c = buildYieldChart([rec('A', 2026, 1), rec('B', 2026, 1)])
    expect(c.series.some((s) => s.key === 'Other')).toBe(false)
  })
})

describe('greeting', () => {
  it('changes with the hour', () => {
    expect(greeting(new Date('2026-09-21T08:00:00'))).toBe('Good morning')
    expect(greeting(new Date('2026-09-21T13:00:00'))).toBe('Good afternoon')
    expect(greeting(new Date('2026-09-21T20:00:00'))).toBe('Good evening')
  })
})
