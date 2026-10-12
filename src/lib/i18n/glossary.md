# Loamy terminology record

The authoritative decisions for the words the product is built on. Every pack
must use the term recorded here for a given concept; a screen that invents its
own wording for "verification" or "settlement" is a bug, not a style choice.

This is a product document, not developer notes. It exists so that a reviewer,
a translator or a regulator can see what each term was decided to mean and why.

---

## Provenance and review status

**None of the four non-English packs has been reviewed by a native speaker.**
They were produced by Claude (Opus 5) on 2026-10-03 and are a first translation
pass: the input to review, not the output of it. `REVIEW_STATUS` in
`src/lib/i18n/packs/index.ts` records this in code so the product cannot
accidentally claim more than is true.

Confidence differs by language, and pretending otherwise would be the dishonest
part:

| Language | Confidence | Basis |
|---|---|---|
| French | High | Full professional-register competence. Financial and agricultural register handled directly. |
| Hausa | Moderate-high for the core | Anchored on Hausa **already verified in this repository** (`copilot_concepts` rows, `copilot/i18n/registry.ts`, `copilot/engine.ts`), which supplies `talla`, `jigila`, `tabbatarwa`, `abokin haɓaka`, `farashi`, `kasuwa`, `kuɗi`, `tallafi`, `gona`. Terms outside that anchor set are lower confidence and marked below. |
| Yoruba | Moderate for the core, low beyond it | Diacritics are written correctly (`ẹ ọ ṣ` plus tone marks). Everyday commercial vocabulary is sound; specialised financing and traceability wording is not confidently established. |
| Igbo | Moderate for the core, low beyond it | Everyday commercial and agricultural vocabulary is sound; specialised financing and traceability wording is not confidently established. |

**Required before any language is described to members as supported:** review by
a native speaker with agricultural-trade familiarity, specifically of the
financing, verification and custody strings, where a wrong word is not a typo
but a misstatement about money.

---

## How to read this record: four statuses, and what each one licenses

Every term in this document carries one of four statuses. The distinction
matters because the four license different actions, and treating them as one
category is how a reviewer ends up "fixing" something that was already right,
or leaving something that was never checked.

| Status | Marker | What it means | What you may do with it |
|---|---|---|---|
| **Established** | (no marker) | Corroborated in this repository, or ordinary vocabulary a competent speaker would produce. Hausa's anchor set is the clearest case: `talla`, `jigila`, `tabbatarwa`, `abokin haɓaka`, `farashi`, `kasuwa`, `kuɗi`, `tallafi`, `gona`, verified in `copilot_concepts` rows and `copilot/i18n/registry.ts`. | Reuse freely. Changing one is a change to the product's vocabulary and needs a reason. |
| **Provisional** | *(new)* in the wave tables | Coined or chosen during a localization wave. Plausible, internally consistent, and NOT corroborated anywhere. | Use it, but expect a reviewer to improve it. Do not build a second term beside it. |
| **Reviewer challenge** | numbered in *Terms a reviewer should challenge first* | Provisional AND identified as likely wrong or likely to read oddly. The register below is the queue a native reviewer should work. | Do not silently change these. They need a speaker, not another guess. |
| **Intentionally untranslated** | stated per term | A proper name, an acronym, an identifier, or a contract name whose meaning depends on staying as it is. | Leave it. "Translating" one of these is the defect. |

**A term may be provisional in one language and established in another.**
`jingina` (ha, collateral) is established; `ihe nkwado` (ig) and
`ohun ìdáhùn` (yo) for the same concept are provisional. The per-wave tables
mark this per cell rather than per row.

### Intentionally untranslated, in full

These appear identically in all five packs, and a guard enforces it:
`tests/unit/i18n-pack-invariants.test.ts` fails if a pack value equals its
English without a recorded reason, so each of these is listed there with a
category.

- **Brands and product names**: Loamy, Loam, Loamy Digital ID, Paystack.
- **Contract names**: Murabaha, Salam. A contract name is the name of a
  specific structure; a description of it is a different thing and would be
  wrong on a financing screen.
- **Identifiers and acronyms**: BVN, NIN, TIN, RC, CAC, GPS, PAR 30+, and every
  reference prefix. A reference must mean the same thing in every language or
  it stops being a reference.
