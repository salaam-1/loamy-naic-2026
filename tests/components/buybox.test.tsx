import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * BuyBox — the two defects the Phase 4 audit found, tested so they stay
 * fixed.
 *
 *   1. A failed add-to-cart was swallowed in a bare catch, so a member whose
 *      add was refused saw the button finish and nothing happen.
 *   2. Math.floor truncated fractional quantities, so a per-tonne listing
 *      could not be bought as 2.5 tonnes.
 */

const addToCart = vi.fn()
let inCartValue = false

vi.mock('@/context/CartContext', () => ({
  useCart: () => ({ inCart: () => inCartValue, addToCart }),
}))

let mockSession: unknown = { user: { id: 'u1' } }
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ session: mockSession, profile: { id: 'u1' } }),
}))

vi.mock('@/pages/marketplace/CardActions', () => ({
  WishlistHeart: () => null,
}))

const { BuyBox } = await import('../../src/components/BuyBox')

function renderBox(props: Partial<Parameters<typeof BuyBox>[0]> = {}) {
  return render(
    <MemoryRouter>
      <BuyBox listingId="l1" unit="tonne" price={90000} availableQty={100} {...props} />
    </MemoryRouter>,
  )
}

const qtyField = () => screen.getByLabelText(/quantity/i) as HTMLInputElement
const addButton = () => screen.getByRole('button', { name: /add to cart/i })

beforeEach(() => {
  mockSession = { user: { id: 'u1' } }
  inCartValue = false
  addToCart.mockReset()
  addToCart.mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('a failed add is visible', () => {
  it('shows the error instead of silently doing nothing', async () => {
    addToCart.mockRejectedValue(new Error('Quantity exceeds available stock'))
    renderBox()
    fireEvent.click(addButton())
    const alert = await screen.findByRole('alert')
    // The server's own wording, not a generic apology: an unrecognised
    // failure is passed through rather than flattened.
    expect(alert.textContent).toMatch(/quantity exceeds available stock/i)
  })

  it('does not claim the item was added', async () => {
    addToCart.mockRejectedValue(new Error('nope'))
    renderBox()
    fireEvent.click(addButton())
    await screen.findByRole('alert')
    expect(screen.queryByText(/in cart/i)).toBeNull()
    expect(screen.getByRole('button', { name: /add to cart/i })).toBeTruthy()
  })

  it('keeps the quantity the member typed', async () => {
    addToCart.mockRejectedValue(new Error('nope'))
    renderBox()
    fireEvent.change(qtyField(), { target: { value: '7.5' } })
    fireEvent.click(addButton())
    await screen.findByRole('alert')
    // Re-typing a quantity after a failure is a small insult that adds up.
    expect(qtyField().value).toBe('7.5')
  })

  it('shows a PostgrestError, which is not an Error instance', async () => {
    // supabase-js rejects with a plain object. The old `instanceof Error`
    // check discarded it and showed the generic fallback instead.
    addToCart.mockRejectedValue({
      message: 'new row violates row-level security policy for table "cart_items"',
      code: '42501', details: null, hint: null,
    })
    renderBox()
    fireEvent.click(addButton())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/not allowed/i)
    expect(alert.textContent).not.toMatch(/could not add this to your cart/i)
  })

  it('falls back to a usable message when the error carries none', async () => {
    addToCart.mockRejectedValue(new Error(''))
    renderBox()
    fireEvent.click(addButton())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/could not add/i)
    expect(alert.textContent).not.toMatch(/undefined|\[object/i)
  })

  it('clears the error once the member edits the quantity', async () => {
    addToCart.mockRejectedValue(new Error('nope'))
    renderBox()
    fireEvent.click(addButton())
    await screen.findByRole('alert')
    fireEvent.change(qtyField(), { target: { value: '3' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('a successful add', () => {
  it('sends the typed quantity through, unrounded', async () => {
    renderBox()
    fireEvent.change(qtyField(), { target: { value: '2.5' } })
    fireEvent.click(addButton())
    await waitFor(() => expect(addToCart).toHaveBeenCalledWith('l1', 2.5))
  })

  it('shows the in-cart state', async () => {
    renderBox()
    fireEvent.click(addButton())
    expect(await screen.findByText(/in cart/i)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('fractional quantities are no longer truncated', () => {
  it.each([['2.5', 2.5], ['0.5', 0.5], ['12.75', 12.75]])('sends %s as %d', async (typed, expected) => {
    renderBox()
    fireEvent.change(qtyField(), { target: { value: typed } })
    fireEvent.click(addButton())
    await waitFor(() => expect(addToCart).toHaveBeenCalledWith('l1', expected))
  })

  it('shows a line total computed from the fraction', () => {
    renderBox({ price: 100 })
    fireEvent.change(qtyField(), { target: { value: '2.5' } })
    // 2.5 x 100 = 250, not 200 (floor) and not 300 (ceil).
    expect(screen.getByText(/250/)).toBeTruthy()
  })

  it('offers an open step for a continuous unit', () => {
    renderBox({ unit: 'tonne' })
    expect(qtyField().getAttribute('step')).toBe('any')
  })

  it('offers a whole step for a discrete unit, without forbidding a decimal', async () => {
    renderBox({ unit: 'bag' })
    expect(qtyField().getAttribute('step')).toBe('1')
    fireEvent.change(qtyField(), { target: { value: '2.5' } })
    fireEvent.click(addButton())
    // The step drives the arrow keys; the database has no such rule.
    await waitFor(() => expect(addToCart).toHaveBeenCalledWith('l1', 2.5))
  })
})

describe('invalid quantities never reach the server', () => {
  it.each(['0', '-1', 'abc', ''])('refuses %j', async (value) => {
    renderBox()
    fireEvent.change(qtyField(), { target: { value } })
    expect((addButton() as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(addButton())
    await waitFor(() => expect(addToCart).not.toHaveBeenCalled())
  })

  it('refuses more than is available, and says how much there is', () => {
    renderBox({ availableQty: 10, unit: 'tonne' })
    fireEvent.change(qtyField(), { target: { value: '11' } })
    expect(screen.getByText(/only 10 tonne available/i)).toBeTruthy()
    expect((addButton() as HTMLButtonElement).disabled).toBe(true)
  })

  it('marks the field invalid for assistive technology', () => {
    renderBox()
    fireEvent.change(qtyField(), { target: { value: '-1' } })
    expect(qtyField().getAttribute('aria-invalid')).toBe('true')
  })
})

describe('signed-out visitors', () => {
  it('are asked to sign in rather than shown a quantity box', () => {
    mockSession = null
    renderBox()
    expect(screen.getByRole('button', { name: /sign in to buy/i })).toBeTruthy()
    expect(screen.queryByLabelText(/quantity/i)).toBeNull()
  })
})
