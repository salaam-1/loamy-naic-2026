import { describe, expect, it } from 'vitest'
import { checkQuantity, formatQuantity, isDiscreteUnit, quantityStep } from '../../src/lib/quantity'

/**
 * The rule under test: the client must never reject a quantity the backend
 * would accept.
 *
 * `listings.quantity_kg`, `cart_items.quantity` and `transactions.quantity`
 * are all `numeric` with a `> 0` check, and 3.89 has been round-tripped
 * through checkout against the live database. Before Phase 4 slice 2 the
 * BuyBox ran Math.floor on every entry, so a listing priced per tonne could
 * not be bought as 2.5 tonnes.
 */

describe('fractional quantities are accepted', () => {
  it('keeps 2.5 as 2.5', () => {
    // The defect this slice exists to fix: Math.floor made this 2.
    const r = checkQuantity('2.5', { unit: 'tonne', available: 100 })
    expect(r.ok).toBe(true)
    expect(r.value).toBe(2.5)
  })

  it.each(['0.5', '1.25', '3.89', '12.005'])('accepts %s', (input) => {
    const r = checkQuantity(input, { unit: 'tonne', available: 100 })
    expect(r.ok).toBe(true)
    expect(r.value).toBe(Number(input))
  })

  it('does not round, floor or ceil', () => {
    for (const v of ['2.4', '2.5', '2.6']) {
      expect(checkQuantity(v, { available: 100 }).value).toBe(Number(v))
    }
  })

  it('accepts a whole number just as happily', () => {
    expect(checkQuantity('1', { available: 10 })).toEqual({ ok: true, value: 1 })
    expect(checkQuantity(3, { available: 10 })).toEqual({ ok: true, value: 3 })
  })
})

describe('the two rules the database actually has', () => {
  it('refuses zero', () => {
    const r = checkQuantity('0', { available: 10 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('too_small')
  })

  it('refuses a negative', () => {
    const r = checkQuantity('-5', { available: 10 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('too_small')
  })

  it('refuses more than is listed, and says how much there is', () => {
    const r = checkQuantity('11', { unit: 'tonne', available: 10 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('too_large')
      expect(r.message).toContain('10')
      expect(r.message).toContain('tonne')
    }
  })

  it('accepts exactly the available quantity', () => {
    expect(checkQuantity('10', { available: 10 }).ok).toBe(true)
  })

  it('imposes no limit when availability is unknown', () => {
    // A missing availability is not a reason to block a purchase; the server
    // validates against the listing either way.
    expect(checkQuantity('9999', {}).ok).toBe(true)
    expect(checkQuantity('9999', { available: null }).ok).toBe(true)
  })
})

describe('malformed input', () => {
  it.each([['', 'empty'], ['   ', 'empty']])('treats %j as %s', (input, reason) => {
    const r = checkQuantity(input, { available: 10 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe(reason)
  })

  it.each(['abc', '1.2.3', 'NaN', '--5'])('refuses %j without producing NaN downstream', (input) => {
    const r = checkQuantity(input, { available: 10 })
    expect(r.ok).toBe(false)
    expect(Number.isNaN(r.value)).toBe(false)
  })

  it('refuses Infinity', () => {
    expect(checkQuantity('Infinity', { available: 10 }).ok).toBe(false)
  })

  it('always gives a message a person can act on', () => {
    for (const input of ['', 'abc', '0', '-1', '999']) {
      const r = checkQuantity(input, { unit: 'kg', available: 10 })
      if (!r.ok) {
        expect(r.message.length).toBeGreaterThan(0)
        expect(r.message).not.toMatch(/NaN|undefined|null/)
      }
    }
  })
})

describe('the step is a convenience, not a constraint', () => {
  it('is whole for units that are whole things', () => {
    for (const u of ['bag', 'bags', 'crate', 'unit', 'units']) {
      expect(isDiscreteUnit(u), u).toBe(true)
      expect(quantityStep(u)).toBe('1')
    }
  })

  it('is open for weight, which is continuous', () => {
    for (const u of ['kg', 'tonne', 'litres']) {
      expect(isDiscreteUnit(u), u).toBe(false)
      expect(quantityStep(u)).toBe('any')
    }
  })

  it('treats an unknown unit as continuous', () => {
    // Wrongly allowing a decimal is a cosmetic oddity. Wrongly forbidding one
    // blocks a legitimate sale, so the default errs toward accepting.
    expect(isDiscreteUnit('punnet')).toBe(false)
    expect(quantityStep(undefined)).toBe('any')
  })

  it('does NOT reject a decimal on a discrete unit', () => {
    // The step governs the arrow keys. The database has no such check, so a
    // typed value must still pass -- the server remains authoritative.
    expect(checkQuantity('2.5', { unit: 'bag', available: 10 }).ok).toBe(true)
  })
})

describe('display', () => {
  it('drops trailing zeros', () => {
    expect(formatQuantity(2.5)).toBe('2.5')
    expect(formatQuantity(3)).toBe('3')
    expect(formatQuantity(2.0)).toBe('2')
  })

  it('does not invent precision', () => {
    expect(formatQuantity(1.25)).toBe('1.25')
  })
})
