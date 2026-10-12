import { useCallback, useEffect, useMemo, useState } from 'react'
import { BadgeCheck, CheckCircle2, CircleDashed, Handshake, Info, Phone, SlidersHorizontal } from 'lucide-react'
import {
  DEFAULT_WEIGHTS, FACTOR_LABELS, fetchBidsForRfq, rankBids,
  type RankFactor, type RfqBid,
} from '@/lib/bids'
import {
  AWARD_STAGES, awardBids, awardStageIndex, discloseSupplierContact, fetchAwards,
  getSupplierContact, type RfqAward, type SupplierContact,
} from '@/lib/awards'
import { formatNaira, formatDateShort } from '@/lib/utils'
import { UNIT_SLUG } from '@/lib/rfqs'
import { useT } from '@/lib/i18n'
import { useErrorText } from '@/lib/useErrorText'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import AwardInspection from '@/pages/processor/AwardInspection'
import AwardEscrow from '@/pages/processor/AwardEscrow'

const FACTORS: RankFactor[] = ['price', 'delivery', 'distance', 'verification', 'track_record']

function Tracker({ status }: { status: RfqAward['status'] }) {
  const { tOr } = useT()
  const reached = awardStageIndex(status)
  return (
    <ol className="flex flex-wrap gap-x-3 gap-y-1">
      {AWARD_STAGES.map((stage, i) => {
        const done = i <= reached
        return (
          <li key={stage.slug} className="flex items-center gap-1 text-[11px]">
            <span className={`h-1.5 w-1.5 rounded-full ${done ? 'bg-emerald-600' : 'bg-emerald-900/20'}`} />
            <span className={done ? 'text-emerald-800' : 'text-emerald-900/40'}>
              {tOr(`processor.awardStage.${stage.slug}`, stage.en)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * Buyer view of an RFQ's bids: a transparent, reweightable ranking, plus (for
 * procurement roles) multi-supplier award and the contact-disclosure gate.
 *
 * "Proceed with supplier" records the buyer's intent and notifies the supplier;
 * it deliberately shows NO phone number. Contact details appear only once the
 * bid has been AWARDED (in the awards block above), which keeps the negotiation
 * on-platform instead of leaking a number off the back of a bid.
 */
export default function RfqBidsPanel({ rfq, canAward, canSettle = false }: {
  rfq: { id: string; delivery_state: string | null; delivery_deadline: string | null; unit: string; quantity: number }
  canAward: boolean
  canSettle?: boolean
}) {
  const { t, tOr, tPlural } = useT()
  const errorText = useErrorText()
  const unitLabel = (v: string) => tOr(`processor.unit.${UNIT_SLUG[v] ?? v}`, v)
  const factorLabel = (f: RankFactor) => tOr(`processor.bid.factor.${f}`, FACTOR_LABELS[f])
  const [bids, setBids] = useState<RfqBid[] | null>(null)
  const [awards, setAwards] = useState<RfqAward[]>([])
  const [error, setError] = useState<string | null>(null)
  const [weights, setWeights] = useState<Record<RankFactor, number>>(DEFAULT_WEIGHTS)
  const [showWeights, setShowWeights] = useState(false)
  const [qty, setQty] = useState<Record<string, string>>({})
  const [contacts, setContacts] = useState<Record<string, SupplierContact>>({})
  const [proceeded, setProceeded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [b, a] = await Promise.all([fetchBidsForRfq(rfq.id), fetchAwards(rfq.id)])
      setBids(b); setAwards(a)
    } catch (e) { setError(errorText(e, 'processor.bid.couldNotLoad', 'Could not load bids.')) }
  }, [rfq.id])

  useEffect(() => { void load() }, [load])

  const ranked = useMemo(() => (bids ? rankBids(bids, rfq, weights) : []), [bids, rfq, weights])
  const awardedBidIds = useMemo(() => new Set(awards.map((a) => a.bid_id)), [awards])
  const totalAwarded = awards.reduce((s, a) => s + Number(a.awarded_quantity), 0)
  const selectedCount = Object.values(qty).filter((v) => Number(v) > 0).length

  async function onAward() {
    setBusy(true); setError(null)
    try {
      const items = ranked
        .filter((r) => Number(qty[r.bid.id]) > 0)
        .map((r) => ({ bid_id: r.bid.id, quantity: Number(qty[r.bid.id]), price: r.bid.price_per_unit }))
      if (!items.length) return
      await awardBids(rfq.id, items)
      setQty({})
      await load()
    } catch (e) { setError(errorText(e, 'processor.bid.couldNotAward', 'Could not award.')) }
    finally { setBusy(false) }
  }

  /** Awarded suppliers only — pulls and shows the phone number. */
  async function reveal(supplierId: string) {
    setBusy(true); setError(null)
    try {
      const c = await getSupplierContact(rfq.id, supplierId)
      setContacts((m) => ({ ...m, [supplierId]: c }))
    } catch (e) { setError(errorText(e, 'processor.bid.couldNotReveal', 'Could not reveal contact.')) }
    finally { setBusy(false) }
  }

  /** Bid list: register intent and notify the supplier. No phone is shown. */
  async function proceed(supplierId: string) {
    setBusy(true); setError(null)
    try {
      await discloseSupplierContact(rfq.id, supplierId)
      setProceeded((m) => new Set(m).add(supplierId))
      await load()
    } catch (e) { setError(errorText(e, 'processor.bid.couldNotProceed', 'Could not proceed with this supplier.')) }
    finally { setBusy(false) }
  }

  if (error && bids === null) return <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
  if (bids === null) return <div className="h-24 animate-pulse rounded bg-emerald-50" aria-label={t('processor.bid.loading')} />

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {/* Awards + aggregate fulfilment */}
      {awards.length > 0 && (
        <div className="rounded border border-line bg-emerald-50/40 p-3">
          <div className="flex items-center justify-between text-[13px]">
            <span className="font-medium text-emerald-950">{tPlural('processor.bid.awardedAcross', awards.length, { count: awards.length })}</span>
            <span className="font-mono text-emerald-900/70">{t('processor.bid.progress', { awarded: totalAwarded, total: rfq.quantity, unit: unitLabel(rfq.unit) })}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-emerald-100">
            <div className="h-full bg-emerald-600" style={{ width: `${Math.min(100, (totalAwarded / rfq.quantity) * 100)}%` }} />
          </div>
          <ul className="mt-3 space-y-3">
            {awards.map((a) => {
              const c = contacts[a.supplier_id]
              return (
                <li key={a.id} className="rounded border border-line bg-white p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-emerald-950">{a.supplier_name?.trim() || t('processor.bid.supplierFallback')}</span>
                    <span className="font-mono text-[13px] text-emerald-900/70">{t('processor.bid.awardLine', { quantity: a.awarded_quantity, unit: unitLabel(rfq.unit), price: formatNaira(a.awarded_price) })}</span>
                  </div>
                  <div className="mt-2"><Tracker status={a.status} /></div>
                  <div className="mt-2"><AwardInspection awardId={a.id} canProcure={canAward} /></div>
                  <div className="mt-2"><AwardEscrow awardId={a.id} awardStatus={a.status} canSettle={canSettle} /></div>
                  <div className="mt-2">
                    {c ? (
                      <span className="inline-flex items-center gap-1.5 text-[13px] text-emerald-900/80">
                        <Phone className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> {c.phone || t('processor.bid.noPhoneOnFile')}
                      </span>
                    ) : (
                      <button onClick={() => reveal(a.supplier_id)} disabled={busy}
                        className="inline-flex items-center gap-1.5 text-[13px] text-emerald-700 hover:underline disabled:opacity-50">
                        <Phone className="h-3.5 w-3.5" aria-hidden /> {t('processor.bid.revealContact')}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {ranked.length === 0 ? (
        <div className="rounded border border-dashed border-line px-4 py-6 text-center text-sm text-emerald-900/55">
          {t('processor.bid.noneYet')}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] text-emerald-900/60">
              <span className="font-medium text-emerald-900/80">{t('processor.bid.rankedBy')}</span>{' '}
              {t('processor.bid.rankedByFactors')}
            </p>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setShowWeights((s) => !s)}>
                <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" aria-hidden /> {t('processor.bid.adjustWeights')}
              </Button>
              {canAward && selectedCount > 0 && (
                <Button size="sm" onClick={onAward} disabled={busy}>{busy ? t('processor.bid.awarding') : tPlural('processor.bid.awardN', selectedCount, { count: selectedCount })}</Button>
              )}
            </div>
          </div>

          {showWeights && (
            <div className="grid gap-3 rounded border border-line bg-emerald-50/40 p-3 sm:grid-cols-5">
              {FACTORS.map((f) => (
                <label key={f} className="block text-[12px]">
                  <span className="flex justify-between text-emerald-900/70"><span>{factorLabel(f)}</span><span className="font-mono">{Math.round(weights[f] * 100)}</span></span>
                  <input type="range" min="0" max="100" value={Math.round(weights[f] * 100)}
                    onChange={(e) => setWeights((w) => ({ ...w, [f]: Number(e.target.value) / 100 }))} className="mt-1 w-full accent-emerald-600" />
                </label>
              ))}
              <button onClick={() => setWeights(DEFAULT_WEIGHTS)} className="text-left text-[12px] text-emerald-700 hover:underline sm:col-span-5">{t('processor.bid.resetWeights')}</button>
            </div>
          )}

          <ol className="space-y-2.5">
            {ranked.map((r, i) => {
              const b = r.bid
              const isAwarded = awardedBidIds.has(b.id)
              return (
                <li key={b.id} className="rounded border border-line bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-950 text-[12px] font-semibold text-white">{i + 1}</span>
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium text-emerald-950">{b.supplier_name?.trim() || t('processor.bid.supplierFallback')}</span>
                          {b.supplier_verified ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700"><BadgeCheck className="h-3.5 w-3.5" aria-hidden /> {t('processor.bid.verified')}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-900/45"><CircleDashed className="h-3.5 w-3.5" aria-hidden /> {t('processor.bid.unverified')}</span>
                          )}
                          {isAwarded && <span className="rounded bg-[#faf4e6] px-1.5 py-0.5 text-[10px] font-medium text-[#8a6d24] ring-1 ring-[#e4cf9c]">{t('processor.bid.awardedBadge')}</span>}
                        </div>
                        <p className="mt-0.5 text-[12px] text-emerald-900/55">
                          {b.supplier_state ?? t('processor.bid.locationUnknown')}
                          {rfq.delivery_state && b.supplier_state && <> · {b.supplier_state === rfq.delivery_state ? t('processor.bid.inDeliveryState') : t('processor.bid.differentState')}</>}
                          {' · '}{b.completed_transactions > 0
                            ? tPlural('processor.bid.completedTransactions', b.completed_transactions, { count: b.completed_transactions })
                            : t('processor.bid.noCompletedTransactions')}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm font-semibold text-emerald-950">{formatNaira(b.price_per_unit)}<span className="text-[11px] font-normal text-emerald-900/50">/{b.unit}</span></p>
                      <p className="text-[12px] text-emerald-900/60">{t('processor.bid.availableLine', {
                        quantity: b.available_quantity,
                        unit: unitLabel(b.unit),
                        delivery: b.delivery_date
                          ? t('processor.bid.byDate', { date: formatDateShort(b.delivery_date) })
                          : t('processor.bid.noDate'),
                      })}</p>
                      <p className="mt-0.5 text-[11px] font-medium text-emerald-700">{t('processor.bid.score', { score: r.score })}</p>
                    </div>
                  </div>

                  <div className="mt-2.5 grid grid-cols-5 gap-1.5">
                    {FACTORS.map((f) => (
                      <div key={f} title={t('processor.bid.factorTooltip', {
                        factor: factorLabel(f),
                        pct: Math.round(r.factors[f] * 100),
                        weight: Math.round(weights[f] * 100),
                      })}>
                        <div className="h-1 overflow-hidden rounded-full bg-emerald-100"><div className="h-full bg-emerald-500" style={{ width: `${Math.round(r.factors[f] * 100)}%` }} /></div>
                        <p className="mt-1 truncate text-[10px] text-emerald-900/50">{factorLabel(f)}</p>
                      </div>
                    ))}
                  </div>

                  {b.note && <p className="mt-2 text-[12px] text-emerald-900/70">“{b.note}”</p>}

                  {canAward && !isAwarded && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
                      <label className="text-[12px] text-emerald-900/60">{t('processor.bid.awardLabel')}</label>
                      <Input type="number" min="0" max={b.available_quantity} value={qty[b.id] ?? ''}
                        onChange={(e) => setQty((m) => ({ ...m, [b.id]: e.target.value }))}
                        placeholder={String(b.available_quantity)} className="h-8 min-h-touch w-24 text-[13px]" />
                      <span className="text-[12px] text-emerald-900/50">{t('processor.bid.atPrice', { unit: unitLabel(rfq.unit), price: formatNaira(b.price_per_unit) })}</span>
                      <div className="flex-1" />
                      {proceeded.has(b.supplier_id) ? (
                        <span className="inline-flex items-center gap-1 text-[12px] text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {t('processor.bid.proceeding')}
                        </span>
                      ) : (
                        <button onClick={() => proceed(b.supplier_id)} disabled={busy}
                          className="inline-flex items-center gap-1 text-[12px] text-emerald-700 hover:underline disabled:opacity-50">
                          <Handshake className="h-3.5 w-3.5" aria-hidden /> {t('processor.bid.proceedWithSupplier')}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ol>

          <p className="flex items-center gap-1 text-[11px] text-emerald-900/45">
            <Info className="h-3 w-3" aria-hidden /> {t('processor.bid.disclosureNote')}
          </p>
        </>
      )}
    </div>
  )
}
