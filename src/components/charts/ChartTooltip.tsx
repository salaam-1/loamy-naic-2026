import type { TooltipProps } from 'recharts'

/** Shared tooltip: flat card, values in JetBrains Mono, series dot for identity. */
export function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="rounded border border-line bg-white px-2.5 py-1.5 text-xs">
      {label !== undefined && <p className="mb-0.5 font-medium text-emerald-950">{label}</p>}
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-1.5 text-emerald-900/70">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} aria-hidden />
          {p.name}: <span className="font-mono text-emerald-950">{p.value}</span>
        </p>
      ))}
    </div>
  )
}
