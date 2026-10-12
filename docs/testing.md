# Testing

**Status:** Phases 0-12, all built. 6 and 7 are behind isolated sandbox adapters -- no bank or provider is live. Covers security boundaries, pure domain logic, the entity/batch spine, verification, and the marketplace link.
There are no component or end-to-end tests yet — those arrive with the workflows
they would cover.

## The two suites, and why they are separate

```
npm test              tests/unit      offline, ~4s, no side effects
npm run test:security tests/security  hits a REAL Supabase project, ~60s
```

`npm test` is safe anywhere, any time, and is what a pre-commit hook or CI
should run. It never opens a socket.

`npm run test:security` is deliberately **not** part of `npm test`. It signs up
real accounts and reads real tables. Running it by accident against production
should not be possible by typing the obvious command.

## Why the security suite cannot run against a local database

Supabase's local stack needs Docker, and Docker is not available on the current
build machine (`supabase functions deploy` prints `WARNING: Docker is not
running` on every invocation). Without it there is no local Postgres to apply
migrations to, so RLS cannot be exercised in isolation.

The consequence is honest but unpleasant: **the security suite currently proves
RLS against the live project.** It creates throwaway `+alias` accounts and only
ever reads or writes its own rows, but it is still production.

**The fix is a dedicated staging Supabase project** — same migrations, no real
users. That is a cost/ops decision, not an engineering one, and it is listed as
an open item in `AUDIT.md`. Until then:

- run the security suite deliberately, not in a loop;
- the accounts it creates are printed at the end of every run;
- delete them in Supabase → Authentication (the anon key cannot delete auth
  users, so this cannot be automated from the suite — pretending otherwise
  would leave silent litter).

## What the security suite proves

| File | Proves |
|---|---|
| `rls-cross-user.test.ts` | One member cannot read another's wallet, ledger, withdrawals, roles, farms, financing, notifications, cart, wishlist or payout account; cannot write rows owned by another member; cannot credit any wallet. Anonymous visitors see nothing but the intended public views |
| `privilege-escalation.test.ts` | A member cannot make themselves admin, self-verify, un-suspend, self-grant `can_verify`, switch into an unheld role, reach the operational `bank` role, or write `platform_role` directly |
| `onboarding-role-path.test.ts` | Locking `platform_role` behind an RPC did not break signup — first-role selection, held-role recording, add-then-switch |
| `phase1-entities.test.ts` | Reference IDs are unique, well-formed and resolvable; the farm -> cycle -> harvest chain rejects mismatched farms, foreign owners, livestock and non-positive quantities; the chain is invisible to other members and to anon; declared area survives alongside mapped area; observations supersede rather than overwrite; actor is stamped server-side; members cannot claim a satellite/partner source; the observation log has no client update or delete path |
| `phase2-batches.test.ts` | A batch traces to its harvest; a farmer cannot mint more traceable stock than they harvested; there is no client insert or update path on batches; quantity cannot go negative or exceed the original; unknown events, disallowed transitions, self-verification and member-driven `sold` are all refused; the event log cannot be forged, edited or deleted, is invisible to others, and replays to the current balance |
| `phase3-verification.test.ts` | Only the assigned agent may submit evidence (not the subject, not a stranger); every anti-fraud check fires — distant GPS, missing GPS, coarse GPS, future timestamp, re-used evidence; flags bubble to the case; evidence cannot be inserted, edited or deleted by a client and is invisible to the subject; an agent cannot approve their own case; the farm stays unverified until the platform approves; a decided case cannot be re-reviewed; the decision writes an audit event; an empty case cannot be submitted |
| `phase4-marketplace-batches.test.ts` | A batch-backed listing copies commodity/unit/grade from the batch; over-listing is refused; a seller cannot insert a `batch_id`, claim `batch_backed` without one, upgrade a declared listing, or edit a backed listing's quantity; declared listings still work; the public view reports claim basis and verification status honestly and leaks no farm, coordinates or location; buyer-requested verification is idempotent, refused for the seller, and refused on declared listings; unlisting returns the batch to its true state |
| `phase5-transactions.test.ts` | Subtotal is computed server-side from the listing; proposing reserves nothing but accepting commits stock; a buyer cannot accept their own proposal and a stranger cannot touch it; **all six payment events are refused to both parties**; the transaction row has no client insert or update path; fulfilment moves without dragging status or payment; the event log cannot be forged, edited or deleted; disputes name the respondent automatically, allow only one open at a time, and are invisible to third parties |
| `phase8to12-chain.test.ts` | Walks the golden path end to end — farm → harvest → batch → listing → transaction → transport → warehouse → trace. Transport requires an accepted deal; external haulage still works; a provider's movement drives transaction and batch forward without touching payment; live truck position is private. A warehouse cannot self-verify, storage is never auto-booked, and an arrival creates a receipt **and** a batch event. Traceability redacts by scope, never fabricates a missing link, and will not confirm an unlisted batch to a stranger. Weather needs a named provider and stays private to the farm owner. Every institutional aggregate is refused without a scope, grants expire, and **refused queries are audited** |
| `phase6and7-financing-money.test.ts` | No BVN-shaped column exists anywhere; only the last four digits of an account are accepted; account opening routes to the bank. Financing inherits amount/seller/batch from the transaction; an applicant cannot approve their own application or write `approved_amount`; approvals cannot exceed the request; the three amounts stay distinct. The eligibility signal is labelled a recommendation with configurable weights and no naira figure. **No client can post a ledger entry and `loamy_post_ledger` is not granted to members at all**; unbalanced groups are refused; the deprecated wallet stays empty. **Escrow cannot shortcut to `released`** — all three parties refused — and the full path posts a balanced release that mirrors onto the payment machine only |
| `money-and-webhooks.test.ts` | A new wallet is exactly zero; withdrawals are refused without a verified destination, at zero/negative amounts, and above balance; a member cannot read another balance; the payment webhook rejects unsigned, wrongly-signed and GET requests; privileged Edge Functions reject unauthenticated callers and other members' withdrawals |