- **Units**: kg, ha, litre, and the naira sign.
- **`batch`** in Igbo and Yoruba, matching the untranslated `BATCH-` reference.

### What is NOT a glossary decision

Money formatting. `₦250,000` renders identically in all five languages because
an amount is a business fact, not a presentation choice. It is enforced in
`tests/unit/i18n-formatters.test.ts` and documented in
`src/lib/i18n/format.ts`, and it is the single thing in this area most likely
to be "corrected" by somebody who has read half of this file.

---

## Core terminology

Confidence column applies to the three Nigerian languages; French is high
throughout unless noted.

| English | Hausa | Igbo | Yoruba | French | Notes |
|---|---|---|---|---|---|
| commodity | kaya | ngwá ahịa | ọjà | produit | Hausa `kaya` is the general "goods" already used across the repo's Hausa Copilot text. Not `amfanin gona` (farm produce), because the platform also lists inputs. |
| batch | tari | ùkwù | ìdì | lot | **Low confidence (ig, yo).** This is the traceability sense: one identified quantity moving as a unit, carrying its origin. Not an ordinary word in any of the three. Reviewers should consider retaining "batch". |
| harvest | girbi | owuwe ihe ubi | ìkórè | récolte | High confidence in all four. |
| farm | gona | ugbo | oko | ferme | `gona` is corroborated in-repo (`gonakinka` = your farms). |
| listing | talla | ngosi ahịa | ìpolówó | annonce | Hausa `talla` is corroborated in-repo. French `annonce` (classified ad) is more natural than `liste`. |
| transaction | ciniki | azụmahịa | ìdúnàdúrà | transaction | `ciniki` is trade/dealing; the repo's Hausa uses it naturally. |
| financing | tallafin kuɗi | nkwado ego | ìnáwó | financement | **See the lender note below.** Deliberately NOT `rance` (Hausa), `mgbazinye ego` (Igbo) or `awin` (Yoruba), all of which mean *loan*. Loamy is not a lender. |
| verification | tabbatarwa | nkwenye | ìjẹ́rìísí | vérification | `tabbatarwa` is corroborated in-repo. |
| Growth Partner | abokin haɓaka | onye nkwado uto | alábàáṣiṣẹ́ ìdàgbàsókè | Partenaire de croissance | Hausa is corroborated in-repo. This is a Loamy role, so it is translated rather than kept as a brand name. |
| logistics | jigila | mbufe ngwongwo | ìkó-ẹrù | logistique | Hausa `jigila` is corroborated in-repo (haulage). |
| warehouse | rumbu | ụlọ nkwakọba | ilé ìtọ́jú ọjà | entrepôt | Hausa `rumbu` is the traditional granary and reads naturally for agricultural storage; `ma'aji` (store) was the alternative considered. |
| exporter | mai fitar da kaya | onye mbupụ | olùkó-ọjà-sóde | exportateur | |
| processor | mai sarrafa kaya | onye nhazi ngwá | aṣèlọ́jà | transformateur | French `transformateur` is the agri-industry term; `processeur` would mean a CPU. |
| buyer | mai saya | onye ọzụzụ | olùrà | acheteur | High confidence in all four. |
| trader | ɗan kasuwa | onye ahịa | oníṣòwò | négociant | French `négociant` carries the commodity-trade sense better than `commerçant`. |
| supplier | mai samarwa | onye na-eweta | olùpèsè | fournisseur | |
| traceability | bibiya | nsochi | ìtọpa | traçabilité | **Low confidence (ig, yo).** Abstract term. Hausa `bibiya` (following/tracking) is the closest natural word. |
| loading | ɗaukar kaya | ibu ngwongwo | ìkó-ẹrù-sínú | chargement | |
| delivery | isar da kaya | nnyefe | ìfijíṣẹ́ | livraison | |
| settlement | biyan kuɗi | ikwụ ụgwọ | ìsanwó | règlement | **Financial precision.** This is the payment-partner settling funds, not "agreement". French `règlement` is correct; `accord` would be wrong. |

### Plural forms

Hausa, Igbo and Yoruba do not pluralise by suffix the way English does. Where
the English pack carries a `_plural` key, the packs use the natural plural
construction or repeat the singular where the language marks number by context
(`gonaki` for farms in Hausa; context-marked in Igbo and Yoruba).

---

## Decisions that required a judgement call

### "Financing" must never become "loan"

