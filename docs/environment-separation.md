# Environment separation

**Date:** 2026-09-23
**Addresses:** release blockers B1 (contaminated production data), B8 (one
project for dev, test and production) and B10 (exposed admin credential).

**What changed:** production is no longer a reachable target for anything that
writes. **What did not change:** the production application's own
configuration, and the contaminated records, which are still in place.

---

## 1. What was wrong

Every mutation-heavy path resolved its Supabase project the same way:

```ts
// tests/helpers/supabase.ts, before
const env = parse(readFileSync('.env'))
export const SUPABASE_URL = env.VITE_SUPABASE_URL   // production
```

`.env` is production. So the security suite, all 14 `verify-*` scripts and 9
browser QA harnesses wrote to the real member database by default. Nobody chose
that; it was simply what a missing configuration resolved to.

The audit measured the result: 2,011 profiles against a documented real base of
247, 1,851 of them created in September, plus two `Test Sandbox Bank` rows
sitting beside a real institution.

## 2. The design

One rule: **mutation-heavy code cannot resolve production, and cannot fall back
to it.**

| Concern | Where |
|---|---|
| Which project is production | `config/environments.json` (one file, read by both guards) |
| Guard for Node scripts | `scripts/_environment.mjs` |
| Guard for the test suites | `tests/helpers/environment.ts` |
| Staging credentials | `.env.test` (gitignored), template in `.env.test.example` |
| Build-time protection | `scripts/check-release-env.mjs`, wired into `npm run build` |

`testEnv()` reads `.env.test` and throws when it is missing **or** when it names
a protected project. There is deliberately **no override flag**: an override is
how a guard becomes decoration.

The production ref is not a secret. It is part of `VITE_SUPABASE_URL`, which is
compiled into the browser bundle and served to every visitor, so committing it
costs nothing and lets the guard be self-contained.

### What is still allowed against production

**Reading.** `scripts/live-smoke.mjs` verifies a deployment by navigating and
reading it, and `scripts/census-production-accounts.mjs` counts accounts.
Neither calls the guard, because neither writes. Reading production is how a
release gets verified; writing to it is what this work prevents.

## 3. What it looks like when it fires

```
$ node scripts/verify-stage3.mjs
Error: REFUSED: scripts/verify-stage3.mjs is mutation-heavy and has no staging
project configured.
Set LOAMY_TEST_SUPABASE_URL and LOAMY_TEST_SUPABASE_ANON_KEY in .env.test
(gitignored) or in the environment.
It deliberately does NOT fall back to .env, because .env is production.
```

```
$ npm run test:security
Error: REFUSED: the security suite is mutation-heavy and has no staging project
configured.
```

Both are the state on a machine with no `.env.test`, which is every machine
today. **The security suite currently cannot run at all.** That is the intended
outcome, not a regression: it could previously only run by writing to
production.

## 4. Standing up staging

**Correction (2026-09-23): this is not true, and was proven false the first
time it was attempted.**

`docs/deployment.md` claims, and this document previously repeated, that the
migration history is complete so a fresh project is a replay. It is not.
`supabase db push` into the new staging project failed on migration 1 of 155:

```
Applying migration 20260712100001_loamy_stage1_extend_profiles.sql...
ERROR: relation "public.profiles" does not exist (SQLSTATE 42P01)
```

That migration's own header says why: *"Extends the EXISTING Founding Member
Portal `profiles` table."* The Portal is a **separate codebase and deployment**
(README:15) that owns the base schema in the shared project.

The dependency is narrow and exactly one table wide. Of 114 tables, 113 are
created by this repo; `public.profiles` is altered by 17 migrations and created
by none. Production's `profiles` has 29 columns, of which these migrations add
13, leaving **16 columns owned by the Portal**: `id`, `email`, `full_name`,
`phone`, `role`, `state`, `category`, `created_at`, `digital_id`,
`founding_member`, `business_info`, `farm_info`, `interests`,
`profile_completion`, `referral_count`, `referred_by` -- plus its signup
trigger, digital-ID generator and RLS policies.

