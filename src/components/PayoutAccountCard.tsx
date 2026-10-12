import { useEffect, useState, type FormEvent } from 'react'
import { Info, Landmark } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useT } from '@/lib/i18n'

interface Existing {
  bank_code: string
  bank_name: string | null
  account_number: string
  account_name: string | null
}

/**
 * Where a seller is settled.
 *
 * The settlement gate checks for this, so a seller without one blocks their
 * own supplier-direct payment with no way to fix it from the UI — which is
 * exactly the gap the end-to-end test found.
 *
 * This is a PAYOUT DESTINATION, not a KYC record. Loamy does not hold a BVN,
 * and identity verification belongs to the institution.
 */
export function PayoutAccountCard() {
  const { t } = useT()
  const [existing, setExisting] = useState<Existing | null | 'none'>(null)
  const [bankCode, setBankCode] = useState('')
  const [bankName, setBankName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountName, setAccountName] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return
      supabase.from('seller_payout_accounts')
        .select('bank_code, bank_name, account_number, account_name')
        .eq('user_id', data.user.id).maybeSingle()
        .then(({ data: row }) => {
          if (cancelled) return
          if (row) {
            setExisting(row as Existing)
            setBankCode(row.bank_code ?? '')
            setBankName(row.bank_name ?? '')
            setAccountName(row.account_name ?? '')
          } else {
            setExisting('none')
          }
        })
    })
    return () => { cancelled = true }
  }, [])

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true); setMessage(null)

    const { data, error } = await supabase.rpc('loamy_set_payout_account', {
      p_bank_code: bankCode.trim(),
      p_account_number: accountNumber.trim(),
      p_bank_name: bankName.trim() || null,
      p_account_name: accountName.trim() || null,
    })
    setSaving(false)

    if (error) { setMessage({ ok: false, text: error.message }); return }
    const r = data as { saved: boolean; reason?: string; message?: string; changed?: boolean }
    if (!r.saved) {
      setMessage({ ok: false, text: r.message ?? 'That could not be saved.' })
      return
    }
    setMessage({ ok: true, text: r.changed ? 'Settlement destination updated.' : 'Settlement destination saved.' })
    setExisting({
      bank_code: bankCode.trim(), bank_name: bankName.trim() || null,
      account_number: accountNumber.trim(), account_name: accountName.trim() || null,
    })
    setAccountNumber('')
  }

  return (
    <Card className="p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-emerald-950">
        <Landmark className="h-4 w-4 text-emerald-700" strokeWidth={1.5} aria-hidden />
        {t('payout.title')}
      </h2>
      <p className="mt-0.5 text-xs text-emerald-900/60">
        {t('payout.subtitle')}
      </p>

      {existing && existing !== 'none' && (
        <p className="mt-2 rounded border border-line bg-emerald-900/[0.02] px-2.5 py-1.5 font-mono text-xs text-emerald-900/75">
          {existing.bank_name ?? existing.bank_code} ····{existing.account_number.slice(-4)}
          {existing.account_name ? ` · ${existing.account_name}` : ''}
        </p>
      )}

      <form onSubmit={save} className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="bank-code">{t('payout.bankCode')}</Label>
          <Input id="bank-code" value={bankCode} onChange={(e) => setBankCode(e.target.value)}
                 placeholder={t('payout.bankCodePlaceholder')} className="font-mono" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="bank-name">{t('payout.bankName')}</Label>
          <Input id="bank-name" value={bankName} onChange={(e) => setBankName(e.target.value)}
                 placeholder={t('payout.bankNamePlaceholder')} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="acct-no">{t('payout.accountNumber')}</Label>
          <Input id="acct-no" value={accountNumber} inputMode="numeric" maxLength={10}
                 onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
                 placeholder={t('payout.accountNumberPlaceholder')} className="font-mono" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="acct-name">{t('payout.accountName')}</Label>
          <Input id="acct-name" value={accountName} onChange={(e) => setAccountName(e.target.value)}
                 placeholder={t('payout.accountNamePlaceholder')} />
        </div>

        <div className="sm:col-span-2">
          <Button type="submit" loading={saving} disabled={accountNumber.length !== 10}>
            {existing && existing !== 'none' ? t('common.update') : t('common.save')}
          </Button>
        </div>
      </form>

      <p className="mt-2 flex items-start gap-1.5 text-xs text-emerald-900/55">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
        {t('payout.notAnIdentityRecord')}
      </p>

      {message && (
        <p className={`mt-2 text-xs ${message.ok ? 'text-emerald-700' : 'text-amber-700'}`} role="status">
          {message.text}
        </p>
      )}
    </Card>
  )
}
