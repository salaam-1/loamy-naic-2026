import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { AuthLayout } from '@/pages/auth/AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { useT } from '@/lib/i18n'

/**
 * Landing page for the recovery link. Supabase's detectSessionInUrl exchanges
 * the link token for a recovery session; the user then sets a new password.
 */
export default function ResetPassword() {
  const { t } = useT()
  const navigate = useNavigate()
  const { session, loading } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setSubmitting(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setSubmitting(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    navigate('/', { replace: true })
  }

  if (!loading && !session) {
    return (
      <AuthLayout
        title={t('auth.linkExpired')}
        subtitle={t('auth.linkExpiredHint')}
      >
        <Button className="w-full" onClick={() => navigate('/forgot-password')}>
          {t('auth.requestNewLink')}
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t('auth.setNewPassword')} subtitle={t('auth.setNewPasswordHint')}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div>
          <Label htmlFor="password">{t('auth.newPassword')}</Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('auth.atLeast8')}
          />
        </div>
        <div>
          <Label htmlFor="confirm">{t('auth.confirmNewPassword')}</Label>
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={t('auth.repeatPassword')}
          />
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" loading={submitting}>
          {t('auth.updatePassword')}
        </Button>
      </form>
    </AuthLayout>
  )
}
