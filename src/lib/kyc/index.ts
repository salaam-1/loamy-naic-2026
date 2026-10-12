/**
 * Identity-verification adapter seams for the Processor dashboard.
 *
 * SECURITY-REVIEW: this is a PLACEHOLDER surface only. Nothing here writes NIN,
 * BVN, or face-liveness data anywhere. The whole KYC UI is gated behind the
 * `processor_kyc` feature flag (default OFF) and stays off until the legal /
 * compliance path is cleared. When that happens, the real providers get wired
 * in *behind these same function signatures* — no caller changes needed.
 *
 * Do NOT:
 *   - call a live NIN/BVN provider from here,
 *   - persist raw identity numbers to any table,
 *   - remove the `processor_kyc` flag gate from the callers.
 */

export interface CacLookupResult {
  found: boolean
  company_name?: string
  rc_number?: string
  status?: string
}

export interface LivenessResult {
  passed: boolean
  reference?: string
}

/**
 * CAC company lookup by RC number. Placeholder — returns "not implemented" so
 * the UI shows a manual-entry fallback. Wire a real CAC/verification provider
 * here later, behind the same signature.
 */
export async function lookupCac(_rcNumber: string): Promise<CacLookupResult> {
  // SECURITY-REVIEW: no network call, no data written. Placeholder only.
  return { found: false }
}

/**
 * Face-liveness check for a company officer. Placeholder — never runs while
 * `processor_kyc` is OFF, and even when called returns a non-committal result
 * with no capture/persist. Real liveness SDK gets wired here later.
 */
export async function runFaceLiveness(): Promise<LivenessResult> {
  // SECURITY-REVIEW: no camera capture, no upload, no storage. Placeholder only.
  return { passed: false }
}
