/**
 * Referrals — the presentation contract.
 *
 * One rule governs this file, and it is a product decision rather than a
 * styling one:
 *
 *   AN ORDINARY REFERRAL SURFACE MUST NEVER SHOW A MONEY FIGURE.
 *
 * Not "₦0 earned", not "pending payout", not a currency symbol anywhere.
 * A zero implies an affiliate programme that simply has not paid yet, which
 * is the opposite of what Loamy is doing. The server already withholds the
 * data; these functions make sure the UI cannot invent it.
 *
 * Growth Partner earnings are a different surface entirely, in fieldops.ts.
 */

export type ReferralStatus =
  | 'created' | 'clicked' | 'registered'
  | 'qualified' | 'benefit_earned' | 'benefit_redeemed' | 'invalidated'

export const REFERRAL_STATE: Record<ReferralStatus, { label: string; tone: 'good' | 'busy' | 'idle' | 'bad' }> = {
  created:          { label: 'Link opened', tone: 'idle' },
  clicked:          { label: 'Link opened', tone: 'idle' },
  registered:       { label: 'Signed up', tone: 'busy' },
  qualified:        { label: 'Qualified', tone: 'good' },
  benefit_earned:   { label: 'Benefit earned', tone: 'good' },
  benefit_redeemed: { label: 'Benefit used', tone: 'good' },
  invalidated:      { label: 'Not counted', tone: 'bad' },
}

export type BenefitKind =
  | 'recognition' | 'badge' | 'access' | 'early_access' | 'visibility' | 'resource'

export const BENEFIT_KIND_LABEL: Record<BenefitKind, string> = {
  recognition: 'Recognition',
  badge: 'Badge',
  access: 'Feature access',
  early_access: 'Early access',
  visibility: 'Marketplace visibility',
  resource: 'Learning resource',
}

export interface Benefit {
  id: string
  ref: string
  code: string
  label: string
  kind: BenefitKind
  status: 'earned' | 'redeemed' | 'expired' | 'revoked'
  awarded_at: string
  expires_at: string | null
}

export interface ReferredPerson {
  ref: string
  display: string
  status: ReferralStatus
  joined: string
  qualified_at: string | null
  progress: { needs?: string } | null
}

export interface ReferralSummary {
  code: {
    code: string
    is_username: boolean
    link_path: string
    programme: {
      ref: string
      name: string
      qualification: { type: string }
      attribution_window_hours: number
      benefits: { code: string; label: string; kind: BenefitKind }[]
    } | null
    note: string
  }
  counts: { registered: number; qualified: number; invalidated: number; total: number }
  people: ReferredPerson[]
  benefits: Benefit[]
  is_cash_programme: boolean
  note: string
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

/**
 * Anything rendered on the invite surface passes through here.
 *
 * It exists because "₦0 earned" is the single most likely way this page goes
 * wrong: a well-meaning developer adds a totals row, the number is zero
 * because there is no money, and the member concludes Loamy owes them.
 */
export function assertNoMoney(text: string): string {
  if (/[₦$]|\bNGN\b|\bnaira\b|\bearned\b.*\d|\bpayout\b|\bcommission\b/i.test(text)) {
    // Loud in development, harmless in production — the string is still
    // returned, because a blank label is worse than a wrong one.
    if (typeof console !== 'undefined') {
      console.warn('[referrals] money-shaped copy on a non-cash surface:', text)
    }
  }
  return text
}

/** What the invite page shows where an affiliate product would show a total. */
export function benefitsHeadline(s: ReferralSummary | null | undefined): {
  value: string
  caption: string
} {
  const earned = (s?.benefits ?? []).filter((b) => b.status === 'earned').length
  const used = (s?.benefits ?? []).filter((b) => b.status === 'redeemed').length
  const total = earned + used

  if (total === 0) {
    return {
      value: 'None yet',
      caption: 'Benefits appear once someone you invited qualifies.',
    }
  }
  return {
    value: `${total} benefit${total === 1 ? '' : 's'}`,
    caption: used > 0 ? `${earned} available · ${used} used` : `${earned} available`,
  }
}

/** The programme condition, in words a member can act on. */
export function qualificationLabel(type: string | undefined): string {
  switch (type) {
    case 'profile_complete': return 'completes their profile'
    case 'identity_verified': return 'has their identity verified'
    case 'first_transaction': return 'completes their first purchase or sale'
    case 'first_listing': return 'creates their first listing'
    case 'manual': return 'is reviewed by Loamy'
    default: return 'meets the current programme condition'
  }
}

/** The full referral link, from the path the server returned. */
export function referralUrl(origin: string, linkPath: string | undefined): string {
  if (!linkPath) return ''
  return `${origin.replace(/\/$/, '')}${linkPath}`
}

/** Why an attribution was refused, in words. */
const REFUSAL: Record<string, string> = {
  self_referral: 'You cannot refer yourself.',
  unknown_code: 'That referral code does not match anyone on Loamy.',
  already_attributed: 'This account already has a referrer, and that cannot be changed.',
  circular_referral: 'That would create a referral loop.',
  referrer_inactive: 'That account is not active.',
  referrer_not_eligible: 'That member cannot refer under the current programme.',
  attribution_window_closed: 'A referrer can only be recorded shortly after signing up.',
  no_active_programme: 'There is no referral programme running at the moment.',
}

export function attributionRefusal(reason: string | undefined): string {
  return REFUSAL[reason ?? ''] ?? 'That referral could not be recorded.'
}

/** Every refusal `loamy_attribute_referral` can return. */
export const ATTRIBUTION_REASONS = Object.keys(REFUSAL)

/**
 * The refusals worth telling a new member about, because they can act on
 * them: fix a mistyped code, or stop trying to refer themselves.
 *
 * The rest are Loamy's business, not theirs. Telling someone on their very
 * first screen that "there is no referral programme running" explains nothing
 * they can use and reads as a fault in their account.
 */
export const ACTIONABLE_REFUSALS = [
  'unknown_code',
  'self_referral',
  'already_attributed',
  'circular_referral',
  'attribution_window_closed',
]
