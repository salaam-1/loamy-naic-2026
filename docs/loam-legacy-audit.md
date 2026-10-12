# Legacy Co-pilot: capability audit

Loam is the only user-facing assistant in staging. The Co-pilot is **not
deleted** — it keeps its flag, its engine and its behaviour, and much of what it
contains is work worth keeping. This records what is in it, what Loam should
inherit, and what should not follow.

Nothing here has been migrated. The task that produced this document was asked
to establish the boundary, not to perform the refactor.

---

## Verdict key

- **Keep** — already reused by Loam, or usable as-is.
- **Migrate** — deterministic and evidence-producing; needs an `EvidenceItem`
  wrapper and a test, nothing more.
- **Rebuild** — the capability is worth having; the implementation assumes the
  keyword router and should not be carried across.
- **Legacy** — correct for the Co-pilot, not for Loam. Stays where it is.

---

## A. Retrieval and analysis

| Capability | File / function | Verdict | Why | Loam destination |
| --- | --- | --- | --- | --- |
| Seasonal price context | `copilot/retrieval.ts` · `retrievePriceContext` | **Keep** | Already used. Wraps `loamy_copilot_price_context`, whose index measures each month against its own year's average so naira devaluation does not distort it. Returns rows. | `loam/evidence.ts` · `priceEvidence` |
| Language + entity extraction | `copilot/language.ts` · `detectLanguage`, `extractCommodity`, `extractState` | **Keep** | Data, not conversation. Knows masara = Maize. | `loam/classify.ts` |
| Month naming | `copilot/analysis.ts` · `monthName`, `MONTH_NAMES` | **Keep** | Pure. | `loam/evidence.ts` |
| Cross-market comparison | `copilot/retrieval.ts` · `retrieveCrossMarket` | **Migrate** | Cheapest-market-first over validated prices. Already client-parameterised. Answers "where is it cheapest?", which Loam cannot. | new `marketComparisonEvidence` |
| Event-annotated history | `copilot/retrieval.ts` · `retrieveActiveEvents`, `retrieveEventsInRange`, `retrieveRecentPrices` | **Migrate** | Dated, hand-verified events explaining price moves. Answers "why did the price change?". | new `priceEventEvidence` |
| Seasonal pattern | `copilot/analysis.ts` · `seasonalPattern`, `monthlyAverages` | **Migrate** | Devaluation-proof seasonal index. Observed pattern, never a forecast. | extend `priceEvidence` |
| Monthly series | `copilot/analysis.ts` · `monthlySeries` | **Migrate** | Chart-shaped series. Needs a UI decision before it is useful in chat. | deferred |
| Recent direction | `copilot/analysis.ts` · `recentDirection` | **Migrate** | "Up or down lately", from rows. | extend `priceEvidence` |
| Date coverage | `copilot/analysis.ts` · `dateCoverage` | **Migrate** | States what the data actually spans — exactly the honesty Loam needs when a figure is thin. | evidence metadata |
| Latest record helpers | `copilot/analysis.ts` · `latestRecord`, `latestRecordsOnMaxDate`, `distinctSources`, `distinctBatchIds` | **Migrate** | Small pure helpers used by the above. | with their callers |
| Concept explanations | `copilot/retrieval.ts` · `retrieveConcept` + `copilot_concepts` (4 rows staging) | **Migrate** | Admin-authored and already reviewed — a *better* Level 2 source than the unreviewed knowledge pack. | `loam/evidence.ts` as L2 |
| Admin Q&A overrides | `copilot/retrieval.ts` · `findOverride` + `copilot_qa_overrides` (0 rows staging) | **Rebuild** | Currently short-circuits the engine entirely. As Loam evidence the precedence question — does an override outrank retrieval? — has to be answered first. | undecided |
| Local unit conversion | `lib/ambassador.ts` · `fetchUnits`, `perUnitLabel` + `commodity_units` | **Migrate** | mudu, tiya, bag. Exactly what N-ATLaS must not guess. | anchor/unit evidence |
| Validated ambassador prices | `lib/ambassador.ts` · `fetchValidatedFor` → `loamy_validated_prices` | **Migrate** | 0 rows on staging today, but the pipeline is real. | `loam/evidence.ts` |
| Market price updates | `lib/prices.ts` → `loamy_public_price_updates` | **Keep** | Already migrated. The only price source with rows. | `loam/evidence.ts` · `marketPriceEvidence` |

## B. Data management

| Capability | File / function | Verdict | Why |
| --- | --- | --- | --- |
| CSV validation and upload | `copilot/upload.ts` · `parseCsv`, `validateUpload`, `commitUpload`, `isLivestock` | **Keep (legacy owns it)** | Admin tooling, not conversational. Feeds `market_prices_history`. The livestock guard is a product rule worth preserving. No Loam involvement needed. |
| Conversation persistence | `copilot/conversations.ts` · `createConversation`, `loadMessages`, `logFlaggedQuestion` | **Legacy** | Loam has its own (`loam/conversations.ts`) precisely so its module graph does not reach the engine. |

