# Deployment architecture

**Status: nothing is deployed.** There has never been a Vercel, Netlify, Render
or CI configuration in this repository's history. Every change described in the
build phases is live in the **database** and present in the **source tree**, and
reachable only from a developer's machine on `npm run dev`.

That was a deliberate choice recorded in `HANDOFF.md` ("keep it undeployed until
the team activates post bank approval"), not an oversight. This document exists
so that when the decision changes, nobody has to reconstruct the reasoning.

---

## The problem to be solved first

There is **one Supabase project**, `lsuqbjwlybzhyuvzgtdj`, and it is production.
It holds 247 real Founding Member profiles. The security suite in
`tests/security` creates accounts in it on every run.

So today, **the test environment and the production environment are the same
database.** That is the single largest gap in this repository and no amount of
frontend deployment configuration fixes it.

Until it is fixed, `npm run test:security` must stay opt-in and must never run
in CI.

---

## Target: three environments

| | Supabase project | Frontend | Who touches it |
|---|---|---|---|
| **dev** | `loamy-dev` (new) | local `npm run dev` | any engineer, freely |
| **staging** | `loamy-staging` (new) | preview deploys | engineers + the team reviewing |
| **production** | `lsuqbjwlybzhyuvzgtdj` (existing) | one domain | release only |

Each gets its own `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` and its own
Paystack keys. Nothing is shared between them — a shared key is a shared
environment wearing two names.

### Standing up dev and staging

The migration history is complete and ordered, so a fresh project is not a
rebuild:

```
supabase link --project-ref <new-ref>
supabase db push          # replays every migration from 20260919100001
```

What does **not** transfer, and must not be copied from production:

- the 247 profiles — staging gets seeded fixtures, not real members
- Paystack live keys
- any storage object holding verification evidence

### Secrets

- `.env` is git-ignored and stays that way. `.env.example` lists names only.
- The **service_role key belongs to no environment file.** It exists only as a
  Supabase Edge Function secret, per `PAYSTACK-SETUP.md`.
- The Paystack secret key is likewise an Edge Function secret, never a
  `VITE_` variable — anything prefixed `VITE_` is compiled into the browser
  bundle and is public by definition.

---

## Release gates

A build may go to production only when all of these pass:

1. `npm run typecheck` — clean
2. `npm test` — the 33 offline unit tests, green
3. `npm run test:security` — green **against staging**, not production
4. `supabase db push --dry-run` against production shows only the migrations
   intended by this release
5. `loamy_run_reconciliation` reports zero exceptions
6. The money gates in `docs/financial-boundaries.md` are met, or the payment
   surface stays dormant (`VITE_PAYSTACK_PUBLIC_KEY` blank)

Gate 3 cannot be met today. Gate 6 cannot be met today. Both are listed here as
gates rather than quietly dropped.

---

## Migration discipline

- Migrations are forward-only and are never edited once pushed. A mistake gets
  a new migration, which is why the history contains files like
  `…_loamy_escrow_honours_fee_snapshot.sql` rather than an amended original.
- `supabase db reset` is never run against production.
- No migration drops or renames a production column without an explicit
  decision recorded in its header comment. The two columns that were dropped
  (`profiles.bvn_encrypted`, `profiles.nin_encrypted`) were dropped because
  holding them at all was the violation, and both were empty.

---

## What deploying the frontend actually needs

Small, and deliberately not done yet:

- a host (Vercel fits the Vite build with no configuration)
- the two `VITE_` variables set per environment
- a SPA rewrite so client-side routes resolve on refresh
- `npm run build` as the build command, `dist` as the output

The reason to wait is not technical. Deploying puts a Nigerian agricultural
marketplace with a dormant payment surface on the public internet under the
Loamy name, and that is a business decision about bank approval and the legal
position on escrow — see `docs/financial-boundaries.md`.
