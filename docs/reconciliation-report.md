# Final reconciliation report

Against the FINAL RECONCILIATION, CONFIGURATION, BUG-FIX & PRODUCTION HARDENING
DIRECTIVE (§1–35). Written 2026-09-20.

**Headline: not production ready, and this report does not claim otherwise.**
The platform logic is built and tested. The three things that make a release
safe — a separate test environment, a named bank, and a proven payment webhook
— are not in place, and two of the three are not engineering work.

---

## 1. Audit matrix

Re-audited against the live database, not the source tree.

| Area | Verdict | Evidence |
|---|---|---|
| RLS coverage | **KEEP** | every table in `public` has RLS enabled |
| `SECURITY DEFINER` hygiene | **KEEP** | every definer function pins `set search_path = public` |
| Identity / provenance | **KEEP** | farm → cycle → harvest → batch chain intact |
| CommodityBatch | **KEEP** | 0 batches with negative `available_quantity`; 0 quantity drift against the event log |
| Verification engine | **FIXED** | GPS reference now derived; clock-skew false positive removed |
| Marketplace / listings | **KEEP** | batch-backed claims cannot be faked by direct write |
| Transactions | **KEEP** | three independent machines: status / payment / fulfilment |
| Logistics, warehouse, traceability | **KEEP** | generalised from award-scoped to transaction-or-award |
| Financing | **KEEP** | Loamy never writes `approved_amount` |
| Ledger | **KEEP** | double-entry; 0 unbalanced groups |
| Escrow | **FIXED** | release now charges the frozen fee rule, not live config |
| BVN / NIN | **FIXED** | storage columns dropped; no column can hold the number |
| Growth Partner anonymity | **FIXED** | agent identity no longer reachable by the inspected party |
| Fee schedule | **REPLACED** | one global bps → `fee_schedules` + per-deal snapshot |
| Reconciliation | **ADDED** | classifies and audits; never auto-corrects |
| Test environment | **MISSING** | tests run against production |
| Deployment | **MISSING** | never deployed; no CI |
| Ratings, usernames, referrals, discovery intelligence | **MISSING** | §3, §4, §5, §24 not built |
| Traceability Explorer UI | **MISSING** | backend complete, UI does not exist |
| Per-role dashboard redesign | **MISSING** | §25, §26 not built |
| GP commission triggers | **OPEN** | §8 — needs a commercial rate first |
| Escrow legal position | **OPEN** | not an engineering question |

## 2. What was fixed this pass

Four audit findings:

- **§11/§27** — `profiles.bvn_encrypted` and `profiles.nin_encrypted` dropped.
  Both were empty. A column that *can* hold a BVN is the violation.
- **§7** — a requester could read `verification_tasks.assigned_to` and resolve
  it to a real name via `loamy_public_profiles`. Closed.
- **§16** — fees were one global `platform_fee_bps`. Now a schedule.
- **§15** — no reconciliation existed. Now `loamy_run_reconciliation`.

Two defects the new tests then exposed in code written earlier the same day:

- **Escrow release ignored the fee snapshot.** The snapshot was written at
  acceptance and then not used — release read live config. Editing the schedule
  would still have moved the economics of an agreed deal, which is the exact
  thing the snapshot exists to prevent.
- **`captured_before_case_existed` fired on clock skew.** It compared the
  agent's phone clock to the Postgres clock with zero tolerance, while the
  `future_timestamp` check on the line above already allowed five minutes. An
  honest capture from a slow phone was being flagged as a backdated photograph.

## 3. Financial correctness

- Ledger is double-entry; every economic event posts lines summing to zero.
- `loamy_post_ledger` is not granted to `authenticated` at all.
- 0 unbalanced entry groups in production.
- Escrow release is reachable only from `accepted`, only from `delivered`, and
  only the buyer can set it.
- Fee charged at release = the rule frozen at acceptance, recorded on the
  escrow event as `fee_applied.source = 'fee_snapshot'`.

## 4. Loamy is not the lender, the bank, or the custodian

Enforced by trigger and policy, not convention. `approved_amount`,
`disbursed_amount` and `bank_id` refuse client writes; only an officer of the
**assigned** bank can set them through `loamy_financing_decision`.

## 5. Security posture

- No client-side role check is a security boundary; all are mirrored in RLS.
- No `service_role` credential exists anywhere in the app or `.env`.
- Privilege escalation via self-granting `can_verify` is closed by BEFORE
  triggers plus session flags.
