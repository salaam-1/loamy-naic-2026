/**
 * WEATHER PROVIDER SEAM.
 *
 * Unlike the other seams in this directory, this one has a WORKING default:
 * Open-Meteo needs no key and is already used in production for the farm
 * forecast panel. The seam exists because the terms do not survive commercial
 * launch — Open-Meteo's free tier is non-commercial — so the provider has to
 * be swappable without touching the farm pages that render it.
 *
 * THE RULE
 *   Weather is never invented. If the provider fails, the caller renders an
 *   honest error state. There is no cached-last-known fallback presented as
 *   current, and no interpolation across a gap: a farmer deciding when to
 *   plant is better served by "we could not reach the forecast" than by a
 *   plausible number with no observation behind it.
 */
import {
  NOT_CONFIGURED, providerError,
  type ProviderInfo, type ProviderResult,
} from '@/lib/providers/types'

export interface DailyForecast {
  date: string
  /** WMO weather code. */
  code: number
  tempMax: number
  tempMin: number
  precipMm: number
  precipProb: number
  windMax: number
}

export interface ForecastRequest {
  lat: number
  lng: number
  /** Days ahead. Providers cap this; the adapter clamps rather than erroring. */
  days?: number
  signal?: AbortSignal
}

export interface WeatherProvider {
  readonly info: ProviderInfo
  forecast(req: ForecastRequest): Promise<ProviderResult<DailyForecast[]>>
}

/** Map an HTTP failure onto Loamy's own error vocabulary. */
function fromHttp(status: number): ReturnType<typeof providerError> {
  if (status === 401 || status === 403) {
    return providerError('unauthorized', 'The weather service rejected our credentials.', { providerCode: String(status) })
  }
  if (status === 429) {
    return providerError('rate_limited', 'The weather service is busy. Try again shortly.', { providerCode: '429' })
  }
  if (status >= 500) {
    return providerError('unavailable', 'The weather service is unavailable right now.', { providerCode: String(status) })
  }
  return providerError('unknown', 'The forecast could not be loaded.', { providerCode: String(status) })
}

/**
 * Open-Meteo. Free, keyless, NON-COMMERCIAL.
 *
 * Marked `live` because it returns real observations — the mode describes
 * whether the data is genuine, not whether the contract is commercial. The
 * licensing constraint is a deployment concern and is recorded in
 * `docs/external-integration-contract.md`, not hidden behind a mode flag.
 */
export const openMeteoProvider: WeatherProvider = {
  info: { key: 'open-meteo', label: 'Open-Meteo', mode: 'live' },

  async forecast({ lat, lng, days = 7, signal }) {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max',
      timezone: 'auto',
      forecast_days: String(Math.min(Math.max(days, 1), 16)),
    })

    let res: Response
    try {
      res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, { signal })
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError'
      return {
        ok: false,
        error: aborted
          ? providerError('timeout', 'The forecast request was cancelled.')
          : providerError('unavailable', 'Could not reach the weather service.'),
      }
    }

    if (!res.ok) return { ok: false, error: fromHttp(res.status) }

    const json = await res.json().catch(() => null)
    const d = (json as { daily?: Record<string, unknown[]> } | null)?.daily
    if (!d?.time) {
      // A 200 with no data is a provider bug, not an empty forecast. Saying
      // "no weather today" would be a fabrication.
      return { ok: false, error: providerError('unknown', 'The forecast came back empty.') }
    }

    const value = (d.time as string[]).map((date, i) => ({
      date,
      code: Number(d.weather_code[i]),
      tempMax: Number(d.temperature_2m_max[i]),
      tempMin: Number(d.temperature_2m_min[i]),
      precipMm: Number(d.precipitation_sum[i]),
      precipProb: Number(d.precipitation_probability_max[i]),
      windMax: Number(d.wind_speed_10m_max[i]),
    }))
    return { ok: true, value, mode: 'live' }
  },
}

export const noWeatherProvider: WeatherProvider = {
  info: { key: 'none', label: 'No weather provider', mode: 'disabled' },
  async forecast() {
    return { ok: false, error: NOT_CONFIGURED }
  },
}

let active: WeatherProvider = openMeteoProvider

export function setWeatherProvider(p: WeatherProvider): void {
  active = p
}

export function weatherProvider(): WeatherProvider {
  return active
}
