import { cn } from '@/lib/utils'

/**
 * Money and quantity typography.
 *
 * §5 of the product direction: "Numbers involving money and quantities must
 * be extremely easy to scan." Three things make that true, and all three are
 * enforced here rather than left to each call site:
 *
 *   1. TABULAR FIGURES. Proportional digits are different widths, so a
 *      column of prices does not line up and the eye cannot compare them.
 *      `.tabular` sets font-variant-numeric.
 *
 *   2. THE UNIT IS PART OF THE NUMBER. ₦18,400,000 means nothing without
 *      "per tonne" beside it, and a quantity without its unit is a number
 *      somebody will guess at. Neither component lets you omit it.
 *
 *   3. THE CURRENCY IS DE-EMPHASISED, THE AMOUNT IS NOT. The naira sign is
 *      constant across the whole product and carries no information; the
 *      digits carry all of it.
 *
 * Nothing here formats a number it was not given. There is no default price,
 * no "—" that could be mistaken for zero, and no rounding that would make a
 * settlement figure disagree with the ledger.
 */

/** Naira, grouped, no decimals unless the amount genuinely has kobo. */
export function formatAmount(value: number): string {
  const hasKobo = Math.abs(value % 1) > 0.004
  return value.toLocaleString('en-NG', {
    minimumFractionDigits: hasKobo ? 2 : 0,
    maximumFractionDigits: hasKobo ? 2 : 0,
  })
}

type PriceSize = 'sm' | 'md' | 'lg' | 'xl'

const PRICE_SIZE: Record<PriceSize, string> = {
  sm: 'text-[13px]',
  md: 'text-base',
  lg: 'text-xl',
  xl: 'text-2xl sm:text-3xl',
}

const SYMBOL_SIZE: Record<PriceSize, string> = {
  sm: 'text-[11px]',
  md: 'text-xs',
  lg: 'text-sm',
  xl: 'text-lg',
}

export function Price({
  amount,
  per,
  size = 'md',
  tone = 'default',
  className,
}: {
  amount: number
  /** The unit this price is PER, e.g. "MT", "kg", "bag". */
  per?: string | null
  size?: PriceSize
  tone?: 'default' | 'muted' | 'positive' | 'negative'
  className?: string
}) {
  const toneClass =
    tone === 'muted' ? 'text-emerald-900/55'
      : tone === 'positive' ? 'text-emerald-700'
        : tone === 'negative' ? 'text-rose-700'
          : 'text-emerald-950'

  return (
    <span className={cn('inline-flex items-baseline gap-0.5 font-semibold tabular', toneClass, className)}>
      <span className={cn('font-normal opacity-60', SYMBOL_SIZE[size])} aria-hidden>
        ₦
      </span>
      <span className={PRICE_SIZE[size]}>{formatAmount(amount)}</span>
      {per && (
        <span className={cn('ml-0.5 font-normal opacity-55', SYMBOL_SIZE[size])}>/{per}</span>
      )}
      {/* The symbol is aria-hidden above so a screen reader says "naira"
          rather than spelling the glyph, which some voices do. */}
      <span className="sr-only">
        naira{per ? ` per ${per}` : ''}
      </span>
    </span>
  )
}

/**
 * A quantity with its unit. `available` renders the remainder alongside the
 * total, which is the form a partly-sold batch needs: "50 MT · 42 MT
 * available" is honest, "50 MT" on a batch with 8 MT committed is not.
 */
export function Quantity({
  value,
  unit,
  available,
  size = 'md',
  className,
}: {
  value: number
  unit: string
  available?: number | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const sizeClass = size === 'sm' ? 'text-[13px]' : size === 'lg' ? 'text-lg' : 'text-sm'
  const partial = available !== null && available !== undefined && available < value

  return (
    <span className={cn('inline-flex items-baseline gap-1 tabular', sizeClass, className)}>
      <span className="font-semibold text-emerald-950">
        {value.toLocaleString('en-NG', { maximumFractionDigits: 2 })}
      </span>
      <span className="font-medium text-emerald-900/60">{unit}</span>
      {partial && (
        <span className="text-[11px] font-medium text-emerald-700">
          · {available!.toLocaleString('en-NG', { maximumFractionDigits: 2 })} {unit} available
        </span>
      )}
    </span>
  )
}

/**
 * A labelled figure for summary rows — checkout totals, portfolio panels.
 * `emphasis` is for the one line that matters most in a group; using it twice
 * in the same block means neither is emphasised.
 */
export function MetricValue({
  label,
  children,
  hint,
  emphasis,
  className,
}: {
  label: string
  children: React.ReactNode
  hint?: string
  emphasis?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4', className)}>
      <span
        className={cn(
          'min-w-0',
          emphasis ? 'text-sm font-semibold text-emerald-950' : 'text-[13px] text-emerald-900/65',
        )}
      >
        {label}
        {hint && <span className="ml-1 text-[11px] text-emerald-900/40">{hint}</span>}
      </span>
      <span className="shrink-0">{children}</span>
    </div>
  )
}
