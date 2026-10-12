import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, LineChart, ToggleLeft, ToggleRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { DashboardCard } from '@/components/DashboardCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import {
  DEFAULT_AI_SETTINGS, aiServiceStatuses, readAiSettings, saveAiSettings,
  testAiConnection, type AiSettings, type ServiceStatus,
} from '@/lib/aiSettings'

const FLAG_HELP: Record<string, string> = {
  marketplace: 'Marketplace browse/list for trading roles (Stage 3)',
  verification_workflow: 'Field verification workflow + partner suite (Stage 4)',
  financing_applications: 'Financing nav for non-farmer roles (future stages)',
  bank_portal: 'Bank portal + admin officer management (Stage 5)',
  processor_procurement: 'Processor buy-request → bids → awards → payments suite (Parts 2–9)',
  processor_kyc: 'Processor identity verification (NIN/BVN/liveness) - keep OFF until cleared',
  supplier_bidding: 'Supplier "Open Buy Requests" board - bid on processor RFQs (Part 3)',
}

/**
 * Platform configuration — feature flags and partner rates in one place.
 * Every change is confirmed and audit-logged (config trigger).
 */
export default function AdminConfig() {
  const [flags, setFlags] = useState<Record<string, boolean> | null>(null)
  const [rates, setRates] = useState<{ onboarding: string; verification: string }>({ onboarding: '', verification: '' })
  const [feeBps, setFeeBps] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [ai, setAi] = useState<AiSettings>(DEFAULT_AI_SETTINGS)
  const [aiTest, setAiTest] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const { data } = await supabase.from('platform_config').select('flags, partner_rates, platform_fee_bps').eq('id', 1).maybeSingle()
    setFlags((data?.flags as Record<string, boolean>) ?? {})
    const pr = data?.partner_rates as Record<string, number> | undefined
    if (pr) setRates({ onboarding: String(pr.onboarding ?? ''), verification: String(pr.verification ?? '') })
    setFeeBps(String((data?.platform_fee_bps as number) ?? 0))
    // Read through the module so defaults and coercion live in one place.
    setAi(await readAiSettings())
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * Save configuration. Deliberately NOT an activation.
   *
   * `saveAiSettings` read-merge-writes, because a whole-column write would
   * destroy the eligibility weights and verification thresholds that live
   * beside this under `settings`. It also refuses anything secret-shaped.
   */
  async function saveAi(e: FormEvent) {
    e.preventDefault()
    setBusy('ai')
    const r = await saveAiSettings(ai)
    setBusy(null)
    setMsg(r.ok
      ? 'AI configuration saved. Saving does not verify that any service works.'
      : r.error)
    if (r.ok) setAi(await readAiSettings())
  }

  const aiStatuses: ServiceStatus[] = aiServiceStatuses(ai)

  async function toggleFlag(key: string) {
    if (!flags) return
    const next = !flags[key]
    if (!window.confirm(`${next ? 'Enable' : 'Disable'} "${key}" platform-wide? This is audit-logged.`)) return
    setBusy(key)
    const { error } = await supabase
      .from('platform_config')
      .update({ flags: { ...flags, [key]: next } })
      .eq('id', 1)
    setBusy(null)
    if (error) setMsg(error.message)
    await load()
  }

  async function saveRates(e: FormEvent) {
    e.preventDefault()
    setBusy('rates')
    const { error } = await supabase
      .from('platform_config')
      .update({
        partner_rates: {
          onboarding: Number(rates.onboarding) || 0,
          verification: Number(rates.verification) || 0,
        },
      })
      .eq('id', 1)
    setBusy(null)
    setMsg(error ? error.message : 'Rates saved - applied at accrual time going forward.')
  }

  async function saveFee(e: FormEvent) {
    e.preventDefault()
    const bps = Number(feeBps)
    if (!Number.isInteger(bps) || bps < 0 || bps > 10000) {
      setMsg('Fee must be 0–10000 basis points (100 = 1%).')
      return
    }
    setBusy('fee')
    const { error } = await supabase.from('platform_config').update({ platform_fee_bps: bps }).eq('id', 1)
    setBusy(null)
    setMsg(error ? error.message : 'Platform fee saved - applied to new marketplace settlements.')
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {msg && <p className="rounded bg-emerald-50 px-2.5 py-1.5 text-sm text-emerald-800">{msg}</p>}

      <DashboardCard title="Feature flags">
        {flags === null ? (
          <div className="h-16 animate-pulse rounded bg-emerald-50" aria-label="Loading flags" />
        ) : (
          <ul className="divide-y divide-line">
            {Object.entries(flags).sort(([a], [b]) => a.localeCompare(b)).map(([key, on]) => (
              <li key={key} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <p className="font-mono text-[13px] font-medium text-emerald-950">{key}</p>
                  <p className="text-[11px] text-emerald-900/50">{FLAG_HELP[key] ?? 'Reserved for a future stage'}</p>
                </div>
                <button
                  type="button"
                  disabled={busy === key}
                  onClick={() => void toggleFlag(key)}
                  className={cn('flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors',
                    on ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-emerald-950/5 text-emerald-900/55 hover:bg-emerald-950/10')}
                >
                  {on ? <ToggleRight className="h-4 w-4" aria-hidden /> : <ToggleLeft className="h-4 w-4" aria-hidden />}
                  {on ? 'On' : 'Off'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </DashboardCard>

      <DashboardCard title="Partner rates (₦, applied at accrual time)">
        <form onSubmit={saveRates} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]" noValidate>
          <div>
            <Label htmlFor="r_ob">Per onboarding</Label>
            <Input id="r_ob" type="number" min={0} value={rates.onboarding} onChange={(e) => setRates((r) => ({ ...r, onboarding: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="r_vf">Per approved verification</Label>
            <Input id="r_vf" type="number" min={0} value={rates.verification} onChange={(e) => setRates((r) => ({ ...r, verification: e.target.value }))} />
          </div>
          <div className="flex items-end">
            <Button type="submit" size="sm" loading={busy === 'rates'}>Save</Button>
          </div>
        </form>
      </DashboardCard>

      {/* NOT the authoritative fee control. Migration 20260919280001 moved
          settlement onto the frozen fee snapshot resolved from
          `fee_schedules`; this value is now only the labelled fallback used
          when a transaction has no snapshot (an escrow with no transaction,
          or one accepted before snapshots existed). Leaving it presented as
          "the marketplace fee" is what made an administrator believe they
          were setting a rate that nothing reads. */}
      <DashboardCard title="Settlement fallback rate">
        <div className="mb-3 flex items-start gap-2 rounded-lg border-l-2 border-amber-500 bg-amber-50/70 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <p className="text-[12px] leading-relaxed text-amber-900">
            <span className="font-semibold">This is not the marketplace fee.</span> Fees are set in{' '}
            <Link to="/admin/fees" className="font-semibold underline underline-offset-2">Fee Schedules</Link>,
            resolved per transaction and frozen at acceptance. This rate is used only when a settlement has
            no frozen fee to honour - normally nothing.
          </p>
        </div>
        <form onSubmit={saveFee} className="grid gap-3 sm:grid-cols-[1fr_auto]" noValidate>
          <div>
            <Label htmlFor="fee_bps">Fallback rate (basis points · 100 = 1%)</Label>
            <Input id="fee_bps" type="number" min={0} max={10000} value={feeBps} onChange={(e) => setFeeBps(e.target.value)} />
            <p className="mt-1 text-[11px] text-emerald-900/50">
              Settlement records which number it used and why, so a fallback charge is always
              distinguishable from a scheduled one in reconciliation.
            </p>
          </div>
          <div className="flex items-end">
            <Button type="submit" size="sm" variant="secondary" loading={busy === 'fee'}>Save fallback</Button>
          </div>
        </form>
      </DashboardCard>

      {/*
        AI model and voice.

        NON-SECRET FIELDS ONLY. `platform_config` has
        `select ... to authenticated using (true)` -- every signed-in member
        can read this row -- so a credential must never be typed here. There
        is deliberately no token field on this form; the hosted credential
        belongs in a Supabase Function secret read with `Deno.env.get`,
        exactly as PAYSTACK_SECRET_KEY already is.
      */}
      <DashboardCard title="AI model and voice">
        <p className="mb-3 text-xs text-emerald-900/60">
          Configuration only. No credential is entered or stored here:
          this row is readable by every signed-in member, so the hosted
          inference token lives in a server-side secret instead.
        </p>

        <div className="mb-4 space-y-2">
          {aiStatuses.map((s) => (
            <div key={s.service} className="flex items-start justify-between gap-3 rounded border border-line bg-white px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-emerald-950">{s.label}</p>
                <p className="text-[11px] leading-snug text-emerald-900/60">{s.summary}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className={cn(
                  'rounded-pill px-2 py-0.5 text-[10px] font-semibold',
                  s.tone === 'ok' ? 'bg-emerald-100 text-emerald-800'
                    : s.tone === 'warn' ? 'bg-gold-100 text-gold-700'
                      : 'bg-clay text-emerald-900/60',
                )}>
                  {/*
                    Never "Connected". A badge that said so because a model id
                    was typed in would be the exact lie this panel avoids.
                  */}
                  {s.inferenceVerified ? 'Verified'
                    : s.configured ? 'Configured, unverified' : 'Not configured'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const r = testAiConnection(s.service, ai)
                    setAiTest((t) => ({ ...t, [s.service]: `${r.checked}: ${r.message}` }))
                  }}
                  className="min-h-touch rounded border border-line px-2 py-0.5 text-[10px] font-medium text-emerald-900 hover:bg-emerald-50"
                >
                  Test connection
                </button>
              </div>
            </div>
          ))}
        </div>

        {Object.entries(aiTest).map(([k, v]) => (
          <p key={k} className="mb-2 rounded border border-line bg-bone px-2.5 py-1.5 text-[11px] text-emerald-900/70">
            <span className="font-semibold">{k}</span>: {v}
          </p>
        ))}

        <form onSubmit={saveAi} className="grid gap-3 sm:grid-cols-2" noValidate>
          <div>
            <Label htmlFor="ai-provider">Inference provider</Label>
            <Select
              id="ai-provider"
              value={ai.inference.provider}
              onChange={(e) => setAi((a) => ({
                ...a, inference: { ...a.inference, provider: e.target.value as 'ollama' | 'hosted' },
              }))}
            >
              <option value="ollama">Local (Ollama)</option>
              <option value="hosted">Hosted (OpenAI-compatible)</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="ai-local-model">Local model</Label>
            <Input
              id="ai-local-model"
              value={ai.inference.localModel}
              onChange={(e) => setAi((a) => ({
                ...a, inference: { ...a.inference, localModel: e.target.value },
              }))}
            />
          </div>
          <div>
            <Label htmlFor="ai-hosted-model">Hosted model identifier</Label>
            <Input
              id="ai-hosted-model"
              value={ai.inference.hostedModel}
              placeholder="none set"
              onChange={(e) => setAi((a) => ({
                ...a, inference: { ...a.inference, hostedModel: e.target.value },
              }))}
            />
            <p className="mt-1 text-[10px] text-emerald-900/50">
              Exact identifier. No default - a default would answer with a model nobody chose.
            </p>
          </div>
          <div>
            <Label htmlFor="ai-max-tokens">Max output tokens</Label>
            <Input
              id="ai-max-tokens"
              type="number"
              value={String(ai.inference.maxOutputTokens)}
              onChange={(e) => setAi((a) => ({
                ...a, inference: { ...a.inference, maxOutputTokens: Number(e.target.value) },
              }))}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-emerald-900">
            <input
              type="checkbox"
              checked={ai.inference.hostedEnabled}
              onChange={(e) => setAi((a) => ({
                ...a, inference: { ...a.inference, hostedEnabled: e.target.checked },
              }))}
            />
            Activate hosted inference
          </label>
          <div className="sm:col-span-2 flex items-center gap-2">
            <Button type="submit" size="sm" loading={busy === 'ai'}>Save settings</Button>
            <span className="text-[11px] text-emerald-900/50">
              Saving stores configuration. It does not verify that anything works.
            </span>
          </div>
        </form>
      </DashboardCard>

      <DashboardCard title="Reference market prices">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-emerald-900/60">Admin-entered commodity prices shown across the marketplace.</p>
          <Link to="/admin/market-prices" className="inline-flex items-center gap-1.5 rounded border border-line bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-900 hover:bg-emerald-50">
            <LineChart className="h-3.5 w-3.5" aria-hidden /> Open price entry
          </Link>
        </div>
      </DashboardCard>
    </div>
  )
}
