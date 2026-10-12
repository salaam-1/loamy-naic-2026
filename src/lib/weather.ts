/**
 * Weather presentation + the forecast entry point.
 *
 * The HTTP call moved to `src/lib/providers/weather.ts` in the platform
 * completion sprint. Open-Meteo is still the default adapter and still needs
 * no key, so behaviour is unchanged — what changed is that the farm pages no
 * longer name a vendor, and swapping to a licensed provider before commercial
 * launch is a registration call rather than an edit here.
 *
 * FORECAST ONLY: no soil metrics and no composite "farm health" score. There
 * is no soil data source, and inventing one would violate the real-data-only
 * rule.
 *
 * HANDOFF NOTE: Open-Meteo's free tier is for NON-COMMERCIAL use. A paid tier
 * or another licensed provider is required before live commercial operations.
 * See docs/external-integration-contract.md.
 */
import { weatherProvider, type DailyForecast } from '@/lib/providers/weather'

export type { DailyForecast }

/** WMO weather-code → short label + emoji glyph (no external icon fetch). */
const WMO: Record<number, { label: string; glyph: string }> = {
  0: { label: 'Clear', glyph: '☀️' },
  1: { label: 'Mainly clear', glyph: '🌤️' },
  2: { label: 'Partly cloudy', glyph: '⛅' },
  3: { label: 'Overcast', glyph: '☁️' },
  45: { label: 'Fog', glyph: '🌫️' },
  48: { label: 'Rime fog', glyph: '🌫️' },
  51: { label: 'Light drizzle', glyph: '🌦️' },
  53: { label: 'Drizzle', glyph: '🌦️' },
  55: { label: 'Heavy drizzle', glyph: '🌧️' },
  61: { label: 'Light rain', glyph: '🌦️' },
  63: { label: 'Rain', glyph: '🌧️' },
  65: { label: 'Heavy rain', glyph: '🌧️' },
  66: { label: 'Freezing rain', glyph: '🌧️' },
  67: { label: 'Freezing rain', glyph: '🌧️' },
  71: { label: 'Light snow', glyph: '🌨️' },
  73: { label: 'Snow', glyph: '🌨️' },
  75: { label: 'Heavy snow', glyph: '❄️' },
  80: { label: 'Rain showers', glyph: '🌦️' },
  81: { label: 'Rain showers', glyph: '🌧️' },
  82: { label: 'Violent showers', glyph: '⛈️' },
  95: { label: 'Thunderstorm', glyph: '⛈️' },
  96: { label: 'Thunderstorm, hail', glyph: '⛈️' },
  99: { label: 'Thunderstorm, hail', glyph: '⛈️' },
}

export function describeCode(code: number): { label: string; glyph: string } {
  return WMO[code] ?? { label: 'Unknown', glyph: '·' }
}

/**
 * A 7-day forecast for a coordinate.
 *
 * Throws on failure so the caller renders an honest error state. Weather is
 * never fabricated: there is no cached-last-known value presented as current
 * and no interpolation across a gap, because a farmer deciding when to plant
 * is better served by "we could not reach the forecast" than by a plausible
 * number with no observation behind it.
 */
export async function fetchForecast(lat: number, lng: number): Promise<DailyForecast[]> {
  const result = await weatherProvider().forecast({ lat, lng, days: 7 })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
