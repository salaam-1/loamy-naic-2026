import { Line, LineChart, ResponsiveContainer, Tooltip } from 'recharts'
import { MIN_SPARK_POINTS, SERIES } from '@/lib/charts'
import { ChartTooltip } from '@/components/charts/ChartTooltip'

interface SparklineProps {
  data: { label: string; value: number }[]
  width?: number
  height?: number
}

/**
 * Tiny inline trend. HARD sparse rule: fewer than MIN_SPARK_POINTS real
 * points renders NOTHING (the caller's number stands alone) — one or two
 * entries never fabricate a line.
 */
export function Sparkline({ data, width = 88, height = 26 }: SparklineProps) {
  if (data.length < MIN_SPARK_POINTS) return null
  return (
    <div style={{ width, height }} aria-label={`Trend over ${data.length} entries`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 3, right: 2, left: 2, bottom: 3 }}>
          <Tooltip content={<ChartTooltip />} isAnimationActive={false} />
          <Line dataKey="value" name="₦/kg" stroke={SERIES[0]} strokeWidth={2} dot={false} activeDot={{ r: 3 }} animationDuration={150} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
