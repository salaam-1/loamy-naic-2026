/**
 * A failure, worded in the member's language where that is possible.
 *
 * `errorMessage(e, fallback)` returns one English string and is still correct
 * for logs and for tests. A screen needs the same decision translated, which
 * means asking `errorParts` which reading it chose and running the key through
 * `tOr`. A failure the app does not recognise has no key and keeps the
 * server's own English wording, because that wording is true and a guessed
 * translation of it would not be.
 */
import { useCallback } from 'react'
import { errorParts } from '@/lib/errors'
import { useT } from '@/lib/i18n'

export function useErrorText() {
  const { t, tOr } = useT()
  return useCallback(
    (e: unknown, fallbackKey: string, fallbackEnglish: string) => {
      const parts = errorParts(e, '')
      if (parts.key) return tOr(parts.key, parts.text)
      return parts.text || tOr(fallbackKey, fallbackEnglish)
    },
    [t, tOr],
  )
}
