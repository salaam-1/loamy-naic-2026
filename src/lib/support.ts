export const TICKET_CATEGORIES = ['payment', 'verification', 'marketplace', 'financing', 'account', 'other'] as const
export type TicketCategory = (typeof TICKET_CATEGORIES)[number]

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'

export const TICKET_STATUS_META: Record<TicketStatus, { label: string; chip: string }> = {
  open: { label: 'Open', chip: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  in_progress: { label: 'In progress', chip: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' },
  resolved: { label: 'Resolved', chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  closed: { label: 'Closed', chip: 'bg-emerald-950/5 text-emerald-900/50' },
}

export interface SupportTicket {
  id: string
  opener_id: string
  category: TicketCategory
  subject: string
  status: TicketStatus
  assigned_to: string | null
  resolution_note: string | null
  created_at: string
  updated_at: string
}

export interface SupportMessage {
  id: string
  ticket_id: string
  sender_id: string
  body: string
  created_at: string
}

export interface ContentEntry {
  id: string
  kind: 'faq' | 'notice' | 'page'
  title: string
  body: string
  published: boolean
  sort_order: number
  updated_at: string
}
