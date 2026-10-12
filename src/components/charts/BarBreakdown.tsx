import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { AXIS_INK, GRID_STROKE, SERIES, SERIES_OTHER } from '@/lib/charts'
import { ChartSparse } from '@/components/charts/ChartSparse'
import { ChartTooltip } from '@/components/charts/ChartTooltip'

interface BarBreakdownProps {
  data: Record<string, string | number>[]
  xKey: string
  series: { key: string; label: string; other?: boolean }[]
  height?: number
  /** Fixed width instead of responsive — required inside the printed report. */
  width?: number
  minGroups?: number
}

/**
 * Grouped/single-series bars: 4px rounded data-ends anchored to the baseline,
 * 2px gaps, legend only when >1 series. Empty/sparse → honest totals.
 */
export function BarBreakdown({ data, xKey, series, height = 180, width, minGroups = 1 }: BarBreakdownProps) {
  const real = data.filter((d) => series.some((s) => Number(d[s.key]) > 0))
  if (real.length < minGroups) {
    return (
      <ChartSparse
        facts={series.map((s) => ({
          label: s.label,
          value: data.reduce((sum, d) => sum + (Number(d[s.key]) || 0), 0),
        }))}
      />
    )
  }
  const chart = (
    <BarChart data={data} width={width} height={width ? height : undefined} margin={{ top: 6, right: 8, left: -18, bottom: 0 }} barGap={2} barCategoryGap="24%">
      <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: AXIS_INK }} tickLine={false} axisLine={{ stroke: GRID_STROKE }} interval={0} />
      <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: AXIS_INK, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} width={38} />
      <Tooltip content={<ChartTooltip />} isAnimationActive={false} cursor={{ fill: 'rgba(1,77,64,0.04)' }} />
      {series.length > 1 && <Legend iconType="square" wrapperStyle={{ fontSize: 11 }} />}
      {series.map((s, i) => (
        <Bar
          key={s.key}
          dataKey={s.key}
          name={s.label}
          fill={s.other ? SERIES_OTHER : SERIES[i % SERIES.length]}
          radius={[4, 4, 0, 0]}
          maxBarSize={28}
          animationDuration={150}
        />
      ))}
    </BarChart>
  )
  if (width) return chart
  return <ResponsiveContainer width="100%" height={height}>{chart}</ResponsiveContainer>
}
