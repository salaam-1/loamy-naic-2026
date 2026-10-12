/**
 * Purchase quantity — what the client may accept, and what it must not refuse.
 *
 * THE RULE THIS MODULE EXISTS TO HOLD
 *   The client must never reject a quantity the backend would accept. Before
 *   Phase 4 slice 2 the BuyBox ran `Math.floor` on every entry, so a listing
 *   priced per tonne could not be bought as 2.5 tonnes — a restriction that
 *   exists nowhere in the schema. `listings.quantity_kg`,
 *   `cart_items.quantity` and `transactions.quantity` are all `numeric` with
 *   a `> 0` check, and 3.89 has been round-tripped through checkout.
 *
 * WHAT IS NOT INVENTED HERE
 *   The schema carries no minimum-order column, no step and no precision
 *   metadata. So this module defines none of those as constraints. It
 *   validates exactly two things, which are the two the database validates:
 *   greater than zero, and not more than is listed.
 *
 *   `quantityStep` is a keyboard-arrow convenience only. A value typed
 *   directly is never rejected for failing to be a multiple of it — that
 *   would be a client-side rule with no server behind it.
 *
 * WHERE AUTHORITY LIVES
 *   With the server. `loamy_propose_transaction` re-validates against the
 *   listing, and checkout fails loudly if it refuses. This is a courtesy
 *   layer that catches the obvious before a round trip, not a gate.
 */

export type QuantityCheck =
  | { ok: true; value: number }
  | { ok: false; value: number; reason: 'empty' | 'not_a_number' | 'too_small' | 'too_large'; message: string }

/**
 * Units that are whole things. A crate is a crate; half a bag is not a unit
 * anybody trades. Weight-based units are continuous and must accept decimals.
 *
 * Kept deliberately short: a unit that is not listed here is treated as
 * continuous, because wrongly allowing a decimal is a cosmetic oddity while
 * wrongly forbidding one blocks a legitimate sale.
 */
const DISCRETE_UNITS = new Set(['bag', 'bags', 'crate', 'crates', 'unit', 'units'])

export function isDiscreteUnit(unit: string | null | undefined): boolean {
  return DISCRETE_UNITS.has((unit ?? '').trim().toLowerCase())
}

/** The arrow-key increment. A convenience, never a constraint. */
export function quantityStep(unit: string | null | undefined): string {
  return isDiscreteUnit(unit) ? '1' : 'any'
}

/**
 * Format a quantity for display without inventing precision: trailing zeros
 * are dropped, so 2.50 reads as 2.5 and 3 reads as 3.
 */
export function formatQuantity(value: number): string {
  return Number(value.toFixed(3)).toLocaleString('en-NG', { maximumFractionDigits: 3 })
}

export function checkQuantity(
  raw: string | number,
  opts: { unit?: string | null; available?: number | null } = {},
): QuantityCheck {
  const text = typeof raw === 'number' ? String(raw) : raw.trim()
  if (text === '') {
    return { ok: false, value: 0, reason: 'empty', message: 'Enter a quantity.' }
  }

  const value = Number(text)
  if (!Number.isFinite(value)) {
    return { ok: false, value: 0, reason: 'not_a_number', message: 'Enter a number.' }
  }
  if (value <= 0) {
    return {
      ok: false,
      value,
      reason: 'too_small',
      message: 'Quantity must be greater than zero.',
    }
  }

  const available = opts.available
  if (available !== null && available !== undefined && value > available) {
    return {
      ok: false,
      value,
      reason: 'too_large',
      message: `Only ${formatQuantity(available)} ${opts.unit ?? ''}`.trim() + ' available.',
    }
  }

  return { ok: true, value }
}