Staging therefore needs the Portal's base schema applied FIRST, from the
Portal's own migrations or a schema-only dump. Hand-writing `profiles` here
would give staging a schema that is not production's, which is a worse outcome
than no staging at all: every result would be measured against the wrong shape.

The Loamy migration history is a replay only ON TOP OF that base.

### The procedure that actually works, verified 2026-09-23

The Portal repository is `github.com/salaam-1/loamy-portal`. Its six migrations
create `profiles`, `launch_config`, `feature_suggestions`, the
`on_auth_user_created` signup trigger, the digital-ID generator, the
profile-completion and field-protection triggers, RLS policies and indexes.

```bash
# 1. Portal base, pushed FROM THE PORTAL REPO so nothing is copied or retyped
cd <loamy-portal>
supabase link --project-ref <staging-ref>
supabase db push                       # applies 0001..0006

# 2. Match production's convention: production records only the Loamy 155 in
#    supabase_migrations, with the Portal applied but unrecorded. Reproduce
#    that, which also lets the Loamy repo push without tripping over versions
#    it does not have locally. The SCHEMA is untouched by this; only the
#    history table changes.
cd <loamy-platform>
supabase migration repair --status reverted 0001 0002 0003 0004 0005 0006

# 3. The Loamy 155
supabase db push                       # 155 applied, 0 pending, 0 orphan

# 4. Restore Supabase's default privileges, which the CLI's migration role
#    does not inherit. Without this every table answers 42501 and the suite
#    would go green for the wrong reason. See scripts/staging-bootstrap.sql.
supabase db query --linked --file scripts/staging-bootstrap.sql

# 5. Staging auth: new projects require email confirmation, so fixtures never
#    receive a session. Declare ONLY that property, and diff before pushing.
#    A minimal config.toml is essential: `config push` leaves undeclared
#    properties alone, but a file generated by `supabase init` declares
#    defaults you did not intend.
supabase config diff --workdir <tmp> --project-ref <staging-ref>
supabase config push --workdir <tmp> --project-ref <staging-ref>
```

### The mistake step 4 nearly made, and what caught it

The first version of `staging-bootstrap.sql` also ran
`grant all on all functions in schema public to anon, authenticated`. Run after
the migrations, that silently reversed every deliberate revoke in them, for
example:

```sql
revoke all on function public.loamy_transaction_fulfilment(uuid) from public, anon;
grant   execute on function public.loamy_transaction_fulfilment(uuid) to authenticated;
```

anon then held EXECUTE on 297 public functions instead of the intended handful,
and staging permitted what production forbids. The security suite caught it
immediately: `2 - the fulfilment read is party-scoped > refuses a signed-out
visitor` failed, because on staging the signed-out visitor was no longer
refused.

That is the failure this whole exercise exists to prevent, arriving from the
opposite direction: not a test writing to production, but a staging environment
so permissive that a green suite would have meant nothing.

The bootstrap now covers TABLES and SEQUENCES only. Function privileges belong
to the migrations, which manage them precisely, and nothing else should touch
them.

Step 4 is the subtle one. It is not a loosening: production grants broadly and
relies on RLS, verified there by an authenticated `wallet_entries` INSERT being
refused by the table's TRIGGER (`23001`) rather than by a missing grant, and by
anon `SELECT` on `profiles` returning `200 []` rather than `42501`.

```bash
# 1. Create a new Supabase project, then:
supabase link --project-ref <staging-ref>
supabase db push                      # replays all 155 migrations

# 2. Configure the repo
cp .env.test.example .env.test        # then fill in the staging URL and anon key

# 3. Confirm the guard now passes
node scripts/verify-stage1.mjs        # should run, against staging
npm run test:security                 # should run, against staging
```

Do **not** copy from production into staging: not the 247 real profiles, not
Paystack live keys, not storage objects holding verification evidence.

Browser-driven QA needs the app itself pointed at staging too, or the script
writes to staging through the API while the browser writes to production:

```bash
npm run dev:test        # vite --mode test, which loads .env.test
```

## 5. Production deployment cannot inherit test credentials

`scripts/check-release-env.mjs` runs as the last step of `npm run build` and
exits non-zero on any of three conditions:

