/**
 * MAPS / GEO PROVIDER SEAM.
 *
 * Loamy uses coordinates for three things that matter: showing a farm on a
 * map, validating that a Growth Partner's evidence was captured AT the farm,
 * and describing where stock came from. The first is presentation; the second
 * is a fraud control; the third is traceability.
 *
 * WHAT STAYS OUT OF A PROVIDER
 *   Distance and proximity checks are computed LOCALLY, by `haversineMetres`
 *   below, and are not a provider concern. A fraud control must not depend on
 *   a third party being reachable — an evidence check that silently passes
 *   because a geocoder timed out would be worse than no check. So the
 *   provider handles tiles and geocoding, and never adjudication.
 *
 * WHAT IS RENDERED TODAY
 *   React-Leaflet against OpenStreetMap tiles, keyless. OSM's tile policy is
 *   for modest, attributed use and is not a commercial CDN; that constraint
 *   is recorded in `docs/external-integration-contract.md`. A commercial tile
 *   provider replaces `tileTemplate` and nothing else.
 */
import {
  NOT_CONFIGURED, providerError,
  type ProviderInfo, type ProviderResult,
} from '@/lib/providers/types'

export interface LatLng {
  lat: number
  lng: number
}

export interface PlaceMatch {
  label: string
  lat: number
  lng: number
  /** Nigerian state, where the provider resolves one. */
  state?: string
  lga?: string
}

export interface TileConfig {
  /** Leaflet URL template. */
  template: string
  /** Required by OSM's policy and by most commercial licences. */
  attribution: string
  maxZoom: number
}

export interface GeoProvider {
  readonly info: ProviderInfo
  tiles(): TileConfig
  /** Free-text → coordinates. Optional: not every provider offers it. */
  geocode?(query: string): Promise<ProviderResult<PlaceMatch[]>>
  /** Coordinates → a human-readable place. Optional. */
  reverseGeocode?(at: LatLng): Promise<ProviderResult<PlaceMatch | null>>
}

/**
 * Distance in metres between two coordinates.
 *
 * Local, dependency-free and always available, because the evidence GPS check
 * depends on it. Haversine on a spherical earth is accurate to ~0.5% — far
 * better than consumer GPS accuracy, which is the actual limiting factor.
 */
export function haversineMetres(a: LatLng, b: LatLng): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Nigeria's bounding box, used to reject obviously impossible coordinates. */
const NIGERIA = { minLat: 4.0, maxLat: 14.0, minLng: 2.5, maxLng: 15.0 }

/**
 * Whether a coordinate could plausibly be in Nigeria.
 *
 * A cheap sanity check, not a border test: it catches a swapped lat/lng or a
 * default 0,0, which are the realistic data-entry failures. It must never be
 * the sole basis for rejecting someone's evidence.
 */
export function plausiblyNigeria({ lat, lng }: LatLng): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= NIGERIA.minLat && lat <= NIGERIA.maxLat &&
    lng >= NIGERIA.minLng && lng <= NIGERIA.maxLng
  )
}

export const openStreetMapProvider: GeoProvider = {
  info: { key: 'openstreetmap', label: 'OpenStreetMap', mode: 'live' },
  tiles: () => ({
    template: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }),
}

export const noGeoProvider: GeoProvider = {
  info: { key: 'none', label: 'No map provider', mode: 'disabled' },
  tiles: () => ({ template: '', attribution: '', maxZoom: 1 }),
  async geocode() {
    return { ok: false, error: NOT_CONFIGURED }
  },
}

let active: GeoProvider = openStreetMapProvider

export function setGeoProvider(p: GeoProvider): void {
  active = p
}

export function geoProvider(): GeoProvider {
  return active
}

/** Geocoding when the active provider supports it, and a clear refusal when not. */
export async function geocode(query: string): Promise<ProviderResult<PlaceMatch[]>> {
  const p = active
  if (!p.geocode) {
    return {
      ok: false,
      error: providerError('not_configured', 'Address search is not available.', { retryable: false }),
    }
  }
  return p.geocode(query)
}