## C. The conversational brain — do not migrate

| Capability | File / function | Verdict | Why |
| --- | --- | --- | --- |
| Keyword intent router | `copilot/engine.ts` · `parseIntent` | **Legacy** | Substring matching over 11 intents. Any commodity name routes to the price flow, which is why "when should I plant maize in Kaduna?" returns a price. Replaced by evidence-gated classification. |
| Answer generator | `copilot/engine.ts` · `answer`, `answerPriceCheck`, `answerCompare`, `answerConvert`, `answerConcept`, `answerNavigation`, `answerMarketUpdate`, `explainReasoning` | **Legacy** | Writes its own prose from templates. Loam's prose comes from N-ATLaS over retrieved evidence. |
| Draft / slot flow | `copilot/engine.ts` · `draftResult`, `extractTradeSlots` + "Confirm & continue" | **Rebuild** | The *capability* (draft a listing from a sentence) is genuinely useful and Loam currently declines it. The implementation is slot-filling off the keyword router. Rebuild as a Loam capability with confirmation, do not port. |
| Logistics request flow | `copilot/engine.ts` · `draftResult('logistics')` | **Rebuild** | Same shape, same reasoning. |
| Clarify / not-yet-built | `copilot/engine.ts` · `oneClarify`, `notYetBuilt`, `UNBUILT` | **Discard** | Loam's refusals are evidence-aware and say *why*. A generic "I'm not sure what you mean" is strictly worse. |
| Fixed-phrase bank | `copilot/i18n/registry.ts`, `copilot/language.ts` · `phrase*` | **Discard** | Canned answers keyed to intents. Loam's deterministic sentences live in `loam/phrases.ts` and are tied to evidence state. |
| Voice clip playback | `copilot/i18n/voice.ts` | **Legacy** | Pre-recorded clips keyed to fixed phrases Loam does not produce. |
| Speech-to-text seam | `copilot/stt/adapter.ts` | **Legacy** | `NullSttAdapter`, no provider, button has no `onClick`. Inert. |
| LLM phrasing seam | `copilot/llm/adapter.ts` | **Discard** | Dead code: both implementations return the input unchanged. Superseded by `loam/model/adapter.ts`. |

---

## Migrated in this pass

Two capabilities moved, chosen because they have real data on staging and can
therefore be *verified* rather than assumed:

- **Concept explanations** — "What is Murabaha?" and "Is my money safe with
  escrow?" now return the team's own reviewed text as Level 2 evidence, phrased
  by N-ATLaS. Verified live.
- **Local units** — "How many kg in a bag of maize?" answers from the recorded
  equivalent. Verified live.

Deliberately NOT migrated, because the tables are empty on staging and a reader
nobody can exercise is a reader nobody can trust: `retrieveCrossMarket`
(`loamy_validated_prices`, 0 rows), the event-annotated history
(`market_events`, 0 rows), and the seasonal/direction/coverage analysis
(`market_prices_history`, 0 rows).

## What Loam lost, and has not regained

The draft-a-listing and logistics-request flows are gone from the user
experience. "I want to sell 20 bags of maize" now declines. That is the right
behaviour given the alternative — handing the question to the keyword router —
but it is a real capability regression, and the first thing worth rebuilding as
a Loam capability with explicit confirmation.

## Boundary status

Loam's import closure is walked from `orchestrator.ts`, `transport.ts` and
`conversations.ts` in `tests/unit/loam-boundaries.test.ts`. It must not contain
`copilot/engine.ts`, `copilot/conversations.ts`, `copilot/i18n/voice.ts`,
`copilot/stt/adapter.ts` or `copilot/llm/adapter.ts`.

A direct-import check was not enough, and the transitive walk proved it: Loam's
persistence helpers were living in `copilot/conversations.ts`, which imports
`answer` from the engine at module level. No Loam file named the engine, and the
engine was in Loam's graph regardless. Those helpers now live in
`src/lib/loam/conversations.ts`.

### Residual coupling, recorded rather than hidden

`copilot/language.ts` is allowlisted for its entity extractors, and it imports
`getDialect` from `copilot/i18n/registry.ts` — so the fixed-phrase answer bank is
reachable from Loam's graph. Loam never calls into it, and a test asserts that no
Loam file references `getDialect`, `phraseFixed`, `phraseNoData`,
`phrasePriceCheck`, `phraseClarifyCommodity` or `FIXED_PHRASE_KEYS`.

Splitting `language.ts` into extractors and phrasing would remove the coupling
entirely. That is a refactor, and the boundary task was explicitly told not to
perform one on the strength of this audit.
