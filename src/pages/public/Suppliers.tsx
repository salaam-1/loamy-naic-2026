import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Store, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { PublicSupplier } from '@/lib/marketplace'
import { PublicShell } from '@/pages/public/PublicShell'
import { VerifiedTag } from '@/components/VerifiedTag'
import { Input } from '@/components/ui/input'

/**
 * Public suppliers directory (route: /suppliers). Real sellers with active
 * listings, aggregated from the anon-safe loamy_public_suppliers view. Verified
 * sellers first, then by number of active listings. No fabricated vendors.
 */
export default function Suppliers() {
  const [rows, setRows] = useState<PublicSupplier[] | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    let cancelled = false
    supabase
      .from('loamy_public_suppliers')
      .select('*')
      .order('seller_verified', { ascending: false })
      .order('listing_count', { ascending: false })
      .limit(200)
      .then(({ data }) => { if (!cancelled) setRows((data as PublicSupplier[]) ?? []) })
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return rows ?? []
    return (rows ?? []).filter((s) =>
      (s.seller_display_name ?? '').toLowerCase().includes(term) ||
      (s.seller_category ?? '').toLowerCase().includes(term) ||
      (s.seller_state ?? '').toLowerCase().includes(term),
    )
  }, [rows, q])

  return (
    <PublicShell>
      <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-emerald-950">
            <Users className="h-5 w-5 text-emerald-800" strokeWidth={1.5} aria-hidden /> Suppliers
          </h1>
          <p className="mt-0.5 text-sm text-emerald-900/60">Verified sellers with active listings across Nigeria.</p>
        </div>

        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-900/35" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search suppliers by name, type or state…" className="pl-9" aria-label="Search suppliers" />
        </div>

        {rows === null ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (<div key={i} className="h-24 animate-pulse rounded border border-line bg-white" aria-hidden />))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center gap-2.5 rounded border border-line bg-white px-4 py-8">
            <Store className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden />
            <p className="text-sm text-emerald-900/60">
              {q ? 'No suppliers match your search.' : 'Suppliers appear here as verified sellers publish listings.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((s) => (
              <Link
                key={s.seller_id}
                to={`/suppliers/${s.seller_id}`}
                className="flex items-start gap-3 rounded border border-line bg-white p-3.5 transition-colors hover:bg-emerald-50/40"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-800 text-sm font-bold text-white">
                  {(s.seller_display_name ?? 'S').slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-semibold text-emerald-950">{s.seller_display_name ?? 'Loamy seller'}</p>
                    <VerifiedTag verified={s.seller_verified} />
                  </div>
                  <p className="mt-0.5 truncate text-xs text-emerald-900/55">
                    {s.seller_category ?? 'Seller'}{s.seller_state ? ` · ${s.seller_state}` : ''}
                  </p>
                  <p className="mt-1 text-[11px] font-medium text-emerald-700">
                    {Number(s.listing_count)} active listing{Number(s.listing_count) === 1 ? '' : 's'}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </PublicShell>
  )
}