- Append-only event logs have no client write path.

## 6. Test coverage

| Suite | Count | Runs against |
|---|---|---|
| `npm test` (unit) | 33 | nothing — offline |
| `npm run test:security` | 257 | **production** |

All 290 green as of `6b08e5f`.

## 7. The test environment problem

`tests/security` creates real accounts in the production Supabase project. The
§29 classification run reports:

| Bucket | Count | Range |
|---|---|---|
| `suite_generated` | 182 | 2026-09-19 → 2026-09-20 |
| `owner_alias` | 69 | 2026-07-13 → 2026-09-19 |
| `placeholder_domain` | 45 | 2026-07-12 → 2026-08-07 |
| `likely_real` | **57** | 2026-07-11 → 2026-09-16 |
| **Total** | **353** | |

This corrects a figure carried through the whole build. Production was
described as holding "247 real profiles". It holds 353 rows, of which **57 look
like real members** — the rest are test and operational accounts, 182 of them
created by this build's own test suite.

Nothing has been deleted. The classification is asserted by rule in
`tests/security/test-account-hygiene.test.ts`, including tests in the dangerous
direction — that real-looking Nigerian member emails are never matched by a
deletion rule.

## 8. Deployment

Nothing is deployed. No Vercel, Netlify or CI config has ever existed in this
repository's history. See `docs/deployment.md` for the three-environment target
and the release gates.

## 9. Data integrity checks run against production

| Check | Result |
|---|---|
| batches with negative `available_quantity` | 0 |
| quantity drift between batches and their event logs | 0 |
| reconciliation exceptions | 0 |
| profiles holding `bvn_encrypted` | 0 (column dropped) |
| deprecated `wallet_entries` rows | 0 |

## 10. Known-unfixed, with reasons

| Item | Why not |
|---|---|
| §3 usernames, §4 ratings, §5 discovery, §24 referrals | Not started. Product surface, not hardening |
| §8 GP commission triggers | Needs a commercial rate, which is a business decision |
| §19 Traceability Explorer UI | Backend complete; UI is a build, not a fix |
| §25/§26 dashboard redesign | Large; deliberately out of a hardening pass |
| Real signed webhook test | Needs Paystack credentials and a public endpoint |
| Staging Supabase project | Needs a new project created under the org account |

## 11. The webhook

`paystack-webhook` had never booted. `const expected` was declared twice in one
handler scope — a SyntaxError, returning `BOOT_ERROR` / 503 to every call. It
was fixed earlier in this build (`a807546` lineage). The consequence stands on
the record: **no payment has ever been confirmed by webhook in this project.**

Only *rejection* is tested. A real signed event has never been proven.

## 12. Migrations

29 migrations added by this build, `20260919100001` → `20260919290001`, all
applied to production. Forward-only; no migration has been edited after being
pushed. Two production columns were dropped, both empty, both because holding
them was the violation.

## 13. Documentation

`docs/security.md`, `docs/testing.md`, `docs/data-model.md`,
`docs/workflows.md`, `docs/traceability.md`, `docs/financial-boundaries.md`,
`docs/deployment.md`, and this report.

## 14. Production-readiness verdict

**No.**

The directive says not to claim it unless the deployment, security and
financial gates actually pass. Deployment has no environment separation.
Financial has no named bank and no proven webhook. Security passes.

What *is* true: the business logic, authorization model, state machines,
ledger and audit trail are built and are covered by 290 passing tests.

## 15. Commit hashes

| Commit | What |
|---|---|
| `1675e24` | Production-readiness audit against the build directive |
| `a24cc48` | Phase 0 — testing and security baseline |
| `29bb304` | Phase 1 — digital identity, provenance, farm → cycle → harvest |
| `69ab6c6` | Phase 2 — CommodityBatch and the batch event log |
| `302be8e` | Phase 3 — verification engine |
| `b5d6ede` | Phase 4 — the marketplace sells real batches |
| `bdb3bab` | Phase 5 — transaction state machine, and disputes |
| `d1bd57e` | Phases 8–12 — logistics, warehouse, traceability, intelligence, institutions |
| `a807546` | Phases 6 and 7 — financing, double-entry ledger, escrow |
| `6b08e5f` | Hardening pass — BVN, agent anonymity, fee schedule, reconciliation |

Branch `sept-2026-platform-changes`, pushed to `origin`. Not merged to `main`.
