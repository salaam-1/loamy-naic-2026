import { useEffect, useState, type FormEvent } from 'react'
import { createClient } from '@supabase/supabase-js'
import QRCode from 'qrcode'
import { CheckCircle2, Copy, Link2, UserRoundPlus } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { NIGERIA_STATES } from '@/lib/nigeria'
import { DashboardCard } from '@/components/DashboardCard'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

/**
 * Assisted signup: the partner creates the farmer's account in the field on
 * their own device. A SEPARATE, non-persisting Supabase client is used so the
 * partner's own session is never touched; the farmer's fresh session then
 * self-attributes the onboarding via loamy_record_referral (field_assisted).
 * Credentials reach the farmer via the Supabase email; SMS delivery is a
 * Phase 2 enhancement.
 *
 * SECURITY-REVIEW: the partner momentarily knows the farmer's starting
 * password — the success copy instructs an immediate handover + the farmer
 * can change it in Settings. Engineer to review before scale (invite-link
 * flow would remove the shared-password moment entirely).
 */
export default function OnboardFarmer() {
  const { t } = useT()
  const { profile } = useAuth()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [stateName, setStateName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const refLink = profile?.digital_id
    ? `${window.location.origin}/signup?ref=${profile.digital_id}`
    : null

  useEffect(() => {
    if (!refLink) return
    QRCode.toDataURL(refLink, { width: 220, margin: 1, color: { dark: '#014D40' } })
      .then(setQr)
      .catch(() => setQr(null))
  }, [refLink])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profile?.digital_id) return
    setError(null)
    if (password.length < 8) return setError('Starting password must be at least 8 characters.')
    setSubmitting(true)

    // Isolated client: the farmer's signup never disturbs the partner session.
    const farmerClient = createClient(
      import.meta.env.VITE_SUPABASE_URL as string,
      import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )

    const { data, error: signUpError } = await farmerClient.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          phone: phone.trim(),
          category: 'Farmer',
          platform_role: 'farmer',
          state: stateName,
        },
      },
    })
    if (signUpError) {
      setSubmitting(false)
      setError(signUpError.message)
      return
    }

    // Attribution runs under the FARMER's fresh session (self-attribution).
    if (data.session) {
      const { error: refError } = await farmerClient.rpc('loamy_record_referral', {
        p_ref_code: profile.digital_id,
        p_method: 'field_assisted',
      })
      await farmerClient.auth.signOut()
      if (refError) {
        setSubmitting(false)
        setError(`Account created, but attribution failed: ${refError.message}`)
        return
      }
    }

    setSubmitting(false)
    setDone(email.trim())
    setFullName(''); setEmail(''); setPhone(''); setStateName(''); setPassword('')
  }

  async function copyLink() {
    if (!refLink) return
    await navigator.clipboard.writeText(refLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <DashboardCard title={t('verification.onboard.heading')}>
        {done ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-600" aria-hidden />
            <p className="text-sm font-semibold text-emerald-950">{t('verification.onboard.accountCreated')}</p>
            <p className="max-w-md text-sm leading-relaxed text-emerald-900/60">
              A confirmation email was sent to <span className="font-semibold">{done}</span>. Hand
              the starting password to the farmer now and ask them to change it in Settings on
              first login. Your onboarding commission has accrued. (SMS credential delivery is a
              planned Phase 2 enhancement.)
            </p>
            <Button variant="outline" onClick={() => setDone(null)}>{t('verification.onboard.onboardAnother')}</Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <p className="text-sm leading-relaxed text-emerald-900/60">
              {t('verification.onboard.explainerFull')}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="ob_name">{t('verification.onboard.fullName')}</Label>
                <Input id="ob_name" required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t('verification.onboard.namePlaceholder')} />
              </div>
              <div>
                <Label htmlFor="ob_phone">{t('verification.onboard.phone')}</Label>
                <Input id="ob_phone" required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('verification.onboard.phonePlaceholder')} />
              </div>
              <div>
                <Label htmlFor="ob_email">{t('verification.onboard.email')}</Label>
                <Input id="ob_email" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('verification.onboard.emailPlaceholder')} />
              </div>
              <div>
                <Label htmlFor="ob_state">{t('verification.onboard.state')}</Label>
                <Select id="ob_state" required value={stateName} onChange={(e) => setStateName(e.target.value)}>
                  <option value="" disabled>{t('verification.onboard.selectState')}</option>
                  {NIGERIA_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="ob_pw">{t('verification.onboard.startingPassword')}</Label>
                <Input id="ob_pw" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('verification.onboard.pwPlaceholder')} />
              </div>
            </div>
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}
            <Button type="submit" loading={submitting}>
              <UserRoundPlus className="h-4 w-4" aria-hidden /> Create farmer account
            </Button>
          </form>
        )}
      </DashboardCard>

      <DashboardCard title={t('verification.onboard.yourReferralLink')}>
        <div className="flex flex-col items-center gap-3 text-center">
          {qr && <img src={qr} alt="Referral QR code" className="h-44 w-44 rounded-lg" />}
          <p className="break-all rounded-lg bg-emerald-50 px-3 py-2 font-mono text-[11px] text-emerald-800">
            {refLink ?? '-'}
          </p>
          <Button size="sm" variant="outline" onClick={copyLink}>
            {copied ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
            {copied ? t('verification.onboard.copied') : t('verification.onboard.copyLink')}
          </Button>
          <p className="flex items-start gap-1.5 text-left text-[11px] leading-relaxed text-emerald-900/50">
            <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {t('verification.onboard.attributionFull')}
          </p>
        </div>
      </DashboardCard>
    </div>
  )
}
