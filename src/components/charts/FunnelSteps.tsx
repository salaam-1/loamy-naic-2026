import { SEQUENTIAL } from '@/lib/charts'
import { ChartSparse } from '@/components/charts/ChartSparse'

interface FunnelStepsProps {
  steps: { label: string; value: number }[]
}

/**
 * Horizontal bar-funnel: sequential emerald steps, widths proportional to the
 * FIRST step (true conversion view — never renormalized to look fuller).
 * Counts + percentages direct-labeled; zero steps render honestly at zero.
 */
export function FunnelSteps({ steps }: FunnelStepsProps) {
  const base = steps[0]?.value ?? 0
  if (base === 0) {
    return <ChartSparse facts={steps.map((s) => ({ label: s.label, value: s.value }))} />
  }
  return (
    <ol className="space-y-1.5">
      {steps.map((s, i) => {
        const pct = Math.round((s.value / base) * 100)
        return (
          <li key={s.label} className="flex items-center gap-2">
            <span className="w-32 shrink-0 text-xs text-emerald-900/70">{s.label}</span>
            <div className="relative h-6 flex-1 overflow-hidden rounded bg-emerald-50">
              <div
                className="h-full rounded transition-all duration-150"
                style={{ width: `${Math.max(pct, s.value > 0 ? 3 : 0)}%`, background: SEQUENTIAL[Math.min(i, SEQUENTIAL.length - 1)] }}
                role="img"
                aria-label={`${s.label}: ${s.value} (${pct}%)`}
              />
            </div>
            <span className="w-20 shrink-0 text-right font-mono text-[12px] text-emerald-950">
              {s.value} <span className="text-emerald-900/45">{pct}%</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
