import { useEffect, useState, type FormEvent } from 'react'
import { Banknote, CheckCircle2, Landmark } from 'lucide-react'
import { DashboardCard } from '@/components/DashboardCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import {
  fetchBanks,
  fetchMyPayoutAccount,
  paymentsConfigured,
  savePayoutAccount,
  type Bank,
  type PayoutAccount as Account,
} from '@/lib/payments'

/**
 * Bank account for wallet withdrawals. Released escrow lands in the member's
 * Loamy wallet; this is where a withdrawal from that wallet is paid out.
 *
 * Saving validates the account with Paystack (which resolves the real account
 * name) and registers a transfer recipient — that recipient code is what the
 * withdrawal RPC requires, so an unverified account can never be paid to.
 */
export function PayoutAccount({ onSaved }: { onSaved?: () => void } = {}) {
  const [account, setAccount] = useState<Account | null | 'loading'>('loading')
  const [banks, setBanks] = useState<Bank[]>([])
  const [editing, setEditing] = useState(false)
  const [bankCode, setBankCode] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okName, setOkName] = useState<string | null>(null)

  const configured = paymentsConfigured()

  useEffect(() => {
    if (!configured) { setAccount(null); return }
    void fetchMyPayoutAccount().then((a) => {
      setAccount(a)
      setEditing(!a)
    })
    void fetchBanks().then(setBanks).catch(() => { /* banks load lazily; error shown on save */ })
  }, [configured])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setOkName(null)
    if (!bankCode) { setError('Select your bank.'); return }
    if (!/^\d{10}$/.test(accountNumber.trim())) { setError('Enter a valid 10-digit account number.'); return }
    setBusy(true)
    try {
      const bankName = banks.find((b) => b.code === bankCode)?.name
      const { account_name } = await savePayoutAccount(bankCode, accountNumber.trim(), bankName)
      setOkName(account_name)
      setAccount(await fetchMyPayoutAccount())
      setEditing(false)
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that account.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DashboardCard title="Bank account for withdrawals">
      {!configured ? (
        <p className="text-sm text-emerald-900/60">
          Withdrawals activate once payments are enabled. This is the account your wallet pays out to.
        </p>
      ) : account === 'loading' ? (
        <div className="h-16 animate-pulse rounded bg-emerald-50" aria-label="Loading" />
      ) : (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-emerald-900/60">
            Released sales land in your Loamy wallet. When you withdraw, this is the account we pay to - so it has to be verified first.
          </p>

          {account && !editing && (
            <div className="flex items-center justify-between gap-3 rounded border border-line px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <Landmark className="h-4 w-4 shrink-0 text-emerald-700" strokeWidth={1.5} aria-hidden />
                <div>
                  <p className="text-sm font-medium text-emerald-950">
                    {account.account_name ?? 'Account'} · ••••{account.account_number.slice(-4)}
                  </p>
                  <p className="text-[11px] text-emerald-900/50">{account.bank_name ?? account.bank_code}</p>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => { setEditing(true); setBankCode(account.bank_code); setAccountNumber('') }}>
                Update
              </Button>
            </div>
          )}

          {okName && !editing && (
            <p className="flex items-center gap-1.5 rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> Verified as {okName}.
            </p>
          )}

          {editing && (
            <form onSubmit={save} className="space-y-3">
              <div>
                <Label htmlFor="po-bank">Bank</Label>
                <Select id="po-bank" value={bankCode} onChange={(e) => setBankCode(e.target.value)} className="mt-1 w-full">
                  <option value="">Select your bank…</option>
                  {banks.map((b) => (<option key={b.code} value={b.code}>{b.name}</option>))}
                </Select>
                {banks.length === 0 && <p className="mt-1 text-[11px] text-emerald-900/45">Loading banks…</p>}
              </div>
              <div>
                <Label htmlFor="po-acct">Account number</Label>
                <Input id="po-acct" inputMode="numeric" maxLength={10} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))} className="mt-1" placeholder="10 digits" />
              </div>
              {error && <p className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">{error}</p>}
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={busy}><Banknote className="h-4 w-4" aria-hidden /> Verify & save</Button>
                {account && <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>}
              </div>
            </form>
          )}
        </div>
      )}
    </DashboardCard>
  )
}
