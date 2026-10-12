import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '@/context/AuthContext'
import {
  addToCart as apiAddToCart,
  addWishlist,
  fetchCart,
  fetchWishlist,
  removeCartItem,
  removeWishlist,
  setCartQuantity,
  type CartItem,
  type WishlistItem,
} from '@/lib/cart'

interface CartState {
  cart: CartItem[]
  wishlist: WishlistItem[]
  cartCount: number
  wishlistCount: number
  loading: boolean
  inCart: (listingId: string) => boolean
  isWishlisted: (listingId: string) => boolean
  addToCart: (listingId: string, quantity?: number) => Promise<void>
  removeFromCart: (itemId: string) => Promise<void>
  setQuantity: (itemId: string, quantity: number) => Promise<void>
  toggleWishlist: (listingId: string) => Promise<void>
  refresh: () => Promise<void>
  /**
   * Increments once per SUCCESSFUL add-to-cart, and never otherwise.
   *
   * The shell's cart icon watches this so the icon itself acknowledges the
   * add, rather than the feedback living only in a toast. It is a counter and
   * not a boolean because two adds in a row must be two separate reactions.
   *
   * Nothing about the cart's authoritative state is derived from it: it is a
   * notification, not a source of truth.
   */
  cartBump: number
}

const CartCtx = createContext<CartState | null>(null)

/** Live cart + wishlist state, shared by the shell badges, product cards and the
 * cart/wishlist pages. Empty and inert for signed-out visitors — every action a
 * visitor triggers is routed to sign-up by the UI, never here. */
export function CartProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const authed = !!session

  const [cart, setCart] = useState<CartItem[]>([])
  const [wishlist, setWishlist] = useState<WishlistItem[]>([])
  const [loading, setLoading] = useState(false)
  const [cartBump, setCartBump] = useState(0)

  const refresh = useCallback(async () => {
    if (!authed) {
      setCart([])
      setWishlist([])
      return
    }
    setLoading(true)
    try {
      const [c, w] = await Promise.all([fetchCart(), fetchWishlist()])
      setCart(c)
      setWishlist(w)
    } catch {
      // Non-fatal: leave the last good state; a badge that fails to load is not
      // worth interrupting browsing over.
    } finally {
      setLoading(false)
    }
  }, [authed])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const cartIds = useMemo(() => new Set(cart.map((c) => c.listing_id)), [cart])
  const wishIds = useMemo(() => new Set(wishlist.map((w) => w.listing_id)), [wishlist])

  const inCart = useCallback((id: string) => cartIds.has(id), [cartIds])
  const isWishlisted = useCallback((id: string) => wishIds.has(id), [wishIds])

  const addToCart = useCallback(async (listingId: string, quantity = 1) => {
    // Both awaits are ahead of the bump on purpose. If either throws, the
    // bump never happens and the icon stays still -- a failed add must not
    // produce a success animation.
    await apiAddToCart(listingId, quantity)
    setCart(await fetchCart())
    setCartBump((n) => n + 1)
  }, [])

  const removeFromCart = useCallback(async (itemId: string) => {
    await removeCartItem(itemId)
    setCart((prev) => prev.filter((c) => c.id !== itemId))
  }, [])

  const setQuantity = useCallback(async (itemId: string, quantity: number) => {
    if (quantity < 1) return
    await setCartQuantity(itemId, quantity)
    setCart((prev) => prev.map((c) => (c.id === itemId ? { ...c, quantity } : c)))
  }, [])

  const toggleWishlist = useCallback(async (listingId: string) => {
    if (wishIds.has(listingId)) {
      await removeWishlist(listingId)
      setWishlist((prev) => prev.filter((w) => w.listing_id !== listingId))
    } else {
      await addWishlist(listingId)
      setWishlist(await fetchWishlist())
    }
  }, [wishIds])

  const value: CartState = {
    cart,
    wishlist,
    cartCount: cart.length,
    wishlistCount: wishlist.length,
    loading,
    inCart,
    isWishlisted,
    addToCart,
    removeFromCart,
    setQuantity,
    toggleWishlist,
    refresh,
    cartBump,
  }

  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>
}

export function useCart(): CartState {
  const ctx = useContext(CartCtx)
  if (!ctx) throw new Error('useCart must be used within <CartProvider>')
  return ctx
}
