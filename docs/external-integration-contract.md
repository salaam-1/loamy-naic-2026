# Loamy — external integration contract

**What this document is for.** When real API documentation and credentials
arrive, this says exactly what has to be built and what already exists. Every
operation below is derived from **Loamy's own lifecycle**, not from any
vendor's API. No endpoint here is invented, and no provider's behaviour is
assumed.

**Status as of 2026-09-21:** no external financing, payment, identity or
messaging provider is connected. Weather and map tiles are live and keyless.

---

## 0. How the boundary works

Adapters live in `src/lib/providers/`. The domain calls an interface; an
adapter speaks the vendor's dialect; nothing in `src/pages` or the database
model names a vendor.

```
src/lib/providers/
  types.ts        ProviderMode, ProviderResult, ProviderError, Idempotent, ProviderEvent
  financing.ts    FinancingProvider     — no adapter registered
  payments.ts     PaymentProvider       — no adapter registered
  kyc.ts          KycProvider           — no adapter registered
  weather.ts      WeatherProvider       — Open-Meteo (live)
  geo.ts          GeoProvider           — OpenStreetMap tiles (live)
  messaging.ts    MessagingProvider     — no adapter registered
src/lib/copilot/llm/adapter.ts          LlmAdapter — deterministic template
```

Three rules hold across all of them.

1. **A provider call returns a result, never throws.** A thrown provider error
   becomes either a crash or a silent catch, and Phase 4 slice 2 established
   what a silent catch costs.
2. **Errors are classified into Loamy's vocabulary**, not the vendor's.
   `ProviderError.kind` is one of nine values; the vendor's own code is kept
   in `providerCode` for logs and never rendered.
3. **Idempotency keys are derived from Loamy business references**
   (`FIN-000123:submit`), never random. A random key per attempt defeats
   idempotency, which is the usual way this is got wrong.

### What "sandbox" means here

A sandbox adapter simulates **transport** — that a request was accepted, that
a reference was issued. It never simulates **judgement**.

There is deliberately no sandbox that approves financing, confirms a payment
or settles a seller. `sandboxFinancingProvider.getApplicationStatus()` returns
`in_review` forever and **never** returns a decision; a unit test asserts it.
Exercising an approval end to end is done through the database's own
`loamy_sandbox_bank_decision`, which is admin-only, applies no credit policy,
refuses to run against a `live` bank, and marks its result `is_sandbox`.

Every sandbox reference is prefixed `SANDBOX-`, so a simulated value cannot be
mistaken for a real one in a row, a log, or a support conversation.

---

## 1. FinancingProvider — the partner bank

**Loamy domain:** `banks`, `financing_applications`, `bank_account_links`,
`financing_events`. **Authoritative RPCs:**
`loamy_apply_financing_for_transaction`, `loamy_financing_decision`,
`loamy_link_bank_account`, `loamy_bank_capabilities`.

**The rule that governs every row below:** an adapter **transports** a
decision, it never **makes** one. A decision received from a provider must be
applied through `loamy_financing_decision` with `p_source: 'bank_api'`, which
re-checks the bank, the amount and the lifecycle and records provenance. An
adapter writing to `financing_applications` directly would bypass every guard
in the system.

| Loamy operation | Provider operation | Request | Response | Notes |
|---|---|---|---|---|
| Link a bank account | `verifyAccount` | `bankId`, `accountLast4` (4 digits), `accountNameHint` | `verified`, `bankReference`, `accountNameMasked` | **No BVN, no NIN, no full account number.** If the bank needs a BVN, the bank collects it. |
| Open an account | `openAccount` | `bankId`, `returnUrl` | `hostedUrl`, `expiresAt` | Only where `banks.supports_account_opening`. Loamy never opens an account; it redirects. |
| Submit an application | `submitApplication` | `applicationRef` (FIN-…), amount, purpose, applicant summary, transaction context | `accepted`, `bankReference`, `status` | Payload mirrors `loamy_application_bundle`. No internal user ids, no email, no evidence photos. |
| Poll status | `getApplicationStatus` | `applicationRef` | `status`, `decision?`, `documentsRequired?` | Provider status is normalised to 7 values, then mapped into Loamy's lifecycle in one place. |
| Document requirements | `getDocumentRequirements` | `applicationRef` | `code`, `label`, `mandatory`, `hostedUploadUrl?` | Prefer bank-hosted upload; Loamy holds no identity documents. |
| Verify the seller | `verifySupplier` | `supplierNameHint`, `accountLast4` | `verified`, `supplierReference` | Only where `banks.supports_supplier_direct`. |
| Instruct settlement | `instructSettlement` | `applicationRef`, `transactionRef`, `amount`, `supplierReference`, `narration` | `accepted`, `externalReference`, `expectedValueDate?` | **An acknowledgement, not a confirmation.** Only a later verified event may record that money moved. |
| Receive an event | `parseEvent` | raw body, signature | `ProviderEvent` with `verified` | An adapter that cannot verify a signature MUST return `verified: false`. |

