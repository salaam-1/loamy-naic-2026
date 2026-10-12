import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { SEQUENTIAL } from '@/lib/charts'
import { ChartSparse } from '@/components/charts/ChartSparse'
import { ChartTooltip } from '@/components/charts/ChartTooltip'

interface DonutSplitProps {
  data: { name: string; value: number }[]
  /** Sequential ramp (ordered stages) by default; pass explicit colors otherwise. */
  colors?: readonly string[]
  height?: number
}

/**
 * Donut for an ordered split (e.g. pipeline stages → sequential emerald ramp,
 * terminal stage in gold). 2px surface gaps between segments; center total;
 * legend beside (identity never color-alone).
 */
export function DonutSplit({ data, colors = SEQUENTIAL, height = 170 }: DonutSplitProps) {
  const nonZero = data.filter((d) => d.value > 0)
  const total = data.reduce((s, d) => s + d.value, 0)
  if (nonZero.length === 0) {
    return <ChartSparse facts={data.map((d) => ({ label: d.name, value: d.value }))} />
  }
  return (
    <div className="flex items-center gap-4">
      <div className="relative" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={nonZero}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="92%"
              stroke="#FFFFFF"
              strokeWidth={2}
              animationDuration={150}
            >
              {nonZero.map((d) => (
                <Cell key={d.name} fill={colors[data.findIndex((x) => x.name === d.name) % colors.length]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} isAnimationActive={false} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-xl font-semibold text-emerald-950">{total}</span>
          <span className="text-[10px] text-emerald-900/50">total</span>
        </div>
      </div>
      <ul className="space-y-1 text-xs">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colors[i % colors.length] }} aria-hidden />
            <span className="text-emerald-900/70">{d.name}</span>
            <span className="font-mono text-emerald-950">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