The single most important terminology decision in this record. Loamy is not a
lender; partner banks make financing decisions. The natural first-reach word in
all three Nigerian languages is the word for *loan* (`rance`, `mgbazinye ego`,
`awin`), and using it would make the interface state something legally untrue
about who is lending.

All four packs therefore use a *financing/support* construction and never the
loan word. `financing.notALender` is translated in full in every pack, with no
shortening.

### Murabaha is retained untranslated

Already retained in the repository's existing Hausa Copilot text. It is a named
Shariah-compliant structure, not a describable arrangement; translating it would
produce something that is not Murabaha. Retained in all four packs, with the
surrounding explanation translated.

### Escrow is described, not named

No reliable single-word equivalent exists in Hausa, Igbo or Yoruba. The
repository's existing Hausa already handles this by describing it ("the money
rests with the licensed payment partner, not Loamy"), and the packs follow that
model rather than coining a term. French uses `séquestre`, which is standard.

### BVN, NIN, and reference prefixes are identifiers

`BVN`, `NIN`, and the `TXN-`, `BATCH-`, `FEE-`, `FIN-`, `BNK-` prefixes are
identifiers, not words. Never translated, in any language.

### "Declared" versus "Verified"

The platform's trust model rests on this distinction: *declared* is what a
member stated, *verified* is what a Growth Partner checked on the ground. Every
pack must keep two visibly different words. Where a language's natural words for
the two are close, the packs choose a more distant pair deliberately, even at
some cost in brevity.

### Naira is never translated or converted

₦ and the amount are business facts. See `format.ts`: money renders on the
Nigerian convention in every locale. No pack contains a currency word.

### Co-pilot answers are not covered by this record

The assistant answers in English and Hausa only, from
`src/lib/copilot/i18n/registry.ts` and `copilot_concepts`. There is no configured
model provider that could produce reliable Igbo, Yoruba or French answers. The
Co-pilot *interface* is translated in all five languages; the *answers* are not,
and `copilot.answersInEnglish` tells the member so in their own language rather
than leaving them to discover it.

### Murabaha is a contract name, not a description

`Murabaha` is the name of the financing structure a partner bank actually
offers. Rendering it as "cost-plus sale" in another language describes the
product but stops *naming* it, and a member who then asks their bank about
"cost-plus" is asking about nothing. The explanatory parenthesis beside it
("cost-plus, non-interest") is wording and does translate; the name does not.

`tests/unit/financing-i18n.test.ts` asserts the name survives in every locale.

### Operational vocabulary mirrors the lib maps, word for word

Several vocabularies exist as TypeScript maps that other code reads, not only
as display strings:

| map | file |
| --- | --- |
| `FINANCING_STATUS_META` | `src/lib/financingLifecycle.ts` |
| `TASK_STATE`, `TASK_TYPE_LABEL`, flags, eligibility, commissions | `src/lib/fieldops.ts` |
| `TASK_STATUS_META` | `src/lib/partner.ts` |
| `ORDER_STATUS_META` | `src/lib/orders.ts` |
| `FULFILMENT_LABEL`, `LOGISTICS_EVENT_LABEL`, `LOADING_FLAG_LABEL`, `MOVEMENT_LABEL` | `src/lib/fulfilment.ts` |

The English pack mirrors each of these **exactly**, and parity is asserted by
`financing-i18n.test.ts` and `verification-i18n.test.ts`. The lib keeps the
colour, the ordering and the state machine; the pack keeps only the words. If
the two were allowed to drift, an English reader would see one word on a
surface that had been wired to i18n and a different word on one that had not.

Two maps describe the **same** task statuses with **different** words on
purpose - `pending` is "Not published" to a field agent and "Awaiting partner"
to the admin queue. They are translated under separate namespaces
(`verification.taskState.*` and `verification.partnerTaskState.*`) and a test
asserts they stay different, so merging them has to be a decision rather than
an accident.

### Sentences that do legal or safety work, and must survive whole

These are not ordinary copy. A translation that reads more naturally but loses
a clause is **wrong**, and a pack should leave the English standing instead:

- **Loamy is not the lender.** Every financing sentence attributes the decision
  and the money to the *partner bank*. "the bank decides", never "we decide";
  "the bank disburses", never "we disburse".