| Condition | Why it matters |
|---|---|
| A `VITE_`-prefixed test variable exists (`VITE_QA_*`, `VITE_LOAMY_TEST_*`, …) | Vite compiles anything `VITE_`-prefixed into the bundle, publishing a working login |
| A test credential **value** appears anywhere in `dist/` | Catches a leak that arrived by some other route |
| The bundle names a project other than production | A production build pointing at staging, or a staging build pointing at production. `LOAMY_BUILD_TARGET=staging` inverts the check |

Verified by running it rather than by assertion:

```
VITE_-prefixed test cred      -> exit 1
staging build hitting prod    -> exit 1
clean production build        -> exit 0
```

It tolerates the absence of `.env` and `.env.test`, so it works unchanged on
Vercel, where neither exists.

## 6. What must happen to the contaminated production records

**Nothing has been deleted.** This section is the plan, not a record of work.

### The rule

Classification is by **email alias**, never by display name. The September
fixtures carry realistic Nigerian names, so a name-based rule would both miss
real fixtures and sweep up real members.

There is exactly one implementation, in
`scripts/census-production-accounts.mjs`; `tests/security/test-account-hygiene.test.ts`
re-exports it rather than keeping a second copy.

| Bucket | Test | Disposition |
|---|---|---|
| `suite_generated` | email contains `+t0-` | **The only bucket proposed for deletion** |
| `owner_alias` | any other `usmanyakubu541+` alias | Operational. Keep. Includes the admin fixture and the QA accounts |
| `named_test` | display name announces itself | **Keep.** Review by hand; a real member may be called "Test Ibrahim" |
| `placeholder_domain` | `@example.com`, `@test.com` | Review by hand |
| `likely_real` | everything else | Never touch |

### The steps, in order

1. **Stand up staging first** (§4). Until it exists, deleting from production
   removes the only environment the suite can run in, and the contamination
   resumes on the next run.
2. **Classify.** `profiles` carries no email column and the anon key cannot read
   `auth.users`, so the full classification must be run by the owner in the
   Supabase SQL editor:

   ```sql
   select
     case
       when u.email ilike '%+t0-%'                       then 'suite_generated'
       when u.email ilike '%usmanyakubu541+%'            then 'owner_alias'
       when p.full_name ~* '^(phase0|hardening)\b'
         or p.full_name ~* '\mtest\M'                    then 'named_test'
       when u.email ~* '@(example|test)\.(com|org)$'     then 'placeholder_domain'
       else 'likely_real'
     end as bucket,
     count(*)
   from auth.users u
   join public.profiles p on p.id = u.id
   group by 1
   order by 2 desc;
   ```

3. **Review the `suite_generated` list by hand** before anything is removed.
   The count should be close to the 1,851 September figure; a large gap means
   the rule is wrong, not that the data is fine.
4. **Delete in dependency order**, and only `suite_generated`: dependent rows
   first (cart_items, wishlists, listings, transactions, financing rows),
   `public.profiles` next, `auth.users` last. A profile deleted without its
   dependants leaves orphans that the RLS policies were never written for.
5. **Remove the two `Test Sandbox Bank` rows** from `banks`, leaving LOTUS Bank.
   These are referenced by financing fixtures, so step 4 comes first.
6. **Re-run the census** and record the result.

Steps 2 to 6 need the service_role key and are the owner's to perform. Nothing
in this repository can do them, by design.

## 7. B10: the exposed admin credential

### The exposure

`usmanyakubu541+admin-explore@gmail.com` and its password were literals in
`tests/helpers/supabase.ts` across 16 commits on
`origin/sept-2026-platform-changes`. All branch tips and the working tree are
clean; the history is not, and published history cannot be unpublished.

**No secret value appears in this document, in any commit made during this
work, or in any console output produced by it.**

### Rotation, exactly

1. Sign in to the Supabase dashboard for the production project.
2. **Authentication → Users**, find `usmanyakubu541+admin-explore@gmail.com`.
3. Reset its password to a newly generated value.
4. Update `QA_PASSWORD_ADMIN` in `.env` (gitignored) on each machine that runs
   the read-only census or the QA harnesses.
