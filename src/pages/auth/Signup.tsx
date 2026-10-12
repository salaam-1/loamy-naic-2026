import { useT } from '@/lib/i18n'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertCircle, MailCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { NIGERIA_STATES } from '@/lib/nigeria'
import { ROLE_CONFIGS, SIGNUP_ROLE_CONFIGS } from '@/lib/roles'
import type { PlatformRole } from '@/lib/types'
import { AuthLayout } from '@/pages/auth/AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

/**
 * Platform signup — writes the SAME minimal fields the portal collects, via
 * auth metadata, so the portal's existing signup trigger creates a valid
 * portal-style profile row. A platform account is therefore also a valid
 * portal account, and vice versa.
 *
 * SECURITY-REVIEW: signup metadata below carries ONLY low-sensitivity fields
 * the portal already collects (name, phone, category/role, state). No BVN,
 * NIN, or financial data is collected at signup, in onboarding, or anywhere
 * else in Stage 1. If the portal's handle_new_user trigger reads different
 * metadata key names, adjust the `data` object here to match — see README
 * "Signup compatibility".
 */
export default function Signup() {
  const { t } = useT()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [fullName, setFullName] = useState('')

  // Growth-partner referral attribution (?ref=LOAMYxxxxxxx): stored locally,
  // claimed by the new account itself via loamy_record_referral during
  // onboarding (works whether or not email confirmation defers the session).
  useEffect(() => {
    const ref = params.get('ref')
    if (ref) localStorage.setItem('loamy_ref', ref.trim().toUpperCase())
  }, [params])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState('')
  const [stateName, setStateName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [awaitingConfirm, setAwaitingConfirm] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!role) {
      setError('Please choose your role on the platform.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setSubmitting(true)
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          phone: phone.trim(),
          // `category` must be the Title-case label the portal's
          // profiles_category_check constraint allows (e.g. 'Warehouse Owner');
          // the DB trigger loamy_sync_platform_role derives the platform_role
          // slug from it on insert.
          category: ROLE_CONFIGS[role as PlatformRole]?.label ?? role,
          platform_role: role,
          state: stateName,
        },
      },
    })
    setSubmitting(false)
    if (signUpError) {
      setError(signUpError.message)
      return
    }
    // If email confirmation is enabled on the project there is no session yet.
    if (!data.session) {
      setAwaitingConfirm(true)
      return
    }
    navigate('/', { replace: true })
  }

  if (awaitingConfirm) {
    return (
      <AuthLayout title={t('auth.checkYourEmail')} subtitle={t('auth.checkYourEmailHint')}>
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <MailCheck className="h-10 w-10 text-emerald-700" aria-hidden />
          <p className="text-sm text-emerald-900/70">
            {t('auth.confirmationSent', { email })}
          </p>
          <Button variant="outline" className="mt-2" onClick={() => navigate('/login')}>
            {t('auth.backToSignIn')}
          </Button>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      wide
      title={t('auth.createYourAccount')}
      subtitle="One account for your digital ID, verification, and market access."
      footer={
        <span>
          Already a member?{' '}
          <Link
            to="/login"
            className="-my-1.5 inline-flex min-h-touch items-center rounded py-1.5 px-1 font-semibold text-emerald-800 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-bone"
          >
            Sign in
          </Link>
        </span>
      }
    >
      {params.get('redirect')?.startsWith('/marketplace') && (
        <p className="mb-4 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {t('auth.createFreeAccount')}
        </p>
      )}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="fullName">{t('auth.fullName')}</Label>
            <Input
              id="fullName"
              autoComplete="name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={t('auth.namePlaceholder')}
            />
          </div>
          <div>
            <Label htmlFor="phone">{t('auth.phone')}</Label>
            <Input
              id="phone"
              type="tel"
              autoComplete="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t('auth.phonePlaceholder')}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="email">{t('auth.email')}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('auth.emailPlaceholder')}
          />
        </div>

        <div>
          <Label htmlFor="password">{t('auth.password')}</Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('auth.passwordPlaceholder')}
            aria-describedby={error ? 'signup-error' : undefined}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="role">{t('auth.yourRole')}</Label>
            <Select id="role" required value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="" disabled>
                {t('auth.selectRole')}
              </option>
              {SIGNUP_ROLE_CONFIGS.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {r.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="state">{t('auth.state')}</Label>
            <Select
              id="state"
              required
              value={stateName}
              onChange={(e) => setStateName(e.target.value)}
            >
              <option value="" disabled>
                {t('auth.selectState')}
              </option>
              {NIGERIA_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {error && (
          <p
            id="signup-error"
            role="alert"
            className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[13px] leading-snug text-rose-800"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" loading={submitting}>
          {t('auth.createAccount')}
        </Button>

        {/* A statement, not a tick box, and it says only what is true.
            Creating an account does not grant optional analytics -- that is a
            separate choice made in the privacy notice, and bundling the two
            would make the consent worthless. There is no Terms of Service in
            this codebase, so none is claimed here. */}
        <p className="text-center text-[11px] leading-relaxed text-emerald-900/55">
          {t('auth.privacyConsent')}{' '}
          <Link
            to="/privacy"
            className="rounded font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            {t('auth.privacyPolicy')}
          </Link>
          . {t('auth.analyticsStayOff')}
        </p>
      </form>
    </AuthLayout>
  )
}
