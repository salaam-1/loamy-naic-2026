export const PLATFORM_ROLE_SLUGS = [
  'farmer',
  'trader',
  'exporter',
  'buyer',
  'warehouse_owner',
  'logistics_provider',
  'growth_partner',
  'input_supplier',
  'processor',
] as const

export type PlatformRole = (typeof PLATFORM_ROLE_SLUGS)[number]

export function isPlatformRole(value: string | null | undefined): value is PlatformRole {
  return !!value && (PLATFORM_ROLE_SLUGS as readonly string[]).includes(value)
}

/**
 * Mirrors the SQL function loamy_normalize_role: maps the portal's free-text
 * `category` onto a canonical role slug, or null when there is no confident
 * match (in which case the user picks a role during onboarding).
 */
export function normalizeRole(raw: string | null | undefined): PlatformRole | null {
  if (!raw) return null
  const norm = raw.trim().toLowerCase().replace(/[\s/-]+/g, '_')
  const map: Record<string, PlatformRole> = {
    farmer: 'farmer',
    farming: 'farmer',
    trader: 'trader',
    trading: 'trader',
    exporter: 'exporter',
    export: 'exporter',
    buyer: 'buyer',
    warehouse_owner: 'warehouse_owner',
    warehouse: 'warehouse_owner',
    warehousing: 'warehouse_owner',
    logistics_provider: 'logistics_provider',
    logistics: 'logistics_provider',
    growth_partner: 'growth_partner',
    input_supplier: 'input_supplier',
    input_supply: 'input_supplier',
    input_suppliers: 'input_supplier',
    processor: 'processor',
    processing: 'processor',
    offtaker: 'processor',
    off_taker: 'processor',
    miller: 'processor',
  }
  return map[norm] ?? null
}

/** The `profiles` row — portal columns plus the Stage 1 additions. */
export interface Profile {
  id: string
  digital_id: string | null
  full_name: string | null
  phone: string | null
  category: string | null
  state: string | null
  role: string // 'member' | 'admin'
  founding_member: boolean | null
  referral_count: number | null
  profile_completion: number | null
  created_at: string
  // Stage 1 additions ('bank' is the Stage 5 operational role — admin-created
  // officers only; never offered at public signup)
  platform_role: PlatformRole | 'bank' | null
  onboarding_complete: boolean
  avatar_url: string | null
  /** Stage 6 suspension flag — false blocks the app and the action paths. */
  active: boolean
  // Stage 9 (Phase 2) — KYC verified STATUS only (never the raw BVN/NIN).
  bvn_verified: boolean
  nin_verified: boolean
  // bvn_encrypted / nin_encrypted no longer exist: both columns were DROPPED
  // in migration 20260919270001. Loamy stores no BVN or NIN. These two
  // booleans record that a bank verified someone; they are not the number.

  // Block 1 — public identity.
  /** Public handle. Written only by loamy_set_username. */
  username: string | null
  username_changed_at: string | null
  headline: string | null
  bio: string | null
  /** 'public' | 'members' (default) | 'private'. */
  profile_visibility: string
}

export interface RoleDetails {
  user_id: string
  role_data: Record<string, unknown>
  updated_at: string
}

export interface NotificationRow {
  id: string
  user_id: string
  title: string
  body: string
  type: string
  read: boolean
  created_at: string
}

/**
 * Feature flags from platform_config. Unknown/absent keys are treated as
 * false everywhere — later stages ADD keys and flip them on, so Stage 1
 * ships with every un-built surface hidden.
 */
export type FeatureFlags = Record<string, boolean>

export const DEFAULT_FLAGS: FeatureFlags = {
  marketplace: false,
  financing_applications: false,
  verification_workflow: false,
  // Processor / large-offtaker suite. The role itself works once assigned;
  // these gate the not-yet-built procurement sections (RFQs → analytics) and
  // the identity-verification surface, which stays OFF until legally cleared.
  processor_procurement: false,
  processor_kyc: false,
  // Supplier-side "Open Buy Requests" board (bidding on processor RFQs).
  supplier_bidding: false,
  // Co-pilot. Stated explicitly rather than relying on an absent key being
  // falsy, so the default survives someone adding the key to platform_config.
  copilot: false,
  // Loam -- the N-ATLaS-backed assistant. INDEPENDENT of `copilot` on purpose:
  // the deterministic Co-pilot stays the fallback and keeps working on its own
  // flag, so turning Loam on (or off, mid-demo) changes nothing else.
  loam: false,
  // NEVER default this on. Loamy does not predict a price: the naive baseline
  // beat every model tried, so a forecast would be a number with a confident
  // shape and no evidence behind it. There is deliberately no code path that
  // renders one -- this flag guards a seam that stays empty until a model has
  // actually beaten the baseline and the claim can be substantiated.
  copilot_predictions: false,
}
