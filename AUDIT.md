# Loamy — Production Readiness Audit

**Against:** Master Claude Code Build Directive (Rule 0)
**Repository:** `loamy-platform` @ `sept-2026-platform-changes`
**Live Supabase project:** `lsuqbjwlybzhyuvzgtdj`
**Date:** 2026-09-19
**Written for:** the engineer(s) who will take Loamy to production — assumes familiarity with Postgres/RLS and React, not with this codebase.

---

## 1. Method, and what this audit does not cover

Inspected: all 76 migrations, all 70 tables and 25 views, every RLS policy, all `SECURITY DEFINER` functions, storage buckets, the 7 Edge Functions, all 219 source files, routing, auth, and `npm audit`.

**Three things I could not verify and am not claiming:**

1. **Runtime RLS behaviour beyond what the verify scripts exercise.** Policies were read as SQL. `scripts/verify-*.mjs` prove a subset live; the rest is static reading.
2. **The pre-existing portal schema.** This app shares a database with the Founding Member Portal, a separate codebase I do not have. `profiles` policies in particular live there, not in these migrations — *the base RLS on the most important table in the system is outside this repo and was not reviewed.*
3. **Anything about the bank side.** No bank API exists yet, so every financing claim is untested against a real institution.

---

## 2. Headline judgement

The prototype is **better than "AI-built prototype" implies, and much further from the directive than it looks.**

What is genuinely strong: RLS is enabled on all 70 tables with no exceptions; every `SECURITY DEFINER` function sets `search_path` (the classic Postgres privilege-escalation hole is closed); money-moving logic already lives in Edge Functions with webhook signature verification and idempotency; the codebase carries honest `SECURITY-REVIEW` markers on sensitive surfaces; and there is a real discipline of never fabricating data.

What the directive exposes: the system is **a set of well-built dashboards, not a connected economic workflow.** The directive's most important principle — trace a commodity from farm to export — cannot be satisfied at all, because the entity it depends on does not exist. Roughly **40% of the directive has no implementation whatsoever**, and several of the missing pieces are structural, not features you can add later.

The single largest gap is not security. It is that **`CommodityBatch` does not exist**, and without it §4 (identity), §5 (provenance), §27 (traceability), §28 (verified transaction) and §47 (government trace) are all unimplementable.

---

## 3. KEEP

Production-quality or close. Do not rewrite.

| Area | Evidence | Note |
|---|---|---|
| RLS discipline | all 70 tables, verified | Enabled everywhere; own-row default; no client write path on sensitive tables |
| `SECURITY DEFINER` hygiene | all definer fns | Every one sets `search_path`. Keep this rule enforced in review |
| Webhook security | `paystack-webhook/index.ts` | HMAC-SHA512 over the raw body, re-verifies with the provider, cross-checks amount against server-computed total, idempotent transitions |
| Escrow state machine | `escrow_transactions` + `escrow_events` | Immutable event log beside mutable state; partial release supported |
| Company multi-tenancy | `loamy_user_company_ids()` | Definer helper avoids policy recursion; genuinely sound pattern — it is the right base for §3 |
| Public data surface | `loamy_public_listings` | Fixed safe column set, `security_invoker=false`, only view granted to `anon`. No coordinates, no phone |
| Private evidence bucket | `verification-evidence` | Private, signed-URL access. Correct |
| Bid ranking transparency | `src/lib/bids.ts` | Rule-based, reweightable, explicitly never called "AI" — matches directive §56 |
| Rule-based risk labelling | `loamy_risk_assessment` | Returns factors + points, explainable |
| No-fabrication discipline | throughout | Zeros render as zeros. Rare and worth protecting |

---

## 4. REFACTOR

Right concept, wrong shape for production.