## What is NOT proved, and why

Stated explicitly so nobody reads a green suite as more than it is.

1. **The webhook's happy path.** Signing a valid Paystack event needs
   `PAYSTACK_SECRET_KEY`, a server secret the suite does not hold. Only
   *rejection* is proved. Positive-path and replay/duplicate-delivery tests need
   either a test secret in CI or a Deno test harness inside the function.
   Until then, **duplicate-webhook handling is unproven** — the idempotency
   design exists (unique `wallet_entries.reference`) but has not been exercised
   end to end.
2. **Bank and financing permissions.** No bank API exists; the bank portal's
   officer scoping is untested.
3. **Growth Partner task permissions.** Covered as of Phase 3 for the
   verification flow. Earnings and payout permissions remain untested.
4. **Admin permissions.** The admin-explore account is a shared credential; the
   suite skips admin-scoped assertions rather than depend on it.
5. **Storage policies.** Bucket-level RLS (`verification-evidence` in
   particular) is read but not exercised.
6. **Everything in the UI.** No component or browser tests exist.

## Adding a test

Unit tests go in `tests/unit/*.test.ts` and may import from `@/…`. Keep them
offline — if a test needs the network it belongs in the other suite.

Security tests go in `tests/security/*.test.ts` and use
`tests/helpers/supabase.ts`:

```ts
const A = await makeUser('trader', 'Trader')
const B = await makeUser('farmer', 'Farmer')
const { data } = await A.client.from('farms').select('*').eq('owner_id', B.uid)
expect(data ?? []).toHaveLength(0)
```

Note the assertion shape: **RLS denial usually returns zero rows, not an
error.** A test that only checks `error` will pass against a table with no
policy at all. Always assert on the rows.

The suite runs single-threaded on purpose. Supabase rate-limits signups, and
parallel runs produce flakes that look like security failures.
