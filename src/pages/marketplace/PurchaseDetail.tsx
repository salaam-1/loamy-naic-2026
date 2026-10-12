import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertCircle, Banknote, Boxes, CheckCircle2, Route, ShieldCheck, Truck, Warehouse,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { PublicShell } from '@/pages/public/PublicShell'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { JourneyTracker } from '@/components/JourneyTracker'
import { FulfilmentPanel } from '@/components/fulfilment/FulfilmentPanel'
import {
  blockingReasons, decisionLabel, paymentLabel,
  type Journey, type Readiness,
} from '@/lib/financing'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'

/**
 * One purchase, end to end (route: /purchase/:txnId).
 *
 * Everything on this page is read from loamy_transaction_journey and the
 * readiness gate — nothing is inferred in the browser. If the tracker says a
 * stage is blocked, the database says so.
 */
export default function PurchaseDetail() {
  const { t } = useT()
  const { txnId = '' } = useParams()
  const [journey, setJourney] = useState<Journey | null | 'missing'>(null)
  // Set by checkout so this page can confirm what was just created. Read from
  // the URL rather than passed in state so a refresh does not lose it.
  const [params] = useSearchParams()
  const placed = Number(params.get('placed') ?? 0)
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('loamy_transaction_journey', { p_transaction_id: txnId })
    const j = data as Journey | null
    setJourney(j?.found ? j : 'missing')

    if (j?.found && j.financing) {
      const { data: app } = await supabase
        .from('financing_applications').select('id').eq('transaction_id', txnId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (app?.id) {
        const { data: r } = await supabase.rpc('loamy_settlement_readiness', {
          p_application_id: app.id,
        })
        setReadiness(r as Readiness)
      }
    }
  }, [txnId])

  useEffect(() => { void load() }, [load])

  async function confirmReceipt() {
    setBusy(true); setError(null)
    const { error: rpcError } = await supabase.rpc('loamy_transaction_transition', {
      p_transaction_id: txnId, p_event_type: 'received', p_machine: 'fulfilment',
    })
    setBusy(false)
    if (rpcError) { setError(rpcError.message); return }
    await load()
  }

  if (journey === null) {
    return (
      <PublicShell>
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
          <div className="h-40 animate-pulse rounded border border-line bg-white" aria-hidden />
        </div>
      </PublicShell>
    )
  }

  if (journey === 'missing') {
    return (
      <PublicShell>
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
          <Card className="p-8 text-center text-sm text-emerald-900/60">
            {t('financing.purchase.notAvailable')}
          </Card>
        </div>
      </PublicShell>
    )
  }

  const txn = journey.transaction
  const f = journey.financing
  const blockers = blockingReasons(readiness)
  const canArrangeTransport = txn.fulfilment_state === 'loaded'
  const canConfirm = txn.fulfilment_state === 'delivered'

  return (
    <PublicShell>
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-6 sm:px-6">
        {placed > 0 && (
          <div className="flex items-start gap-2.5 rounded-card border border-emerald-200 bg-emerald-50/70 px-4 py-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
            <p className="text-[13px] leading-relaxed text-emerald-900/80">
              <span className="font-semibold text-emerald-950">
                {placed === 1 ? 'Purchase created.' : `${placed} purchases created.`}
              </span>{' '}
              {placed === 1
                ? 'The seller has been notified and will confirm.'
                : 'One for each seller line in your cart. This is the first; the rest are in your purchases.'}
            </p>
          </div>
        )}

        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-emerald-950">
              {txn.commodity} - {Number(txn.quantity).toLocaleString('en-NG')} {txn.unit}
            </h1>
            <p className="mt-0.5 font-mono text-xs text-emerald-900/55">{txn.ref}</p>
          </div>
          <Link
            to={`/trace/${txn.ref}`}
            className="inline-flex h-10 min-h-touch items-center gap-1.5 rounded-control border border-clay bg-white px-3.5 text-[13px] font-medium text-emerald-800 hover:bg-sand"
          >
            <Route className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> {t('transaction.traceThisPurchase')}
          </Link>
        </header>

        <div className="grid gap-3 sm:grid-cols-3">
          <Fact icon={Boxes} label={t('transaction.purchaseTotal')}
                value={`₦${Number(txn.subtotal).toLocaleString('en-NG')}`} />
          <Fact icon={Banknote} label={t('transaction.payment')} value={paymentLabel(journey)} />
          {/* The agreement state is the server's own value, shown as it is. */}
          <Fact icon={ShieldCheck} label={t('transaction.agreement')} value={txn.status} />
        </div>

        {/* Financing summary — the institution's words, never Loamy's. */}
        {f && (
          <Card className="p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-emerald-950">{t('transaction.financing')}</h2>
              <span className="font-mono text-xs text-emerald-900/50">{f.ref}</span>
            </div>

            <p className="mt-1 text-sm text-emerald-900/80">{decisionLabel(f)}</p>

            {f.is_sandbox && (
              <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
                {t('transaction.sandboxDecision')}
              </p>
            )}

            <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
              <Amount label={t('transaction.requested')} value={f.amount_requested} />
              <Amount label={t('transaction.approved')} value={f.approved_amount} />
              <Amount label={t('transaction.settled')} value={f.disbursed_amount} />
            </dl>

            {f.repayment_status && (
              <p className="mt-2 border-t border-line pt-2 text-xs text-emerald-900/60">
                {t('transaction.repayment')}{' '}
                <strong className="font-medium text-emerald-900">{f.repayment_status}</strong>
                {' '}{t('transaction.repaymentTail')}
              </p>
            )}

            {blockers.length > 0 && (
              <div className="mt-3 rounded border border-amber-300 bg-amber-50/60 p-3">
                <p className="text-xs font-medium text-amber-900">
                  {t('transaction.settlementWaitingOn')}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {blockers.map((b) => (
                    <li key={b} className="text-xs text-amber-900/85">· {b}</li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        )}

        {!f && txn.status !== 'cancelled' && (
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-emerald-900/75">
              {t('transaction.payingDirectly')}
            </p>
            <Link to={`/financing/apply/${txnId}`}>
              <Button>
                <Banknote className="h-4 w-4" strokeWidth={1.5} aria-hidden /> {t('financing.apply')}
              </Button>
            </Link>
          </Card>
        )}

        {error && (
          <Card className="flex items-start gap-2.5 border-amber-300 bg-amber-50/60 p-4">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" strokeWidth={1.5} aria-hidden />
            <p className="text-sm text-amber-900">{error}</p>
          </Card>
        )}

        {/* Actions that are genuinely available right now. */}
        {/* The whole post-agreement spine: loading, transport offers and
            selection, storage, receipts, settlement. Everything here reads
            authoritative tables through loamy_transaction_fulfilment; nothing
            is inferred in the browser. Replaces a "next step" card that could
            only request transport, and a warehouse list with no way to ask
            for space. */}
        <FulfilmentPanel transactionId={txnId} onChanged={load} />

        <JourneyTracker journey={journey} />
      </div>
    </PublicShell>
  )
}

function Fact({ icon: Icon, label, value }: { icon: typeof Boxes; label: string; value: string }) {
  return (
    <Card className="flex items-start gap-2.5 p-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" strokeWidth={1.5} aria-hidden />
      <div className="min-w-0">
        <p className="text-xs text-emerald-900/55">{label}</p>
        <p className="truncate text-sm font-medium text-emerald-950">{value}</p>
      </div>
    </Card>
  )
}

/** A null amount is rendered as "-", never as ₦0. */
function Amount({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line pb-1.5">
      <dt className="text-xs text-emerald-900/55">{label}</dt>
      <dd className={cn('font-mono text-sm', value == null ? 'text-emerald-900/35' : 'text-emerald-950')}>
        {value == null ? '-' : `₦${Number(value).toLocaleString('en-NG')}`}
      </dd>
    </div>
  )
}
