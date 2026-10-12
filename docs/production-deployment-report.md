# Production Deployment Report

**Date:** 2026-09-23 (00:36 UTC)
**Prepared against commit:** `de90f5f776a2cfb7a118901497c572ecdaf8faf8`
**Outcome of this first pass:** NOT DEPLOYED — stopped at Phase 6.
**SUPERSEDED 2026-09-23 01:22 UTC:** the release IS now live at
https://loamy-platform.vercel.app. See "Existing Vercel Production Deployment"
at the end of this document. Sections A-P below record the first pass as it
stood, including the incorrect conclusion that no deployment existed; they are
kept rather than rewritten so the error and its cause stay visible.

> **The central finding, stated first.**
>
> The directive's premise is that a live Loamy site exists and needs moving onto
> the current release. **It does not exist.** There is no production frontend,
> no hosting account, no deployment configuration, and none has ever existed in
> this repository's history on any branch.
>
> Deploying would therefore not be "updating the live site". It would be the
> **first public launch** of a Nigerian agricultural finance platform, against a
> Supabase project holding real Founding Member data, ahead of the partner-bank
> gate the team set for itself. That is a materially different act from the one
> requested, so Phases 6 and 7 were stopped and are reported rather than
> improvised.
>
> Everything that could be done safely was done in full: Phases 0–4, 8 (to the
> limit of read-only access) and 9. **Phase 5 turned out to be a no-op** — the
> production database is already in exact sync with this commit.

---

## A. Production environment identified

Determined from repository evidence only; no platform was assumed.

| Question | Finding | Evidence |
|---|---|---|
| Production frontend host | **None** | no host referenced anywhere in the tree |
| Deployment platform | **None** | no `vercel.json`, `netlify.toml`, `.github/`, `Dockerfile`, `fly.toml`, `render.yaml`, `wrangler.toml`, `amplify.yml` |
| Branch/commit in production | **N/A** | nothing is deployed |
| Supabase project | `lsuqbjwlybzhyuvzgtdj` | `supabase/.temp/project-ref`; CLI linked |
| Supabase environment | **Production — and the only environment** | `docs/deployment.md` |
| Frontend deploy automatic? | **Neither** — no mechanism exists | — |
| Migrations automatic? | **Manual**, via Supabase CLI | no CI |
| Production env vars | **None exist** (no platform to hold them) | — |
| Deployment config files | **None** | — |
| CI/CD | **None** | — |

Verified historically, not just at the tip:

```
git log --all --diff-filter=A -- vercel.json netlify.toml .github/ Dockerfile \
        fly.toml render.yaml wrangler.toml amplify.yml
(empty — no such file has ever been added on any branch)
```

The repository states this itself:

- `docs/deployment.md`: *"**Status: nothing is deployed.** There has never been a Vercel, Netlify, Render or CI configuration in this repository's history."*
- `HANDOFF.md`: *"Status: **BUILD-FOR-THE-SHELF.** Complete and verified locally … but NOT publicly deployed. It ships when the team activates Phase 2 after partner-bank approval. **Nothing in this document is an invitation to deploy early.**"*

**A second, independent blocker** from the same document: there is one Supabase
project and it is production. Dev, test and production are the same database,
and the security suite creates accounts in it on every run. Publishing a
frontend against that database points real users at the same rows the test
harness writes to.

## B. Previous production SHA

**None.** There is no prior deployment to compare against.

## C. New production SHA

`de90f5f776a2cfb7a118901497c572ecdaf8faf8` — built and verified, **not deployed**.
`origin/sept-2026-platform-changes` is at this SHA. `origin/main` is at
`171c3bb984fde59cfe61897ac85f52fa4b4f204c` and does **not** contain this release.

## D. Hosting platform

None. Selecting one is an owner decision and is listed in §P.

## E. Supabase project / environment

`lsuqbjwlybzhyuvzgtdj` — production, and currently also dev and test.

---

## F. Migrations already applied

**All of them.** Local git and the production database are in exact sync:

```
rows returned         : 155
local migration files : 155
PENDING (in git, not on prod) : 0
ORPHAN  (on prod, not in git) : 0
```

Every migration named in the directive is already applied:

