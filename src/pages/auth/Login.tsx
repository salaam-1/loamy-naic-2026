import { useState, type FormEvent } from 'react'
import { useT } from '@/lib/i18n'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AuthLayout } from '@/pages/auth/AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'

/**
 * Uses the EXISTING Supabase Auth — Founding Member Portal accounts sign in
 * here with the same credentials. Routing by role happens at "/".
 */
export default function Login() {
  const { t } = useT()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    setSubmitting(false)
    if (signInError) {
      setError(
        signInError.message === 'Invalid login credentials'
          ? 'Email or password is incorrect.'
          : signInError.message,
      )
      return
    }
    navigate('/', { replace: true })
  }

  return (
    <AuthLayout
      title={t('auth.signIn')}
      subtitle="Founding members sign in with their existing portal credentials."
      footer={
        <span>
          {t('auth.noAccount')}{' '}
          <Link
            to="/signup"
            className="-my-1.5 inline-flex min-h-touch items-center rounded py-1.5 px-1 font-semibold text-emerald-800 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-bone"
          >
            {t('auth.createOne')}
          </Link>
        </span>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
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
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'signin-error' : undefined}
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor="password">{t('auth.password')}</Label>
            <Link
              to="/forgot-password"
              className="-my-1.5 mb-1.5 inline-flex min-h-touch items-center rounded px-1 text-xs font-medium text-emerald-700 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'signin-error' : undefined}
          />
        </div>
        {error && (
          <p
            id="signin-error"
            role="alert"
            className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[13px] leading-snug text-rose-800"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" loading={submitting}>
          {t('auth.signIn')}
        </Button>
      </form>
    </AuthLayout>
  )
}
