import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface DashboardCardProps {
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
}

/** Standard content card for dashboard sections: title row + body slot. */
export function DashboardCard({ title, action, children, className }: DashboardCardProps) {
  return (
    <Card className={cn(className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>{title}</CardTitle>
        {action}
      </CardHeader>
      {/* overflow-x-auto: wide tables scroll INSIDE the card instead of pushing
          the whole page sideways on narrow screens. No-op when content fits. */}
      <CardContent className="overflow-x-auto">{children}</CardContent>
    </Card>
  )
}
