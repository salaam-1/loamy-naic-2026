import { BankShell } from '@/pages/bank/BankShell'
import Settings from '@/pages/shared/Settings'

/** Bank officer account settings — reuses the shared profile/password page. */
export default function BankSettings() {
  return (
    <BankShell section="settings">
      <Settings />
    </BankShell>
  )
}
