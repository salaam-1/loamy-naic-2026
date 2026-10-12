import { LOCALE_META, type Locale } from './types'

/**
 * Locale-aware formatting.
 *
 * THE MONEY RULE, AND WHY IT IS NOT A LOCALE DECISION
 *   Naira is formatted on the Nigerian convention in every language. The amount
 *   and the currency are business facts: a contract for ₦250,000 is for
 *   ₦250,000 whether the member reads the screen in Hausa, Igbo, Yoruba or
 *   French. Rendering it as "250 000,00 ₦" because the interface language is
 *   French would change how a financial figure reads on a financing
 *   application, and no conversion, rounding or re-grouping of money is in
 *   scope for a localization feature.
 *
 *   Dates, counts and relative times are presentation and DO follow the locale.
 */

const nairaByLocale = new Map<Locale, Intl.NumberFormat>()

/**
 * Money. Deliberately pinned to en-NG regardless of UI language — see above.
 * Kept here rather than in lib/utils so the rule has one home and one reason.
 */
export function formatMoney(amount: number): string {
  let f = nairaByLocale.get('en')
  if (!f) {
    f = new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      maximumFractionDigits: 0,
    })
    nairaByLocale.set('en', f)
  }
  return f.format(amount)
}

/** Plain counts and quantities: these DO follow the locale. */
export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(LOCALE_META[locale].intl).format(value)
}

export function formatDateShort(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString(LOCALE_META[locale].intl, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateLong(date: Date, locale: Locale): string {
  return date.toLocaleDateString(LOCALE_META[locale].intl, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/**
 * Relative time ("3 days ago"). Intl.RelativeTimeFormat has no data for several
 * Nigerian languages in most runtimes, and it falls back to the closest
 * available locale silently. That is acceptable here precisely because the
 * output is approximate by nature; an exact date never routes through this.
 */
export function formatRelative(iso: string, locale: Locale, now: Date = new Date()): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return '-'
  const seconds = Math.round((then.getTime() - now.getTime()) / 1000)
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31536000], ['month', 2592000], ['week', 604800],
    ['day', 86400], ['hour', 3600], ['minute', 60],
  ]
  const rtf = new Intl.RelativeTimeFormat(LOCALE_META[locale].intl, { numeric: 'auto' })
  for (const [unit, secondsIn] of units) {
    if (Math.abs(seconds) >= secondsIn) return rtf.format(Math.round(seconds / secondsIn), unit)
  }
  return rtf.format(seconds, 'second')
}

/**
 * Plural selection by the locale's own rules, not by `n === 1`.
 *
 * The caller supplies the key and this returns the key to look up: `cart.items`
 * for one, `cart.items_plural` otherwise. English and French split at one;
 * other locales may not, and Intl.PluralRules is what knows that. Packs that
 * need more than two forms can add `_zero`, `_few`, `_many` and they resolve
 * here without a code change.
 */
export function pluralKey(base: string, count: number, locale: Locale): string {
  const category = new Intl.PluralRules(LOCALE_META[locale].intl).select(count)
  return category === 'one' ? base : `${base}_${category === 'other' ? 'plural' : category}`
}
