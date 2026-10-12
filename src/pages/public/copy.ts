/**
 * Shared public-page structure.
 *
 * THIS FILE NO LONGER HOLDS ENGLISH
 *   It used to export the sentences themselves, which meant every public page
 *   rendered English no matter what language the visitor had chosen. It now
 *   exports the STRUCTURE — which pillars exist, in what order, with which icon
 *   — and the translation keys for their words. The words live in
 *   src/lib/i18n/packs, like all other interface copy.
 *
 *   The disclaimer is a compliance statement rather than marketing copy, so it
 *   is keyed too and every pack must carry it in full or fall back to English.
 */

export const DISCLAIMER_KEY = 'public.disclaimer'

export const PILLARS = [
  { key: 'identity', icon: 'BadgeCheck' },
  { key: 'financing', icon: 'Landmark' },
  { key: 'marketplace', icon: 'Store' },
  { key: 'intelligence', icon: 'LineChart' },
] as const

export const STEPS = [
  { n: 1, key: 'register' },
  { n: 2, key: 'verify' },
  { n: 3, key: 'finance' },
  { n: 4, key: 'sell' },
  { n: 5, key: 'store' },
  { n: 6, key: 'history' },
] as const

/**
 * The roles shown on "Who it is for", in display order.
 *
 * The slug matches PlatformRole, so the NAME comes from `role.<slug>` in the
 * roles pack and the one-line description from `public.role.<slug>` here. A
 * role is named the same way on the public site as it is inside the product.
 */
export const ROLES = [
  'farmer',
  'trader',
  'exporter',
  'buyer',
  'input_supplier',
  'warehouse_owner',
  'logistics_provider',
  'growth_partner',
] as const