- **Loamy holds no funds.** Escrow is a licensed payment partner's. Neither
  "In escrow" nor "Funds released" may become "Loamy is holding your money".
- **A flag is not an accusation.** `verification.flagDisclaimer` exists to say
  a reviewer will look and that nothing is rejected automatically. "Device
  clock was ahead" must not become a claim of tampering.
- **Loading-evidence gaps are never softened.** The lib's own comment says so.
  "No quantity was confirmed at loading." does not become "quantity pending".
- **Storage is opt-in.** "Most purchases go straight to the buyer. Ask a
  warehouse for space only if you need it." is the reason nobody books storage
  they did not want. "Ask for space" and "Send request" must not become "Book".
- **Payout is not identity.** The card that collects a bank account says Loamy
  stores no BVN and no NIN. That sentence is why it may ask at all.

### What is deliberately NOT translated, and why

- **Hausa**: status words, column headings and short labels are translated;
  the long compliance paragraphs are not. See `packs/ha/operations.ts`, which
  names each gap. English a member can ask about beats confident-sounding
  Hausa that has moved the actor of the sentence.
- **Igbo and Yorùbá**: financing, verification and operational wording falls
  back to English entirely, as those packs already stated.
- **Server-generated text**: `activity.note` from `loamy_my_financial_activity`
  and the stored activity-feed entries written by `loamy_log_my_event` arrive
  in English and are rendered as given. The feed entry is written *to* the
  database and read by other people, so translating it at write time would
  make one event read differently depending on who created it. Localising
  these means returning a code rather than a sentence - a schema change.
- **Bank-officer evidence**: on the application detail a bank reads, the
  transaction ref, batch ref, commodity, GPS pair, risk tier and the officer's
  own pricing note are the record being decided on. A translated record is a
  different record.

### Coverage is reported, never rounded up (Phase 7)

| locale | keys | coverage | what the gap is |
| --- | --- | --- | --- |
| en | 1162 | canonical | - |
| fr | 1162 | 100% | none |
| ha | 794 | 68% | financing and verification prose |
| ig | 587 | 51% | operational prose, bank portal |
| yo | 587 | 51% | operational prose, bank portal |

`scripts/i18n-coverage.mjs` prints this. A key present in a pack counts;
English falling through does not. Two rules keep the number honest:

1. **English is never copied into another pack to raise a percentage.** A key
   that is absent falls back, and the fallback is visible in the count.
2. **`tests/components/i18n-languages.test.tsx` asserts ig and yo hold fewer
   keys than English.** If one ever reaches parity the test fails, so claiming
   completeness has to be a deliberate act rather than a drift.

### What the Nigerian-language packs deliberately leave in English

The split is by TRANSLATABILITY, not by effort:

- **Translated**: the operational vocabulary - statuses, column headings,
  buttons, navigation, short labels. These are words with settled equivalents
  and they are most of what a member actually reads.
- **Left in English**: the compliance prose. The sentences that say Loamy does
  not lend, does not hold funds, that a flag is not an accusation, and that
  storage is opt-in each carry clauses whose loss changes what the product
  promises. Guessing at one in a language without a reviewer is worse than
  English a member can ask someone about.
- **Left in English**: `financing.bank.*`. That portal is used by partner-bank
  staff whose working languages are English and French, and French is complete.

`src/lib/i18n/packs/{ig,yo}/operations.ts` and `packs/ha/operations.ts` each
state this at the top of the file, beside the keys it applies to.

### Terminology set in Phase 7

- **financing**: `nkwado ego` (ig, "financial support"), `ìnáwó` (yo),
  `tallafin kuɗi` (ha). None of these is the word for a loan, because Loamy
  does not lend. `agbazinye ego` (ig) and `yá owó` (yo) ARE the lending words
  and appear only in the sentence that says Loamy does not do it.
- **escrow**: Hausa `a hannun amintaccen ɓangare na uku` - held by a trusted
  third party. Never "held by Loamy".
- **batch**: retained as `batch` in ig and yo, matching the `BATCH-` reference
  the glossary already keeps untranslated. French uses `Lot (batch)`.
- **Growth Partner**: `Onye Mmekọ Uto` (ig), `Alábàáṣiṣẹ́ Ìdàgbàsókè` (yo).

### Terminology set in Wave A.3 (Processor)

