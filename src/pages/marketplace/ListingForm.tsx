import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Boxes, ImagePlus, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { COMMODITIES, NIGERIA_STATES } from '@/lib/nigeria'
import {
  listingPhotoUrl,
  LISTING_UNITS,
  SELLER_ROLES,
  type Listing,
  type ListingUnit,
} from '@/lib/marketplace'
import { fetchListedQuantities, fetchMyBatches, listableQuantity, type CommodityBatch } from '@/lib/stock'
import { RoleShell } from '@/pages/shared/RoleShell'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const MAX_PHOTOS = 5

interface FormState {
  listing_type: 'commodity' | 'input'
  commodity: string
  quantity_kg: string
  unit: ListingUnit
  price_per_unit: string
  state: string
  lga: string
  description: string
  available_from: string
}

/**
 * Create/edit a listing with multi-photo upload. Input suppliers list inputs
 * (free-text category, flexible units); farmers/traders list commodities from
 * the fixed taxonomy (kg). Photos go to the seller's own storage folder.
 */
export default function ListingForm() {
  const { listingId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { profile } = useAuth()
  const editing = Boolean(listingId)
  const isInputSupplier = profile?.platform_role === 'input_supplier'

  const [form, setForm] = useState<FormState>({
    listing_type: isInputSupplier ? 'input' : 'commodity',
    commodity: '',
    quantity_kg: '',
    unit: 'kg',
    price_per_unit: '',
    state: profile?.state ?? '',
    lga: '',
    description: '',
    available_from: '',
  })
  // Stock the seller could list traceably instead. Offered, never forced:
  // a declared listing is legitimate, it just claims less.
  const [listableBatches, setListableBatches] = useState<CommodityBatch[]>([])
  const [existingPhotos, setExistingPhotos] = useState<string[]>([])
  const [newFiles, setNewFiles] = useState<File[]>([])
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isInputSupplier) return
    setForm((p) => ({ ...p, listing_type: 'input' }))
  }, [isInputSupplier])

  // Prefill from a Co-pilot draft (RFQ / "sell my produce"). The Co-pilot only
  // assembles a draft; nothing is written until the seller reviews & publishes.
  useEffect(() => {
    if (editing) return
    const draft = (location.state as { copilotDraft?: Record<string, string | number | null> } | null)?.copilotDraft
    if (!draft) return
    setForm((p) => ({
      ...p,
      commodity: draft.commodity != null ? String(draft.commodity) : p.commodity,
      quantity_kg: draft.quantity != null ? String(draft.quantity) : p.quantity_kg,
      price_per_unit: draft.price_expectation != null ? String(draft.price_expectation) : p.price_per_unit,
      state: draft.state != null ? String(draft.state) : p.state,
      unit: (LISTING_UNITS as readonly string[]).includes(String(draft.unit)) ? (String(draft.unit) as ListingUnit) : p.unit,
    }))
    // Run once on mount for a fresh listing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!listingId) return
    let cancelled = false
    supabase
      .from('listings')
      .select('*')
      .eq('id', listingId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        if (!data) {
          setNotFound(true)
          return
        }
        const l = data as Listing
        setForm({
          listing_type: l.listing_type,
          commodity: l.commodity,
          quantity_kg: String(Number(l.quantity_kg)),
          unit: l.unit,
          price_per_unit: String(Number(l.price_per_unit)),
          state: l.state,
          lga: l.lga ?? '',
          description: l.description ?? '',
          available_from: l.available_from ?? '',
        })
        setExistingPhotos(l.photos)
      })
    return () => {
      cancelled = true
    }
  }, [listingId])

  useEffect(() => {
    if (editing || isInputSupplier) return
    void (async () => {
      const rows = await fetchMyBatches()
      const listed = await fetchListedQuantities(rows.map((b) => b.id))
      setListableBatches(rows.filter((b) => listableQuantity(b, listed[b.id] ?? 0) > 0))
    })()
  }, [editing, isInputSupplier])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const totalPhotos = existingPhotos.length + newFiles.length

  function addFiles(files: FileList | null) {
    if (!files) return
    const imgs = [...files].filter((f) => f.type.startsWith('image/') && f.size <= 4 * 1024 * 1024)
    setNewFiles((prev) => [...prev, ...imgs].slice(0, MAX_PHOTOS - existingPhotos.length))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setError(null)
    const qty = Number(form.quantity_kg)
    const price = Number(form.price_per_unit)
    if (!form.commodity.trim()) return setError(form.listing_type === 'commodity' ? 'Select a commodity.' : 'Name the input product.')
    if (!Number.isFinite(qty) || qty <= 0) return setError('Quantity must be greater than zero.')
    if (!Number.isFinite(price) || price <= 0) return setError('Price must be greater than zero.')
    if (!form.state) return setError('State is required.')

    setSaving(true)

    // Upload new photos into the seller's own folder (policy-enforced).
    const uploadedPaths: string[] = []
    for (const [i, file] of newFiles.entries()) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
      const path = `${profile.id}/${Date.now()}-${i}.${ext}`
      const { error: upErr } = await supabase.storage.from('listing-photos').upload(path, file, { cacheControl: '3600' })
      if (upErr) {
        setSaving(false)
        setError(`Photo upload failed: ${upErr.message}`)
        return
      }
      uploadedPaths.push(path)
    }

    const payload = {
      seller_id: profile.id,
      listing_type: form.listing_type,
      commodity: form.commodity.trim(),
      quantity_kg: qty,
      unit: form.listing_type === 'commodity' ? ('kg' as ListingUnit) : form.unit,
      price_per_unit: price,
      state: form.state,
      lga: form.lga.trim() || null,
      description: form.description.trim() || null,
      available_from: form.available_from || null,
      photos: [...existingPhotos, ...uploadedPaths],
    }

    const result = editing
      ? await supabase.from('listings').update(payload).eq('id', listingId!).select('id').maybeSingle()
      : await supabase.from('listings').insert(payload).select('id').maybeSingle()

    setSaving(false)
    if (result.error || !result.data) {
      setError(result.error?.message ?? 'Could not save the listing.')
      return
    }
    navigate(`/dashboard/${profile.platform_role}/my-listings`, { replace: true })
  }

  return (
    <RoleShell section="my-listings" allowedRoles={SELLER_ROLES}>
      {notFound ? (
        <Card className="p-8 text-center text-sm text-emerald-900/60">
          This listing does not exist or is not yours.
        </Card>
      ) : (
        <form onSubmit={onSubmit} className="mx-auto max-w-2xl space-y-5" noValidate>
          <h1 className="text-lg font-semibold text-emerald-950">
            {editing ? 'Edit listing' : 'Create a listing'}
          </h1>

          {/* A listing made here is `seller_declared`: a claim a buyer has to
              take on trust. A listing made from a batch is `batch_backed` and
              carries its origin. Sellers were never told the difference
              existed, so almost nothing on the marketplace was traceable. */}
          {listableBatches.length > 0 && (
            <Card className="flex items-start gap-2.5 bg-emerald-50/60 p-4">
              <Boxes className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-emerald-950">
                  You have {listableBatches.length} batch{listableBatches.length === 1 ? '' : 'es'} ready to list
                </p>
                <p className="mt-0.5 text-[11px] text-emerald-900/65">
                  Listing from My Stock carries the batch's origin, so buyers can trace it and ask
                  Loamy to inspect it. A listing made on this form is seller-declared - perfectly
                  valid, but a buyer has only your word for it.
                </p>
                <Link
                  to={`/dashboard/${profile?.platform_role ?? 'farmer'}/my-stock`}
                  className="mt-1 inline-block text-[11px] font-semibold text-emerald-700 hover:text-emerald-800"
                >
                  List from My Stock instead →
                </Link>
              </div>
            </Card>
          )}

          <Card className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="ltype">Listing type</Label>
                <Select
                  id="ltype"
                  value={form.listing_type}
                  disabled={isInputSupplier || editing}
                  onChange={(e) => set('listing_type', e.target.value as FormState['listing_type'])}
                >
                  {/* Input suppliers sell inputs, so 'commodity' is not offered
                      to them at all - an unselectable option in a disabled
                      select just reads as a blocked form. */}
                  {!isInputSupplier && <option value="commodity">Commodity (produce)</option>}
                  {isInputSupplier && <option value="input">Input (fertilizer, seed, …)</option>}
                </Select>
              </div>
              <div>
                {form.listing_type === 'commodity' ? (
                  <>
                    <Label htmlFor="commodity">Commodity *</Label>
                    <Select id="commodity" value={form.commodity} onChange={(e) => set('commodity', e.target.value)}>
                      <option value="" disabled>Select…</option>
                      {COMMODITIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </Select>
                  </>
                ) : (
                  <>
                    <Label htmlFor="commodity">Input product *</Label>
                    <Input id="commodity" value={form.commodity} onChange={(e) => set('commodity', e.target.value)} placeholder="e.g. NPK Fertilizer 50kg" />
                  </>
                )}
              </div>
              <div>
                <Label htmlFor="qty">Quantity *</Label>
                <Input id="qty" type="number" min={0} step="any" value={form.quantity_kg} onChange={(e) => set('quantity_kg', e.target.value)} placeholder="e.g. 500" />
              </div>
              <div>
                <Label htmlFor="unit">Unit</Label>
                <Select id="unit" value={form.listing_type === 'commodity' ? 'kg' : form.unit} disabled={form.listing_type === 'commodity'} onChange={(e) => set('unit', e.target.value as ListingUnit)}>
                  {LISTING_UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="price">Price per unit (₦) *</Label>
                <Input id="price" type="number" min={0} step="any" value={form.price_per_unit} onChange={(e) => set('price_per_unit', e.target.value)} placeholder="e.g. 450" />
              </div>
              <div>
                <Label htmlFor="avail">Available from</Label>
                <Input id="avail" type="date" value={form.available_from} onChange={(e) => set('available_from', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="lstate">State *</Label>
                <Select id="lstate" value={form.state} onChange={(e) => set('state', e.target.value)}>
                  <option value="" disabled>Select state…</option>
                  {NIGERIA_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="llga">LGA</Label>
                <Input id="llga" value={form.lga} onChange={(e) => set('lga', e.target.value)} placeholder="e.g. Zaria" />
              </div>
            </div>
            <div>
              <Label htmlFor="desc">Description</Label>
              <Textarea id="desc" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Quality, variety, moisture content, packaging…" />
            </div>
          </Card>

          <Card className="space-y-3 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-emerald-950">Photos</p>
                <p className="text-xs text-emerald-900/55">Up to {MAX_PHOTOS}, max 4 MB each. Listings with photos get far more interest.</p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-50">
                <ImagePlus className="h-4 w-4" aria-hidden /> Add photos
                <input type="file" accept="image/*" multiple className="hidden" disabled={totalPhotos >= MAX_PHOTOS} onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
              </label>
            </div>
            {totalPhotos > 0 && (
              <div className="flex flex-wrap gap-2">
                {existingPhotos.map((p) => (
                  <div key={p} className="relative h-20 w-20 overflow-hidden rounded-lg">
                    <img src={listingPhotoUrl(p)} alt="" className="h-full w-full object-cover" />
                    <button type="button" onClick={() => setExistingPhotos((prev) => prev.filter((x) => x !== p))} className="absolute right-0.5 top-0.5 rounded-full bg-emerald-950/60 p-0.5 text-white hover:bg-emerald-950" aria-label="Remove photo">
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </div>
                ))}
                {newFiles.map((f, i) => (
                  <div key={i} className="relative h-20 w-20 overflow-hidden rounded-lg">
                    <img src={URL.createObjectURL(f)} alt="" className="h-full w-full object-cover" />
                    <button type="button" onClick={() => setNewFiles((prev) => prev.filter((_, j) => j !== i))} className="absolute right-0.5 top-0.5 rounded-full bg-emerald-950/60 p-0.5 text-white hover:bg-emerald-950" aria-label="Remove photo">
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <div className="flex gap-3">
            <Button type="submit" loading={saving}>{editing ? 'Save changes' : 'Publish listing'}</Button>
            <Button type="button" variant="ghost" onClick={() => navigate(-1)}>Cancel</Button>
          </div>
        </form>
      )}
    </RoleShell>
  )
}
