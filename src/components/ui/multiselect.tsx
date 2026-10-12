import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MultiSelectChipsProps {
  options: readonly string[]
  value: string[]
  onChange: (next: string[]) => void
}

/** Checkbox-chip multi-select used by onboarding forms. */
export function MultiSelectChips({ options, value, onChange }: MultiSelectChipsProps) {
  function toggle(option: string) {
    onChange(
      value.includes(option) ? value.filter((v) => v !== option) : [...value, option],
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const selected = value.includes(option)
        return (
          <button
            key={option}
            type="button"
            onClick={() => toggle(option)}
            aria-pressed={selected}
            className={cn(
              // min-h-touch: these chips are the ONLY way to pick crops on
              // the farm form, and at 28px they were the smallest control in
              // the product. Fixed on the primitive so every multi-select
              // gets it, not on the one form that exposed it.
              'inline-flex min-h-touch items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-medium transition-colors',
              selected
                ? 'border-emerald-800 bg-emerald-800 text-white'
                : 'border-emerald-100 bg-white text-emerald-900 hover:border-emerald-300 hover:bg-emerald-50',
            )}
          >
            {selected && <Check className="h-3 w-3" aria-hidden />}
            {option}
          </button>
        )
      })}
    </div>
  )
}
