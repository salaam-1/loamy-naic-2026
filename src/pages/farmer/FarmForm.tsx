import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Crosshair, LocateFixed } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { COMMODITIES, NIGERIA_STATES } from '@/lib/nigeria'
import { OWNERSHIP_LABELS, OWNERSHIP_TYPES, type Farm, type OwnershipType } from '@/lib/farming'
import { FarmerShell } from '@/pages/farmer/FarmerShell'
import { FarmMap } from '@/components/FarmMap'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useT } from '@/lib/i18n'
import { MultiSelectChips } from '@/components/ui/multiselect'

interface FormState {
  farm_name: string
  state: string
  lga: string
  address_description: string
  size_hectares: string
  primary_crops: string[]
  ownership_type: OwnershipType
  latitude: string
  longitude: string
}

const BLANK: FormState = {
  farm_name: '',
  state: '',
  lga: '',
  address_description: '',
  size_hectares: '',
  primary_crops: [],
  ownership_type: 'owned',
  latitude: '',
  longitude: '',
}

/**
 * Add/edit a farm. GPS point captured via browser geolocation with two manual
 * fallbacks: click the map, or type coordinates. Editing another user's farm
 * is impossible — the RLS-scoped fetch simply returns nothing.
 */
export default function FarmForm() {
  const { t } = useT()
  const { farmId } = useParams()
  const navigate = useNavigate()
  const editing = Boolean(farmId)
  const [form, setForm] = useState<FormState>(BLANK)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!farmId) return
    let cancelled = false
    supabase
      .from('farms')
      .select('*')
      .eq('id', farmId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        if (!data) {
          setNotFound(true)
          return
        }
        const farm = data as Farm
        setForm({
          farm_name: farm.farm_name,
          state: farm.state,
          lga: farm.lga,
          address_description: farm.address_description ?? '',
          size_hectares: String(farm.size_hectares),
          primary_crops: farm.primary_crops,
          ownership_type: farm.ownership_type,
          latitude: farm.latitude === null ? '' : String(farm.latitude),
          longitude: farm.longitude === null ? '' : String(farm.longitude),
        })
      })
    return () => {
      cancelled = true
    }
  }, [farmId])

  const lat = form.latitude === '' ? null : Number(form.latitude)
  const lng = form.longitude === '' ? null : Number(form.longitude)
  const latValid = lat === null || (Number.isFinite(lat) && lat >= -90 && lat <= 90)
  const lngValid = lng === null || (Number.isFinite(lng) && lng >= -180 && lng <= 180)

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function captureGps() {
    setGpsError(null)
    if (!navigator.geolocation) {
      setGpsError('Geolocation is not available on this device - click the map or type coordinates instead.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        set('latitude', pos.coords.latitude.toFixed(6))
        set('longitude', pos.coords.longitude.toFixed(6))
      },
      (err) => {
        setLocating(false)
        setGpsError(
          err.code === err.PERMISSION_DENIED
            ? t('farm.locationDenied')
            : t('farm.locationFailed'),
        )
      },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const size = Number(form.size_hectares)
    if (!form.farm_name.trim()) return setError(t('farm.validation.nameRequired'))
    if (!form.state) return setError(t('farm.validation.stateRequired'))
    if (!form.lga.trim()) return setError(t('farm.validation.lgaRequired'))
    if (!Number.isFinite(size) || size <= 0) return setError(t('farm.validation.sizePositive'))
    if (form.primary_crops.length === 0) return setError(t('farm.validation.cropsRequired'))
    if (!latValid || !lngValid) return setError(t('farm.validation.coordinatesRange'))
    if ((lat === null) !== (lng === null)) return setError(t('farm.validation.bothCoordinates'))

    setSaving(true)
    const { data: userData } = await supabase.auth.getUser()
    const payload = {
      owner_id: userData.user?.id,
      farm_name: form.farm_name.trim(),
      state: form.state,
      lga: form.lga.trim(),
      address_description: form.address_description.trim() || null,
      size_hectares: size,
      primary_crops: form.primary_crops,
      ownership_type: form.ownership_type,
      latitude: lat,
      longitude: lng,
    }

    const result = editing
      ? await supabase.from('farms').update(payload).eq('id', farmId!).select('id').maybeSingle()
      : await supabase.from('farms').insert(payload).select('id').maybeSingle()

    setSaving(false)
    if (result.error || !result.data) {
      setError(result.error?.message ?? t('farm.couldNotSave'))
      return
    }
    navigate(`/dashboard/farmer/my-farm/${result.data.id}`, { replace: true })
  }

  if (notFound) {
    return (
      <FarmerShell section="my-farm">
        <Card className="p-8 text-center text-sm text-emerald-900/60">
          This farm does not exist or is not yours.
        </Card>
      </FarmerShell>
    )
  }

  return (
    <FarmerShell section="my-farm">
      <form onSubmit={onSubmit} className="mx-auto max-w-3xl space-y-5" noValidate>
        <h1 className="text-lg font-semibold text-emerald-950">
          {editing ? 'Edit farm' : 'Register a farm'}
        </h1>

        <Card className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="farm_name">{t('farm.farmName')}</Label>
              <Input id="farm_name" value={form.farm_name} onChange={(e) => set('farm_name', e.target.value)} placeholder={t('farm.namePlaceholder')} />
            </div>
            <div>
              <Label htmlFor="size">{t('farm.sizeHectares')}</Label>
              <Input id="size" type="number" min={0} step="any" value={form.size_hectares} onChange={(e) => set('size_hectares', e.target.value)} placeholder="e.g. 2.5" />
            </div>
            <div>
              <Label htmlFor="state">{t('farm.state')}</Label>
              <Select id="state" value={form.state} onChange={(e) => set('state', e.target.value)}>
                <option value="" disabled>{t('farm.selectState')}</option>
                {NIGERIA_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="lga">{t('farm.lga')}</Label>
              <Input id="lga" value={form.lga} onChange={(e) => set('lga', e.target.value)} placeholder={t('farm.lgaPlaceholder')} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="address">{t('farm.addressDirections')}</Label>
              <Textarea id="address" value={form.address_description} onChange={(e) => set('address_description', e.target.value)} placeholder={t('farm.directionsPlaceholder')} />
            </div>
            <div>
              <Label htmlFor="ownership">{t('farm.ownership')}</Label>
              <Select id="ownership" value={form.ownership_type} onChange={(e) => set('ownership_type', e.target.value as OwnershipType)}>
                {OWNERSHIP_TYPES.map((t) => (
                  <option key={t} value={t}>{OWNERSHIP_LABELS[t]}</option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <Label>{t('farm.primaryCrops')}</Label>
            <MultiSelectChips options={COMMODITIES} value={form.primary_crops} onChange={(v) => set('primary_crops', v)} />
          </div>
        </Card>

        <Card className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-emerald-950">{t('farm.farmLocation')}</p>
              <p className="text-xs text-emerald-900/55">
                {t('farm.gpsHint')}
              </p>
            </div>
            {/* Not `sm`. That variant is the dense 32px one for table rows;
                this is the only way to capture GPS on the farm form, used
                one-handed in a field. */}
            <Button type="button" variant="outline" onClick={captureGps} loading={locating}>
              <LocateFixed className="h-4 w-4" aria-hidden /> {t('farm.useMyLocation')}
            </Button>
          </div>

          {gpsError && <p className="text-xs text-amber-700">{gpsError}</p>}

          <FarmMap
            latitude={latValid ? lat : null}
            longitude={lngValid ? lng : null}
            onPick={(pLat, pLng) => {
              set('latitude', String(pLat))
              set('longitude', String(pLng))
            }}
            className="h-56 overflow-hidden rounded-lg"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="lat">{t('farm.latitude')}</Label>
              <Input id="lat" inputMode="decimal" value={form.latitude} onChange={(e) => set('latitude', e.target.value)} placeholder="e.g. 11.085541" />
            </div>
            <div>
              <Label htmlFor="lng">{t('farm.longitude')}</Label>
              <Input id="lng" inputMode="decimal" value={form.longitude} onChange={(e) => set('longitude', e.target.value)} placeholder="e.g. 7.719945" />
            </div>
          </div>
          {(lat !== null || lng !== null) && (
            <p className="flex items-center gap-1 text-xs text-emerald-900/55">
              <Crosshair className="h-3.5 w-3.5" aria-hidden />
              {latValid && lngValid && lat !== null && lng !== null
                ? `Pinned at ${lat}, ${lng}`
                : t('farm.coordinatesIncomplete')}
            </p>
          )}
        </Card>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <div className="flex gap-3">
          <Button type="submit" loading={saving}>{editing ? t('farm.saveChanges') : 'Register farm'}</Button>
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>Cancel</Button>
        </div>
      </form>
    </FarmerShell>
  )
}