The procurement pipeline needed words the packs did not have. Each of these is a
CHOICE, not an established term, and each is listed again below as something a
reviewer should challenge.

- **escrow**: `amana` (ha, already in use for `transaction.orderStatus.in_escrow`),
  `nchekwa ego` (ig), `ìpamọ́ owó` (yo), `séquestre` (fr). None of
  them names Loamy as the holder, and the help text beside each names the
  payment partner instead.
- **bid / offer**: `tayi` (ha, already in use for `logistics.offer`),
  `onyinye` (ig), `àbá` (yo), `offre` (fr). The word has to mean a PROPOSED
  PRICE: not a gift, and not an order that has been placed.
- **award**, the act of granting a bid: `amincewa` (ha, accepting),
  `ikenye` (ig, allotting), `ìfúnni` (yo, giving), `attribution` (fr). This is
  the step that creates a contract, so it must not read as merely approving
  something.
- **buy request**: `buƙatar siye` (ha), `arịrịọ ọzụzụ` (ig),
  `ìbéèrè ìrajà` (yo), `demande d'achat` (fr). `rfqs` stays the route slug and
  the database's word in all five languages; only the interface says "buy
  request".
- **Nigerian state**: `jiha` (ha), `steeti` (ig), `ìpínlẹ̀` (yo), `État` (fr).

The payment-partner custody claim is asserted PER LANGUAGE in
`tests/components/processor-i18n.test.tsx`, which fails if any language's
`processor.escrow.heldByPartner` or `processor.escrowStatus.funded` contains the
word "Loamy". The same file asserts that no two load-bearing states (escrow
funded vs released, closed vs cancelled, accepted vs disputed) render as the
same string in any language, because that collapse is invisible in review and
reads to a supplier as having been paid.

### Terminology set in Wave A.4 (Bank portal)

The bank portal needed a lending vocabulary the packs did not have. This is the
least certain terminology in the project: it is financial, it is read by
professionals who have their own words for these things, and a plausible-sounding
wrong term here is worse than in any other namespace. Everything below is a
CHOICE, and the ones marked *new* are listed again under the reviewer's list.

| Concept | Hausa | Igbo | Yoruba | French |
| --- | --- | --- | --- | --- |
| bank's loan book | `rance` | `agbazinye ego` | `owó yíyá` | `prêts` |
| facility | `asusun rance` *(new)* | `akaụntụ ego` *(new)* | `àkáǹtì owó` *(new)* | `facilité` |
| principal | `jarin asali` *(new)* | `isi ego` *(new)* | `owó orí` *(new)* | `principal` |
| outstanding | `saura` | `ego fọdụrụ` | `ó ṣẹ́kù` | `encours` |
| disbursement | `fitar da kuɗi` | `inyefe ego` | `ìfisanwó` | `versement` |
| repayment | `biyan baya` | `ịkwụghachi` | `ìsanpadà` | `remboursement` |
| instalment | `kashi` | `akụkụ ụgwọ` | `ìdá ìsanwó` | `échéance` |
| collateral | `jingina` | `ihe nkwado` *(new)* | `ohun ìdáhùn` *(new)* | `garantie` |
| tenor | `tsawon lokaci` *(new)* | `ogologo oge` *(new)* | `gígùn àkókò` *(new)* | `durée` |
| risk | `kasada` *(new)* | `ize ndụ` | `ewu` | `risque` |
| settlement | `sasantawa` *(new)* | `ịkwụ ụgwọ` | `ìparí ìsanwó` | `règlement` |
| applicant | `mai neman` | `onye na-arịọ` | `olùbéèrè` | `demandeur` |
| borrower | `mai karɓar rance` | `onye gbaziri ego` | `ẹni tí ó yá owó` | `emprunteur` |

`PAR 30+` is retained untranslated in all five languages: it is an industry
acronym (portfolio at risk), and a bank officer looking for it on a dashboard is
looking for those characters.

#### The lending word is correct in the bank portal, and only there

`rance` (ha), `agbazinye ego` (ig) and `yá owó` (yo) are the words for LENDING.
Elsewhere in the packs they appear only inside the sentence that says Loamy does
not lend, and the per-language disclaimer test matches on exactly those words.

In the bank portal they are correct, because the BANK is the lender. The thing
that differs is who lends, not the word. Each pack's header says so, so that
nobody reading `nav.loans: 'Rance'` concludes the disclaimer has been
contradicted.