| Item | Current state | Required change |
|---|---|---|
| **Business profiles** (§3) | `companies`/`company_members` exist but only procurement roles use them. Everyone else is a bare `profiles` row | Promote to a first-class `businesses` + `business_memberships` for *all* roles; add active-business selection; scope every query |
| **Ledger** (§20) | `wallet_entries` is single-entry with a `direction` column; `platform_transactions` is record-only | Move to double-entry with named accounts. States needed: Pending/Held/Available/Withdrawn/Reversed/Disputed/Failed — only some exist |
| **Fees** (§55) | One global `platform_config.platform_fee_bps` | Needs per user-type / transaction-type / bank / volume / agreement configuration |
| **Verification** (§6) | `verification_tasks` with `evidence jsonb` and 3 task types | Needs `VerificationCase` / `Evidence` / `Review` as separate entities, ~13 verification types, and evidence as rows not a JSON blob |
| **Audit events** (§52) | `audit_events` has actor/type/subject/detail | Missing `before/after` reference and `source`. Coverage is ~17 event types against the directive's ~28 |
| **Payment adapter** (§19, §50) | `src/lib/providers/payments.ts` is a stub nothing calls; Paystack is named directly in **11 files** including `escrow.ts`, `payments.ts`, `contracts.ts`, `rfqs.ts` | Real adapter; remove provider names from the domain layer |
| **Growth Partner** (§2, §22) | `partner_earnings` accrues; combined role is correctly one role already | Needs its own payout ledger with the 7 states in §43 and milestone-based payability (truck departure, not delivery) |
| **Notifications** (§40) | Free-text `type` column, no constraint | Needs the 10 defined categories and per-category preferences |
| **Market prices** (§29) | Solid: ambassador submissions, anomaly flagging, admin review, confidence | Add evidence attachment and quality/specification |

---

## 5. REBUILD

Security- or money-critical. Do not patch these.

1. **Wallet/ledger money model.** Built *today* in this session and already live. It is single-entry, and §20 explicitly forbids treating a balance as source of truth. The balance is derived from a ledger sum (good) but there is no account structure, no Held state, and no reconciliation job against the provider. **This is the highest-risk live code in the system.**

2. **Settlement and fee capture.** No fee is actually deducted anywhere in the escrow→wallet path. The 3%/1.5%/5% benchmarks in §55 exist as a config column that nothing reads on the marketplace path.

3. **`profiles` base RLS.** Lives in the portal codebase, unreviewed, and governs the table everything else joins to. Must be pulled into this repo's migrations and audited before launch.

4. **Financing amount authority.** I removed the ₦500k cap today per instruction, which is correct per §16 — but there is now *no* bank-returned limit model either. `financing_applications` has `amount_requested` and nothing representing approved-vs-disbursed (§18 requires all three distinct).

---

## 6. REPLACE

| Item | Why |
|---|---|
| `src/lib/providers/payments.ts` | Stub interface that nothing calls and whose comment says Loamy "never will" move money — contradicted by the escrow and wallet code now in production |
| Weather provider | Open-Meteo free tier is **non-commercial use only**. Already flagged in `HANDOFF.md`. Must be licensed or swapped before revenue |
| Global `platform_fee_bps` | Replace with the configurable fee matrix |

---

## 7. MISSING — no implementation at all

Ordered by how much else depends on them.

| # | Directive | Status | Blocks |
|---|---|---|---|
| 1 | **CommodityBatch** (§27) | Does not exist. `batch_id` in the schema refers to *data upload* batches, unrelated | §4, §5, §27, §28, §47 — the entire traceability spine |
| 2 | **Entity identity model** (§4) | Only users/businesses have persistent IDs. No `entity_id`/`entity_type`/provenance/history envelope | §5, §27, §47 |
| 3 | **Provenance** (§5) | Data is overwritten. Farmer-declared vs observed vs mapped area is not preserved — `farms.size_hectares` is a single mutable number | §6, §8, financing evidence quality |
| 4 | **Farm geomapping** (§8) | Lat/long points only. No polygon, no PostGIS, no calculated area, no geospatial index | §8, §10, sourcing-by-proximity, §25 |
| 5 | **In-app chat** (§12) | `messaging` nav item exists behind a permanently-false flag. Nothing built | §12, §13 — phone-number gating has no alternative channel |
| 6 | **Financed purchase path B** (§13, §35) | The single most important workflow in the directive. Not started | §13, §14, §35 |
| 7 | **Bank adapter** (§50) | No bank integration of any kind | §13–§18 |
| 8 | **Supplier-direct payment** (§13) | Not modelled | §35 |
| 9 | **Disputes** (§45) | Only an escrow status `'disputed'`. No case, evidence, review or decision entity | §45, §28 |
| 10 | **Behaviour events** (§31) | No event pipeline | §31, §32, §33, recommendations |
| 11 | **Loamy Score** (§32) | Does not exist | §32 |
| 12 | **Hot Deals** (§33) | Does not exist | §33 |
| 13 | **WhatsApp** (§39) | Does not exist | §39, §41 |
| 14 | **Loamy Pulse** (§41) | Does not exist | §41 |
| 15 | **Government/institutional dashboard** (§47) | Role does not exist | §47 |
| 16 | **Satellite adapter** (§10) | Does not exist | §10 |
| 17 | **Post-checkout logistics/warehouse recommendation** (§25) | Not built | §25 |
| 18 | **Referral benefit split** (§42) | Growth Partner commission accrues, but ordinary-user *non-cash* benefits do not exist, and the anti-fraud controls in §42 (self-referral, device checks, cluster detection, caps) are absent | §42, §44 |
| 19 | **Fraud controls** (§44) | Essentially none of the 19 listed controls | §44 |
| 20 | **Automated tests** (§53) | **No test framework installed.** Only live verification scripts against production | All of §53, §54 |

