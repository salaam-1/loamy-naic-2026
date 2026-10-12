import { supabase } from '@/lib/supabase'
import { isLocale, type Locale } from '@/lib/i18n/types'

/**
 * The member's saved interface language.
 *
 * WHY AN RPC AND NOT A TABLE WRITE
 *   The preference lives in role_details.role_data, alongside admin-granted
 *   keys like can_verify and the bank officer's bank_id. RLS would permit the
 *   client to update that row, but a client-side read-modify-write of the whole
 *   jsonb puts those keys on a round trip through the browser, where a stale
 *   read can drop them. loamy_set_language merges the single key server-side.
 *
 *   The RPC takes no user_id. There is no shape of this call that writes
 *   somebody else's preference; the caller is auth.uid().
 */
export async function saveLanguagePreference(locale: Locale): Promise<void> {
  if (!isLocale(locale)) throw new Error(`Unsupported language: ${locale}`)
  const { error } = await supabase.rpc('loamy_set_language', { p_lang: locale })
  if (error) throw new Error(error.message)
}

/**
 * Read a saved preference out of an already-loaded role_data blob.
 *
 * Returns null when there is none, and null is meaningful: it means resolve
 * from the device and the browser instead. A member who has never chosen a
 * language does not have one silently written to their account by having
 * visited on a French phone.
 */
export function languageFromRoleData(roleData: unknown): Locale | null {
  if (!roleData || typeof roleData !== 'object') return null
  const raw = (roleData as Record<string, unknown>).language
  return isLocale(raw) ? raw : null
}
