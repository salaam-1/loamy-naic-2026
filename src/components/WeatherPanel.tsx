import { useEffect, useState } from 'react'
import { CloudSun } from 'lucide-react'
import { describeCode, fetchForecast, type DailyForecast } from '@/lib/weather'
import { DashboardCard } from '@/components/DashboardCard'

/**
 * 7-day forecast for a farm's GPS point (Open-Meteo). Forecast only — no soil,
 * no farm-health score. Honest states: no coordinates → prompt; fetch error →
 * plain message; never fabricated weather.
 */
export function WeatherPanel({ latitude, longitude }: { latitude: number | null; longitude: number | null }) {
  const [days, setDays] = useState<DailyForecast[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (latitude === null || longitude === null) return
    let cancelled = false
    setError(null)
    setDays(null)
    fetchForecast(latitude, longitude)
      .then((d) => !cancelled && setDays(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load the forecast'))
    return () => {
      cancelled = true
    }
  }, [latitude, longitude])

  if (latitude === null || longitude === null) {
    return (
      <DashboardCard title="Weather forecast">
        <p className="py-1 text-sm text-emerald-900/55">
          Add this farm's location to see a 7-day forecast for the site.
        </p>
      </DashboardCard>
    )
  }

  return (
    <DashboardCard title="Weather forecast - 7 day">
      {error ? (
        <p className="flex items-center gap-1.5 py-1 text-sm text-emerald-900/55">
          <CloudSun className="h-4 w-4" aria-hidden /> {error}. Try again shortly.
        </p>
      ) : days === null ? (
        <div className="h-20 animate-pulse rounded bg-emerald-50" aria-label="Loading forecast" />
      ) : (
        <div className="overflow-x-auto">
          <div className="flex gap-2">
            {days.map((d) => {
              const w = describeCode(d.code)
              const day = new Date(d.date).toLocaleDateString('en-NG', { weekday: 'short' })
              return (
                <div key={d.date} className="flex min-w-[68px] flex-1 flex-col items-center rounded border border-line px-2 py-2 text-center">
                  <span className="text-[11px] font-medium text-emerald-900/60">{day}</span>
                  <span className="my-0.5 text-lg leading-none" title={w.label} aria-label={w.label}>{w.glyph}</span>
                  <span className="font-mono text-[12px] font-semibold text-emerald-950">{Math.round(d.tempMax)}°</span>
                  <span className="font-mono text-[10px] text-emerald-900/45">{Math.round(d.tempMin)}°</span>
                  <span className="mt-0.5 font-mono text-[10px] text-sky-600" title="Rain probability">💧{d.precipProb}%</span>
                </div>
              )
            })}
          </div>
          <p className="mt-2 text-[10px] text-emerald-900/40">
            Source: Open-Meteo · max/min °C, rain probability. Forecast only.
          </p>
        </div>
      )}
    </DashboardCard>
  )
}
