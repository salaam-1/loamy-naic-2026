import { useEffect } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

// Vite bundling breaks Leaflet's default icon URL resolution; point it at the
// bundled assets explicitly.
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

/** Geographic centre of Nigeria — the default view before a point is set. */
const NIGERIA_CENTER: [number, number] = [9.082, 8.6753]

function ClickToPick({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)))
    },
  })
  return null
}

function RecenterOnChange({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap()
  useEffect(() => {
    map.setView([lat, lng], Math.max(map.getZoom(), 13))
  }, [lat, lng, map])
  return null
}

interface FarmMapProps {
  latitude: number | null
  longitude: number | null
  /** When set, clicking the map picks coordinates (manual-entry fallback). */
  onPick?: (lat: number, lng: number) => void
  className?: string
}

/**
 * Small embedded farm map — Leaflet + OpenStreetMap tiles (free, no API key).
 * SECURITY-REVIEW: renders precise farm GPS coordinates; only ever mount this
 * on owner/admin-scoped pages (RLS already restricts the data, but keep the
 * component off any public surface).
 */
export function FarmMap({ latitude, longitude, onPick, className }: FarmMapProps) {
  const hasPoint = latitude !== null && longitude !== null

  return (
    <div className={className}>
      <MapContainer
        center={hasPoint ? [latitude, longitude] : NIGERIA_CENTER}
        zoom={hasPoint ? 13 : 6}
        scrollWheelZoom={false}
        className="h-full w-full rounded-lg"
        style={{ minHeight: 220 }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {hasPoint && <Marker position={[latitude, longitude]} />}
        {hasPoint && <RecenterOnChange lat={latitude} lng={longitude} />}
        {onPick && <ClickToPick onPick={onPick} />}
      </MapContainer>
    </div>
  )
}
