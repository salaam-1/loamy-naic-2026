import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wallet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { BANK_LIST_LIMIT } from '@/lib/limits'
import { LOAN_SECTORS, type Facility, type PipelineRow } from '@/lib/bank'
import { cn, formatNaira } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { BankShell } from '@/pages/bank/BankShell'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { DashboardCard } from '@/components/DashboardCard'
import { EmptyState } from '@/components/EmptyState'

interface ActivateState {
  app: PipelineRow
  principal: string
  sector: string
  instalments: string
  firstDue: string
  instalmentAmount: string
}

/**
 * Loans (facilities): activate a decided application into a serviced facility,
 * and list active facilities. Loamy records the bank-confirmed principal — no
 * funds move here; disbursement/repayment records are entered per facility.
 */
export default function BankLoans() {
  const { t, tOr, dateShort } = useT()
  const sectorLabel = (v: string) => tOr(`bank.sector.${v}`, v)
  const facilityStatusLabel = (v: string) => tOr(`bank.facilityStatus.${v}`, v)
  const navigate = useNavigate()
  const [pipeline, setPipeline] = useState<PipelineRow[]>([])
  const [facilities, setFacilities] = useState<Facility[] | null>(null)
  const [activate, setActivate] = useState<ActivateState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [{ data: pipe }, { data: facs }] = await Promise.all([
      supabase.rpc('loamy_bank_pipeline'),
      supabase.from('facilities').select('*')
        .order('created_at', { ascending: false }).order('id', { ascending: true })
        .limit(BANK_LIST_LIMIT),
    ])
    setPipeline((pipe as PipelineRow[]) ?? [])
    setFacilities((facs as Facility[]) ?? [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const facilityAppIds = new Set((facilities ?? []).map((f) => f.application_id))
  // A facility can be opened against any approved application, not only one
  // decided outside Loamy. `rejected` is decided but is NOT fundable, so the
  // test is approval, not decidedness.
  const readyToActivate = pipeline.filter(
    (r) => ['approved', 'partially_approved', 'decided_external'].includes(r.status)
      && !facilityAppIds.has(r.id),
  )

  function openActivate(app: PipelineRow) {
    setError(null)
    setActivate({
      app,
      principal: String(Number(app.amount_requested)),
      sector: LOAN_SECTORS[0],
      instalments: '',
      firstDue: '',
      instalmentAmount: '',
    })
  }

  async function submitActivate(e: FormEvent) {
    e.preventDefault()
    if (!activate) return
    setError(null)
    const principal = Number(activate.principal)
    if (!Number.isFinite(principal) || principal < 0) return setError(t('bank.loans.invalidPrincipal'))
    setBusy(true)
    const { error: rpcErr } = await supabase.rpc('loamy_activate_facility', {
      p_application: activate.app.id,
      p_principal: principal,
      p_sector: activate.sector,
      p_instalments: activate.instalments ? Number(activate.instalments) : 0,
      p_first_due: activate.firstDue || null,
      p_instalment_amount: activate.instalmentAmount ? Number(activate.instalmentAmount) : 0,
    })
    setBusy(false)
    if (rpcErr) return setError(rpcErr.message)
    setActivate(null)
    await load()
  }

  return (
    <BankShell section="loans">
      <div className="space-y-4">
        <p className="rounded border border-line bg-emerald-50/50 px-3 py-2 text-[12px] text-emerald-900/70">
          Facilities mirror the bank of record. Principals, disbursements, and repayments are
          bank-confirmed figures - Loamy records and monitors them; it holds no funds.
        </p>

        {readyToActivate.length > 0 && (
          <DashboardCard title={`Decided applications ready to activate (${readyToActivate.length})`}>
            <table className="w-full text-left text-sm">
              <tbody className="divide-y divide-line">
                {readyToActivate.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 pr-4">
                      <p className="font-medium text-emerald-950">{r.applicant_name ?? '-'}</p>
                      <p className="font-mono text-[11px] text-emerald-900/50">{r.digital_id}</p>
                    </td>
                    <td className="py-2 pr-4 font-mono text-[13px]">{formatNaira(Number(r.amount_requested))}</td>
                    <td className="py-2 text-right">
                      <Button size="sm" onClick={() => openActivate(r)}>{t('bank.loans.activateFacility')}</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DashboardCard>
        )}

        {activate && (
          <DashboardCard title={`Activate facility - ${activate.app.applicant_name ?? ''}`}>
            <form onSubmit={submitActivate} className="space-y-3" noValidate>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="af_principal">{t('bank.loans.principalConfirmed')}</Label>
                  <Input id="af_principal" type="number" min={0} value={activate.principal} onChange={(e) => setActivate({ ...activate, principal: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="af_sector">{t('bank.loans.sector')}</Label>
                  <Select id="af_sector" value={activate.sector} onChange={(e) => setActivate({ ...activate, sector: e.target.value })}>
                    {LOAN_SECTORS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </Select>
                </div>
              </div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-900/50">{t('bank.loans.optionalSchedule')}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="af_inst">{t('bank.loans.instalments')}</Label>
                  <Input id="af_inst" type="number" min={0} value={activate.instalments} onChange={(e) => setActivate({ ...activate, instalments: e.target.value })} placeholder="e.g. 6" />
                </div>
                <div>
                  <Label htmlFor="af_first">{t('bank.loans.firstDue')}</Label>
                  <Input id="af_first" type="date" value={activate.firstDue} onChange={(e) => setActivate({ ...activate, firstDue: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="af_amt">{t('bank.loans.amountPerInstalment')}</Label>
                  <Input id="af_amt" type="number" min={0} value={activate.instalmentAmount} onChange={(e) => setActivate({ ...activate, instalmentAmount: e.target.value })} />
                </div>
              </div>
              {error && <p className="text-xs text-red-700">{error}</p>}
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={busy}>{t('bank.loans.openFacility')}</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setActivate(null)}>{t('common.cancel')}</Button>
              </div>
            </form>
          </DashboardCard>
        )}

        <DashboardCard title={`Active facilities (${facilities?.length ?? 0})`}>
          {facilities === null ? (
            <div className="h-16 animate-pulse rounded bg-emerald-50" aria-label={t('bank.loans.loading')} />
          ) : facilities.length === 0 ? (
            <EmptyState icon={Wallet} title={t('bank.loans.noneTitle')} body={t('bank.loans.noneBody')} />
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                  <th className="py-2 pr-4 font-medium">{t('bank.col.facility')}</th>
                  <th className="py-2 pr-4 font-medium">{t('bank.col.principal')}</th>
                  <th className="hidden py-2 pr-4 font-medium sm:table-cell">{t('bank.col.sector')}</th>
                  <th className="py-2 pr-4 font-medium">{t('bank.col.opened')}</th>
                  <th className="py-2 font-medium">{t('bank.col.status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {facilities.map((f) => (
                  <tr key={f.id} className="cursor-pointer transition-colors hover:bg-emerald-50/60" onClick={() => navigate(`/bank/loans/${f.id}`)}>
                    <td className="py-2 pr-4 font-mono text-[12px] text-emerald-700">{f.id.slice(0, 8).toUpperCase()}</td>
                    <td className="py-2 pr-4 font-mono text-[13px]">{formatNaira(Number(f.principal))}</td>
                    <td className="hidden py-2 pr-4 text-emerald-900/70 sm:table-cell">{sectorLabel(f.sector)}</td>
                    <td className="py-2 pr-4 text-emerald-900/70">{dateShort(f.opened_on)}</td>
                    <td className="py-2">
                      <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium',
                        f.status === 'active' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-emerald-950/5 text-emerald-900/55')}>
                        {facilityStatusLabel(f.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DashboardCard>
      </div>
    </BankShell>
  )
}
