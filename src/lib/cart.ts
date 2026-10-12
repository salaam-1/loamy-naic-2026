import { supabase } from '@/lib/supabase'
import type { Listing } from '@/lib/marketplace'

/**
 * Cart + wishlist data access. Both are private per-user tables guarded by RLS
 * (user_id = auth.uid()); these helpers never pass a user id for reads/deletes —
 * the policies scope every row to the caller. Checkout/escrow are later stages;
 * here a cart just holds a listing + desired quantity.
 */

export interface CartItem {
  id: string
  listing_id: string
  quantity: number
  created_at: string
  updated_at: string
  /** PostgREST embed — null if the listing was removed or is no longer visible. */
  listing?: Listing | null
}

export interface WishlistItem {
  id: string
  listing_id: string
  created_at: string
  listing?: Listing | null
}

const CART_SELECT = 'id, listing_id, quantity, created_at, updated_at, listing:listings(*)'
const WISH_SELECT = 'id, listing_id, created_at, listing:listings(*)'

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser()
  if (!data.user) throw new Error('You need to be signed in.')
  return data.user.id
}

export async function fetchCart(): Promise<CartItem[]> {
  const { data, error } = await supabase
    .from('cart_items')
    .select(CART_SELECT)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data as unknown as CartItem[]) ?? []
}

/** Add a listing to the cart, or bump quantity if it is already there. */
export async function addToCart(listingId: string, quantity = 1): Promise<void> {
  const user_id = await currentUserId()
  const { error } = await supabase
    .from('cart_items')
    .upsert(
      { user_id, listing_id: listingId, quantity },
      { onConflict: 'user_id,listing_id', ignoreDuplicates: false },
    )
  if (error) throw error
}

export async function setCartQuantity(itemId: string, quantity: number): Promise<void> {
  const { error } = await supabase.from('cart_items').update({ quantity }).eq('id', itemId)
  if (error) throw error
}

export async function removeCartItem(itemId: string): Promise<void> {
  const { error } = await supabase.from('cart_items').delete().eq('id', itemId)
  if (error) throw error
}

export async function fetchWishlist(): Promise<WishlistItem[]> {
  const { data, error } = await supabase
    .from('wishlists')
    .select(WISH_SELECT)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as unknown as WishlistItem[]) ?? []
}

export async function addWishlist(listingId: string): Promise<void> {
  const user_id = await currentUserId()
  const { error } = await supabase
    .from('wishlists')
    .upsert({ user_id, listing_id: listingId }, { onConflict: 'user_id,listing_id', ignoreDuplicates: true })
  if (error) throw error
}

/** Remove a saved listing by listing id (RLS scopes the delete to the owner). */
export async function removeWishlist(listingId: string): Promise<void> {
  const { error } = await supabase.from('wishlists').delete().eq('listing_id', listingId)
  if (error) throw error
}
