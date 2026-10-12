import { describe, expect, it } from 'vitest'
import { errorCode, errorMessage, rawErrorMessage } from '../../src/lib/errors'

/**
 * The hole this module closes: supabase-js rejects with a PostgrestError,
 * which is a plain object and NOT an instance of Error. Every
 * `e instanceof Error ? e.message : fallback` in the app therefore discarded
 * the database's own description of the failure. Phase 4 slice 2 browser QA
 * caught it — a refused add-to-cart said "Please try again" when the server
 * had said "new row violates row-level security policy".
 */

const postgrestError = (over: Record<string, unknown> = {}) => ({
  message: 'new row violates row-level security policy for table "cart_items"',
  code: '42501',
  details: null,
  hint: null,
  ...over,
})

describe('a PostgrestError is not an Error, and must still be read', () => {
  it('is genuinely not an Error instance', () => {
    // If this ever fails, supabase-js changed and the instanceof checks
    // elsewhere became safe. Worth knowing either way.
    expect(postgrestError() instanceof Error).toBe(false)
  })

  it('still yields its message', () => {
    expect(rawErrorMessage(postgrestError())).toMatch(/row-level security/)
  })

  it('still yields its code', () => {
    expect(errorCode(postgrestError())).toBe('42501')
  })

  it('does not fall through to the generic fallback', () => {
    const msg = errorMessage(postgrestError(), 'Please try again.')
    expect(msg).not.toBe('Please try again.')
  })
})

describe('known refusals are put in plain language', () => {
  it('explains an RLS refusal without jargon', () => {
    const msg = errorMessage(postgrestError(), 'fallback')
    expect(msg).toMatch(/not allowed/i)
    expect(msg).not.toMatch(/row-level security|42501/)
  })

  it('recognises an RLS refusal from the message when no code is supplied', () => {
    const msg = errorMessage({ message: 'new row violates row-level security policy' }, 'fallback')
    expect(msg).toMatch(/not allowed/i)
  })

  it.each([
    ['23505', /already/i],
    ['23514', /outside what/i],
    ['23503', /no longer available/i],
    ['PGRST116', /could not be found/i],
  ])('translates %s', (code, expected) => {
    expect(errorMessage(postgrestError({ code, message: 'raw db text' }), 'fallback')).toMatch(expected)
  })

  it('names a connection failure as one', () => {
    expect(errorMessage(new TypeError('Failed to fetch'), 'fallback')).toMatch(/could not reach/i)
  })
})

describe('anything unrecognised is passed through, not hidden', () => {
  it('shows the server wording for an unknown code', () => {
    const msg = errorMessage(postgrestError({ code: 'P0001', message: 'Quantity exceeds available stock' }), 'fallback')
    expect(msg).toBe('Quantity exceeds available stock')
  })

  it('reads a plain Error', () => {
    expect(errorMessage(new Error('boom'), 'fallback')).toBe('boom')
  })

  it('reads a thrown string', () => {
    expect(errorMessage('boom', 'fallback')).toBe('boom')
  })
})

describe('the fallback is the last resort, never the first', () => {
  it.each([[null], [undefined], [{}], [{ message: '' }], [{ message: 123 }], [42]])(
    'falls back for %j', (thrown) => {
      expect(errorMessage(thrown, 'Could not add this.')).toBe('Could not add this.')
    },
  )

  it('never produces undefined, null or [object Object]', () => {
    for (const thrown of [null, undefined, {}, 42, new Error(''), postgrestError()]) {
      const msg = errorMessage(thrown, 'fallback')
      expect(msg).not.toMatch(/undefined|\[object|^null$/)
      expect(msg.length).toBeGreaterThan(0)
    }
  })
})
