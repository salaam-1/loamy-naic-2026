import { BadgeCheck, FileText, ShieldCheck } from 'lucide-react'
import { CLAIM_BASIS_META, type ClaimBasis } from '@/lib/marketplace'
import { cn } from '@/lib/utils'

/**
 * How strongly a listing's claim is backed (directive Part 15: clearly
 * distinguish SELLER DECLARED from LOAMY VERIFIED / OBSERVED).
 *
 * Three distinct things that are easy to conflate, so they are shown
 * differently on purpose:
 *
 *   seller badge        — this SELLER's identity is verified (VerifiedTag)
 *   traceable stock     — a real batch stands behind THIS listing
 *   verified stock      — someone physically went and looked at it
 *
 * A verified seller with a declared listing is still a declared listing. The
 * component never implies otherwise, and never invents a middle state.
 */
export function StockClaim({
  claimBasis,
  verificationStatus,
  originTraced,
  originState,
  className,
  showHint = false,
}: {
  claimBasis: ClaimBasis
  verificationStatus: 'unverified' | 'pending' | 'verified' | 'rejected'
  originTraced?: boolean
  originState?: string | null
  className?: string
  showHint?: boolean
}) {
  const verified = claimBasis === 'batch_backed' && verificationStatus === 'verified'
  const pending = claimBasis === 'batch_backed' && verificationStatus === 'pending'
  const backed = claimBasis === 'batch_backed'

  const { Icon, label, chip } = verified
    ? {
        Icon: ShieldCheck,
        label: 'Loamy verified',
        chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
      }
    : pending
      ? {
          Icon: BadgeCheck,
          label: 'Verification in progress',
          chip: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
        }
      : backed
        ? {
            Icon: BadgeCheck,
            label: CLAIM_BASIS_META.batch_backed.label,
            chip: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
          }
        : {
            Icon: FileText,
            label: CLAIM_BASIS_META.seller_declared.label,
            chip: 'bg-emerald-950/5 text-emerald-900/60',
          }

  const hint = verified
    ? `A Loamy field agent inspected this stock${originState ? ` in ${originState}` : ''}.`
    : pending
      ? 'A field agent has been asked to inspect this stock.'
      : CLAIM_BASIS_META[claimBasis].hint

  return (
    <span className={cn('inline-flex flex-col gap-1', className)}>
      <span className={cn('inline-flex w-fit items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium', chip)}>
        <Icon className="h-3 w-3" strokeWidth={2} aria-hidden />
        {label}
        {originTraced && originState && verified && (
          <span className="font-normal opacity-75">· {originState}</span>
        )}
      </span>
      {showHint && <span className="text-[11px] leading-relaxed text-emerald-900/55">{hint}</span>}
    </span>
  )
}