| Migration | Concern | State |
|---|---|---|
| `20260921140001` | Slice 3 bank decision lifecycle | APPLIED |
| `20260921150001` | Fee rule lifecycle guard | APPLIED |
| `20260922100001` | Wave 1 fulfilment spine | APPLIED |
| `20260922100002` | Wave 1 column corrections | APPLIED |
| `20260922100003` | Wave 1 logistics mirror guard | APPLIED |
| `20260922100004` | Bundle event-detail leak fix | APPLIED |
| `20260922110001` | Non-custodial wallet closure | APPLIED |
| `20260922120001` | Partial-sale batch state | APPLIED |

## G. Migrations newly applied

**None. Phase 5 was a no-op.** Nothing was pending, so `supabase db push` was
never run and the production database was not modified by this exercise.

The production database is therefore **already ready for this frontend build** —
the schema is ahead of the deployment, not behind it.

### What the release migrations actually contain

Statement census across all 11 migrations dated 2026-09-21/22:

| Statement | Count |
|---|---|
| `create or replace function` | 19 |
| `grant execute on function` | 17 |
| `revoke all on function` | 16 |
| `insert into` | 9 |
| `comment on function` | 8 |
| `update` | 6 |
| `grant select` / `drop view` / `create view` | 4 each |
| `drop policy if exists` / `comment on view` | 3 each |
| `drop trigger` / `create trigger` | 2 each |

**No `CREATE TABLE`, no `ALTER TABLE`, no `ADD COLUMN`, no `DROP COLUMN`.** This
release changes functions, views, policies, triggers and grants — not table
structure. That materially improves reversibility (§N).

## H. Environment variables required

Browser-safe, and the only two the app needs to run:

| Variable | Purpose | Safe in bundle? |
|---|---|---|
| `VITE_SUPABASE_URL` | project URL | yes |
| `VITE_SUPABASE_ANON_KEY` | publishable key | yes — RLS is the boundary |
| `VITE_PAYSTACK_PUBLIC_KEY` | Paystack **public** key | yes |

Local-only, never deployed (QA harness credentials): `QA_EMAIL_ADMIN`,
`QA_PASSWORD_ADMIN`, `QA_PASSWORD_STAGE3/4/5`. Not `VITE_`-prefixed, so Vite
cannot ship them to a browser.

**Bundle secret sweep** — every non-empty value in `.env` was searched for inside
the built output:

```
env values found inside dist/: 2
   index-DRIHXfAn.js  <- https://lsuq…     (Supabase URL, browser-safe)
   index-DRIHXfAn.js  <- sb_publishab…     (publishable key, browser-safe)
```

No password, no secret key, no QA credential reached the bundle.

---

## I. Security / credential rotation status

### I.1 What is actually exposed on the remote

Scanned all 94 commits reachable from every `origin/*` ref, de-duplicated to 22
distinct file versions.

| Account category | File | Exposure |
|---|---|---|
| **Platform admin fixture** (`usmanyakubu541+admin-exp…@gmail.com`) | `tests/helpers/supabase.ts` | **2 distinct blob versions, present in 16 published commits** |

**Exactly one account is exposed. It must be rotated before any deployment.**

No branch **tip** contains a credential any more. The exposure is entirely in
history, on `origin/sept-2026-platform-changes`, in commits that predate the
rewrite. `origin/main` and `origin/feature/loamy-adjustments` are clean in both
tip and history.

### I.2 A correction to an earlier statement

I previously told the owner that *"test-account passwords in `verify-stage1.mjs`
are already on origin."* **That was wrong**, and it overstated what needs
rotating. `verify-stage1.mjs` builds its password as
`'LoamyStage1-Test!' + Math.random()` — a generated value, not a stored
credential. My earlier check counted lines containing the word "password"
rather than literal credential values.

The fixed stage-3/4/5 passwords were real credentials, but they existed **only
in commits that were never pushed** and were removed by the history rewrite
before the push. They are not on the remote.

**Net effect: one account to rotate, not several.**

### I.3 Rotation status

