import { en } from './en'
import { fr } from './fr'
import { ha } from './ha'
import { ig } from './ig'
import { yo } from './yo'
import type { TranslationPack } from './en'
import type { Locale } from '../types'

/**
 * The pack registry.
 *
 * Adding a language is adding one directory and one line here. Nothing in the
 * application changes: components ask for keys, `translate()` walks
 * locale -> English -> key, and an absent key simply falls back. That is why a
 * language can ship incrementally instead of having to be complete first.
 */
export const PACKS: Record<Locale, TranslationPack> = { en, fr, ha, ig, yo }

/**
 * How far a pack can be trusted, recorded in code so the product cannot
 * accidentally claim more than is true.
 *
 * 'canonical'  the source language.
 * 'unreviewed' translated, but NOT yet checked by a native speaker. Usable, and
 *              honestly labelled; not something to describe to members as
 *              supported.
 * 'partial'    deliberately incomplete; the untranslated remainder falls back
 *              to English by design.
 *
 * `src/lib/i18n/glossary.md` carries the per-language confidence and names the
 * terms a reviewer should challenge first. Nothing here should be promoted to a
 * stronger status without that review actually happening.
 */
export type ReviewStatus = 'canonical' | 'unreviewed' | 'partial'

export const REVIEW_STATUS: Record<Locale, ReviewStatus> = {
  en: 'canonical',
  fr: 'unreviewed',
  ha: 'partial',
  ig: 'partial',
  yo: 'partial',
}

/** True only for a language a member could fairly be told the product supports. */
export function isMemberReady(locale: Locale): boolean {
  return REVIEW_STATUS[locale] === 'canonical'
}

export { en } from './en'
export type { TranslationKey, TranslationPack } from './en'
