import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle, ArrowLeft, Banknote, Building2, Check, ExternalLink, Info, Landmark,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { PublicShell } from '@/pages/public/PublicShell'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { useDiscoveryEvents } from '@/lib/useDiscoveryEvents'
import {
  ELIGIBILITY_DISCLAIMER, bankOffers, eligibilityLabel, type BankCapabilities,
} from '@/lib/financing'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'

interface Txn {
  id: string
  ref: string
  commodity: string
  quantity: number
  unit: string
  subtotal: number
  currency: string
  status: string
  seller_id: string
}

/**
 * Apply for financing against ONE purchase (route: /financing/apply/:txnId).
 *
 * The amount is derived from the transaction and shown, not typed. There is
 * deliberately no free-text amount field larger than the purchase: the whole
 * point of transaction-linked financing is that the request is "finance THIS
 * purchase", not "give me ₦5m".
 *
 * Loamy never states an approval, an amount you qualify for, or a rate. Every
 * one of those belongs to the institution.
 */
export default function FinancingApply() {
  const { txnId = '' } = useParams()
  const navigate = useNavigate()
  const { t } = useT()
  const record = useDiscoveryEvents('checkout')

  const [txn, setTxn] = useState<Txn | null | 'missing'>(null)
  const [partners, setPartners] = useState<BankCapabilities[] | null>(null)
  const [chosen, setChosen] = useState<string>('')
  const [hasAccount, setHasAccount] = useState<'yes' | 'no' | null>(null)
  const [accountRef, setAccountRef] = useState('')
  const [amount, setAmount] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase.from('transactions')
      .select('id, ref, commodity, quantity, unit, subtotal, currency, status, seller_id')
      .eq('id', txnId).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setTxn((data as Txn) ?? 'missing')
        if (data) setAmount(String(data.subtotal))
      })
    supabase.rpc('loamy_financing_partners').then(({ data }) => {
      if (!cancelled) setPartners((data as BankCapabilities[]) ?? [])
    })
    return () => { cancelled = true }
  }, [txnId])

  const bank = partners?.find((p) => p.bank_id === chosen) ?? null

  async function apply() {
    if (!chosen || txn === null || txn === 'missing') return
    setBusy(true); setError(null)

    const asked = Number(amount)
    const { error: rpcError } = await supabase.rpc('loamy_apply_financing_for_transaction', {
      p_transaction_id: txnId,
      p_bank_id: chosen,
      p_amount: Number.isFinite(asked) && asked > 0 ? asked : null,
    })
    setBusy(false)

    if (rpcError) { setError(rpcError.message); return }

    record('request_financing', {
      objectType: 'transaction', objectId: txnId,
      commodity: txn.commodity, quantity: txn.quantity, unit: txn.unit,
      metadata: { bank_id: chosen },
    })
    navigate(`/purchase/${txnId}`)
  }

  if (txn === null) {
    return (
      <PublicShell>
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
          <div className="h-32 animate-pulse rounded border border-line bg-white" aria-hidden />
        </div>
      </PublicShell>
    )
  }

  if (txn === 'missing') {
    return (
      <PublicShell>
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
          <Card className="p-8 text-center text-sm text-emerald-900/60">
            {t('financing.purchase.notAvailable')}
          </Card>
        </div>
      </PublicShell>
    )
  }

  const subtotal = Number(txn.subtotal)
  const asked = Number(amount)
  const overAsking = Number.isFinite(asked) && asked > subtotal

  return (
    <PublicShell>
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6">
        <Link
          to={`/purchase/${txnId}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> {t('financing.purchase.backToPurchase')}
        </Link>

        <header>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-emerald-950">
            <Banknote className="h-5 w-5 text-emerald-700" strokeWidth={1.5} aria-hidden />
            {t('financing.apply')}
          </h1>
          <p className="mt-0.5 text-sm text-emerald-900/60">
            {t('financing.purchase.subtitle')}
          </p>
        </header>

        {/* What is being financed — the economics, not a typed figure. */}
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-emerald-950">{t('financing.purchase.whatYouAreFinancing')}</h2>
          <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {/* The REF, the commodity, the quantity and the unit are the
                record itself and are never translated - only the labels are. */}
            <Row label={t('financing.purchase.reference')} value={txn.ref} mono />
            <Row label={t('financing.purchase.commodity')} value={txn.commodity} />
            <Row label={t('financing.purchase.quantity')} value={`${Number(txn.quantity).toLocaleString('en-NG')} ${txn.unit}`} mono />
            <Row
              label={t('financing.purchase.purchaseTotal')}
              value={`₦${subtotal.toLocaleString('en-NG')}`}
              mono
            />
          </dl>
        </Card>

        {/* Amount — derived, adjustable DOWN only. */}
        <Card className="p-4">
          <Label htmlFor="amount">{t('financing.purchase.howMuch')}</Label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Input
              id="amount" type="number" min="0" max={subtotal} step="any"
              value={amount} onChange={(e) => setAmount(e.target.value)}
              className="max-w-xs font-mono"
            />
            <Button variant="outline" size="sm" onClick={() => setAmount(String(subtotal))}>
              {t('financing.purchase.fullAmount')}
            </Button>
          </div>
          <p className={cn('mt-1 text-xs', overAsking ? 'text-amber-700' : 'text-emerald-900/55')}>
            {overAsking
              ? t('financing.purchase.cannotExceed', { total: `₦${subtotal.toLocaleString('en-NG')}` })
              : t('financing.purchase.amountHint')}
          </p>
        </Card>

        {/* Partner choice — capability-driven. */}
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-emerald-950">{t('financing.purchase.chooseInstitution')}</h2>
          <p className="mt-0.5 text-xs text-emerald-900/60">
            {t('financing.purchase.institutionNote')}
          </p>

          {partners === null ? (
            <div className="mt-3 h-16 animate-pulse rounded bg-emerald-900/5" aria-hidden />
          ) : partners.length === 0 ? (
            <p className="mt-3 text-sm text-emerald-900/60">
              {t('financing.purchase.noInstitutions')}
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {partners.map((p) => (
                <li key={p.bank_id}>
                  <button
                    type="button"
                    onClick={() => { setChosen(p.bank_id); setHasAccount(null) }}
                    aria-pressed={chosen === p.bank_id}
                    className={cn(
                      'flex w-full items-start gap-3 rounded border p-3 text-left transition-colors',
                      chosen === p.bank_id
                        ? 'border-emerald-700 bg-emerald-50/60'
                        : 'border-line bg-white hover:bg-emerald-50/40',
                    )}
                  >
                    <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" strokeWidth={1.5} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-emerald-950">{p.bank}</span>
                      <span className="mt-0.5 block text-xs text-emerald-900/60">
                        {bankOffers(p).join(' · ') || t('financing.purchase.acceptsApplications')}
                      </span>
                      {p.contact_note && (
                        <span className="mt-0.5 block text-[11px] text-emerald-900/45">{p.contact_note}</span>
                      )}
                    </span>
                    {chosen === p.bank_id && (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" strokeWidth={2} aria-hidden />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Bank account — Loamy collects the minimum and stores no BVN. */}
        {bank && (
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-emerald-950">
              {t('financing.purchase.haveAccount', { bank: bank.bank })}
            </h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant={hasAccount === 'yes' ? 'primary' : 'outline'}
                size="sm"
                onClick={() => setHasAccount('yes')}
              >
                {t('common.yes')}
              </Button>
              <Button
                variant={hasAccount === 'no' ? 'primary' : 'outline'}
                size="sm"
                onClick={() => setHasAccount('no')}
              >
                {t('financing.purchase.createOne')}
              </Button>
            </div>

            {hasAccount === 'yes' && (
              <div className="mt-3 space-y-1.5">
                <Label htmlFor="acct">{t('financing.purchase.accountRefLabel')}</Label>
                <Input
                  id="acct" value={accountRef} onChange={(e) => setAccountRef(e.target.value)}
                  placeholder={t('financing.purchase.accountRefPlaceholder')}
                  className="max-w-sm font-mono"
                />
                <p className="flex items-start gap-1.5 text-xs text-emerald-900/55">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
                  {t('financing.purchase.accountRefNote')}
                </p>
              </div>
            )}

            {hasAccount === 'no' && (
              <div className="mt-3">
                {bank.capabilities.account_opening && bank.capabilities.account_opening_url ? (
                  <>
                    <a
                      href={bank.capabilities.account_opening_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex min-h-touch items-center gap-1.5 rounded border border-line px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-50"
                    >
                      <Building2 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                      {t('financing.purchase.openAccountWith', { bank: bank.bank })}
                      <ExternalLink className="h-3 w-3" strokeWidth={1.5} aria-hidden />
                    </a>
                    <p className="mt-1.5 text-xs text-emerald-900/55">
                      {t('financing.purchase.openAccountNote')}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-emerald-900/60">
                    {t('financing.purchase.noAccountOpening')}
                  </p>
                )}
              </div>
            )}
          </Card>
        )}

        {/* Eligibility — words, never an amount. */}
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-emerald-950">{t('financing.purchase.yourLoamyRecord')}</h2>
          <p className="mt-1 text-sm text-emerald-900/80">
            {eligibilityLabel({ available: true })}
          </p>
          <p className="mt-1 text-xs text-emerald-900/55">{ELIGIBILITY_DISCLAIMER}</p>
        </Card>

        {error && (
          <Card className="flex items-start gap-2.5 border-amber-300 bg-amber-50/60 p-4">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" strokeWidth={1.5} aria-hidden />
            <p className="text-sm text-amber-900">{error}</p>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={apply} loading={busy} disabled={!chosen || overAsking || busy}>
            {t('financing.purchase.submitTo', {
              bank: bank?.bank ?? t('financing.purchase.theInstitution'),
            })}
          </Button>
          <p className="text-xs text-emerald-900/55">
            {t('financing.purchase.submitNote')}
          </p>
        </div>
      </div>
    </PublicShell>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line pb-1.5">
      <dt className="text-xs text-emerald-900/55">{label}</dt>
      <dd className={cn('text-sm text-emerald-950', mono && 'font-mono')}>{value}</dd>
    </div>
  )
}