---

## 8. Security findings

Ranked by exploitability.

| Sev | Finding | Detail |
|---|---|---|
| **High** | No automated test suite | §53/§54 demand permission tests, RLS tests, webhook replay tests, fraud tests. There is no framework to write them in. Every RLS guarantee is currently asserted by reading, not proving |
| **High** | `profiles` RLS unreviewed | Base policy is in another repo; every table joins to it |
| **Med** | Growth Partner evidence anti-fraud absent | §7 requires GPS consistency, timestamp validation, duplicate-evidence detection, suspicious-pattern detection. `verification_tasks.evidence` is an unvalidated JSON blob. An agent can submit anything |
| **Med** | `react-router` 2 moderate CVEs | Open redirect via backslash in `<Link>`/`useNavigate`; constructor injection in SSR hydration. `npm audit fix` available |
| **Med** | `service_directory` readable by every signed-in user (`using (true)`) | Now carries the `address` field added today. Business addresses are semi-public by design, but this should be an explicit product decision, not a side effect |
| **Med** | Wallet has no reconciliation | No job compares Loamy's ledger against the provider's balance. A silent divergence would be invisible |
| **Low** | Farm coordinates | Correctly excluded from public views; confirm no authenticated-role path exposes them to non-owners |
| **Low** | `bvn_encrypted`/`nin_encrypted` columns exist but unused | Correct per §15 — keep them unused, or drop them to remove the temptation |

**Explicitly checked and clean:** no `service_role` key anywhere in frontend or env; all definer functions pin `search_path`; webhook verifies signatures and amounts; no BVN is stored.

---

## 9. OPEN — requires external decision, not engineering

These cannot be resolved in code. They need you, a bank, or a lawyer.

1. **Fund custody legal structure.** §21 says Loamy must not be represented as custodian unless the legal structure supports it. The wallet went live today. **What is the actual legal position?** This is the most urgent open item.
2. **Partner bank identity and API.** Nothing in §13–§18 can be built against a real institution until one is named.
3. **Does the partner bank support supplier-direct payment?** §13 says never assume. The answer changes the architecture.
4. **Weather licence.** Open-Meteo is non-commercial. Needs resolving before revenue.
5. **Satellite provider.** Unselected — adapter can be built regardless.
6. **Government data-sharing lawful basis.** §47 requires scopes and lawful-purpose access.
7. **Paystack is on test keys.** No real money has ever moved through this system.
8. **The site has never been deployed.** No hosting exists. `HANDOFF.md` says hold until bank approval.

---

## 10. Recommended sequence

The directive's P0 list is right, but it is not a sprint — it is a multi-quarter programme. Proposed order, dependency-first:

**Phase 0 — make change safe (do this before anything else)**
Install a test framework. Write RLS and permission tests for what exists *today*. Pull `profiles` policies into this repo. Fix the router CVEs. Without this, every subsequent change is unverifiable.

**Phase 1 — the identity and traceability spine**
`CommodityBatch`, the entity-identity envelope, provenance. Everything downstream depends on these three, and retrofitting them later means rewriting the marketplace, verification and financing on top of a changed data model.

**Phase 2 — businesses and money**
Promote `businesses`/`business_memberships` for all roles. Rebuild the ledger double-entry. Add the fee matrix and reconciliation.

**Phase 3 — verification engine**
Cases/evidence/reviews, the 13 types, Growth Partner anti-fraud.

**Phase 4 — financed purchase**
Bank adapter, Path B, supplier-direct. Gated on the open items above.

**Phase 5 — intelligence**
Behaviour events, Loamy Score, Hot Deals, Copilot extension, WhatsApp.

A realistic caution: §§1–59 describe a platform that is normally a team-year or more of work. Treating it as one continuous build will produce exactly the situation this audit is diagnosing — broad surface, thin foundations. Phase 1 is the one that cannot be deferred.

---

## 11. What I recommend you decide first

1. **The custody question (§9.1).** Live code is moving toward holding user funds. Everything else can wait; this cannot.
2. **Phase 0 or straight to features?** My recommendation is Phase 0. Skipping it means no change after this point is provably safe.
3. **Scope for the next block of work.** Give me one phase, not the whole directive.
