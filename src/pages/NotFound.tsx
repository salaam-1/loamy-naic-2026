import { useNavigate } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'

export default function NotFound() {
  const { t } = useT()
  const navigate = useNavigate()
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4">
      <Logo tone="dark" withTagline className="mb-10" />
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 ring-1 ring-emerald-100">
        <Compass className="h-8 w-8 text-emerald-700" aria-hidden />
      </span>
      <h1 className="mt-5 text-2xl font-bold text-emerald-950">{t('notFound.title')}</h1>
      <p className="mt-2 max-w-sm text-center text-sm text-emerald-900/60">
        {t('notFound.body')}
      </p>
      <Button className="mt-6" onClick={() => navigate('/')}>
        {t('notFound.back')}
      </Button>
    </div>
  )
}