| Item | Status |
|---|---|
| Admin fixture password rotated | **NOT DONE — owner action, blocks deployment** |
| Repository contains active credential literals | **None** (working tree sweep: 0) |
| `.env` committed | No — gitignored (`.gitignore:5`), untracked |
| `.env.example` contains values | No — names only |
| Secrets printed in test/build output | No — verified across `npm test` and `npm run build` |

Rotation procedure: change the password for the `admin-explore` account in
Supabase Auth, then set `QA_PASSWORD_ADMIN` in `.env`. Nothing in tracked source
needs editing — `tests/helpers/supabase.ts` and the harnesses already read from
the environment via `scripts/_secrets.mjs`.

Rotating does **not** erase the old value from GitHub's history; it makes the
published value worthless, which is the actual remedy.

### I.4 `VITE_`-prefixed API keys — latent, not currently leaking

`src/lib/copilot/config.ts:12,14` reads:

- `VITE_COPILOT_LLM_API_KEY`
- `VITE_COPILOT_STT_API_KEY`

Anything `VITE_`-prefixed is **compiled into the browser bundle**. Both are
currently **unset**, absent from `.env` and `.env.example`, so nothing leaks
today, and the file documents the constraint itself ("MUST be proxied through a
backend / Supabase Edge Function so the API key never reaches the browser").

It is still a trap: setting either variable to a real key publishes that key to
every visitor. They must be replaced by an Edge Function proxy before any
provider is configured. Not blocking today — per
`docs/copilot-ground-truth-audit.md` the Copilot has no LLM wired at all.

### I.5 Local-only credential note

A scratchpad script from an earlier session contained a `demo-supplier`
account credential. It lives in the session temp directory, is not in version
control, and was never published. The owner may still wish to rotate it.

---

## J. Build / test results

Phase 4 run from a **clean install**, so the release is reproducible from the
repository alone.

| Step | Result |
|---|---|
| `npm ci` | success (after clearing three stale dev servers — see below) |
| `npx tsc --noEmit` | **exit 0** |
| `npm test` | **735 / 735 passed**, 30 files |
| `npm run build` | **success**, built in 51.59s (`tsc --noEmit && vite build`) |
| `dist/` | 4.8 MB |

`npm ci` first failed with `EPERM unlink` on
`@rollup/rollup-win32-x64-msvc`. Cause: three stale `loamy-platform` Vite dev
servers from earlier sessions (started 2026-09-19 and 2026-09-20) still had the
native binary mapped. They were stopped; three unrelated
`braventi-growth-forge` dev servers on the same machine were deliberately left
running. The install then succeeded.

The build emits a pre-existing chunk-size advisory, unchanged by this release.

## K. Live smoke-test results

**Not run — there is no live URL to test.** All 18 routes named in Phase 7
remain unverified in production.

They were, however, exercised against a local build during the preceding UI/UX
pass (browser QA 109/109 at 390/768/1440, `docs/ui-ux-refinement-report.md`).
That is **not** a substitute for production verification and is not presented as
one.

## L. Critical invariant verification

Run read-only against the production database. No financial transaction was
created and no external payment was made.

| # | Invariant | Result | How |
|---|---|---|---|
| 1 | No new `wallet_entries` can be created | **VERIFIED** | INSERT with a valid row shape → **`23001` restrict_violation**, trigger's own message |
| 2 | Historical `wallet_entries` readable | **VERIFIED** | rows returned to an authorised reader |
| 3 | `wallet_entries` UPDATE / DELETE blocked | **VERIFIED** | both matched **0 rows** (no policy exists); row count unchanged before and after all three attempts |
| 4 | `wallet_withdrawals` mutation blocked | **VERIFIED** | INSERT → **`23001`**, "Withdrawals are closed…" |
| 5 | Fee rules mutable only via controlled RPCs | **INFERRED** | `20260921150001` applied: admin insert policy replaced, `loamy_end_fee_rule` / `loamy_restore_fee_rule` are `security definer` with `set search_path = public` |
| 6 | Financing decision lifecycle available | **INFERRED** | `20260921140001` applied: `loamy_financing_decision`, `loamy_bank_pipeline`, `loamy_application_bundle` |
| 7 | Partial-sale state | **INFERRED** | `20260922120001` applied |
| 8–12 | Verification, logistics, warehouse, settlement, traceability | **INFERRED** | `20260922100001`–`100004` applied |

**"INFERRED" is not "verified" and is not presented as such.** It means: the
migration that creates the object is recorded as applied in the production
migration history, and its source declares the object. Two things prevented
direct runtime confirmation:

1. **Schema introspection is unavailable.** PostgREST's OpenAPI document now
   requires a secret API key (`401: "Only secret API keys can be used for this
   endpoint"`). This session has only the publishable key, and using a secret
   key was out of scope.
2. **The security suite was deliberately not run.** It is the natural way to
   verify items 5–12 end to end, but it **creates accounts in the production
   database on every run** (`docs/deployment.md`). Running it to produce a
   greener report would have polluted production to test production.

Invariants 1–4 needed no such caveat because a *blocked* write proves the guard
and changes nothing: a `BEFORE` trigger that raises never lets a row land.

## M. Deployment timestamp

**No deployment occurred.** Verification performed 2026-09-23, 00:29–00:37 UTC.

---

## N. Rollback / recovery procedure

Honest version, not the reassuring one.

**Frontend rollback: not applicable.** Nothing is deployed, so there is nothing
to roll back to. Once a platform is chosen, rollback means redeploying the
previous build — most hosts keep immutable deployments, which makes this a
genuine one-click revert. That does not exist yet.

**Database rollback: there is no rollback.** Concretely:

- The repository contains **zero** down/rollback/revert migrations. Migrations
  are forward-only by design.
- Recovery therefore depends entirely on Supabase's backup / point-in-time
  restore for project `lsuqbjwlybzhyuvzgtdj`. **I could not verify that this
  exists.** It depends on the project's plan tier and is visible only in the
  Supabase dashboard, which this session cannot reach. No documentation in the
  repository mentions backups, PITR or a restore procedure.
- **Treat production as having no verified recovery capability until the owner
  confirms the backup tier in the dashboard.** This is listed as a blocker.

**What is reversible, if it came to it:** this release adds no tables and no
columns, so a revert means re-applying prior function, view, policy and trigger
definitions — mechanical, and recoverable from git. The `wallet_entries` and
`wallet_withdrawals` closures are two `DROP TRIGGER` statements.

**What is not reversible:** the 9 `INSERT` and 6 `UPDATE` statements in the
release migrations changed data (including the FEE-000022 restoration and the
Wave 1 `company_id` corrections). Reverting the frontend does not undo them, and
they have no inverse migration.

**Backward compatibility during rollout:** the production schema is already at
this release and no earlier frontend has ever been deployed, so there is no
mixed-version window to manage. The first deployment will be to a schema that is
already ahead of it — the safe direction.

---

## O. Blockers

Ordered by what must be resolved first.

| # | Blocker | Owner action | Severity |
|---|---|---|---|
| **1** | **Admin fixture credential published on GitHub** in 16 commits | Rotate the `admin-explore` password, then set `QA_PASSWORD_ADMIN` in `.env` | **P0 — blocks deployment** |
| **2** | **No production frontend or hosting platform exists**; deploying is a first public launch, not an update | Owner decision: choose a host and confirm launch is intended now | **P0 — blocks deployment** |
| **3** | **`HANDOFF.md` gates go-live on partner-bank approval** and states this explicitly | Confirm the gate is lifted, or defer | **P0 — policy** |
| **4** | **Production, test and dev are one Supabase project**; the security suite writes to production | Stand up `loamy-dev` / `loamy-staging` (`docs/deployment.md` has the procedure; migration history replays cleanly) | **P0 for public launch** |
| **5** | **Backup / PITR capability unverified** — no confirmed recovery path | Confirm the backup tier in the Supabase dashboard | **P1** |
| **6** | `VITE_COPILOT_*_API_KEY` would ship a real key to browsers if ever set | Replace with an Edge Function proxy before configuring a provider | **P1 — latent** |

Blockers 1–4 are each independently sufficient to stop deployment. None is a
code defect; all are environment and authorisation facts.

## P. Remaining manual production configuration

Once the blockers clear, the following must be done by hand — none exists today:

1. Choose and provision a host (the Vite static build needs no special config).
2. Create the production project there and connect the repository.
3. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_PAYSTACK_PUBLIC_KEY`
   in the host's environment settings. **Do not upload `.env`.**
4. Decide the branch that represents production. `origin/main` does **not**
   currently contain this release; `sept-2026-platform-changes` does.
5. Configure the custom domain and TLS.
6. Add CI that runs `tsc`, `npm test` and `npm run build` — and that **never**
   runs `npm run test:security`, which writes to production.
7. Confirm Supabase Auth redirect URLs and allowed origins for the new domain,
   or sign-in will fail in production while working locally.
8. Re-run the Phase 7 smoke tests against the real URL, and only then treat the
   deployment as successful.

---

## Definition of done — actual status

| Criterion | Status |
|---|---|
| Exposed credentials rotated | ❌ owner action outstanding |
| Repository contains no active credential literals | ✅ |
| Production environment identified | ✅ (identified as: none exists) |
| Production DB migration state known | ✅ 155/155 applied, 0 pending |
| Pending migrations reviewed | ✅ (there are none) |
| Migrations safely applied | ✅ no-op — already in sync |
| Frontend deployed from verified SHA | ❌ blocked |
| Production env vars configured | ❌ no platform |
| Live auth / dashboards / marketplace / financing / Trace / Loam / logistics | ❌ no live URL |
| Critical financial invariants verified | ⚠️ 4 verified directly, 8 inferred from applied migrations |
| No new `wallet_entries` can be created | ✅ verified in production |
| Historical wallet entries intact | ✅ verified in production |
| Live browser smoke tests pass | ❌ blocked |
| Deployment report exists | ✅ this document |

**Wave 2 remains not started.**

---

# Existing Vercel Production Deployment

**Added 2026-09-23 01:22 UTC.** This section supersedes the "no production
frontend exists" conclusion in the report above.

## Correction to the previous investigation

The earlier investigation concluded that nothing was deployed. **That conclusion
was wrong.** The reasoning was: no `vercel.json`, no `.vercel/`, no CI config
anywhere in the repository's history, plus `docs/deployment.md` stating
*"nothing is deployed"*.

The error was treating **absence of deployment config in the repository** as
proof of **absence of a deployment**. Vercel's Git integration needs no file in
the repo — the link lives in Vercel's own project settings. The correct next
step would have been to query the Vercel account, not to conclude from repo
contents. `docs/deployment.md` is simply out of date and should be corrected.

The live project was found under a **second Vercel team** (`braventi-loamy`),
not the default scope (`braventi`), which is why the first listing returned
"No projects found".

## Deployment record

| Field | Value |
|---|---|
| Vercel team | `braventi-loamy` (Braventi LOAMY) |
| Vercel project | `loamy-platform` (`prj_WRyNkScxh6zrXmEWRM2XyJCUKJUi`) |
| Production URL | **https://loamy-platform.vercel.app** |
| Deployment mechanism | Git integration, production branch `main` |
| **Previous production SHA** | `171c3bb` (committed 2026-08-30 09:14 WAT; deployment created 09:36 WAT, 22 min later) |
| Previous deployment ID | `dpl_96eCDBQUq8TvfdewfkJEa5t7ecEV` (Aug 30 2026, 24 days old) |
| **Deployed SHA** | `55740ba` = `de90f5f` + one deployment-config commit |
| Final deployment ID | `dpl_AajVA1FvLDD4wTJZbdE9gg2BtceU` |
| Final deployment URL | https://loamy-platform-c3llgnm8q-braventi-loamy.vercel.app |
| Deployment timestamp | 2026-09-23 01:11:42 UTC |
| Build result | **Ready**, 39s |
| Database migrations run | **None** — `supabase db push` was not executed |

`main` was fast-forwarded to exactly `de90f5f` (origin/main was an ancestor, so
no merge commit and no rewrite). The owner chose this over a CLI deploy so that
`main` remains the production truth.

### Why the deployed SHA is not exactly de90f5f

`de90f5f` alone **could not serve the application** (see below). One commit was
added, `55740ba`, containing a single new file, `vercel.json`, with an SPA
rewrite. **No application code differs from `de90f5f`** — the JavaScript bundle
is byte-identical (`index-DRIHXfAn.js` in both the local verified build and
production). Section 11 of the directive authorises fixing deployment
configuration necessary to deploy the verified release.

## The production defect this deployment uncovered

**Every route except `/` was returning HTTP 404 in production.**

```
/             status=200
/login        status=404
/privacy      status=404
/marketplace  status=404
```

This was **not caused by this release**. The project has never had a
`vercel.json`, so Vercel served the build output literally and client-side
routes had no fallback to `index.html`. Only the index route resolved to a real
file. Anyone who opened, bookmarked or was linked to any URL other than the bare
domain got Vercel's 404 page — for the entire life of the deployment.

Fix: `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`.
Vercel checks the filesystem before applying rewrites, so hashed assets are not
shadowed — verified: `/assets/index-DRIHXfAn.js` returns
`application/javascript`, 2,051,248 bytes.

After the fix all routes return 200.

## Environment verification

Read from the existing project. **No variable was added, changed or removed.**

| Variable | Production | Verdict |
|---|---|---|
| `VITE_SUPABASE_URL` | present (encrypted) | required, correct |
| `VITE_SUPABASE_ANON_KEY` | present (encrypted) | required, correct |
| `VITE_PAYSTACK_PUBLIC_KEY` | present (encrypted) | public key, correct |
| `VITE_COPILOT_LLM_API_KEY` | **absent** | **correct — must stay unset** |
| `VITE_COPILOT_STT_API_KEY` | **absent** | **correct — must stay unset** |

No server-only secret is exposed through a `VITE_` variable. No provider
credential was introduced.

`vercel link` wrote `.vercel/` and `.env.local` locally and appended `.vercel`
plus `.env*` to `.gitignore`. `.env*` was narrowed to `.vercel`, because `.env*`
would have re-ignored the intentionally tracked `.env.example`, and `.env.local`
is already covered by the existing `.env.*` rule.

## Proof the new release is actually serving

Not "Vercel says Ready". The live bundle was fetched and inspected:

| Check | Result |
|---|---|
| Bundle served at production URL | `/assets/index-DRIHXfAn.js` |
| Local verified build | `/assets/index-DRIHXfAn.js` — **identical** |
| Bundle before deployment | `/assets/index-DY5UppIY.js` (now replaced) |
| `Your farming co-pilot` | PRESENT |
| `Open Loam, your farming co-pilot` | PRESENT |
| `hero-farmer` (new auth photography) | PRESENT |
| `LoamAvatar` leaf path | PRESENT |
| `loam/loam-default.png` reference | PRESENT |

Two markers were **rejected as discriminators** rather than counted: `Ask Loam`
also matches the transport board's "Ask Loamy carriers for offers", and
`Loamy Co-pilot` legitimately appears inside `COPILOT_DISCLAIMER` in the new
build too. An early check using `Open Loam` reported a false PRESENT against the
*old* bundle because it is a prefix of "Open Loamy…".

## Live smoke-test results — 73/73

Real Chrome against `https://loamy-platform.vercel.app`. Read-only: no account,
transaction, financing application, logistics job, warehouse receipt or fee
change was created, and no part of the security suite was run (§10).

| Surface | 390 | 768 | 1440 |
|---|---|---|---|
| Landing | OK | OK | OK |
| Privacy | OK | OK | OK |
| Login (+ new photography, no overflow) | OK | OK | OK |
| Signup (+ new photography, no overflow) | OK | OK | OK |
| Buyer dashboard | OK | — | OK |
| Marketplace (12 live listings) | OK | — | OK |
| Commodity detail (`/marketplace/:id`) | OK | — | OK |
| Trace | OK | — | OK |
| Loam launcher + panel | OK | — | OK |

Role sign-in and routing, all verified on the live site:

| Role | Lands on | Renders |
|---|---|---|
| buyer | `/dashboard/buyer` | OK |
| farmer | `/dashboard/farmer` | OK |
| growth partner | `/dashboard/growth_partner` | OK |
| trader | `/dashboard/trader` | OK |
| logistics (carrier) | `/dashboard/logistics_provider` | OK |
| warehouse | `/dashboard/warehouse_owner` | OK |
| admin | `/admin` | OK |

**Not covered: the bank portal.** No bank-role credential exists on this
machine. The `bank_portal` flag is `true` in production, but the surface itself
was not exercised and is not claimed as verified.

## Copilot / Loam verification

| Check | Result |
|---|---|
| `copilot` feature flag in production | `true` |
| Launcher present (390 and 1440) | yes |
| Launcher reads "Ask Loam" | yes |
| Launcher uses the Loam identity, not a star/sparkle | yes — 1 inline SVG |
| Launcher clears the mobile bottom nav | yes — **0px overlap at 390** |
| Panel opens | yes |
| Panel names the role ("Your farming co-pilot") | yes |

**Stated exactly, as required:** the four Loam character renders
(`public/images/loam/loam-*.png`) are **still not in the repository**. The
single SVG in the launcher is the **approved Loamy leaf-mark fallback**, not
character artwork. The deployed release contains the Loam identity *wiring* and
the fallback — not the character.

## Login / signup visual refinement

Verified live at all three widths: `hero-farmer.jpg` photography present on both
routes, no horizontal overflow (0px), privacy reachable, and the old build is
gone — the previous bundle hash is no longer served.

No design change was made during deployment.

## Runtime errors

**None.** No JavaScript exception, no console error, no failed asset request and
no failed Supabase request across every surface and width tested.

One reported failure was investigated and dismissed as a harness artifact: the
`notifications` request appeared as `requestfailed`, but its `errorText` was
`ERR_ABORTED` — the harness navigating away cancelled it. The same query
succeeds from Node (`ok, 1 row`). The harness now ignores aborted requests.

### Harness defects found and fixed during this smoke test

Recorded because a smoke test that reports false failures is worth no more than
one that reports false passes. **Four of the twelve initial flags were mine:**

1. Checked for the Loam launcher while sitting on `/financing` — which is not a
   route (the real ones are `/financing/apply/:txnId` and
   `/dashboard/farmer/financing/apply`), so it correctly 404s, and the 404 page
   renders outside `AppShell` where no Copilot exists.
2. Used `/settings/profile`; the real public profile route is `/u/:username`.
3. Looked for `a[href*="/listing/"]`; live listings are `/marketplace/<uuid>`.
4. Read role dashboards' `innerText` immediately after sign-in with no wait, so
   all six reported "0 chars".

Only after correcting these did the genuine defect — the missing SPA rewrite —
stand out clearly rather than being buried among my own noise.

## Blockers

| # | Blocker | Status |
|---|---|---|
| 1 | **Admin fixture credential still published on GitHub** in 16 commits and **not yet rotated** | **OPEN — P0** |
| 2 | Bank portal not smoke-tested (no bank-role credential) | OPEN — P2 |
| 3 | Production, test and dev remain one Supabase project | OPEN — P0 for scale |
| 4 | Backup / PITR capability still unverified | OPEN — P1 |
| 5 | `docs/deployment.md` states "nothing is deployed" and is now wrong | OPEN — P2, docs |

Deployment succeeded. **Blocker 1 is unchanged by it and still needs the owner
to rotate that password.**

## Definition of done

| Criterion | Status |
|---|---|
| Existing Vercel project identified | ✅ `braventi-loamy/loamy-platform` |
| Existing production URL identified | ✅ |
| Current production SHA recorded | ✅ `171c3bb` |
| `de90f5f` verified | ✅ |
| No production database migration performed | ✅ |
| Existing production env vars verified | ✅ unchanged |
| Deployed to existing Vercel production | ✅ `55740ba` (= `de90f5f` + SPA rewrite) |
| Production URL serves the new release | ✅ bundle hash matches local build |
| Login / signup / buyer dashboard / marketplace reflect release | ✅ |
| Financing | ⚠️ route exists only as `/financing/apply/:txnId`; not exercised end to end |
| Trace | ✅ |
| Loam launcher + responsive behaviour | ✅ 390 / 768 / 1440 |
| No critical browser/runtime errors | ✅ |
| No production mutation tests executed | ✅ |
| Deployment report updated | ✅ |

**Wave 2 not started.**
