import { supabase } from '@/lib/supabase'

/**
 * Orders data access — RETAINED FOR HISTORY, NOT FOR NEW CHECKOUT.
 *
 * `orders` is listed in docs/model-freeze.json as retained-but-not-
 * authoritative. An order carries no fee snapshot, no batch_id, no
 * transaction_events, and no route to financing, verification, logistics,
 * warehouse or settlement — all of which hang off `transactions`.
 *
 * Phase 4 slice 1 moved new checkout onto loamy_checkout_cart (see
 * src/lib/checkout.ts). The READ functions here remain in use: real orders
 * were placed before that change and members must still be able to see and
 * act on them. Deleting the table is a separate migration with its own
 * history question, not a checkout change.
 *
 * Rows are created/mutated ONLY through the security-definer RPCs; the client
 * just reads its own party rows (RLS) and calls those RPCs.
 */

export type OrderStatus =
  | 'pending_seller'
  | 'confirmed'
  | 'rejected'
  | 'cancelled'
  | 'awaiting_payment'
  | 'in_escrow'
  | 'released'
  | 'completed'
  | 'refunded'

export interface OrderItem {
  id: string
  order_id: string
  listing_id: string | null
  commodity: string
  unit: string
  unit_price: number
  quantity: number
  line_total: number
  created_at: string
}

export interface Order {
  id: string
  buyer_id: string
  seller_id: string
  status: OrderStatus
  currency: string
  subtotal: number
  delivery_state: string | null
  buyer_note: string | null
  seller_note: string | null
  created_at: string
  updated_at: string
  items?: OrderItem[]
}

export const ORDER_STATUS_META: Record<OrderStatus, { label: string; chip: string }> = {
  pending_seller: { label: 'Awaiting seller', chip: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  confirmed: { label: 'Confirmed', chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  rejected: { label: 'Declined', chip: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
  cancelled: { label: 'Cancelled', chip: 'bg-emerald-950/5 text-emerald-900/50' },
  awaiting_payment: { label: 'Awaiting payment', chip: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  in_escrow: { label: 'In escrow', chip: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' },
  released: { label: 'Funds released', chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  completed: { label: 'Completed', chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  refunded: { label: 'Refunded', chip: 'bg-emerald-950/5 text-emerald-900/50' },
}

const ORDER_SELECT = '*, items:order_items(*)'

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getUser()
  if (!data.user) throw new Error('You need to be signed in.')
  return data.user.id
}

/** Orders the caller placed (as buyer). */
export async function fetchMyOrders(): Promise<Order[]> {
  const me = await uid()
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_SELECT)
    .eq('buyer_id', me)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as unknown as Order[]) ?? []
}

/** Orders the caller received (as seller). */
export async function fetchSalesOrders(): Promise<Order[]> {
  const me = await uid()
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_SELECT)
    .eq('seller_id', me)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as unknown as Order[]) ?? []
}

/** Place one order per seller from the caller's cart. Returns new order ids. */
/**
 * @deprecated Phase 4 slice 1 (2026-09-21). Creates a non-authoritative
 * `orders` row. New checkout uses `checkoutCart` from src/lib/checkout.ts,
 * which creates authoritative transactions. Kept only so the old RPC stays
 * callable for any recovery need; no product code should call it.
 */
export async function placeOrdersFromCart(deliveryState?: string | null, note?: string | null): Promise<string[]> {
  const { data, error } = await supabase.rpc('loamy_place_orders_from_cart', {
    p_delivery_state: deliveryState ?? null,
    p_note: note ?? null,
  })
  if (error) throw error
  return (data as string[]) ?? []
}

export async function respondToOrder(orderId: string, accept: boolean, note?: string | null): Promise<void> {
  const { error } = await supabase.rpc('loamy_respond_to_order', {
    p_order: orderId,
    p_accept: accept,
    p_note: note ?? null,
  })
  if (error) throw error
}

export async function cancelOrder(orderId: string): Promise<void> {
  const { error } = await supabase.rpc('loamy_cancel_order', { p_order: orderId })
  if (error) throw error
}