### Error mapping

| Loamy `kind` | Retryable | Typical cause |
|---|---|---|
| `not_configured` | no | No adapter, or `integration_mode = 'disabled'` |
| `unauthorized` | no | Credentials rejected |
| `rejected` | no | Bank understood and refused |
| `not_found` | no | Unknown reference |
| `invalid_request` | no | Our payload is wrong — do not retry unchanged |
| `rate_limited` | yes | Throttled |
| `timeout` | yes | No response in time |
| `unavailable` | yes | Provider down |
| `unknown` | **no** | Unclassified — deliberately not retryable, because retrying a settlement blindly is how a seller gets paid twice |

### Idempotency, retry, timeout

- Key: `FIN-000123:submit`, `FIN-000123:settle`. Stable across retries of the
  same attempt.
- Retry only `rate_limited`, `timeout`, `unavailable`, with backoff.
- **Never** retry `instructSettlement` on `unknown` without first calling
  `getApplicationStatus` and reconciling.
- Timeouts: reads 10s, writes 30s. Suggested, not yet enforced — no adapter
  exists to enforce them in.

### Webhooks and audit

- Every inbound event must be signature-verified before it changes anything.
- Replay protection: reject an `externalId` already seen.
- Every applied decision writes `financing_events` + `audit_events` already,
  via `loamy_financing_decision`. An adapter adds nothing to this.

### Sandbox behaviour

`sandboxFinancingProvider`: accepts submissions, issues `SANDBOX-FIN-…`
references, reports `in_review` forever, **never decides**, refuses
`openAccount`, returns unverified events.

### Production configuration required

| Item | Status |
|---|---|
| Client id / secret | **not supplied** |
| Base URL, sandbox and production | **not supplied** |
| Webhook endpoint + signing secret | **not supplied** |
| mTLS / IP allowlist requirements | **unknown** |
| `banks` row + capability flags per institution | **configurable today** |
| `integration_mode` flip to `live` | **admin action, available today** |

### Still unknown, pending real documentation

- Authentication scheme (OAuth2 client credentials? mTLS? static key?)
- Whether decisions are pushed (webhook) or must be polled, and at what rate
- The bank's own application state vocabulary, for mapping
- Whether the bank accepts a structured application at all, or expects a
  document pack
- Supplier-direct settlement mechanics and value-date semantics
- Document requirement codes
- Rate limits

### Sterling specifically

**Nothing Sterling-specific exists in this codebase, and that is correct.**
A bank is a row in `banks` with capability flags; no bank is named in any
domain logic. Onboarding Sterling is: one row, its capability flags, one
adapter implementing `FinancingProvider`, and an `integration_mode` flip. No
domain change.

---

## 2. PaymentProvider — Paystack and successors

**Loamy domain:** `escrow_workflows`, `ledger_entries`, `external_settlement`,
`partner_funding`. Interface at `src/lib/providers/payments.ts`.

**The non-custodial boundary is not negotiable.** Loamy records references and
status. It does not hold, move or process funds, and it maintains no
withdrawable member balance. The custodial wallet module and its UI were
**deleted** in this sprint; a unit test asserts the module no longer imports.

| Loamy operation | Provider operation | Notes |
|---|---|---|
| Initialise a checkout | `initialize` | Returns a hosted URL/reference. Loamy stores the reference only. |
| Verify a payment | `verify` | Server-side verification. **A client-reported success is never trusted.** |
| Record a disbursement | `recordDisbursement` | Records a bank-confirmed reference for something that happened off-platform. |
| Record repayment status | `recordRepaymentStatus` | Status only; never an amount Loamy processed. |
| Receive a webhook | signature-verified handler | Already enforced in the existing payment webhook path. |

**Configuration required:** public + secret key (public key is present in
`.env` as `VITE_PAYSTACK_PUBLIC_KEY`), webhook URL, webhook secret, settlement
account configuration. **Unknown:** split-payment mechanics for the Phase 5
split-payer model, which has no schema support yet.

---

## 3. KycProvider — identity verification

Interface at `src/lib/providers/kyc.ts`. **Not implemented, and there is
nowhere to put a BVN or NIN.**

Verified against the live schema on 2026-09-21: `profiles` carries
`bvn_verified` and `nin_verified` (booleans) and `kyc_reference` (opaque).
Probes for `bvn`, `bvn_encrypted`, `nin`, `nin_encrypted` all return `42703`.
`hardening-pass.test.ts` asserts the columns are absent.

The contract returns **pass/fail plus a provider reference — never the raw
number, never the document image**, so nothing sensitive transits Loamy's app
or database tier. Capture happens in a provider-hosted widget; Loamy receives
an opaque token.

