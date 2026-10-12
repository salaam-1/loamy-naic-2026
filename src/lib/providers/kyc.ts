/**
 * KYC / IDENTITY PROVIDER SEAM — interface only, NOT implemented.
 *
 * BVN/NIN are NOT collected anywhere in this build, and there is nowhere to
 * put one. Verified against the live schema on 2026-09-21: `profiles` carries
 * `bvn_verified` and `nin_verified` (booleans) and `kyc_reference` (an opaque
 * provider handle) and NOTHING ELSE of this kind. A probe for `bvn`,
 * `bvn_encrypted`, `nin` and `nin_encrypted` returns 42703 for all four.
 *
 * An earlier version of this comment claimed "the reserved
 * profiles.bvn_encrypted / nin_encrypted columns exist but are written by
 * nothing". That was wrong, and a stale claim that sensitive columns exist is
 * its own hazard -- it invites someone to use them. They do not exist, and
 * they must not be created: a boolean saying verification happened, plus a
 * provider's own reference, is the whole of what Loamy keeps.
 *
 * This seam defines where a Phase-2 identity provider plugs in. The default
 * provider throws; no UI captures a BVN/NIN and no code path reaches a live
 * method.
 *
 * TODO(phase-2): implement a concrete provider (e.g. a licensed BVN/NIN
 * verification API) behind this interface and register via setKycProvider().
 *
 * SECURITY-REVIEW — HARD GATE, do this FIRST (see HANDOFF.md §3 item 1):
 * before any concrete provider is wired or any BVN/NIN is captured, design
 * encryption-at-rest (pgsodium/KMS envelope — the app must never see or store
 * plaintext), key management + rotation, column-level grants, access auditing,
 * consent capture, and data-retention. The verifyIdentity() contract below
 * returns only a pass/fail + provider reference — NEVER the raw number, and
 * never the document image — so nothing sensitive transits the app tier.
 */

export type KycField = 'bvn' | 'nin'

export interface KycVerificationRequest {
  user_id: string
  field: KycField
  /**
   * Opaque token from a provider-hosted capture widget — NOT the raw BVN/NIN.
   * The number itself must never reach Loamy's app or DB in plaintext.
   */
  capture_token: string
}

export interface KycVerificationResult {
  verified: boolean
  /** Provider-side reference for audit; never the raw identity number. */
  provider_reference: string
  checked_at: string
}

export interface KycProvider {
  readonly name: string
  /** Verify an identity field via a provider-hosted capture. Returns pass/fail
   * + reference only — never the raw number or document. */
  verifyIdentity(request: KycVerificationRequest): Promise<KycVerificationResult>
}

class NotConfiguredKycProvider implements KycProvider {
  readonly name = 'not-configured'
  verifyIdentity(): Promise<KycVerificationResult> {
    // Deliberate: no KYC provider ships in the shelf build. Collecting BVN/NIN
    // is blocked on the encryption-at-rest design in the SECURITY-REVIEW above.
    throw new Error(
      'No KYC provider is configured. BVN/NIN collection is disabled until the ' +
        'engineer-designed encryption-at-rest review is complete.',
    )
  }
}

let active: KycProvider = new NotConfiguredKycProvider()

/** Phase-2 entry point: register a concrete provider once the review is done. */
export function setKycProvider(provider: KycProvider): void {
  active = provider
}

export function getKycProvider(): KycProvider {
  return active
}

/** True only when a real provider has been registered (always false in shelf build). */
export function isKycProviderConfigured(): boolean {
  return active.name !== 'not-configured'
}
