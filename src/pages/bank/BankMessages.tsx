import { MessageSquare } from 'lucide-react'
import { BankShell } from '@/pages/bank/BankShell'
import { EmptyState } from '@/components/EmptyState'
import { useT } from '@/lib/i18n'

/** Messaging is a shared platform feature not yet built (feature-flagged off
 * platform-wide). Honest placeholder — no fake threads. */
export default function BankMessages() {
  const { t } = useT()
  return (
    <BankShell section="messages">
      <EmptyState
        icon={MessageSquare}
        title={t('bank.messages.comingTitle')}
        body={t('bank.messages.comingBody')}
      />
    </BankShell>
  )
}