**Hard gate before any adapter is wired:** encryption at rest for anything
retained, key management and rotation, column-level grants, access auditing,
consent capture, retention policy. See `HANDOFF.md` §3.

**Configuration required:** provider, credentials, hosted-widget
configuration, DPA. **Unknown:** everything — no provider has been selected.

---

## 4. WeatherProvider — LIVE today

`openMeteoProvider`, `https://api.open-meteo.com/v1/forecast`. No key. Used by
the farm forecast panel.

| Aspect | Detail |
|---|---|
| Request | lat, lng, 7 days, `timezone=auto` |
| Response | daily WMO code, temp max/min, precipitation, precipitation probability, wind max |
| Errors | 401/403 → `unauthorized`, 429 → `rate_limited`, 5xx → `unavailable`, 200-with-no-data → `unknown` |
| Idempotency | not applicable — read-only |
| Sandbox | none; the real service is free |
| **Blocker** | **Open-Meteo's free tier is NON-COMMERCIAL.** A paid tier or a licensed alternative is required before commercial launch. |

Weather is never fabricated: no cached-last-known presented as current, no
interpolation across a gap. A farmer deciding when to plant is better served
by "we could not reach the forecast".

---

## 5. GeoProvider — LIVE today

`openStreetMapProvider`, raster tiles via react-leaflet. No key.

**Distance and proximity are computed locally** by `haversineMetres`, not by a
provider — a fraud control must not depend on a third party being reachable.
An evidence GPS check that silently passed because a geocoder timed out would
be worse than no check.

**Blocker:** OSM's tile policy is for modest attributed use and is not a
commercial CDN. A commercial tile provider replaces `tiles()` and nothing
else. **Unknown:** whether geocoding is needed at all; no adapter implements
it today and `geocode()` refuses cleanly.

---

## 6. MessagingProvider — not implemented

Loamy notifies through the `notifications` table, read in-app. Nothing sends
an SMS today.

Three rules a concrete adapter must hold:

1. **The database stays authoritative.** An outbound message is a copy of a
   notification row, never a substitute. If the gateway is down the member
   still sees it in-app.
2. **No sensitive content leaves.** SMS is unencrypted, lands on a lock screen
   and is retained by a carrier. No financing amounts, no account digits, no
   identity data, **no verification-agent identity**, no counterparty contact
   details. A notification says something changed and to open Loamy.
3. **Consent is checked before sending.** Phone numbers were collected for
   account use. `MessagePurpose` has only `transactional` and `service` —
   there is deliberately no `marketing` value to reach for.

Free text is not accepted; only registered template keys, so a reviewer can
read the full list before anything reaches a real person.

**Configuration required:** provider, sender id / WhatsApp business account,
approved templates, credentials, opt-out handling. **Unknown:** provider,
Nigerian sender-id registration requirements, per-message cost.

---

## 7. LlmAdapter — Copilot

`src/lib/copilot/llm/adapter.ts`. Default is `templatePhraser`, which returns
the deterministic, data-derived text unchanged. **The core application does
not require an LLM key and must not.**

An LLM's only permitted job is to **phrase an answer more naturally from
already-retrieved facts**. It must never add information from model
knowledge, predict a price, or give financial advice. A real provider must be:

- proxied through a backend (no key in the browser),
- constrained to the supplied `facts` with a strict system prompt,
- falling back to the deterministic text on any error or low confidence.

Retrieval stays permission-aware regardless of adapter, and the
`observed` / `user_generated` / `model_inference` classification is preserved.
**Predictions remain disabled unless backed by a real model.**

**Configuration required:** provider, model, backend proxy endpoint, key,
rate limits, logging/retention policy. **Unknown:** provider and model.

---

## 8. What remains when credentials arrive

| # | Work | Depends on |
|---|---|---|
| 1 | Implement `FinancingProvider` for the chosen bank | Bank API docs + credentials |
| 2 | Webhook receiver + signature verification + replay store | Webhook secret |
| 3 | Map the bank's status vocabulary onto `FinancingProviderStatus` | Bank docs |
| 4 | Apply received decisions via `loamy_financing_decision(p_source:'bank_api')` | (1) |
| 5 | Flip `banks.integration_mode` to `live` per institution | (1)–(4) signed off |
| 6 | Licensed weather provider | Commercial terms |
| 7 | Commercial map tiles | Commercial terms |
| 8 | Messaging adapter + approved templates | Provider selection |
| 9 | LLM adapter behind a backend proxy | Provider selection |
| 10 | KYC adapter **after** the encryption/retention gate | Security design |

**None of items 1–10 require a change to Loamy's domain model.** That is the
point of this document: the remaining production work is provider integration
and configuration, not product architecture.
