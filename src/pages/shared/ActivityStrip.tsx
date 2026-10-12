import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { bucketWeekly, type WeekBucket } from '@/lib/charts'
import { DashboardCard } from '@/components/DashboardCard'
import { TrendLine } from '@/components/charts/TrendLine'

/**
 * Trading-role activity strip: listings posted / interests sent / deals
 * concluded per week — each series from the caller's OWN rows (RLS-scoped;
 * the chart query is the same boundary as the pages themselves).
 */
export function ActivityStrip() {
  const { profile } = useAuth()
  const [data, setData] = useState<WeekBucket[] | null>(null)

  useEffect(() => {
    if (!profile) return
    let cancelled = false
    async function load() {
      const [listingsRes, interestsRes] = await Promise.all([
        supabase.from('listings').select('created_at').eq('seller_id', profile!.id),
        supabase.from('listing_interests').select('created_at, updated_at, status').eq('buyer_id', profile!.id),
      ])
      if (cancelled) return
      const listings = (listingsRes.data ?? []) as { created_at: string }[]
      const interests = (interestsRes.data ?? []) as { created_at: string; updated_at: string; status: string }[]
      type Row = { kind: 'listing' | 'interest' | 'concluded'; at: string }
      const rows: Row[] = [
        ...listings.map((l) => ({ kind: 'listing' as const, at: l.created_at })),
        ...interests.map((i) => ({ kind: 'interest' as const, at: i.created_at })),
        ...interests
          .filter((i) => i.status === 'concluded_externally')
          .map((i) => ({ kind: 'concluded' as const, at: i.updated_at })),
      ]
      setData(
        bucketWeekly(rows, [
          { key: 'listings', date: (r) => (r.kind === 'listing' ? r.at : null) },
          { key: 'interests', date: (r) => (r.kind === 'interest' ? r.at : null) },
          { key: 'concluded', date: (r) => (r.kind === 'concluded' ? r.at : null) },
        ]),
      )
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [profile])

  if (data === null) return null
  return (
    <DashboardCard title="Marketplace activity (weekly)">
      <TrendLine
        data={data}
        series={[
          { key: 'listings', label: 'Listings posted' },
          { key: 'interests', label: 'Interests sent' },
          { key: 'concluded', label: 'Concluded' },
        ]}
      />
    </DashboardCard>
  )
}
