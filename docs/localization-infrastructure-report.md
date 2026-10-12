# Localization infrastructure report (Wave A.5)

Written for: the engineer running the next localization wave, and whoever
reviews whether its claims can be trusted.

Waves A.1 to A.4 localized four role clusters. This wave localized nothing. It
hardened the contract those waves exposed, so that the next one cannot silently
disagree with the runtime i18n engine.

**The success metric is not coverage.** It is that a future wave introducing any
of the eight listed failure classes now fails a test. All eight were injected
deliberately and all eight turned a guard red.

---

## 1. Source-to-engine invariants

`tests/unit/i18n-source-contract.test.ts`, 12 tests, asserting one chain:

```
APPLICATION SOURCE -> LOOKUP ENGINE -> CANONICAL KEY -> LOCALE PACK
```

The direction is the point. Wave A.3 found three key families written as
`base_one` / `base_other` while `pluralKey()` produces the bare base and
`base_plural`. Every lookup missed and a member read the literal text
`transaction.orderPlaced_plural`, in English as much as in the other four
languages. **Five parity tests were green at the time, and all five compared
pack to pack.** The packs agreed with each other and all of them disagreed with
the code, which pack parity cannot see by construction.

| Invariant | What it catches |
| --- | --- |
| every literal key exists in canonical English | typo, key never added, stale rename |
| every literal key RESOLVES through `translate()` | membership in the object is not resolution |
| every runtime-built prefix matches a real namespace | `financing.banks.` where the pack says `financing.bank.` |
| the canonical pack and the runtime registry are one object | a key that typechecks but cannot resolve |
| no canonical key uses `_one` / `_other` | a suffix the engine cannot produce |
| every counted key resolves for every count in every locale | run through the real `pluralKey`, 7 counts, 5 locales |
| no pack carries an orphan `_plural` | a half-finished rename, or a translator inventing a form |
| every call site supplies the variables its English declares | a dropped `{amount}` |
| no call site supplies a variable the English does not declare | call site and copy drifting apart |
| no translation requires a variable the source cannot supply | a French string using `{montant}` where English says `{amount}` |
| no translation drops a variable the English declares | a placeholder lost in translation |

### The extraction is now shared, which was most of the problem

`scripts/lib/i18n-contract.mjs`. Waves A.1 to A.4 each grew their own string
scanner **inside the test that needed it**, so each was wrong in its own way and
fixing one fixed one:

- one subtracted any value appearing in some pack, conflating "keyed here" with
  "this word exists elsewhere";
- one read only the remainder of a call's own line, so ten multi-line calls were
  reported as passing no variables;
- one missed shorthand properties, so `t('k', { email })` counted as supplying
  nothing;
- one could not see a height living in a module constant.

Both the test guards and the reporting scripts now read that one module. A
scanner bug is a bug in one file.

Two bugs in the extraction were found and fixed while building it: `pluralBases`
scoped its variable-key lookup to a single file when the declaration
(`src/lib/bank.ts`) and the `tPlural` call (`BankMonitoring.tsx`) are in
different files, and it over-collected `{ key, en }` objects from
`src/lib/errors.ts` that carry no count, which would have demanded a
nonexistent `error.notAllowed_plural`.

---

## 2. Pluralization

The canonical convention is `pluralKey()`: the bare base for the `one`
category, `base_plural` for everything else. Both mismatch directions are
caught: a pack key with a foreign suffix, and a counted key missing a form.

13 counted keys are in use. All 13 resolve for every count in every locale.

`tests/unit/plural-keys.test.ts` keeps the assertions that are about the WORDS
rather than the keys, and dropped its own scanner:

