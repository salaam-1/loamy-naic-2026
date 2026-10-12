import { supabase } from '@/lib/supabase'

/**
 * Checkout — the one authoritative path from a cart to a purchase.
 *
 * WHY THIS MODULE EXISTS
 *   Checkout used to end in `orders`, which the model freeze lists as
 *   retained-but-not-authoritative. An order carries no fee snapshot, no
 *   batch_id, no transaction_events, and no route to financing,
 *   verification, logistics, warehouse or settlement — all of which hang off
 *   `transactions`. So the ordinary purchase terminated outside the spine.
 *
 *   `loamy_checkout_cart` orchestrates `loamy_propose_transaction` per cart
 *   line and clears those lines in one statement. It restates none of the
 *   business rules; ownership, active-listing, self-purchase, quantity,
 *   batch linkage, the lifecycle event and the seller notification all still
 *   belong to the authoritative function.
 *
 * ONE TRANSACTION PER LISTING
 *   Not a new choice: a transaction carries listing_id, batch_id, commodity,
 *   quantity and price, so it cannot represent several listings at once.
 *   `orders` grouped by seller, and that grouping is exactly what could not
 *   carry traceability.
 *
 * IDEMPOTENCY IS SERVER-SIDE
 *   Re-proposing the same (buyer, listing, quantity) while the first is still
 *   `proposed` returns the existing transaction rather than creating a
 *   second. A disabled button is a courtesy; the unique partial index is the
 *   guarantee. The client may therefore retry safely.
 */

export interface CheckoutInput {
  /** Optional, exactly as the authoritative function treats it. */
  deliveryState?: string | null
  deliveryLga?: string | null
  note?: string | null
}

export interface CheckoutResult {
  transactionIds: string[]
  error: string | null
}

/**
 * Turn the signed-in member's cart into authoritative transactions.
 *
 * Returns ids rather than throwing so the caller can show a real error
 * instead of a redirect that implies success. A failure here means NOTHING
 * was bought — the server runs the whole cart in one statement.
 */
export async function checkoutCart(input: CheckoutInput = {}): Promise<CheckoutResult> {
  const { data, error } = await supabase.rpc('loamy_checkout_cart', {
    p_delivery_state: input.deliveryState ?? null,
    p_delivery_lga: input.deliveryLga ?? null,
    p_note: input.note ?? null,
  })
  if (error) return { transactionIds: [], error: error.message }

  // setof uuid comes back as an array of scalars.
  const ids = Array.isArray(data) ? (data as unknown[]).map(String) : []
  return { transactionIds: ids, error: null }
}

/**
 * Propose a purchase for ONE listing, outside the cart.
 *
 * Used by the financing entry point so that financing attaches to a
 * transaction the buyer already has, rather than creating a second one for
 * the same purchase. Idempotent on (buyer, listing, quantity).
 */
export async function proposeTransaction(
  listingId: string,
  quantity: number,
  input: CheckoutInput = {},
): Promise<{ transactionId: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('loamy_propose_transaction', {
    p_listing_id: listingId,
    p_quantity: quantity,
    p_note: input.note ?? null,
    p_delivery_state: input.deliveryState ?? null,
    p_delivery_lga: input.deliveryLga ?? null,
  })
  if (error) return { transactionId: null, error: error.message }
  return { transactionId: (data as string) ?? null, error: null }
}
