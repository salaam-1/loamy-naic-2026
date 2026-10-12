import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Boxes, Info, Package, Route as RouteIcon, ShieldCheck, Store, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { NIGERIA_STATES } from '@/lib/nigeria'
import {
  BATCH_STATUS_META, BATCH_VERIFICATION_META,
  fetchListedQuantities, fetchMyBatches, listBatch, listableQuantity, listingBlocker, unlistBatch,
  type CommodityBatch,
} from '@/lib/stock'
import { cn, formatDateShort, formatNaira } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

interface BatchListing {
  id: string
  batch_id: string
  quantity_kg: number
  price_per_unit: number
  status: string
  created_at: string
}

interface SellForm {
  quantity: string
  price: string
  state: string
  lga: string
  description: string
  available_from: string
}

/**
 * My Stock — the batches a member holds, and the only route in the product
 * from stock to a traceable listing.
 *
 * Why this screen exists at all: the audit found nothing under src/ touching
 * `commodity_batches`. A listing created through the ordinary listing form is
 * `seller_declared` — a claim. A listing created here is `batch_backed`,
 * which is what Trace walks, what verification attaches to, and what a buyer
 * can check rather than believe.
 *
 * TWO HONESTIES THIS SCREEN KEEPS
 *
 *   1. Commercial status and verification status are separate axes and are
 *      shown separately. A batch can be listed and unverified. Collapsing
 *      them into one badge would have to misrepresent one of them.
 *
 *   2. A seller cannot request verification of their own stock, and this
 *      screen says so instead of offering a button that fails.
 *      `loamy_request_listing_verification` refuses the seller by design:
 *      verification is something a BUYER asks Loamy for, so that the party
 *      being checked is never the party commissioning the check.
 */
/*
 * NOTE: this renders NO shell of its own.
 *
 * It is reached only through RoleDashboard, which already wraps every
 * section in AppShell. Wrapping again in RoleShell (which is itself an
 * AppShell) nested two shells and painted TWO complete Loamy headers,
 * one directly above the other, on mobile. RoleShell is for DEEP ROUTES
 * that are not inside RoleDashboard, such as the listing detail and
 * editor, and those keep it.
 *
 * No authorization is lost: RoleDashboard enforces the auth guard and the
 * section role list, and this call site never passed allowedRoles.
 */
