import { useCallback, useEffect, useMemo, useState } from 'react'
import { Store } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { fetchPublicProfiles, LISTING_STATUS_META, type Listing, type PublicProfile } from '@/lib/marketplace'
import { cn, formatDateShort, formatNaira } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'

/**
 * Admin oversight of marketplace listings (read-only; admin RLS already sees
 * all). Filter by status; identify seller. Moderation actions are out of
 * scope here — this is visibility.
 */
export default function AdminListingsOversight() {
  const [listings, setListings] = useState<Listing[] | null>(null)
  const [sellers, setSellers] = useState<Record<string, PublicProfile>>({})
  const [statusF, setStatusF] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('listings').select('*').order('created_at', { ascending: false }).limit(500)
    const rows = (data as Listing[]) ?? []
    setListings(rows)
    setSellers(await fetchPublicProfiles(rows.map((l) => l.seller_id)))
  }, [])

  useEffect(() => { void load() }, [load])

  async function moderate(l: Listing, action: 'remove' | 'restore') {
    if (action === 'remove' && !window.confirm(`Remove "${l.commodity}" from the marketplace? The seller is notified.`)) return
    setBusy(l.id)
    await supabase.rpc('loamy_admin_moderate_listing', { p_listing: l.id, p_action: action })
    setBusy(null)
    await load()
  }

  const filtered = useMemo(() => (listings ?? []).filter((l) => !statusF || l.status === statusF), [listings, statusF])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-base font-semibold text-emerald-950">
          Listings oversight <span className="font-mono text-sm font-normal text-emerald-900/50">{filtered.length}</span>
        </h1>
        <Select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="w-36" aria-label="Filter by status">
          <option value="">All statuses</option>
          {Object.entries(LISTING_STATUS_META).map(([k, v]) => (<option key={k} value={k}>{v.label}</option>))}
        </Select>
      </div>

      {listings === null ? (
        <div className="h-32 animate-pulse rounded bg-white" aria-label="Loading listings" />
      ) : filtered.length === 0 ? (
        <Card className="flex items-center gap-2.5 px-4 py-4">
          <Store className="h-5 w-5 text-emerald-700" aria-hidden />
          <p className="text-sm text-emerald-900/60">No listings match.</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                <th className="px-4 py-2 font-medium">Commodity</th>
                <th className="px-4 py-2 font-medium">Seller</th>
                <th className="px-4 py-2 font-medium">Qty</th>
                <th className="px-4 py-2 font-medium">Price</th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">State</th>
                <th className="hidden px-4 py-2 font-medium md:table-cell">Posted</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium"><span className="sr-only">Moderation</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2 font-medium text-emerald-950">{l.commodity}</td>
                  <td className="px-4 py-2 text-emerald-900/70">{sellers[l.seller_id]?.full_name ?? '-'}</td>
                  <td className="px-4 py-2 font-mono text-[13px]">{Number(l.quantity_kg)} {l.unit}</td>
                  <td className="px-4 py-2 font-mono text-[13px]">{formatNaira(Number(l.price_per_unit))}</td>
                  <td className="hidden px-4 py-2 text-emerald-900/70 sm:table-cell">{l.state}</td>
                  <td className="hidden px-4 py-2 text-emerald-900/70 md:table-cell">{formatDateShort(l.created_at)}</td>
                  <td className="px-4 py-2"><span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', LISTING_STATUS_META[l.status].chip)}>{LISTING_STATUS_META[l.status].label}</span></td>
                  <td className="px-4 py-2 text-right">
                    {l.status === 'expired' ? (
                      <Button size="sm" variant="outline" disabled={busy === l.id} onClick={() => moderate(l, 'restore')}>Restore</Button>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={busy === l.id} onClick={() => moderate(l, 'remove')}>Remove</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
