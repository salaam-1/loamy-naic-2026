import { useState } from 'react'
import { PhoneCall } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { BANK_RAILS_COPY, type InterestContact } from '@/lib/marketplace'
import { Button } from '@/components/ui/button'

type Variant = 'interest' | 'booking'

const RPC: Record<Variant, { fn: string; param: string; parties: [string, string] }> = {
  interest: { fn: 'loamy_get_interest_contacts', param: 'p_interest_id', parties: ['buyer', 'seller'] },
  booking: { fn: 'loamy_get_booking_contacts', param: 'p_booking', parties: ['booker', 'owner'] },
}

/**
 * Post-acceptance contact exchange. Calls the security-definer disclosure
 * function — the server re-checks that the caller is a party AND that the
 * interest/booking is accepted; nothing is cached in app state beforehand.
 * SECURITY-REVIEW: keep this the only UI path that renders another user's
 * phone number.
 */
export function ContactReveal({
  interestId,
  viewer,
  variant = 'interest',
}: {
  interestId: string
  /** The caller's own party, so we show the OTHER party's details. */
  viewer: string
  variant?: Variant
}) {
  const [contacts, setContacts] = useState<InterestContact[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function reveal() {
    setError(null)
    setLoading(true)
    const spec = RPC[variant]
    const { data, error: rpcErr } = await supabase.rpc(spec.fn, { [spec.param]: interestId })
    setLoading(false)
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    setContacts((data as InterestContact[]) ?? [])
  }

  if (!contacts) {
    return (
      <div>
        <Button size="sm" variant="outline" onClick={reveal} loading={loading}>
          <PhoneCall className="h-3.5 w-3.5" aria-hidden /> View contact details
        </Button>
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      </div>
    )
  }

  const other = contacts.find((c) => c.party !== viewer)
  return (
    <div className="rounded border border-emerald-100 bg-emerald-50/60 p-3">
      <p className="text-sm font-semibold text-emerald-950">{other?.full_name ?? 'Counterparty'}</p>
      <p className="mt-0.5 font-mono text-sm text-emerald-800">{other?.phone ?? 'No phone on file'}</p>
      <p className="mt-2 text-[11px] leading-relaxed text-emerald-900/60">{BANK_RAILS_COPY}</p>
    </div>
  )
}