#### What was NOT translated, on purpose

`risk.factors[].label` and `.detail` are composed by the server and, in a stored
credit report, are HISTORICAL text. They are rendered as written. Localizing
them needs the server to emit a code and parameters instead of a sentence, which
is an API change and is recorded in `docs/bank-localization-report.md` rather
than attempted.

### The lender claim is checked per language, not per pattern

`tests/components/i18n-journey.test.tsx` and the public-footer test assert that
any TRANSLATED disclaimer still says Loamy does not lend. That check matches on
each language's own word (`prêteur`, `rance`, `agbazinye`, `yá owó`). The first
version matched only English and French and read a correct Igbo disclaimer as a
dropped clause, so a language absent from that pattern is a language whose
disclaimer nobody is checking.

---

## Terms a reviewer should challenge first

**This list is the review queue, in priority order.** Everything on it is
*provisional*: chosen during a wave, internally consistent, and uncorroborated.
A reviewer working this list should expect to change things, and a developer
reading it should not pre-empt them.

Each entry names the languages it applies to. Where a language is absent from
an entry, that language's term is established and is not in question.

These are the entries where a native reviewer is most likely to improve on this
pass, listed so review effort goes where it is worth most:

1. **batch** (ig, yo) - may be better retained as "batch".
2. **traceability** (ig, yo) - abstract; current choices are plausible, not established.
3. **settlement** (all three) - financial precision matters more than naturalness here.
4. **processor** (ig, yo) - risk of reading as a machine rather than a business.
5. **Growth Partner** (ig, yo) - a product role; a coined phrase may read oddly.
6. **financing** (all three) - correct avoidance of the loan word, but the chosen phrasing may be stiff.
7. **award** (ig `ikenye`, yo `ìfúnni`) - these are "allot" and "give"; a
   procurement reviewer may have a stronger commercial term for granting a bid.
8. **bid** (ig `onyinye`, yo `àbá`) - `onyinye` can read as "gift" and `àbá`
   as "suggestion". Both are weaker than the English "bid".
9. **escrow** (ig `nchekwa ego`, yo `ìpamọ́ owó`) - literally "money
   safekeeping". Correct in substance, but may not be the term a Nigerian
   finance officer would reach for.
10. **grade** (yo `ipò ọjà`) - reuses `ipò`, which also renders *status*
    elsewhere on the same screen, so a bid row shows `ipò` twice meaning two
    different things.
11. **facility** (all three) - rendered as a "loan account"
    (`asusun rance`, `akaụntụ ego`, `àkáǹtì owó`). A facility is not an account,
    and a banker may have a precise term. This is the single most-used noun in
    the portal.
12. **principal** (all three) - `jarin asali` is "original capital" and
    `isi ego` / `owó orí` are "head money". All three read sensibly; none is
    confirmed as the term a lender would use on a statement.
13. **tenor** (all three) - rendered as "length of time". Correct in
    substance, and probably longer than the word a practitioner would use.
14. **collateral** (ig, yo) - `ihe nkwado` and `ohun ìdáhùn` are coined.
    Hausa `jingina` is well attested and should be the model for what good looks
    like here.
15. **settlement vs repayment** (ig) - both land near `ịkwụ ụgwọ`. The pack
    keeps them apart (`ịkwụ ụgwọ` for settlement, `ịkwụghachi` for repayment) but
    a reviewer should confirm the distinction reads as sharply as it must: one is
    the bank paying a supplier, the other is a borrower paying the bank.
16. **risk** (ig `ize ndụ`) - the ordinary sense is *danger to life*. In a
    credit context that may be too strong, or may be exactly right; a reviewer
    with banking Igbo should decide.
17. **Hausa plural agreement after a numeral** - three counted strings render
    the SAME words for one and for many:
    `processor.analytics.supplierRow`, `processor.awardLogistics.offersReceived`
    and `processor.bid.completedTransactions`. CLDR gives Hausa `one` and
    `other`, so the engine asks for two forms; but a Hausa noun following a
    numeral commonly does not inflect, because the numeral already carries the
    number. Both readings are defensible, and a speaker should settle it.
    `tests/unit/plural-keys.test.ts` deliberately does NOT assert either way:
    it checks English and French only, and records why in a comment. A guard
    that enforces a guess about grammar is worse than no guard.