5. For staging, set `LOAMY_TEST_ADMIN_EMAIL` and `LOAMY_TEST_ADMIN_PASSWORD` in
   `.env.test`. The security suite reads those, never `.env`.

No tracked source needs editing: the credential already resolves at run time.

### Preventing a recurrence

`tests/unit/no-hardcoded-credentials.test.ts` scans `src/`, `scripts/`,
`tests/` and `supabase/functions/` and fails when a credential-shaped key is
assigned a string literal. It accepts run-time resolution (`secret('X')`,
`process.env.X`) and exempts dynamic prefixes such as
`'LoamyStage1-Test!' + Math.random()` and `` `LoamyWave1-QA!${RUN}` ``, because
flagging those would train people to ignore the test.

It reports the file, line and key **only** — never the value — so a failure
does not itself become a disclosure.

## 8. Verification

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` | **826 passed**, 33 files (was 759 / 31) |
| `npm run build` | clean, including the new release-env check |
| Mutation-heavy script with no staging | refuses, exit non-zero |
| `npm run test:security` with no staging | refuses at fixture load |
| Release guard, negative cases | 2 of 2 refuse; clean build passes |
| Security suite run against production | **not run** |

---

## 9. Addendum: browser fixtures that write through the UI

Found during the deployment handoff, in this work's own first sweep.

The first pass classified harnesses by their **direct Supabase calls**. That
missed a category: a harness that clicks "Add to cart" or toggles a wishlist
heart persists rows just as surely, but never constructs a client, so
`testEnv()` never saw it. What decided its target was whichever project the dev
server happened to be built against, which under `npm run dev` is production.

`scripts/visual-qa-ux-polish.mjs` was in that category: it adds to cart and
toggles hearts, and was unguarded.

`assertServedProjectNotProduction(baseUrl, context)` closes it by asking the
running app rather than trusting configuration. It fetches the served bundle,
reads the project reference actually compiled into it, and refuses a protected
ref. Being empirical, it cannot be fooled by an env file that disagrees with
what is being served, and it refuses outright when it cannot tell.

Verified against the live production URL, which serves the production ref:

```
REFUSED: ... (via the dev server at https://loamy-platform.vercel.app) would
write to the PRODUCTION Supabase project
```

`scripts/visual-qa-auth-loam.mjs` was left unguarded deliberately: it fills
forms, toggles password visibility and signs in. A session is not member data.

### Still unguarded, and deliberately so

`scripts/restore-fee-000022.mjs` writes to production through
`loamy_restore_fee_rule`. It is an **operational remediation script**, not a
test: it exists because a fee rule was deactivated by accident and had to be
restored. It is not part of any automated suite and is not run by CI. It is
recorded here so the boundary's one intentional exception is written down
rather than discovered later.

---

## 10. Staging fee parity (2026-09-25)

The migrations seed `FEE-000001` (`marketplace_transaction`) at **0 bps**.
Production carries **200 bps, payer `split`**, set operationally after launch
and therefore absent from the migration history. With 0, escrow release
resolves a zero fee and `ledger_entries_amount_check` (`amount <> 0`) correctly
refuses the entry, which is what the last four suite failures were.

`fee_schedules` grants UPDATE and DELETE to nobody by design: a rate change is
"end the old rule, insert a new one", both audited. Staging was brought to
parity the same way production got there, not by a raw UPDATE:

1. `loamy_end_fee_rule(FEE-000001, reason)` - ends the 0 bps rule and writes an
   audit row.
2. An admin INSERT of one replacement: `marketplace_transaction`, `bps`, `200`,
   payer `split`, active, with a note recording that it is staging parity.

**One rule ended, one rule added. 16 rules to 17.** No other production row was
copied: not the other 21 production rules, not a single member, transaction,
financing or verification record.

Verified through the real engine rather than by inspection:

```
loamy_resolve_fee(marketplace_transaction, 1,000,000)
  -> fee 20000, basis bps, value 200, payer split, resolved true, FEE-000017
```

Security suite after this change: **824 passed, 0 failed, 0 skipped.**