export default function MyStock() {
  const [batches, setBatches] = useState<CommodityBatch[] | null>(null)
  const [listings, setListings] = useState<BatchListing[]>([])
  const [listedQty, setListedQty] = useState<Record<string, number>>({})
  const [sellFor, setSellFor] = useState<string | null>(null)
  const [form, setForm] = useState<SellForm>({ quantity: '', price: '', state: '', lga: '', description: '', available_from: '' })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const rows = await fetchMyBatches()
    setBatches(rows)
    const ids = rows.map((b) => b.id)
    setListedQty(await fetchListedQuantities(ids))
    if (ids.length > 0) {
      const { data } = await supabase
        .from('listings')
        .select('id, batch_id, quantity_kg, price_per_unit, status, created_at')
        .in('batch_id', ids)
        .eq('status', 'active')
      setListings((data as BatchListing[]) ?? [])
    } else {
      setListings([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function openSell(b: CommodityBatch) {
    setError(null)
    setNotice(null)
    setSellFor(b.id)
    setForm({
      quantity: String(listableQuantity(b, listedQty[b.id] ?? 0)),
      price: '',
      state: b.current_state ?? b.origin_state ?? '',
      lga: b.origin_lga ?? '',
      description: '',
      available_from: '',
    })
  }

  async function sell(e: FormEvent, b: CommodityBatch) {
    e.preventDefault()
    setError(null)
    const qty = Number(form.quantity)
    const price = Number(form.price)
    if (!Number.isFinite(qty) || qty <= 0) return setError('Quantity must be greater than zero.')
    if (!Number.isFinite(price) || price <= 0) return setError('Price must be greater than zero.')
    const free = listableQuantity(b, listedQty[b.id] ?? 0)
    if (qty > free) return setError(`Only ${free} ${b.unit} of this batch is free to list.`)

    setBusy(b.id)
    const { error: err } = await listBatch({
      batchId: b.id,
      quantity: qty,
      pricePerUnit: price,
      state: form.state || null,
      lga: form.lga.trim() || null,
      description: form.description.trim() || null,
      availableFrom: form.available_from || null,
    })
    setBusy(null)
    if (err) return setError(err)
    setSellFor(null)
    setNotice('Listed. Buyers will see this as traceable stock, not a declared claim.')
    await load()
  }

  async function removeListing(listingId: string) {
    setError(null)
    setBusy(listingId)
    const { error: err } = await unlistBatch(listingId)
    setBusy(null)
    if (err) return setError(err)
    await load()
  }

  // Defined once and rendered in EVERY state. RoleDashboard suppresses its own
  // page title for this section on the promise that the section always supplies
  // one; a loading or empty page is still a page, and it still needs a name.
  const heading = (
    <div>
      <h1 className="text-lg font-semibold text-emerald-950">My Stock</h1>
      <p className="mt-0.5 text-sm text-emerald-900/60">
        Batches you hold. Each one carries its origin, so a buyer can check where it came from
        instead of taking your word for it.
      </p>
    </div>
  )

  if (batches === null) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        {heading}
        <div className="h-40 animate-pulse rounded-card bg-white" aria-label="Loading stock" />
      </div>
    )
  }

  return (
    <>
      <div className="mx-auto max-w-3xl space-y-5">
        {heading}

        {notice && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {batches.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-8 text-center">
            <Boxes className="h-8 w-8 text-emerald-900/20" aria-hidden />
            <p className="max-w-md text-sm text-emerald-900/55">
              No batches yet. Record a harvest against a production cycle on your farm, then turn it
              into a batch - that is what gives your stock a reference buyers can trace.
            </p>
            <Link
              to="/dashboard/farmer/my-farm"
              className="text-sm font-semibold text-emerald-700 hover:text-emerald-800"
            >
              Go to My Farm →
            </Link>
          </Card>
        ) : (
          <div className="space-y-3">
            {batches.map((b) => {
              const free = listableQuantity(b, listedQty[b.id] ?? 0)
              const blocker = listingBlocker(b, listedQty[b.id] ?? 0)
              const mine = listings.filter((l) => l.batch_id === b.id)
              const status = BATCH_STATUS_META[b.status]
              const verif = BATCH_VERIFICATION_META[b.verification_status]
              return (
                <DashboardCard key={b.id} title={`${b.commodity} · ${Number(b.quantity)} ${b.unit}`}>
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn('rounded px-2.5 py-1 text-xs font-medium', status.chip)}>{status.label}</span>
                      <span className={cn('rounded px-2.5 py-1 text-xs font-medium', verif.chip)}>{verif.label}</span>
                      {b.ref && <span className="text-[11px] font-medium text-emerald-900/45">{b.ref}</span>}
                    </div>

                    <p className="text-xs text-emerald-900/60">
                      {b.origin_traced
                        ? 'Origin traced to your farm record'
                        : 'Origin declared, not traced'}
                      {b.origin_state && ` · ${b.origin_lga ? `${b.origin_lga}, ` : ''}${b.origin_state}`}
                      {b.quality_grade && ` · grade ${b.quality_grade}`}
                      {' · created '}{formatDateShort(b.created_at)}
                    </p>

                    <p className="flex items-center gap-1.5 text-xs text-emerald-900/70">
                      <Package className="h-3.5 w-3.5" aria-hidden />
                      {Number(b.available_quantity)} {b.unit} uncommitted
                      {(listedQty[b.id] ?? 0) > 0 && ` · ${listedQty[b.id]} ${b.unit} on the market`}
                      {free > 0 && ` · ${free} ${b.unit} free to list`}
                    </p>

                    {mine.length > 0 && (
                      <ul className="space-y-1.5">
                        {mine.map((l) => (
                          <li key={l.id} className="flex items-center justify-between gap-2 rounded-md bg-emerald-50/60 px-3 py-2 text-xs">
                            <span className="text-emerald-900/75">
                              {Number(l.quantity_kg)} {b.unit} at {formatNaira(Number(l.price_per_unit))} per {b.unit}
                            </span>
                            <Button size="sm" variant="ghost" loading={busy === l.id} onClick={() => removeListing(l.id)}>
                              <X className="h-3.5 w-3.5" aria-hidden /> Remove
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}

                    {sellFor === b.id ? (
                      <form onSubmit={(e) => sell(e, b)} className="space-y-3 rounded-lg border border-emerald-100 bg-emerald-50/40 p-4" noValidate>
                        <p className="text-xs font-semibold text-emerald-950">List this stock</p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <Label htmlFor={`q_${b.id}`}>Quantity ({b.unit}) *</Label>
                            <Input id={`q_${b.id}`} type="number" min={0} step="any" value={form.quantity} onChange={(e) => setForm((p) => ({ ...p, quantity: e.target.value }))} />
                          </div>
                          <div>
                            <Label htmlFor={`p_${b.id}`}>Price per {b.unit} (₦) *</Label>
                            <Input id={`p_${b.id}`} type="number" min={0} step="any" value={form.price} onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))} />
                          </div>
                          <div>
                            <Label htmlFor={`s_${b.id}`}>State</Label>
                            <Select id={`s_${b.id}`} value={form.state} onChange={(e) => setForm((p) => ({ ...p, state: e.target.value }))}>
                              <option value="">Use the batch's location</option>
                              {NIGERIA_STATES.map((st) => <option key={st} value={st}>{st}</option>)}
                            </Select>
                          </div>
                          <div>
                            <Label htmlFor={`l_${b.id}`}>LGA</Label>
                            <Input id={`l_${b.id}`} value={form.lga} onChange={(e) => setForm((p) => ({ ...p, lga: e.target.value }))} />
                          </div>
                          <div>
                            <Label htmlFor={`af_${b.id}`}>Available from</Label>
                            <Input id={`af_${b.id}`} type="date" value={form.available_from} onChange={(e) => setForm((p) => ({ ...p, available_from: e.target.value }))} />
                          </div>
                          <div className="sm:col-span-2">
                            <Label htmlFor={`d_${b.id}`}>Description</Label>
                            <Textarea id={`d_${b.id}`} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Condition, packaging, anything a buyer should know" />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button type="submit" size="sm" loading={busy === b.id}>Publish listing</Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => setSellFor(null)}>Cancel</Button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="outline" disabled={blocker !== null} onClick={() => openSell(b)}>
                          <Store className="h-3.5 w-3.5" aria-hidden /> List on marketplace
                        </Button>
                        {b.ref && (
                          <Link
                            to={`/trace/${encodeURIComponent(b.ref)}`}
                            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"
                          >
                            <RouteIcon className="h-3.5 w-3.5" aria-hidden /> View its trace
                          </Link>
                        )}
                      </div>
                    )}
                    {blocker && <p className="text-[11px] text-emerald-900/50">{blocker}</p>}
                  </div>
                </DashboardCard>
              )
            })}
          </div>
        )}

        {/* Said plainly rather than offered as a button that would be refused. */}
        <Card className="flex items-start gap-2.5 bg-emerald-50/50 p-4">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
          <div>
            <p className="text-xs font-semibold text-emerald-950">How stock gets verified</p>
            <p className="mt-0.5 text-[11px] text-emerald-900/65">
              You cannot commission a verification of your own stock - that is what would make it
              worthless. A buyer looking at one of your batch-backed listings asks Loamy to inspect,
              a field agent visits, and an independent reviewer decides. Listing traceable stock is
              what makes that possible.
            </p>
          </div>
        </Card>

        <p className="flex items-start gap-1.5 text-[11px] text-emerald-900/45">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          Batches are created from a recorded harvest on a farm you own. Stock bought in from
          elsewhere cannot yet be entered as a batch.
        </p>
      </div>
    </>
  )
}
