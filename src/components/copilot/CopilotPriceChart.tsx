import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { AXIS_INK, GRID_STROKE, SERIES } from '@/lib/charts'
import { ymLabel } from '@/lib/copilot/analysis'
import type { CopilotChart } from '@/lib/copilot/types'

/**
 * Compact price-history chart for a Co-pilot answer: a single emerald line of
 * observed monthly averages, annotated with gold vertical markers for real
 * market_events. No trend line into the future — it only draws recorded points.
 */
export function CopilotPriceChart({ data }: { data: CopilotChart }) {
  if (data.points.length < 3) return null
  const isYm = (k: string) => /^\d{4}-\d{2}$/.test(k)
  const shortLabel = (k: string) => (isYm(k) ? k.replace('-', '·').slice(2) : k) // "24·07" or "Jul"

  return (
    <div className="mt-2 rounded border border-line bg-white p-2">
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={data.points} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="key" tick={{ fontSize: 9, fill: AXIS_INK }} tickFormatter={shortLabel} tickLine={false} axisLine={{ stroke: GRID_STROKE }} minTickGap={24} />
          <YAxis allowDecimals={false} tick={{ fontSize: 9, fill: AXIS_INK, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} width={40} />
          <Tooltip
            isAnimationActive={false}
            formatter={(v: number | string) => [`₦${Number(v).toLocaleString('en-NG')} ${data.unit}`, 'Avg']}
            labelFormatter={(k: string) => (isYm(k) ? ymLabel(k) : k)}
            contentStyle={{ fontSize: 11, borderRadius: 4, border: `1px solid ${GRID_STROKE}` }}
          />
          {data.events.map((e) => (
            <ReferenceLine
              key={`${e.at}-${e.label}`}
              x={e.at}
              stroke="#C8A045"
              strokeDasharray="2 2"
              label={{ value: e.label, position: 'top', fontSize: 8, fill: '#8A6D2F', angle: 0 }}
            />
          ))}
          <Line dataKey="price" stroke={SERIES[0]} strokeWidth={2} dot={false} activeDot={{ r: 3 }} animationDuration={150} />
        </LineChart>
      </ResponsiveContainer>
      {data.events.length > 0 && (
        <p className="mt-1 px-1 text-[10px] text-emerald-900/45">Gold markers: recorded market events.</p>
      )}
    </div>
  )
}
