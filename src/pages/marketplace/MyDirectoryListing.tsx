import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { NIGERIA_STATES } from '@/lib/nigeria'
import { lgasFor } from '@/lib/lgas'
import type { DirectoryEntry } from '@/lib/marketplace'
import { DashboardCard } from '@/components/DashboardCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

/**
 * Warehouse owners / logistics providers manage their single directory entry.
 * Contact requests arrive through the interest→accept pattern; direct contact
 * details are never published on the entry itself.
 */
export default function MyDirectoryListing() {
  const { profile } = useAuth()
  const serviceType = profile?.platform_role === 'warehouse_owner' ? 'warehouse' : 'logistics'
  const [existing, setExisting] = useState<DirectoryEntry | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [businessName, setBusinessName] = useState('')
  const [stateName, setStateName] = useState(profile?.state ?? '')
  const [lga, setLga] = useState('')
  const [address, setAddress] = useState('')
  const [capacityNote, setCapacityNote] = useState('')
  const [routesNote, setRoutesNote] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!profile) return
    let cancelled = false
    supabase
      .from('service_directory')
      .select('*')
      .eq('owner_id', profile.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        const entry = data as DirectoryEntry | null
        if (entry) {
          setExisting(entry)
          setBusinessName(entry.business_name)
          setStateName(entry.state)
          setLga(entry.lga ?? '')
          setAddress(entry.address ?? '')
          setCapacityNote(entry.capacity_note ?? '')
          setRoutesNote(entry.routes_note ?? '')
        }
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [profile])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setMsg(null)
    if (!businessName.trim()) return setMsg({ ok: false, text: 'Business name is required.' })
    if (!stateName) return setMsg({ ok: false, text: 'State is required.' })
    setSaving(true)
    const payload = {
      owner_id: profile.id,
      service_type: serviceType,
      business_name: businessName.trim(),
      state: stateName,
      lga: lga || null,
      address: address.trim() || null,
      capacity_note: capacityNote.trim() || null,
      routes_note: routesNote.trim() || null,
    }
    const { error } = existing
      ? await supabase.from('service_directory').update(payload).eq('id', existing.id)
      : await supabase.from('service_directory').insert(payload)
    setSaving(false)
    if (error) {
      setMsg({ ok: false, text: error.message })
      return
    }
    setMsg({ ok: true, text: existing ? 'Directory entry updated.' : 'You are now listed in the directory.' })
    if (!existing) {
      const { data } = await supabase.from('service_directory').select('*').eq('owner_id', profile.id).maybeSingle()
      setExisting(data as DirectoryEntry)
    }
  }

  if (!loaded) {
    return <div className="h-40 animate-pulse rounded-card bg-white" aria-label="Loading" />
  }

  return (
    <div className="mx-auto max-w-2xl">
      <DashboardCard title={existing ? 'My directory entry' : 'Join the service directory'}>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <p className="text-sm leading-relaxed text-emerald-900/60">
            Your entry is visible to all Loamy members. Interested parties request contact - you
            accept or decline, and arrangements conclude directly between you (Loamy handles no
            payments or bookings during the pilot).
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="biz">Business name *</Label>
              <Input id="biz" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder={serviceType === 'warehouse' ? 'e.g. Kaduna AgriStore' : 'e.g. Arewa Haulage'} />
            </div>
            <div>
              <Label htmlFor="svc">Service</Label>
              <Input id="svc" value={serviceType === 'warehouse' ? 'Warehouse / storage' : 'Logistics / haulage'} disabled />
            </div>
            <div>
              <Label htmlFor="dstate">State *</Label>
              <Select id="dstate" value={stateName} onChange={(e) => { setStateName(e.target.value); setLga('') }}>
                <option value="" disabled>Select state…</option>
                {NIGERIA_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="dlga">Local Government Area</Label>
              <Select id="dlga" value={lga} disabled={!stateName} onChange={(e) => setLga(e.target.value)}>
                <option value="">{stateName ? 'Select LGA…' : 'Choose a state first'}</option>
                {lgasFor(stateName).map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="daddr">Full address</Label>
            <Textarea
              id="daddr"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={serviceType === 'warehouse'
                ? 'e.g. Plot 14, Zaria Road Industrial Layout, beside Dangote depot, Kaduna North'
                : 'e.g. 8 Murtala Mohammed Way, opposite NNPC filling station, Kano'}
            />
            <p className="mt-1 text-xs text-emerald-900/50">
              Where the {serviceType === 'warehouse' ? 'facility' : 'yard / depot'} actually is.
              Visible to signed-in members browsing the directory.
            </p>
          </div>
          {serviceType === 'warehouse' ? (
            <div>
              <Label htmlFor="cap">Capacity & facilities</Label>
              <Textarea id="cap" value={capacityNote} onChange={(e) => setCapacityNote(e.target.value)} placeholder="e.g. 500t dry storage, 100t cold room, 24h security, loading bay" />
            </div>
          ) : (
            <>
              <div>
                <Label htmlFor="cap">Fleet & capacity</Label>
                <Textarea id="cap" value={capacityNote} onChange={(e) => setCapacityNote(e.target.value)} placeholder="e.g. 4 flatbed trucks (30t), 2 refrigerated vans" />
              </div>
              <div>
                <Label htmlFor="routes">Routes covered</Label>
                <Textarea id="routes" value={routesNote} onChange={(e) => setRoutesNote(e.target.value)} placeholder="e.g. Kano–Lagos weekly, Kaduna–Abuja daily" />
              </div>
            </>
          )}
          {msg && (
            <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800' : 'rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700'}>
              {msg.text}
            </p>
          )}
          <Button type="submit" loading={saving}>{existing ? 'Save changes' : 'Publish entry'}</Button>
        </form>
      </DashboardCard>
    </div>
  )
}
