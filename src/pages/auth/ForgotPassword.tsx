import { useT } from '@/lib/i18n'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AuthLayout } from '@/pages/auth/AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** Existing Supabase reset flow — same as the portal's. */
export default function ForgotPassword() {
  const { t } = useT()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setSubmitting(false)
    if (resetError) {
      setError(resetError.message)
      return
    }
    setSent(true)
  }

  return (
    <AuthLayout
      title={t('auth.resetYourPassword')}
      subtitle={t('auth.resetEmailHint')}
      footer={
        <Link to="/login" className="font-semibold text-gold-300 hover:text-gold-200">
          {t('auth.backToSignIn')}
        </Link>
      }
    >
      {sent ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <MailCheck className="h-10 w-10 text-emerald-700" aria-hidden />
          <p className="text-sm text-emerald-900/70">
            {t('auth.ifAccountExists', { email })}
          </p>
        </div>
      ) : (
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
            />
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" loading={submitting}>
            {t('auth.sendResetLink')}
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
