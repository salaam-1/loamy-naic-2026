import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  body: string
  action?: { label: string; onClick: () => void }
  className?: string
}

/** Compact empty state: one line + one action. No illustrations, no hero. */
export function EmptyState({ icon: Icon, title, body, action, className }: EmptyStateProps) {
  return (
    <Card className={cn('flex flex-wrap items-center justify-between gap-3 px-4 py-4', className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        <Icon className="h-5 w-5 shrink-0 text-emerald-700" strokeWidth={1.5} aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium text-emerald-950">{title}</p>
          <p className="mt-0.5 text-[13px] leading-snug text-emerald-900/55">{body}</p>
        </div>
      </div>
      {action && (
        /* Not `sm`. The `sm` variant is the dense 32px one meant for a table
           row, where it sits among many siblings; here it is the only way
           forward on an otherwise empty screen, so it takes the full target. */
        <Button onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </Card>
  )
}
