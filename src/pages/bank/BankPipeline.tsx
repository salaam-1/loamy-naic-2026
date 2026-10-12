import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BadgeCheck, ListChecks } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { NIGERIA_STATES } from '@/lib/nigeria'
import { RISK_TIER_META, type PipelineRow, type RiskTier } from '@/lib/bank'
import { FINANCING_STATUS_META, statusMeta } from '@/lib/financingLifecycle'
import { cn, formatNaira } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { BankShell } from '@/pages/bank/BankShell'
import { Card } from '@/components/ui/card'
import { Select } from '@/components/ui/select'

const TIERS: RiskTier[] = ['Low', 'Medium', 'High', 'Very High']

/** Dense pipeline table with product/state/tier/status filters. Row → detail. */
export default function BankPipeline() {
  const { t, tOr, dateShort } = useT()
  const statusLabel = (st: string, english?: string) =>
    tOr(`financing.status.${st}`, english ?? statusMeta(st).label)
  const riskLabel = (tier: string) => tOr(`bank.riskTier.${tier}`, tier)
  const navigate = useNavigate()
  const [rows, setRows] = useState<PipelineRow[] | null>(null)
  const [product, setProduct] = useState('')
  const [stateF, setStateF] = useState('')
  const [tierF, setTierF] = useState('')
  const [statusF, setStatusF] = useState('')

  useEffect(() => {
    let cancelled = false
    supabase.rpc('loamy_bank_pipeline').then(({ data }) => {
      if (!cancelled) setRows((data as PipelineRow[]) ?? [])
    })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(
    () =>
      (rows ?? []).filter(
        (r) =>
          (!product || r.product_type === product) &&
          (!stateF || r.state === stateF) &&
          (!tierF || r.risk_tier === tierF) &&
          (!statusF || statusMeta(r.status).label === statusMeta(statusF).label),
      ),
    [rows, product, stateF, tierF, statusF],
  )

  return (
    <BankShell section="pipeline">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-base font-semibold text-emerald-950">
            {t('bank.pipeline.title')} <span className="font-mono text-sm font-normal text-emerald-900/50">{filtered.length}</span>
          </h1>
          <Select value={product} onChange={(e) => setProduct(e.target.value)} className="w-40" aria-label={t('bank.pipeline.filterProduct')}>
            <option value="">{t('bank.pipeline.allProducts')}</option>
            <option value="input_financing">{t('bank.pipeline.inputFinancing')}</option>
          </Select>
          <Select value={stateF} onChange={(e) => setStateF(e.target.value)} className="w-36" aria-label={t('bank.pipeline.filterState')}>
            <option value="">{t('bank.pipeline.allStates')}</option>
            {NIGERIA_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
          <Select value={tierF} onChange={(e) => setTierF(e.target.value)} className="w-32" aria-label={t('bank.pipeline.filterTier')}>
            <option value="">{t('bank.pipeline.allTiers')}</option>
            {TIERS.map((tier) => (
              <option key={tier} value={tier}>{riskLabel(tier)}</option>
            ))}
          </Select>
          <Select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="w-44" aria-label={t('bank.pipeline.filterStatus')}>
            <option value="">{t('bank.pipeline.allStatuses')}</option>
            {/* Every status the lifecycle can hold, deduplicated by label:
                info_requested and additional_information_required are two
                words for one state and must not appear twice. */}
            {[...new Map(Object.entries(FINANCING_STATUS_META)
              .filter(([k]) => k !== 'draft')
              .map(([k, v]) => [statusLabel(k, v.label), k])).entries()].map(([label, k]) => (
                <option key={k} value={k}>{label}</option>
            ))}
          </Select>
        </div>

        {rows === null ? (
          <div className="h-32 animate-pulse rounded bg-white" aria-label={t('bank.pipeline.loading')} />
        ) : filtered.length === 0 ? (
          <Card className="flex items-center gap-2.5 px-4 py-4">
            <ListChecks className="h-5 w-5 text-emerald-700" aria-hidden />
            <p className="text-sm text-emerald-900/60">
              {rows.length === 0 ? t('bank.pipeline.noneForInstitution') : t('bank.pipeline.noneMatchFilters')}
            </p>
          </Card>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-emerald-900/50">
                  <th className="px-4 py-2 font-medium">{t('bank.col.applicant')}</th>
                  <th className="px-4 py-2 font-medium">{t('bank.col.product')}</th>
                  <th className="px-4 py-2 font-medium">{t('bank.col.amount')}</th>
                  <th className="hidden px-4 py-2 font-medium md:table-cell">{t('bank.col.state')}</th>
                  <th className="hidden px-4 py-2 font-medium sm:table-cell">{t('bank.col.submitted')}</th>
                  <th className="px-4 py-2 font-medium">{t('bank.col.risk')}</th>
                  <th className="px-4 py-2 font-medium">{t('bank.col.status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => navigate(`/bank/application/${r.id}`)}
                    className="cursor-pointer transition-colors hover:bg-emerald-50/60"
                  >
                    <td className="px-4 py-2.5">
                      <p className="flex items-center gap-1 font-medium text-emerald-950">
                        {r.applicant_name ?? '-'}
                        {r.verified_badge && <BadgeCheck className="h-4 w-4 text-emerald-600" aria-label={t('financing.bank.verifiedAria')} />}
                      </p>
                      <p className="font-mono text-[11px] text-emerald-900/50">
                        {r.digital_id}{r.ref ? ` · ${r.ref}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-emerald-900/70">
                      {t('bank.pipeline.inputFinancing')}
                      {/* Murabaha is the name of the structure a partner bank
                          actually uses, and the glossary keeps it untranslated
                          in all five languages. */}
                      <span className="ml-1.5 rounded bg-emerald-50 px-1 py-0.5 text-[10px] font-medium uppercase text-emerald-700">
                        Murabaha
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[13px] text-emerald-950">
                      {formatNaira(Number(r.amount_requested))}
                      {/* Requested and approved are different numbers and are
                          never shown as one. */}
                      {r.approved_amount != null && (
                        <span className="block text-[11px] font-normal text-emerald-700">
                          {t('bank.pipeline.approvedPrefix', { amount: formatNaira(Number(r.approved_amount)) })}
                        </span>
                      )}
                    </td>
                    <td className="hidden px-4 py-2.5 text-emerald-900/70 md:table-cell">{r.state ?? '-'}</td>
                    <td className="hidden px-4 py-2.5 text-emerald-900/70 sm:table-cell">{dateShort(r.created_at)}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', RISK_TIER_META[r.risk_tier].chip)}>
                        {riskLabel(r.risk_tier)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', statusMeta(r.status).chip)}>
                        {statusLabel(r.status, statusMeta(r.status).label)}
                      </span>
                      {r.is_sandbox && (
                        <span className="ml-1 rounded bg-amber-50 px-1 py-0.5 text-[10px] font-medium text-amber-800">
                          {t('financing.bank.sandbox')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </BankShell>
  )
}