- every plural form carries `{count}`. The singular may omit it ("Your order was
  placed" reads better than "1 order was placed"); the plural may not, because
  "orders were placed" without the number is a sentence that lost its subject.
- no plural form is identical to its singular **in English and French only**.

### A deliberate non-assertion

Igbo and Yoruba have a single plural category, so one form serving both counts
is correct and flagging it would flag the right answer.

**Hausa was excluded for a less certain reason.** CLDR gives it `one` and
`other`, so the engine asks for two forms, but a Hausa noun following a numeral
commonly does not inflect because the numeral already carries the number. Three
processor keys render identically in both forms. Whether that is good Hausa or
laziness is a question for a speaker, so it is recorded in the glossary's
reviewer queue (item 17) rather than asserted either way. A guard that enforces
a guess about grammar is worse than no guard.

---

## 3. Interpolation contract

Compared as a CONTRACT, never as prose. Four assertions, in both directions,
across all five packs: a translation may not drop a declared variable, may not
introduce one the English never declares, and a call site must supply what the
English declares and nothing it does not.

The project's syntax is `{name}`, not `{{name}}`.

---

## 4. Formatter audit

Every locale-sensitive site in the application, classified:

| Classification | Sites | Meaning |
| --- | --- | --- |
| threaded | 5 | locale comes from `LOCALE_META[locale]`. All in `src/lib/i18n/format.ts`. |
| money | 24 | pinned to en-NG **on purpose** |
| hardcoded | 32 | a locale literal; output can never follow the member |
| browser | 2 | no locale at all; output varies by machine |

Two formatter families exist:

- **canonical**, `src/lib/i18n/format.ts`: `formatNumber`, `formatDateShort`,
  `formatDateLong`, `formatRelative` all take a locale; `formatMoney` pins it.
- **legacy**, `src/lib/utils.ts`: `formatDateShort` and `formatDateLong`
  hardcode `en-NG`, from before the i18n layer existed. **73 files** inherited
  them.

`formatNaira` is NOT legacy. It is money, and pinning it is the rule.

### The two browser-locale sites

`src/components/AdminDataHealth.tsx` lines 147 and 215 call `toLocaleString()`
with no argument, so the output follows whatever machine renders it. That is
worse than hardcoding in one respect: a bug reproduces for one tester and not
the next. Admin is out of scope for this wave, so they are **named in the debt
list** rather than changed, and the next Admin wave inherits a located defect
instead of rediscovering it.

---

## 5. The legacy formatter guard

`LEGACY_DATE_DEBT` in the shared contract module freezes the 73 files. A file on
the list may keep its debt; a file not on it may not take any. The list may only
shrink, and a guard asserts that every entry still owes something, so a migrated
file must be removed rather than left to make the number look worse.

**The Bank portal was migrated as the representative set**, which also corrects
an A.4 claim. The A.4 report said "the 13 bank files were moved to the i18n
contract's `dateShort`". Nine had only a stale import left, which is harmless,
but `BankApplicationDetail` still had **7 live calls** and `ReportView` had
**1**. The claim was overstated. All 8 are migrated now, 11 stale imports are
removed, and `src/pages/bank/` is absent from the debt list, which the guard
asserts.

---

## 6. Coverage tooling

`scripts/i18n-coverage.mjs` was rewritten. Both of its numbers were wrong in
ways that flattered the project.

**Its key regex was `[a-zA-Z][\w.]*`**, which rejects spaces, hyphens and `&`.
So `bank.sector.Trading & Distribution`, `nav.my-listings` and 24 others were
invisible to it: absent from the canonical total and therefore never reportable
as untranslated in any locale. **A key the tool cannot see is a key it cannot
tell you is missing.** It reported 2,375 canonical keys where there were 2,401.

**Its "still hard-coded" counter scanned JSX text and four attributes** -
exactly the scan that undercounted every wave. It also counted Tailwind
classes, SQL column lists, the i18n key being passed to the translator, and
`tOr`'s English fallback, which exists on purpose.

It now classifies into the five buckets the brief names:

| | Bucket | Count |
| --- | --- | --- |
| A | interface candidates | 2,733 across 218 files |
| B | already-keyed vocabulary | 196 |
| C | i18n keys being passed | 145 |
| D | user / business data | 1,100 |
| E | internal identifiers | 6,827 |
| | class names and styles | 4,723 |

Bucket D is why `src/lib/lgas.ts` left the "worst files" list: it is 796
Nigerian Local Government Area names. Place names are not translated, are not
written by Loamy, and had sat at the top of that list for four waves, drowning
out the files that actually needed work.

### The limitations are printed, not implied

The tool now states them in its own output: A is a candidate count and not a
defect count; no static reachability is attempted; bucket B only fires where a
file calls `useT()`; and **the lib-map pattern is not detected** -
`src/lib/roles.ts` holds nav labels that `AppShell` renders through
``tOr(`nav.${section}`, label)``, so they are keyed, but the English lives in a
map in one file and the `tOr` call in another. A lib file high in the list means
"check whether its map is keyed", not "this many strings are unreachable".

A false positive is preferable to a confident wrong number, because the
confident wrong number is what each of the last four waves had to correct.

---

## 7. Pack invariants

`tests/unit/i18n-pack-invariants.test.ts`, 14 tests. **Three real defects were
found by writing them.**

### Duplicate keys: 51 shadowed declarations, 12 with differing values

A duplicate is legal TypeScript. The last spread wins, silently, so which string
renders depended on the order of unrelated lines in a pack's `index.ts`.

| Key | Declared | Rendered |
| --- | --- | --- |
| `notifications.markAllRead` (en) | `'Mark all as read'` and `'Mark all read'` | the first, because `account` spreads after `nav` |
| `profile.title` (ha) | `'Bayanan ka'` and `'Bayananka'` | the second |
| `logistics.openJobs` (ha) | `'Ayyuka a buɗe'` and `'Ayyukan da ake da su'` | the second |
| `warehouse.capacity` (ha) | `'Girma'` and `'Girman ajiya'` | the second |
| ... 8 more with differing values, 39 more identical | | |

All 51 shadowed copies were removed, always the one in the file that spreads
EARLIER, so the resolved value is unchanged by construction. **Verified
empirically**: the resolved packs were snapshotted before and after, and the
only differences are the 10 entries deliberately deleted below. 10,269 resolved
entries before, 10,259 after.

### Dead keys: `cart.items` and `cart.items_plural`

Added in Phase 2, superseded by `a11y.addedToCartAnnouncement`, referenced
nowhere. Deleted from all five packs.

### Reference vocabulary is now a category, not an anomaly

`term.*` is 26 keys of platform terminology whose own header says they "appear
inside hundreds of other strings". Nothing calls `t('term.commodity')` directly.
They are legitimately unreferenced, which is **not** the same as dead, and the
two look identical to a reachability scan while the honest treatment is
opposite. `REFERENCE_NAMESPACES` records the claim, and coverage reports
rendered interface separately from reference vocabulary.

### The other invariants

- English defines the key space; no pack may introduce an unknown key.
- No translation is an empty string. An empty value is worse than a missing one:
  a missing key falls back and the member reads something, while an empty string
  satisfies the lookup, renders nothing, and never records a gap.
- **No pack passes English off as a translation.** A value identical to its
  English passes only if a rule explains it (nothing translatable outside the
  placeholders) or it is listed with a category: brand, acronym, unit,
  glossary-retained, borrowing, or French cognate. 59 values are explained; the
  list is also asserted to contain nothing stale.
- `REVIEW_STATUS` stays authoritative: English canonical, nothing claims native
  review, and a locale marked `partial` must actually have gaps.
- Fallback stays observable: a missing key renders English AND is recorded in
  `missingKeys()`, which is how coverage is measured honestly.

---

## 8. Glossary contract

`src/lib/i18n/glossary.md` now opens with a four-status contract, because the
four license different actions and treating them as one is how a reviewer
"fixes" something already right or leaves something never checked:

| Status | Marker | What you may do |
| --- | --- | --- |
| **Established** | no marker | reuse freely |
| **Provisional** | `*(new)*` in wave tables | use, expect improvement, do not fork |
| **Reviewer challenge** | numbered in the queue | do not silently change; needs a speaker |
| **Intentionally untranslated** | stated per term | leave it; translating is the defect |

A term may be provisional in one language and established in another, and the
wave tables mark that per cell. The intentionally-untranslated set is listed in
full and is enforced by the pack-invariant guard.

The reviewer queue is now framed as the review queue in priority order: 17
entries, including the financial terms (**facility**, **principal**, **tenor**,
**collateral**) and the processor terms (**escrow**, **bid**, **award**, and the
Yoruba `ipò` collision where *grade* and *status* render the same word on one
bid row).

---

## 9. Shared chrome

Measured, not assumed. The A.4 bank QA had reported 10 distinct undersized
controls in shared chrome; both are fixed and re-measured.

| Control | Was | Source |
| --- | --- | --- |
| `Accept all`, `Essential only`, `Manage preferences`, `Save` | 32px | `PrivacyNotice.tsx` |
| `Read the Privacy Policy` | 17.39px | `PrivacyNotice.tsx` |
| Loamy brand lockup | 30px (en), 38.75px (ha) | `AppShell.tsx` |

The `sm` button variant is **deliberately** 32px for dense in-page actions, so
it was left alone; changing it would move every small button in the product,
which is the general accessibility cleanup the brief excludes. The four consent
controls were raised individually, because a consent decision is the first thing
a member is asked, on every page, in every language, often on a phone.

The brand lockup is localization-relevant in a way that is easy to miss: its
height is set by the artwork **and the tagline**, so it measured 30px in English
and 38.75px in Hausa. Both under the minimum.

Re-measured with `scripts/verify-bank-qa.mjs`: **117 page scans, 0 findings** -
no undersized control, no document overflow, no element past the right edge, no
visible translation key, across 14 routes at 390/768/1440 in all five languages.

---

## 10. Server-generated text

`docs/localization-server-text-contract.md`. An architecture note; nothing was
migrated and no data was touched.

The problem in one sentence: **a sentence composed on the server cannot be
translated on the client, because by the time it arrives the words have already
been chosen.**

Seven classes are enumerated (activity notes, risk factors, settlement reason,
checklist labels, edge-function failures, Postgres errors, the purchase
contract), each with why it resists. The preferred contract is **CODE + PARAMS**
rather than a pre-rendered sentence, with the reasoning for rejecting the
alternatives (translate on write: the locale belongs to the read; store five
columns: no answer for the sixth language; interpolate server-side: the client
cannot reorder, and reordering is most of what translation is).

Migration is additive and gradual, and **nothing is backfilled**: an activity row
is a record of what was said, and rewriting it would be editing history.

---

## 11. Tests

| File | Tests | Covers |
| --- | --- | --- |
| `tests/unit/i18n-source-contract.test.ts` | 12 | the four-layer chain |
| `tests/unit/i18n-pack-invariants.test.ts` | 14 | duplicates, empties, English-identical, REVIEW_STATUS, fallback |
| `tests/unit/i18n-formatters.test.ts` | 19 | money, counts, dates, relative, both ratchets |
| `tests/unit/plural-keys.test.ts` | 3 | the words, not the keys |
| `tests/components/i18n-five-languages.test.tsx` | 16 | ten semantic cases rendered in five languages |

**Suite: 57 files, 1,283 tests, all passing.** The count moved from 1,294 because
`plural-keys` was consolidated from 7 tests to 3, with the per-locale and
per-count versions relocated into the source contract. Net assertions increased.

### Mutation-tested, reproducibly

`scripts/mutate-i18n-guards.mjs` injects twelve faults, runs the guards, and
restores every file. **12/12 caught**, and the output names which test caught
each one, so the claim can be re-checked rather than taken from this report.

```
missing-key            caught
stale-rename           caught
namespace-typo         caught
plural-suffix          caught
source-missing-var     caught
translation-new-var    caught
translation-drops-var  caught
duplicate-key          caught
empty-translation      caught
english-copied         caught
legacy-formatter       caught
hardcoded-locale       caught
```

This exists as a script because every guard in this area has been written at
least once in a form that passed while proving nothing: the first dynamic-key
guard described the dangerous namespaces with a regex and matched none of them,
including the offender it was written for.

Two of the twelve are worth noting individually. **`hardcoded-locale` cannot be
caught behaviourally**: `formatNaira(500000)` and
`(500000).toLocaleString('en-NG')` produce the identical string, so the mutation
was injected in A.4 and the suite stayed green. What makes a pinned locale wrong
is not the output for one number but that the output can never change, so the
rule is asserted over the source. And **`stale-rename` first reported ANCHOR
MISSING** because the spec embedded a `\n` while the packs are CRLF: the guard
was fine and the spec was broken, which is itself the failure mode this script
exists to expose.

---

## 12. tsc

Clean.

## 13. Build

Passes. 2,883 modules. The 2.6 MB bundle-size warning is pre-existing and
unrelated.

## 14. Release guard

`node scripts/check-release-env.mjs`: OK, no test credential or foreign project
reference in the build.

---

## 15. Remaining localization infrastructure gaps

Named, with the reason each was not closed here.

1. **73 files still use the locale-hardcoded date helper.** Frozen, not fixed.
   Migrating all of them is a 73-file diff with no test able to tell a correct
   migration from a careless one; the ratchet prevents a 74th.
2. **32 hardcoded and 2 browser-locale formatter sites** outside the money
   layer, in 24 files. Listed in `KNOWN_LOCALE_DEBT` with per-file reasons.
3. **The lib-map pattern is invisible to the coverage tool.** `roles.ts`,
   `fulfilment.ts`, `financingLifecycle.ts`, `rfqs.ts` and `fieldops.ts` sit
   high in the candidate list while being keyed, because the English lives in a
   map in one file and the `tOr` call in another. Closing this needs the tool to
   resolve map identifiers across files.
4. **No static reachability.** A string behind a condition is counted. Deliberate:
   a conservative over-count beats a confident under-count.
5. **Igbo and Yoruba are at 73%, Hausa at 82%.** Not this wave's objective, and
   not a defect: the packs are marked `partial` and the fallback is observable.
6. **No language is native-reviewed.** The single largest outstanding item in the
   whole localization effort, and no test can close it.
7. **Server-generated text is documented, not migrated.** Seven classes remain
   pre-rendered English.
8. **Bank browser QA still has no institution-scoped fixture.** The A.4 run used
   the admin override, so populated tables were never exercised. Unchanged.

---

## 16. Production

Untouched. No Vercel deployment, no production migration, no production data
change, no production configuration change. The browser re-measurement ran
against the staging dev server (`vite --mode test`), guarded by
`assertServedProjectNotProduction`, and only read.

### Security suite: carried forward unchanged, NOT re-run

```
820 passed
0 assertion failures
27 assertions did not execute
rls-cross-user.test.ts beforeAll failed: Supabase provisioning hit ECONNRESET
```

**The security suite is NOT green.** It was not re-run in this wave, and no
security test, provisioning, retry, timeout or concurrency setting was modified.
