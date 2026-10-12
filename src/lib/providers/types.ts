/**
 * The shape every external provider adapter shares.
 *
 * WHY A COMMON SHAPE
 *   Loamy talks to a bank, a payment processor, a weather service, a map
 *   tile server, an SMS gateway and (later) a language model. They have
 *   nothing in common as businesses, but they have four things in common as
 *   dependencies: they can be absent, they can be in sandbox, they fail in
 *   ways the domain must not inherit, and they must never be able to claim
 *   something happened that did not.
 *
 * THE RULE THAT MATTERS MOST
 *   `mode` is not decoration. A `sandbox` adapter's output must be
 *   distinguishable from a `live` adapter's output at every layer that
 *   carries it — in the return value, in whatever is persisted, and in what
 *   the member is shown. Loamy already does this in the database
 *   (`banks.integration_mode`, `financing_applications.decision_source`,
 *   `is_sandbox`) and these types carry the same distinction through the
 *   application tier so the two cannot drift apart.
 *
 *   A `disabled` provider is not an error state. It is a configuration, and a
 *   workflow that needs it is not offered rather than offered-and-broken.
 */

/** How a provider is connected. Mirrors `banks.integration_mode`. */
export type ProviderMode = 'live' | 'sandbox' | 'disabled'

export interface ProviderInfo {
  /** Stable adapter key, e.g. 'open-meteo', 'paystack', 'sterling'. */
  readonly key: string
  /** What a member would call it. */
  readonly label: string
  readonly mode: ProviderMode
}

/**
 * Every provider call returns this rather than throwing.
 *
 * A thrown provider error tends to become either a crash or a silent catch,
 * and Phase 4 slice 2 established what a silent catch costs. An explicit
 * result forces the caller to decide what to show.
 */
export type ProviderResult<T> =
  | { ok: true; value: T; mode: ProviderMode }
  | { ok: false; error: ProviderError }

export interface ProviderError {
  /**
   * A Loamy-side classification, NOT the provider's own code. Mapping happens
   * in the adapter so the domain never learns a vendor's vocabulary.
   */
  kind:
    | 'not_configured'   // no adapter registered, or mode is disabled
    | 'unauthorized'     // credentials rejected
    | 'rejected'         // the provider understood and refused
    | 'not_found'
    | 'invalid_request'  // our fault; do not retry unchanged
    | 'rate_limited'
    | 'timeout'
    | 'unavailable'      // provider down; retryable
    | 'unknown'
  /** Safe to show a member. Never a raw vendor payload. */
  message: string
  /** The provider's own code, kept for logs and support. Never rendered. */
  providerCode?: string
  /** Whether retrying the identical request could succeed. */
  retryable: boolean
}

export function providerError(
  kind: ProviderError['kind'],
  message: string,
  extra: { providerCode?: string; retryable?: boolean } = {},
): ProviderError {
  return {
    kind,
    message,
    providerCode: extra.providerCode,
    // Only these three are safe to retry unchanged. Everything else either
    // will not change, or must not be repeated blindly against money.
    retryable: extra.retryable ?? ['rate_limited', 'timeout', 'unavailable'].includes(kind),
  }
}

export const NOT_CONFIGURED: ProviderError = providerError(
  'not_configured',
  'This integration is not configured yet.',
  { retryable: false },
)

/**
 * A request that must not be applied twice.
 *
 * Any operation that moves money, opens an account or submits an application
 * carries one of these. The key is generated from Loamy's own business
 * reference (TXN-…, FIN-…) rather than a random value, so a retry after a
 * timeout produces the SAME key and the provider can recognise it. A random
 * key per attempt would make idempotency impossible, which is the usual way
 * this is got wrong.
 */
export interface Idempotent {
  idempotencyKey: string
}

/** Build an idempotency key from a Loamy business reference plus an operation. */
export function idempotencyKey(businessRef: string, operation: string, attemptOf?: string): string {
  return [businessRef, operation, attemptOf].filter(Boolean).join(':')
}

/**
 * An event received FROM a provider (webhook, callback, poll result).
 *
 * Deliberately not trusted. `verified` records whether the adapter checked a
 * signature; an unverified event may be logged but must never be allowed to
 * change authoritative state. Loamy has been caught by this class of problem
 * before — the payment webhook path already enforces signature verification.
 */
export interface ProviderEvent<T = unknown> {
  providerKey: string
  /** The provider's own event id, used to reject replays. */
  externalId: string
  type: string
  receivedAt: string
  /** FALSE means the signature did not check out, or there was none. */
  verified: boolean
  mode: ProviderMode
  payload: T
}
