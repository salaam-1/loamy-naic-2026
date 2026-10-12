# Security baseline

**Phase 0 deliverable.** Covers the checklist in Part 4 of the build directive.
Every line below is either *proved by a test*, *read in source*, or *open* —
labelled as such, never asserted.

Last reviewed: 2026-09-19.

---

## Findings resolved in Phase 0

### 1. Privilege escalation: any member could grant themselves verification rights — **HIGH, FIXED**

`loamy_can_verify(uid)` is `platform_role = 'growth_partner' AND
role_data.can_verify = true`. Both halves were client-writable:

- `profiles.platform_role` could be set with a plain `UPDATE`, side-stepping
  `loamy_switch_role`'s entitlement check entirely;
- `role_details.role_data` is a self-writable jsonb blob and `can_verify` was
  read straight out of it.

Chaining them let **any signed-in member** pass `loamy_can_verify`, which gates
claiming verification tasks, submitting evidence, and **reading other members'
private farm detail** (`20260715090004`).

Fixed in `20260919110001`: BEFORE-UPDATE/INSERT triggers refuse both changes
unless they arrive through an authorised definer RPC (which raises a session
flag) or from an admin. `loamy_set_initial_role` was added for onboarding,
since the column is no longer client-writable.

Proved by `tests/security/privilege-escalation.test.ts`, including the full
chain end to end. Regression-guarded by
`tests/security/onboarding-role-path.test.ts`.

No evidence of exploitation: `audit_events` holds no unexplained
`role_changed` rows.

### 2. Payment webhook had never booted — **HIGH, FIXED**

`paystack-webhook` declared `const expected` twice in one scope (the HMAC
digest and the expected kobo amount). That is a `SyntaxError`, so the module
never instantiated. Every Paystack delivery got `BOOT_ERROR` / HTTP 503.

**This was pre-existing** — present in commit `607be7a`, confirmed by parsing
that revision. Consequence: since the function was first deployed, **no payment
has ever been confirmed by webhook.** Orders never moved to `in_escrow` by this
path and escrow funding never completed through it.

Fixed by renaming to `expectedSignature` / `expectedKobo` and redeploying. The
function now returns 401 to unsigned and wrongly-signed requests, proved by
`tests/security/money-and-webhooks.test.ts`.

**Operational follow-up required:** any order or escrow row created before
2026-09-19 may be stranded in a pre-confirmation state. Reconcile against
Paystack before going live.

### 3. `react-router` CVEs — **MODERATE, FIXED**

Two moderate advisories (open redirect via backslash in `<Link>`/`useNavigate`;
constructor injection in SSR hydration). No patched 6.x exists, so upgraded
6.30.4 → 7.18.4. Typecheck, build and a nine-route browser smoke test all pass.
`npm audit --omit=dev` now reports zero vulnerabilities.

The SSR advisory never applied — this is a client-only SPA.

---

## Verified clean

| Area | Status | Basis |
|---|---|---|
| RLS enabled | All 70 tables, no exceptions | Static check across all migrations |
| `SECURITY DEFINER` hygiene | Every function pins `search_path` | Static check; closes the classic escalation vector |
| `service_role` exposure | Not present in `src/`, `.env`, or any client bundle | Grep; only mentioned in warning comments |
| Cross-user reads | Denied on 10 owned tables | **Tested** |
| Cross-user writes | Denied | **Tested** |
| Anonymous access | Blind to 12 private tables; public views work | **Tested** |
| Self-promotion to admin | Denied | **Tested** |
| Self-verification badge | Denied | **Tested** |
| Wallet writes from client | Denied — no insert policy exists | **Tested** |
| Wallet overdraw | Denied | **Tested** |
| Withdrawal without verified account | Denied | **Tested** |
| Reading another member's balance | Denied | **Tested** |
| Webhook signature verification | HMAC-SHA512 over the raw body, then re-verified with the provider, then amount cross-checked | Source + **tested** for rejection |
| BVN storage | Not stored, and there is nowhere to store one. `bvn_encrypted`/`nin_encrypted` were DROPPED; a probe returns 42703. Only the `bvn_verified`/`nin_verified` booleans and an opaque `kyc_reference` remain | `hardening-pass.test.ts` asserts the columns are absent; live schema re-verified 2026-09-21 |
| Farm coordinates | Excluded from every public view | Source |
| Private evidence bucket | `verification-evidence` is private, signed-URL only | Source |

---

## Open findings

Not fixed in Phase 0. Listed with the phase that should close them.

| Sev | Finding | Detail | Close in |
|---|---|---|---|
| **High** | `profiles` base RLS unreviewed | The policy lives in the Founding Member Portal repo, which is not available here. `profiles` is the table everything joins to | Phase 1 — pull it into this repo |
| **High** | Webhook positive path unproven | Rejection is tested; a valid signed delivery and a duplicate delivery are not. Idempotency is designed but unexercised | Phase 7 |
| **Med** | Growth Partner evidence is unvalidated | `verification_tasks.evidence` is a free jsonb blob. No GPS consistency, timestamp validation, duplicate-evidence detection or pattern analysis (directive §7) | Phase 3 |
| **Med** | CORS is `*` on all Edge Functions | Low practical risk — a third-party site cannot read a token it does not have — but the allowlist should be explicit | Phase 7 |
| **Med** | No reconciliation job | Nothing compares the Loamy ledger against the provider's balance. A divergence would be invisible | Phase 7 |
| **Med** | `service_directory` is readable by every signed-in member (`using (true)`) | Now includes a street address. Defensible for a directory, but should be a deliberate product decision | Phase 4 |
| **Med** | No rate limiting | Nothing throttles signup, RPC calls or Edge Function invocations beyond Supabase defaults | Phase 7 |
| **Low** | Shared admin credential | `admin-explore` is a persistent shared login documented in `scripts/TEST-LOGINS.md`. Delete before public launch | Before launch |
| **Low** | Unused BVN columns | Correctly unused, but their existence invites a future mistake. Consider dropping | Phase 1 |

---

## Standing rules

These are not suggestions; a review should reject changes that break them.

1. **Never trust the frontend for authorization.** Role checks in React decide
   what to *render*. RLS and definer RPCs decide what is *permitted*.
2. **Every `SECURITY DEFINER` function sets `search_path = public`.** No
   exceptions — the one time it is forgotten is the escalation.
3. **`service_role` never leaves the server.** Not in `.env`, not in a bundle,
   not in a comment example.
4. **No BVN in Loamy.** Not a column, not a log, not frontend state, not a URL.
   The partner bank collects and owns it.
5. **RLS denial is usually zero rows, not an error.** Assert on rows, or the
   test passes against a table with no policy at all.
6. **Money state transitions happen server-side.** The client may request; it
   may never assert an outcome.
7. **A new privileged column needs a trigger, not just a policy.** Owner-writable
   tables let a member set any column on their own row.
