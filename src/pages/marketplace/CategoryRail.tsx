import { Link } from 'react-router-dom'
import { Building2, LayoutGrid } from 'lucide-react'
import { COMMODITY_GROUPS } from '@/lib/nigeria'
import { CATEGORY_ICONS } from '@/pages/marketplace/categoryIcons'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'

/**
 * Left category rail — the real commodity taxonomy grouped for browsing. No
 * livestock, no invented categories. Selecting a group filters the grid; the
 * Directory link points to the real logistics/storage surface.
 */
export function CategoryRail({
  activeGroup,
  onSelect,
  directoryHref,
}: {
  activeGroup: string | null
  onSelect: (groupKey: string | null) => void
  /** Directory link target. Omit on the public (signed-out) surface. */
  directoryHref?: string
}) {
  const { t } = useT()
  return (
    <nav aria-label={t('marketplace.categoriesAria')} className="rounded border border-line bg-white p-2">
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={cn(
          'flex min-h-touch w-full items-center gap-2 rounded px-2.5 py-2 text-sm font-medium transition-colors',
          activeGroup === null ? 'bg-emerald-800 text-white' : 'text-emerald-900 hover:bg-emerald-50',
        )}
      >
        <LayoutGrid className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden />
        {t('marketplace.allCategoriesLabel')}
      </button>

      <div className="my-1 h-px bg-line" />

      {COMMODITY_GROUPS.map((g) => {
        const Icon = CATEGORY_ICONS[g.icon] ?? LayoutGrid
        const active = activeGroup === g.key
        return (
          <button
            key={g.key}
            type="button"
            onClick={() => onSelect(active ? null : g.key)}
            className={cn(
              'flex min-h-touch w-full items-center gap-2 rounded px-2.5 py-2 text-sm font-medium transition-colors',
              active ? 'bg-emerald-800 text-white' : 'text-emerald-900 hover:bg-emerald-50',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden />
            <span className="flex-1 text-left">{g.label}</span>
          </button>
        )
      })}

      {directoryHref && (
        <>
          <div className="my-1 h-px bg-line" />
          <Link
            to={directoryHref}
            className="flex min-h-touch items-center gap-2 rounded px-2.5 py-2 text-sm font-medium text-emerald-900 transition-colors hover:bg-emerald-50"
          >
            <Building2 className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden />
            {t('marketplace.storageAndLogistics')}
          </Link>
        </>
      )}
    </nav>
  )
}
