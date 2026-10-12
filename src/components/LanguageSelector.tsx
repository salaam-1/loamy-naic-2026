import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, Globe } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { LOCALES, LOCALE_META, type Locale } from '@/lib/i18n/types'
import { cn } from '@/lib/utils'

/**
 * The one language control. Used by the public footer and by Settings.
 *
 * ONE COMPONENT, TWO SURFACES
 *   Two implementations would drift: a locale added to the registry would
 *   appear in one place and not the other, and the keyboard behaviour would be
 *   right in whichever got attention last. Only the surface styling differs
 *   between the variants; the options, the labels and every interaction come
 *   from here.
 *
 * THE OPTIONS ARE THE REGISTRY
 *   LOCALES and LOCALE_META are the source. There is no array of language names
 *   in this file, so adding a sixth language never means remembering to edit a
 *   selector. Each language is shown by its endonym — what it calls itself —
 *   because a member looking for Hausa is looking for "Hausa", not for a
 *   translation of the word into a language they are trying to leave.
 *
 * KEYBOARD
 *   A listbox: the trigger opens on Enter, Space or Down; the options are
 *   walked with Up/Down, Home and End; Enter or Space chooses; Escape closes
 *   and returns focus to the trigger, which is what a keyboard user expects and
 *   what stops the menu stranding them.
 */
export function LanguageSelector({
  variant = 'settings',
  className,
}: {
  variant?: 'footer' | 'settings'
  className?: string
}) {
  const { locale, setLocale, t } = useT()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<number>(() => LOCALES.indexOf(locale))
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const listId = useId()

  const onDark = variant === 'footer'

  const close = useCallback((returnFocus = true) => {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }, [])

  // Click outside and Escape, matching RoleSwitcher so the two controls behave
  // identically rather than merely looking alike.
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  // Focus follows the active option, so a screen reader announces each language
  // as it is walked rather than only on selection.
  useEffect(() => {
    if (open) optionRefs.current[active]?.focus()
  }, [open, active])

  function openWith(index: number) {
    setActive(index)
    setOpen(true)
  }

  function onTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openWith(LOCALES.indexOf(locale))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      openWith(LOCALES.length - 1)
    }
  }

  function onOptionKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((index + 1) % LOCALES.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((index - 1 + LOCALES.length) % LOCALES.length)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(LOCALES.length - 1)
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  function choose(next: Locale) {
    setLocale(next)
    close()
  }

  const current = LOCALE_META[locale]

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close(false) : openWith(LOCALES.indexOf(locale)))}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={t('footer.languageAria')}
        className={cn(
          // Explicit pixels, not min-h-11. This app sets a 15px root font, so
          // Tailwind's rem-based 11 resolves to 41.25px and quietly misses the
          // 44px touch target. The Button primitive uses min-h-[32px] for the
          // same reason.
          'flex min-h-[44px] items-center gap-1.5 rounded-control px-2.5 text-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
          onDark
            ? 'text-[#9FB5AC] hover:text-white focus-visible:ring-emerald-300 focus-visible:ring-offset-emerald-800'
            : 'border border-clay bg-white/70 text-emerald-950 hover:bg-sand focus-visible:ring-emerald-500 focus-visible:ring-offset-bone',
        )}
      >
        <Globe className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden />
        <span className="truncate">{current.endonym}</span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')}
          strokeWidth={1.5}
          aria-hidden
        />
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('settings.languageSelectAria')}
          className={cn(
            // Opens upward in the footer, where there is no room below.
            'absolute z-50 min-w-44 overflow-hidden rounded-card border border-clay bg-white py-1 shadow-lg',
            onDark ? 'bottom-full mb-1 left-0' : 'top-full mt-1 left-0',
          )}
        >
          {LOCALES.map((code, i) => {
            const meta = LOCALE_META[code]
            const selected = code === locale
            return (
              <li key={code} role="none">
                <button
                  ref={(el) => { optionRefs.current[i] = el }}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  lang={meta.code}
                  tabIndex={i === active ? 0 : -1}
                  onClick={() => choose(code)}
                  onKeyDown={(e) => onOptionKeyDown(e, i)}
                  className={cn(
                    'flex min-h-[44px] w-full items-center gap-2 px-3 text-left text-sm transition-colors',
                    'focus-visible:outline-none focus-visible:bg-sand',
                    selected ? 'font-medium text-emerald-900' : 'text-emerald-900/75',
                    'hover:bg-sand',
                  )}
                >
                  <Check
                    className={cn('h-4 w-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')}
                    strokeWidth={2}
                    aria-hidden
                  />
                  <span className="truncate">{meta.endonym}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
