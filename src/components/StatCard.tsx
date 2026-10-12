import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface StatCardProps {
  icon: LucideIcon
  label: string
  value: string | number
  sub: string
  loading?: boolean
  className?: string
}

/**
 * Compact stat tile. Values are ALWAYS real database state — zeros at launch
 * are correct, never seeded. Numbers render in the data font (JetBrains Mono).
 */
export function StatCard({ icon: Icon, label, value, sub, loading, className }: StatCardProps) {
  return (
    <Card className={cn('px-4 py-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-900/50">{label}</p>
        <Icon className="h-5 w-5 shrink-0 text-emerald-700/70" strokeWidth={1.5} aria-hidden />
      </div>
      {loading ? (
        <div className="mt-1.5 h-6 w-14 animate-pulse rounded-sm bg-emerald-50" aria-hidden />
      ) : (
        <p className="mt-1 truncate font-mono text-xl font-semibold tracking-tight text-emerald-950">
          {value}
        </p>
      )}
      <p className="mt-0.5 text-[11px] text-emerald-900/50">{sub}</p>
    </Card>
  )
}
