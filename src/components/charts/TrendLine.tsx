import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { AXIS_INK, GRID_STROKE, MIN_TREND_POINTS, SERIES, type WeekBucket, realPointCount } from '@/lib/charts'
import { ChartSparse } from '@/components/charts/ChartSparse'
import { ChartTooltip } from '@/components/charts/ChartTooltip'

interface TrendLineProps {
  data: WeekBucket[]
  series: { key: string; label: string }[]
  height?: number
  /** SPARSE-DATA RULE threshold (weeks with real activity). */
  minPoints?: number
}

/**
 * Weekly trend line. One axis; 2px lines; legend only when >1 series; below
 * the threshold it renders the honest totals instead of a fabricated line.
 */
export function TrendLine({ data, series, height = 180, minPoints = MIN_TREND_POINTS }: TrendLineProps) {
  const real = realPointCount(data, series.map((s) => s.key))
  if (real < minPoints) {
    return (
      <ChartSparse
        facts={series.map((s) => ({
          label: s.label,
          value: data.reduce((sum, b) => sum + ((b[s.key] as number) || 0), 0),
        }))}
      />
    )
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="week" tick={{ fontSize: 10, fill: AXIS_INK }} tickLine={false} axisLine={{ stroke: GRID_STROKE }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: AXIS_INK, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} width={38} />
        <Tooltip content={<ChartTooltip />} isAnimationActive={false} />
        {series.length > 1 && <Legend iconType="plainline" wrapperStyle={{ fontSize: 11 }} />}
        {series.map((s, i) => (
          <Line
            key={s.key}
            dataKey={s.key}
            name={s.label}
            stroke={SERIES[i % SERIES.length]}
            strokeWidth={2}
            dot={{ r: 2.5, strokeWidth: 0, fill: SERIES[i % SERIES.length] }}
            activeDot={{ r: 4 }}
            animationDuration={150}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
