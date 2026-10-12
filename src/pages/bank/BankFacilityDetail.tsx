import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Banknote, Plus, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { BANK_LIST_LIMIT } from '@/lib/limits'
import {
  REPAYMENT_STATUS_META,
  type Collateral, type DisbursementRecord, type Facility, type RepaymentInstalment,
} from '@/lib/bank'
import { cn, formatNaira } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { BankShell } from '@/pages/bank/BankShell'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DashboardCard } from '@/components/DashboardCard'
import { AmountReferenceDialog } from '@/components/AmountReferenceDialog'

/**
 * Facility servicing: record bank-confirmed disbursements and repayments, and
 * log collateral. Every figure is entered as a reference to what happened on
 * the bank's rails — Loamy executes nothing and holds nothing.
 */
export default function BankFacilityDetail() {
  const { t, tOr, dateShort } = useT()
  const sectorLabel = (v: string) => tOr(`bank.sector.${v}`, v)
  const facilityStatusLabel = (v: string) => tOr(`bank.facilityStatus.${v}`, v)
  const repaymentLabel = (st: RepaymentInstalment['status']) =>
    tOr(`bank.repaymentStatus.${st}`, REPAYMENT_STATUS_META[st].label)
  const { facilityId } = useParams()
  const [facility, setFacility] = useState<Facility | null | 'missing'>(null)
  const [disbursements, setDisbursements] = useState<DisbursementRecord[]>([])
  const [schedule, setSchedule] = useState<RepaymentInstalment[]>([])
  const [collateral, setCollateral] = useState<Collateral[]>([])
  const [borrowerName, setBorrowerName] = useState<string | null>(null)
  const [disb, setDisb] = useState({ amount: '', on: '', ref: '' })
  const [coll, setColl] = useState({ kind: '', description: '', value: '' })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [payingInst, setPayingInst] = useState<RepaymentInstalment | null>(null)

  const load = useCallback(async () => {
    if (!facilityId) return
    const [facRes, disbRes, schedRes, collRes] = await Promise.all([
      supabase.from('facilities').select('*').eq('id', facilityId).maybeSingle(),
      supabase.from('disbursement_records').select('*').eq('facility_id', facilityId)
        .order('disbursed_on', { ascending: false }).order('id', { ascending: true }).limit(BANK_LIST_LIMIT),
      supabase.from('repayment_schedule').select('*').eq('facility_id', facilityId)
        .order('due_date').order('id', { ascending: true }).limit(BANK_LIST_LIMIT),
      supabase.from('collateral').select('*').eq('facility_id', facilityId)
        .order('created_at', { ascending: false }).order('id', { ascending: true }).limit(BANK_LIST_LIMIT),
    ])
    const f: Facility | 'missing' = (facRes.data as Facility | null) ?? 'missing'
    setFacility(f)
    setDisbursements((disbRes.data as DisbursementRecord[]) ?? [])
    setSchedule((schedRes.data as RepaymentInstalment[]) ?? [])
    setCollateral((collRes.data as Collateral[]) ?? [])
    if (f !== 'missing') {
      const { data: pub } = await supabase.from('loamy_public_profiles').select('full_name').eq('id', f.borrower_id).maybeSingle()
      setBorrowerName((pub?.full_name as string) ?? null)
    }
  }, [facilityId])

  useEffect(() => {
    void load()
  }, [load])

  async function recordDisbursement(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const amount = Number(disb.amount)
    if (!Number.isFinite(amount) || amount <= 0) return setError(t('bank.facility.invalidAmount'))
    setBusy('disb')
    const { error: rpcErr } = await supabase.rpc('loamy_record_disbursement', {
      p_facility: facilityId, p_amount: amount, p_disbursed_on: disb.on || null, p_reference: disb.ref.trim() || null,
    })
    setBusy(null)
    if (rpcErr) return setError(rpcErr.message)
    setDisb({ amount: '', on: '', ref: '' })
    await load()
  }

  function recordRepayment(inst: RepaymentInstalment) {
    setPayingInst(inst)
  }

  async function addCollateral(e: FormEvent) {
    e.preventDefault()
    if (!facilityId || !coll.kind.trim()) return
    setBusy('coll')
    await supabase.from('collateral').insert({
      facility_id: facilityId, kind: coll.kind.trim(), description: coll.description.trim() || null,
      estimated_value: coll.value ? Number(coll.value) : null,
    })
    setBusy(null)
    setColl({ kind: '', description: '', value: '' })
    await load()
  }

  if (facility === null) {
    return <BankShell section="loans"><div className="h-32 animate-pulse rounded bg-white" aria-label={t('bank.facility.loading')} /></BankShell>
  }
  if (facility === 'missing') {
    return <BankShell section="loans"><Card className="p-6 text-center text-sm text-emerald-900/60">{t('bank.facility.notFound')}</Card></BankShell>
  }

  const disbursedTotal = disbursements.reduce((s, d) => s + Number(d.amount), 0)
  const repaidTotal = schedule.reduce((s, r) => s + Number(r.amount_paid ?? 0), 0)
  const outstanding = Number(facility.principal) - repaidTotal

  return (
    <BankShell section="loans">
      <div className="mx-auto max-w-3xl space-y-4">
        <Link to="/bank/loans" className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t('bank.facility.backToLoans')}
        </Link>

        <Card className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h1 className="font-mono text-base font-semibold text-emerald-950">{facility.id.slice(0, 8).toUpperCase()}</h1>
              <p className="text-xs text-emerald-900/55">{borrowerName ?? '-'} · {sectorLabel(facility.sector)} · {facility.structure} · {t('bank.facility.openedOn', { date: dateShort(facility.opened_on) })}</p>
            </div>
            <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', facility.status === 'active' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-emerald-950/5 text-emerald-900/55')}>{facilityStatusLabel(facility.status)}</span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              [t('bank.facility.principal'), formatNaira(Number(facility.principal))],
              [t('bank.facility.disbursed'), formatNaira(disbursedTotal)],
              [t('bank.facility.repaid'), formatNaira(repaidTotal)],
              [t('bank.facility.outstanding'), formatNaira(outstanding)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[10px] uppercase tracking-wide text-emerald-900/50">{k}</dt>
                <dd className="font-mono text-[13px] font-semibold text-emerald-950">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <DashboardCard title={t('bank.facility.disbursements')}>
          <form onSubmit={recordDisbursement} className="mb-3 grid gap-2 sm:grid-cols-[1fr_10rem_1fr_auto]" noValidate>
            <div><Label htmlFor="d_amt">{t('bank.facility.amount')}</Label><Input id="d_amt" type="number" min={0} value={disb.amount} onChange={(e) => setDisb({ ...disb, amount: e.target.value })} /></div>
            <div><Label htmlFor="d_on">{t('bank.facility.date')}</Label><Input id="d_on" type="date" value={disb.on} onChange={(e) => setDisb({ ...disb, on: e.target.value })} /></div>
            <div><Label htmlFor="d_ref">{t('bank.facility.bankReference')}</Label><Input id="d_ref" value={disb.ref} onChange={(e) => setDisb({ ...disb, ref: e.target.value })} placeholder={t('bank.facility.referencePlaceholder')} /></div>
            <div className="flex items-end"><Button size="sm" type="submit" loading={busy === 'disb'}><Banknote className="h-3.5 w-3.5" aria-hidden /> {t('bank.facility.record')}</Button></div>
          </form>
          {error && <p className="mb-2 text-xs text-red-700">{error}</p>}
          {disbursements.length === 0 ? (
            <p className="text-sm text-emerald-900/55">{t('bank.facility.noDisbursements')}</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {disbursements.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-emerald-900/70">{dateShort(d.disbursed_on)}{d.external_reference ? ` · ${d.external_reference}` : ''}</span>
                  <span className="font-mono text-[13px] text-emerald-950">{formatNaira(Number(d.amount))}</span>
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>

        <DashboardCard title={t('bank.facility.repaymentSchedule')}>
          {schedule.length === 0 ? (
            <p className="text-sm text-emerald-900/55">{t('bank.facility.noSchedule')}</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                  <th className="py-1.5 pr-3 font-medium">{t('bank.facility.colDue')}</th>
                  <th className="py-1.5 pr-3 font-medium">{t('bank.facility.colAmountDue')}</th>
                  <th className="py-1.5 pr-3 font-medium">{t('bank.facility.colPaid')}</th>
                  <th className="py-1.5 pr-3 font-medium">{t('bank.col.status')}</th>
                  <th className="py-1.5 font-medium"><span className="sr-only">{t('bank.facility.colAction')}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {schedule.map((r) => (
                  <tr key={r.id}>
                    <td className="py-1.5 pr-3 font-mono text-[13px]">{dateShort(r.due_date)}</td>
                    <td className="py-1.5 pr-3 font-mono text-[13px]">{formatNaira(Number(r.amount_due))}</td>
                    <td className="py-1.5 pr-3 font-mono text-[13px]">{r.amount_paid != null ? formatNaira(Number(r.amount_paid)) : '-'}</td>
                    <td className="py-1.5 pr-3"><span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', REPAYMENT_STATUS_META[r.status].chip)}>{repaymentLabel(r.status)}</span></td>
                    <td className="py-1.5 text-right">
                      {r.status !== 'paid' && (
                        <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => recordRepayment(r)}>{t('bank.facility.recordPayment')}</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DashboardCard>

        <DashboardCard title={t('bank.facility.collateral')}>
          <form onSubmit={addCollateral} className="mb-3 grid gap-2 sm:grid-cols-[1fr_1fr_10rem_auto]" noValidate>
            <div><Label htmlFor="c_kind">{t('bank.facility.kind')}</Label><Input id="c_kind" value={coll.kind} onChange={(e) => setColl({ ...coll, kind: e.target.value })} placeholder={t('bank.facility.kindPlaceholder')} /></div>
            <div><Label htmlFor="c_desc">{t('bank.facility.description')}</Label><Input id="c_desc" value={coll.description} onChange={(e) => setColl({ ...coll, description: e.target.value })} /></div>
            <div><Label htmlFor="c_val">{t('bank.facility.estValue')}</Label><Input id="c_val" type="number" min={0} value={coll.value} onChange={(e) => setColl({ ...coll, value: e.target.value })} /></div>
            <div className="flex items-end"><Button size="sm" type="submit" loading={busy === 'coll'}><Plus className="h-3.5 w-3.5" aria-hidden /> {t('bank.facility.add')}</Button></div>
          </form>
          {collateral.length === 0 ? (
            <p className="flex items-center gap-1.5 text-sm text-emerald-900/55"><ShieldCheck className="h-4 w-4" aria-hidden /> {t('bank.facility.noCollateral')}</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {collateral.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-emerald-900/70">{c.kind}{c.description ? ` · ${c.description}` : ''}</span>
                  <span className="font-mono text-[13px] text-emerald-950">{c.estimated_value != null ? formatNaira(Number(c.estimated_value)) : '-'}</span>
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>
      </div>

      <AmountReferenceDialog
        open={!!payingInst}
        onClose={() => setPayingInst(null)}
        title={t('bank.facility.recordRepayment')}
        amountLabel={t('bank.facility.amountPaid')}
        defaultAmount={payingInst ? Number(payingInst.amount_due) : ''}
        hint={payingInst
          ? t('bank.facility.instalmentHint', {
            date: dateShort(payingInst.due_date),
            amount: formatNaira(Number(payingInst.amount_due)),
          })
          : undefined}
        submitLabel={t('bank.facility.recordRepayment')}
        onSubmit={async (amount, reference) => {
          if (!payingInst) return
          const { error: rpcErr } = await supabase.rpc('loamy_record_repayment', {
            p_schedule: payingInst.id, p_amount_paid: amount, p_paid_on: null, p_reference: reference,
          })
          if (rpcErr) throw new Error(rpcErr.message)
          await load()
        }}
      />
    </BankShell>
  )
}
