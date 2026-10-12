import { supabase } from '@/lib/supabase'

/** RFQ board data access. Browsing open requests uses the anon-safe view;
 * posting/responding hit the base tables under RLS. */

export interface PublicBuyRequest {
  id: string
  commodity: string
  quantity: number
  unit: string
  target_price: number | null
  currency: string
  state: string | null
  lga: string | null
  note: string | null
  created_at: string
  buyer_display_name: string | null
  buyer_category: string | null
}

export interface BuyRequest {
  id: string
  buyer_id: string
  commodity: string
  quantity: number
  unit: string
  target_price: number | null
  currency: string
  state: string | null
  lga: string | null
  note: string | null
  status: 'open' | 'closed'
  created_at: string
}

export interface BuyRequestResponse {
  id: string
  request_id: string
  responder_id: string
  message: string | null
  offered_price: number | null
  offered_quantity: number | null
  created_at: string
}

export interface NewBuyRequest {
  commodity: string
  quantity: number
  unit: string
  target_price: number | null
  state: string | null
  note: string | null
}

export async function fetchOpenRequests(): Promise<PublicBuyRequest[]> {
  const { data } = await supabase
    .from('loamy_public_buy_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)
  return (data as PublicBuyRequest[]) ?? []
}

export async function fetchMyRequests(): Promise<BuyRequest[]> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return []
  const { data } = await supabase
    .from('buy_requests')
    .select('*')
    .eq('buyer_id', auth.user.id)
    .order('created_at', { ascending: false })
  return (data as BuyRequest[]) ?? []
}

export async function postRequest(r: NewBuyRequest): Promise<void> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('You need to be signed in.')
  const { error } = await supabase.from('buy_requests').insert({
    buyer_id: auth.user.id,
    commodity: r.commodity,
    quantity: r.quantity,
    unit: r.unit,
    target_price: r.target_price,
    state: r.state,
    note: r.note,
    status: 'open',
  })
  if (error) throw new Error(error.message)
}

export async function setRequestStatus(id: string, status: 'open' | 'closed'): Promise<void> {
  const { error } = await supabase.from('buy_requests').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function respondToRequest(
  requestId: string,
  message: string | null,
  offeredPrice: number | null,
  offeredQuantity: number | null,
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('You need to be signed in.')
  const { error } = await supabase.from('buy_request_responses').insert({
    request_id: requestId,
    responder_id: auth.user.id,
    message,
    offered_price: offeredPrice,
    offered_quantity: offeredQuantity,
  })
  if (error) {
    if (error.code === '23505') throw new Error('You have already responded to this request.')
    throw new Error(error.message)
  }
}

export async function fetchResponses(requestId: string): Promise<BuyRequestResponse[]> {
  const { data } = await supabase
    .from('buy_request_responses')
    .select('*')
    .eq('request_id', requestId)
    .order('created_at', { ascending: false })
  return (data as BuyRequestResponse[]) ?? []
}
