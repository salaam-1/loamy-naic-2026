import { LayoutGrid } from 'lucide-react'
import { COMMODITY_GROUPS } from '@/lib/nigeria'
import { CATEGORY_ICONS } from '@/pages/marketplace/categoryIcons'
import { cn } from '@/lib/utils'

/**
 * Featured categories grid. Counts are REAL — the number of active listings in
 * each group, passed in from a live query. When a group has none, it honestly
 * reads "0 listings". No invented "120+ Products" figures.
 */
export function FeaturedCategories({
  counts,
  activeGroup,
  onSelect,
}: {
  counts: Record<string, number>
  activeGroup: string | null
  onSelect: (groupKey: string | null) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      {COMMODITY_GROUPS.map((g) => {
        const Icon = CATEGORY_ICONS[g.icon] ?? LayoutGrid
        const active = activeGroup === g.key
        const n = counts[g.key] ?? 0
        return (
          <button
            key={g.key}
            type="button"
            onClick={() => onSelect(active ? null : g.key)}
            className={cn(
              'flex flex-col items-start gap-2 rounded border p-3 text-left transition-colors',
              active ? 'border-emerald-800 bg-emerald-50' : 'border-line bg-white hover:bg-emerald-50',
            )}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded bg-emerald-800">
              <Icon className="h-5 w-5 text-white" strokeWidth={1.5} aria-hidden />
            </span>
            <span className="text-sm font-semibold text-emerald-950">{g.label}</span>
            <span className="text-xs text-emerald-900/55">{n} {n === 1 ? 'listing' : 'listings'}</span>
          </button>
        )
      })}
    </div>
  )
}
