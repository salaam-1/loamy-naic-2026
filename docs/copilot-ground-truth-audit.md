# Loamy Copilot — ground-truth architecture audit

**Date:** 2026-09-22 · **Scope:** read-only. No file, migration, prompt,
deployment, package, environment variable or production record was modified.
All live reads were `SELECT`-only against the linked Supabase project
`lsuqbjwlybzhyuvzgtdj`.

**On secrets:** three configuration keys for AI providers exist as names only —
`VITE_COPILOT_LLM_API_KEY`, `VITE_COPILOT_LLM_MODEL`, `VITE_COPILOT_STT_API_KEY`
(`src/lib/copilot/config.ts`). **None is set** in `.env`. No value is printed
anywhere in this report.

---

## 1. Executive summary

**The Loamy Copilot contains no language model. There is no model call in the
answer path at all.**

This is the single most important fact in this audit, and it reframes every
other question. `src/lib/copilot/engine.ts` is a deterministic keyword-matching
router: `parseIntent()` matches substrings against hard-coded English and Hausa
phrase lists, dispatches to one of nine handlers, and each handler formats a
sentence from SQL rows using string templates. `answer()` returns before any
provider is consulted, because no provider is ever consulted.

The LLM seam (`src/lib/copilot/llm/adapter.ts`) exists and is deliberately
narrow: its only permitted job is to *rephrase* text already built from rows.
The default `templatePhraser` returns the deterministic text unchanged.
**Nothing calls `phrase()` anywhere in `src/`** — even that seam is unwired.

So "the Copilot feels dumb" is not a model-quality problem, a prompt problem,
or a context-window problem. **There is no prompt.** Swapping in Claude would
change nothing on its own, because there is no code path for a model to run in.

Three further findings that matter as much:

1. **The Copilot cannot see any Loamy business data.** Not the user's profile,
   farm, crop, listing, transaction, financing application, verification,
   logistics or traceability. It reads six market/content tables and nothing
   else. Every platform capability built in this codebase is invisible to it.
2. **The "22-year dataset" is really three disjoint series**, and the one that
   spans ~22 years is the *stale* one. Details in §5.
3. **58% of recorded answers were failures.** Of 55 assistant messages,
   32 have `was_answered = false` (live count, `copilot_messages`).

What is genuinely good: provenance is tracked per answer, retrieval is pinned
to active upload batches so a bad import can be rolled back instantly, price
types are never mixed, RLS on conversations is correctly ownership-derived, and
the system refuses to guess. That discipline is worth keeping.

---

## 2. Current Loamy architecture

| Layer | Technology | Evidence |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite, React Router 7, Tailwind | `package.json` |
| Backend | **None of its own.** Supabase Postgres accessed directly from the browser | `src/lib/supabase.ts` |
| Business logic | ~281 Postgres functions, `security definer`, `set search_path = public` | `supabase/migrations/` |
| Database | Supabase Postgres 17 | `supabase migration list --linked` |
| AuthN | Supabase Auth (email/password) | `src/context/AuthContext.tsx` |
| AuthZ | Row Level Security + `security definer` RPCs | every migration |
| API | PostgREST (tables/views) + RPC. No REST/GraphQL service | — |
| Background jobs | None. A few scheduled DB functions | reachability report class E |
| Edge functions | 8 Deno functions (Paystack, escrow) | `supabase/functions/` |
| Storage | Supabase Storage (evidence photos, listing images) | `src/lib/evidenceUpload.ts` |
| Analytics | `audit_events` table. No product analytics SDK | — |
| AI | **None wired** | §3 |
| Deployment | Vite static build; Supabase hosted | `vite.config.ts` |
| Config | `VITE_*` env vars, browser-safe anon key only | `.env` |

```
Browser (React SPA)
   |
   |-- supabase-js ---> PostgREST  --> Postgres tables/views   (RLS enforced)
   |                 \-> RPC        --> ~281 security-definer functions
   |
   |-- functions.invoke --> 8 Deno edge functions --> Paystack
   |
   \-- fetch -----------> api.open-meteo.com (weather, keyless)

          NO application server.  NO AI provider.  NO queue.
```

**Architectural consequence for the Copilot:** with no backend tier, any real
model integration must go into an edge function or a new service. A browser-side
model call would put the API key in the client. `config.ts` already says this in
its own header, which is the right instinct.

---

## 3. Existing Copilot architecture

### Inventory

| # | Component | Path | Role |
|---|---|---|---|
| 1 | Frontend entry | `src/components/copilot/Copilot.tsx` (447 lines) | Floating chat panel; mounted in `AppShell.tsx:324`; gated on `flagEnabled('copilot')` (`Copilot.tsx:120`) |
| 2 | Backend entry | **none** | The browser calls `answer()` in-process |
| 3 | Engine | `src/lib/copilot/engine.ts` | Intent parse + 9 handlers. **The whole "AI"** |
| 4 | Retrieval | `src/lib/copilot/retrieval.ts` | 7 typed SQL reads |
| 5 | Analysis | `src/lib/copilot/analysis.ts` | Seasonality, monthly averages, direction |
| 6 | Language | `src/lib/copilot/language.ts` | EN/HA detection, commodity + state extraction |
| 7 | Persistence | `src/lib/copilot/conversations.ts` | Conversation + message writes |
| 8 | LLM seam | `src/lib/copilot/llm/adapter.ts` | Interface + `templatePhraser`. **No caller** |
| 9 | STT seam | `src/lib/copilot/stt/adapter.ts` | Interface only |
| 10 | Config | `src/lib/copilot/config.ts` | Provider keys (unset) |
| 11 | Voice clips | `src/lib/copilot/i18n/voice.ts` | Pre-recorded audio for *fixed* phrases only |
| 12 | Admin | `src/pages/admin/AdminCopilot.tsx` | Overrides, concepts, flagged questions |
| 13 | Chart | `src/components/copilot/CopilotPriceChart.tsx` | Seasonal shape |
| 14 | Upload | `src/lib/copilot/upload.ts` | Admin CSV ingest → `upload_batches` |

### Tables

| Table | Rows (live) | Purpose |
|---|---|---|
| `copilot_conversations` | 16 | Thread per user |
| `copilot_messages` | 110 | Turns + provenance (`data_sources`, `data_as_of`, `was_answered`) |
| `copilot_flagged_questions` | 34 | Unanswered questions for review |
| `copilot_qa_overrides` | **0** | Admin-authored canned answers |
| `copilot_concepts` | 4 | Concept explanations (EN/HA) |
| `market_prices_history` | 52,225 | The historical price series |
| `macro_context` | 1,287 | FX + food CPI, 1990→ |
| `market_events` | 10 | Macro shock annotations |
| `market_price_updates` | 241 | Ambassador-reported live prices |

### Request trace (exact)

```
User types in Copilot.tsx
  → answer(text, language, { lastCommodity })            engine.ts:402
      → findOverride()                                    retrieval.ts:139
      → parseIntent() — substring matching                engine.ts:57
      → one of: answerPriceCheck / answerConcept /
                answerConvert / answerCompare /
                answerNavigation / answerMarketUpdate /
                draftResult / notYetBuilt / oneClarify
      → each reads SQL and formats a STRING TEMPLATE
  → Copilot.tsx writes copilot_messages (user + assistant)
  → if !wasAnswered → copilot_flagged_questions
```

**There is no step where a model sees anything.**

> **Dead code worth knowing about:** `conversations.ts` exports `runTurn()`,
> which is the "proper" turn function — and **nothing calls it.**
> `Copilot.tsx` inlines its own `supabase.from('copilot_messages').insert(...)`
> at lines 129–134. Two implementations of the same thing, one unused.

---

## 4. What the Copilot can actually access

Traced from `retrieval.ts` and `engine.ts` imports. **Not inferred from the UI.**

| Category | Status | Evidence |
|---|---|---|
| Market prices (historical) | **HISTORICAL** | `loamy_copilot_prices` view |
| Market prices (ambassador) | **LIVE** | `fetchValidatedFor()` → `loamy_validated_prices` |
| Market events | **HISTORICAL** | `loamy_copilot_events`, 10 rows |
| Measurement units | **LIVE** | `fetchUnits()` |
| Concepts | **LIVE** | `copilot_concepts`, 4 rows |
| Admin overrides | **LIVE** | `copilot_qa_overrides`, 0 rows |
| FX / food CPI (`macro_context`) | **NOT AVAILABLE** | 1,287 rows loaded; **no retrieval function reads it** |
| User profile | **NOT AVAILABLE** | no import |
| Farmer profile / farm / plot | **NOT AVAILABLE** | no import |
| Crop, planting date, harvest, farm activities | **NOT AVAILABLE** | no import |
| Soil data | **NOT AVAILABLE** | no such table |
| Weather | **NOT AVAILABLE to the Copilot** | `weather_observations` (27 rows) exists and `WeatherPanel` uses it — the Copilot does not |
| Fuel prices | **NOT AVAILABLE** | no table; only 1 event row |
| Disease / outbreak | **NOT AVAILABLE** | no table |
| Marketplace listings / sellers / buyers | **NOT AVAILABLE** | no import |
| Transactions | **NOT AVAILABLE** | no import |
| Financing / applications / bank decisions | **NOT AVAILABLE** | no import |
| Verification | **NOT AVAILABLE** | no import |
| Logistics / warehouse | **NOT AVAILABLE** | no import |
| Traceability (`loamy_trace`) | **NOT AVAILABLE** | no import |
| Documents | **NOT AVAILABLE** | no import |
| Notifications / tasks | **NOT AVAILABLE** | no import |

**Six of twenty-three categories are reachable.** The Copilot is a commodity
price assistant that happens to live inside an agricultural operating system.

---

## 5. The "22-year dataset" — what is actually there

`market_prices_history`, **52,225 rows**, verified by paging (a single
`select` returns only 1,000 rows — PostgREST's cap — and would have given a
badly wrong profile).

### It is three disjoint series, not one

| price_type | Rows | Range | Span | Commodities | Source |
|---|---|---|---|---|---|
| `retail` | 30,435 | 2014-05 → **2026-05** | 12 yr | 11 | WFP |
| `wholesale` | 20,430 | 2002-01 → **2023-01** | 21 yr | 9 | WFP |
| `farmgate` | 1,360 | 1991-12 → 2025-12 | 34 yr | 13 | FAOSTAT, **annual, national only** |

**The ~22-year span belongs to `wholesale`, which stopped in January 2023 —
three and a half years stale.** The series the Copilot actually queries is
`retail` (`DEFAULT_PRICE_TYPE`, `retrieval.ts:23`), which begins in 2014.

The code is scrupulous about not mixing these (`retrieval.ts:16-19` explains
why pooling them produces nonsense), which is correct and commendable — but it
means "22 years of history" is not what any answer is built from.

### Coverage

- **18 commodities.** Top: Cowpea 8,499 · Sorghum 7,283 · Maize 5,180 ·
  Millet 5,108 · Rice 4,747 · Groundnut 4,413 · Yam 3,656.
- **15 states of 37.** Borno 14,807 + Yobe 13,052 = **53% of all rows.**
  This is WFP humanitarian monitoring data: dense in the north-east conflict
  zone, absent from most of the country. A farmer in Enugu, Rivers, Benue,
  Plateau or the FCT has **no local series at all**.
- Units: NGN per kg (`price_ngn_per_kg`), normalised. Good.
- Frequency: monthly (WFP), annual (FAOSTAT).
- Provenance: `source`, `quality_flag`, `upload_batch_id` — genuinely good.
- Lat/long columns exist and are **null for every row I sampled**.

### The other claimed variables

| Claim | Reality |
|---|---|
| Market information | Real: 52,225 rows |
| Fuel-price fluctuations | **Not present.** No fuel table. One `market_events` row: "Fuel subsidy removal", 2023-05-29 |
| Weather | **Not in the historical set.** `weather_observations` has **27 rows**, all forward forecasts fetched from Open-Meteo |
| Disease outbreaks | **Not present.** No table |
| "Other factors" | `macro_context`: FX + food CPI, 1,287 monthly rows from 1990. Real, and **never read by the Copilot** |

### Is the Copilot using it?

**Partly, and only the recent slice.** `retrievePriceContext()` calls
`loamy_copilot_price_context`, which computes a normal range from the **last 24
months** and a seasonal index. So of 52,225 rows spanning 34 years, answers draw
on roughly two years of `retail`.

There is a deliberate reason (`engine.ts:145-152`): a **>2.5× spread guard**
that refuses to present a devaluation-inflated range as normal. That is good
judgement. But combined with the 24-month window it means the long history's
practical contribution is the seasonal index alone.

**The difference that matters:** the dataset exists in the platform; it is
*barely* used in conversations; and the Copilot has **no access to the
correlating variables** (FX, fuel, weather, disease) that would make 34 years
of prices analytically interesting.

---

## 6. The prompt

**There is no prompt.** No system prompt, no developer prompt, no instruction
string, no template assembled for a model — because no model is called.

The nearest equivalents are hard-coded output templates, e.g.
`engine.ts:137-139`:

```ts
lines.push(language === 'ha'
  ? `${variety}${commodity} a ${where} yana ₦${lo}–₦${hi} kowace ${per} yau …`
  : `${variety}${commodity} in ${where} is ₦${lo}–₦${hi} per ${per} today …`)
```

Static: every sentence. Dynamic: interpolated numbers. Tools described: none.
Safety rules: enforced in *control flow*, not instructions — `wasAnswered`,
the range guard, "the decision is yours" (`engine.ts:198`), and
`COPILOT_DISCLAIMER`.

**Why it succeeds:** it cannot hallucinate. Every number traces to a row.
**Why it fails:** it cannot handle any phrasing its author did not anticipate,
cannot combine two facts, cannot reason, and cannot answer about the user.

---

## 7. Memory

| Kind | Present? | Detail |
|---|---|---|
| Conversation history (stored) | **Yes** | `copilot_messages`, ownership via parent conversation |
| Conversation history (used) | **NO** | Nothing reads prior turns back into `answer()` |
| Session memory | **One variable** | `lastCommodity` — a `useRef` in `Copilot.tsx:83`, lost on reload |
| Persistent user memory | **No** | — |
| Farm memory | **No** | — |
| Entity memory | **No** | — |
| Retrieval memory / embeddings | **No** | No vector store, no `pgvector` |
| Summaries | **No** | — |
| Profile-based context | **No** | `profile` is read for `id` and the flag only |
| User control | N/A | No delete/export for Copilot history |
| Cross-user leakage | **No** | RLS is correct; assessed §9 |

There is also a 7-day `localStorage` cache (`CACHE_KEY`, `Copilot.tsx:34`) for
offline display. It is display-only and never re-enters reasoning.

**So:** history is *recorded* but never *recalled*. The Copilot begins every
turn with no knowledge of the conversation except one commodity name held in
volatile memory.

---

## 8. Tools and executable actions

**No tool calling, no function calling.** Handler selection is an `if`/`else`
chain.

The only action-shaped capability is `draftResult()` (`engine.ts:355`) for
`rfq`, `buy_request` and `logistics`: it extracts slots with a regex
(`extractTradeSlots`, `engine.ts:79`) and returns `kind: 'draft'`. The UI
pre-fills a form; the human submits it.

| Action | Exists? | Confirmation | Permissions | Verified | Rollback |
|---|---|---|---|---|---|
| Draft a listing | Slot extraction only | Human submits the form | Form path | n/a | n/a |
| Draft a buy request | Same | Same | Form path | n/a | n/a |
| Draft a logistics request | Same | Same | Form path | n/a | n/a |
| Everything else | **No** | — | — | — | — |

The Copilot cannot create a task, update a farm, submit an application, cancel
a transaction, send a message, upload a document, change settings or initiate a
payment.

**This is a defensible v1 posture** — nothing can be done to a member's account
by a keyword match. It is also the ceiling on usefulness.

---

## 9. Authorization and privacy

**Assessment: sound, because the attack surface is tiny.**

- Identity: Supabase session; `profile.id` from `AuthContext`.
- Enforcement: **database RLS**, not prompt instructions. Correct layer.
- `copilot_conversations`: `user_id = auth.uid() or loamy_is_admin()`.
- `copilot_messages`: ownership proven **through the parent conversation** —
  never trusted from the client. This is the right pattern.
- `copilot_flagged_questions`: insert own, select/update admin.
- Retrieval views use `security_invoker = true`, so the caller's RLS still
  applies; the view only *adds* the active-batch filter.
- Growth Partner anonymity: **not at risk** — the Copilot cannot reach
  verification data at all.
- Cross-user access: **not possible.** The Copilot reads only market/content
  tables plus the caller's own thread.

### The risk that arrives with capability

Every current guarantee follows from the Copilot having no tools and no user
data. **Adding either inverts the security model.** The moment a tool can read
a farm or a financing application, the tool must carry the caller's identity
and be constrained by RLS — and a model must never be handed rows it can then
disclose to the wrong person.

Two specific hazards to design against before any migration:

1. **Service-role tools.** If tools run with `service_role` they bypass RLS
   entirely. This codebase already learned that lesson in the money layer: four
   edge functions wrote a deprecated table for months precisely because
   service_role ignores RLS.
2. **Prompt-injection via stored content.** Listing descriptions, notes and
   flagged questions are member-authored. If retrieved into a prompt, they are
   untrusted input.

---

## 10. Events and analytics

| Signal | Where | Suitable for a learning loop? |
|---|---|---|
| Conversation turns | `copilot_messages` | Yes — role, content, provenance, `was_answered` |
| Failed answers | `copilot_flagged_questions` (34) | **Yes — the highest-value signal present** |
| Explicit "not helpful" | `Copilot.tsx:198` → flagged | Yes |
| Answer provenance | `data_sources`, `data_as_of` | Yes |
| Platform audit trail | `audit_events` | Partly — operational, not behavioural |
| Marketplace / financing / transaction events | `transaction_events`, `financing_events`, `batch_events`, `shipment_events` | **Yes, and entirely untapped** |
| Tool calls | — | None exist |
| Searches, feature usage, abandonment | **Not tracked** | No product analytics |
| Thumbs up/down | Down only | Partial |

**The raw material for a learning loop exists and is unused.** There is no
pipeline, no evaluation, no aggregation.

**A caution the brief rightly flags:** `copilot_messages` and
`copilot_flagged_questions` contain member-authored text under an RLS model
that promises per-user privacy. Using them as training or knowledge input is a
*consent and purpose-limitation* question, not a technical one. Nothing in the
current privacy policy that I read anticipates it.

---

## 11. Model and provider

| Aspect | Reality |
|---|---|
| Provider | **None** |
| Model | **None** |
| API | n/a |
| Temperature / max tokens | n/a |
| Context strategy | n/a |
| Token usage / cost | **Zero** |
| Latency | One or two Supabase round trips |
| Retries / fallback | n/a |
| Caching | 7-day `localStorage`, display only |
| Streaming | No |

**Would changing the model materially improve the Copilot?** No — there is
nothing to change. A model would have to be *introduced*, and on its own it
would produce a fluent assistant that still cannot see a farm, a transaction or
a financing application. **Context and tools are the binding constraint; the
model is a prerequisite, not the fix.**

---

## 12. Why it feels limited — ranked by impact

1. **No model.** Every question outside the keyword lists falls to
   `oneClarify()` or `notYetBuilt()`. Evidence: 32 of 55 answers unanswered.
2. **No access to the user or their business.** The one thing an agricultural
   OS assistant should know — *your* farm, *your* sale, *your* application — is
   exactly what it cannot see.
3. **No tools.** Cannot act, cannot chain, cannot look something up mid-answer.
4. **No memory in the loop.** History stored, never recalled.
5. **Retrieval is narrow and keyword-driven.** No embeddings; `retrieveConcept`
   is a substring scan over 4 rows.
6. **Sparse and skewed data.** 15 states, 53% Borno/Yobe, 4 concepts, 0
   overrides. Most users have no local series.
7. **Honest refusals are frequent and terminal.** Correct, but with no
   follow-up path the member simply leaves.
8. **No evaluation.** No regression set, no quality metric.
9. **Two competing turn implementations** (`runTurn` unused) — minor, but a
   sign the module drifted.

**Not causes**, despite plausibility: hallucination (impossible), wrong model
(none), context window (no context), poor error handling (handling is good).

---

## 13. LiyaEngine migration mapping

| Loamy capability | Intent | Input | Output | Knowledge | Tools | Difficulty |
|---|---|---|---|---|---|---|
| Price check | `market.price_check` | commodity, state | price + range + seasonality | `market_prices_history` | `get_price_context` | **Easy** — logic exists |
| Cross-market compare | `market.compare` | commodity, state | ranked markets | `loamy_validated_prices` | `compare_markets` | **Easy** |
| Unit conversion | `market.convert` | units, amount | converted | `measurement_units` | `convert_unit` | **Easy** |
| Concept explain | `platform.explain` | topic | explanation | `copilot_concepts` | retrieval | **Easy** |
| Market update | `market.digest` | — | movers + events | prices + events | `recent_movements` | **Easy** |
| Navigation | `platform.navigate` | goal | deep link | route map | — | **Easy** |
| **Farm context** | `farm.summary` | user | farms, crops, verification | `farms`, `crop_records` | `get_my_farms` | **Moderate** — RLS-scoped tool |
| **Financing status** | `finance.status` | user | application + decision | `financing_applications` | `get_my_financing` | **Moderate** |
| **Transaction status** | `trade.status` | user, ref | full fulfilment state | `loamy_transaction_fulfilment` | `get_my_purchase` | **Moderate** — RPC exists |
| **Traceability** | `trace.explain` | business ref | provenance chain | `loamy_trace` | `trace_ref` | **Moderate** — RPC exists |
| **Weather** | `agro.weather` | farm | forecast | Open-Meteo via provider seam | `get_forecast` | **Moderate** |
| Draft listing / buy request | `trade.draft_*` | slots | draft | — | `create_draft` | **Moderate** |
| **Executable actions** | various | — | — | — | write tools | **Hard** — confirmation, idempotency, rollback |
| **Semantic retrieval** | — | — | — | embeddings | vector search | **Hard** — no pgvector |
| **Agronomic advice** | `agro.advise` | crop, stage | guidance | **does not exist** | — | **Hard** — no knowledge base |
| Correlation / prediction | `market.forecast` | — | — | needs fuel + weather + disease | — | **Hard** — data absent |
| Cost / latency at scale | — | — | — | — | — | **Unknown** |
| LiyaEngine auth model | — | — | — | — | — | **Unknown — not in this repo** |

**The critical architectural requirement:** Loamy has no backend tier. Every
moderate/hard item needs one (edge function or service) so that (a) the API key
stays server-side and (b) tools execute **as the calling user** so RLS still
applies.

---

## 14. The Loam Learning Loop

| Layer | Supported today? | What is needed |
|---|---|---|
| **Contextual memory** | No | A memory store + retrieval; RLS-scoped per user |
| **Product learning** | **Raw signal yes, pipeline no** | Aggregate `copilot_flagged_questions` + `was_answered` into a ranked gap list. **Cheapest real win available** |
| **Knowledge learning** | Manual only | `copilot_concepts` (4) and `copilot_qa_overrides` (0) are admin-authored. A curation workflow would work today |
| **Model training** | No | Not advisable, and not necessary |

**The honest version:** items 1 and 2 are achievable with the data already
being written. Item 3 needs editorial process, not engineering. Item 4 should
not be attempted.

---

## 15. Can Claude "learn"?

**Claude does not learn from your users automatically. Nothing you deploy will
make it do so.** Anyone who says otherwise is describing something else.

Precisely:

| Mechanism | What it is | Persists? |
|---|---|---|
| **In-context** | Facts in the prompt shape one response | **No** — gone next request |
| **Tools** | Model calls your function, you return rows | **No** |
| **Retrieval (RAG)** | You fetch and inject documents | **No** — the *store* persists |
| **Stored memory** | You write facts down and re-inject them | **Yes — because YOU stored it** |
| **Analytics over logs** | You mine transcripts for patterns | **Yes — as human/pipeline output** |
| **Prompt updates** | You change instructions | **Yes — a deployment** |
| **Fine-tuning** | Weights actually change | **Yes — and not offered here** |

The distinction the brief asks for:

- **Learning from context** — per-request, ephemeral.
- **Learning from memory** — your database, retrieved deliberately. This is
  what "Loam remembers my farm" must mean.
- **Learning from analytics** — offline, produces *changes you ship*.
- **Retrieval updates** — new documents, no model change.
- **Prompt updates** — versioned, evaluated, deployed.
- **Fine-tuning** — genuine weight change. Requires a curated dataset, an
  evaluation harness and a provider that supports it. **Almost certainly the
  wrong tool for Loamy**, and unnecessary: retrieval plus memory plus tools
  gets you nearly all of it, reversibly.

**Infrastructure for permanent "learning":** a memory store, an evaluation
harness with a frozen regression set, a curation workflow, and prompt
versioning. All four are missing.

---

## 16. Current-state scorecard

| Capability | Current state | Evidence | Main limitation | Needed for Loam |
|---|---|---|---|---|
| Context awareness | **Absent** | No profile/farm read | Knows nothing about the user | RLS-scoped context tools |
| Live data access | **Partial** | Ambassador prices only | One live source | Tool layer |
| Agricultural grounding | **Absent** | No agronomy content | Cannot answer a farming question | Knowledge base |
| Market intelligence | **Real but narrow** | 52,225 rows, 24-mo window | 15 states, 53% NE | Wider coverage |
| Weather | **Absent from Copilot** | `WeatherPanel` only | Not reachable | Tool |
| Marketplace | **Absent** | No listing access | — | Tool |
| Financing | **Absent** | Named as unbuilt, `engine.ts:365` | — | Tool |
| Transactions | **Absent** | No access | — | `loamy_transaction_fulfilment` as a tool |
| Traceability | **Absent** | `loamy_trace` unused | — | Tool |
| Verification | **Absent** | No access | — | Tool + GP anonymity guard |
| Navigation | **Basic** | 4 hard-coded routes | Doesn't know 47 sections | Route map |
| Documents | **Absent** | — | — | Parsing + storage access |
| Memory | **Stored, not used** | `copilot_messages` never re-read | No recall | Memory retrieval |
| Tool use | **Absent** | if/else chain | — | Tool runtime |
| Authorization | **Good** | RLS, invoker views | Untested at scale | Per-user tool identity |
| Privacy | **Good** | Ownership via parent | Consent for AI reuse unclear | Policy + controls |
| Observability | **Partial** | Provenance per answer | No metrics/traces | Telemetry |
| Feedback | **Partial** | Negative only | No positive signal | Both + pipeline |
| Learning loop | **Absent** | No pipeline | — | §14 |
| Evaluation | **Absent** | No tests for `answer()` | Cannot detect regression | Regression set |
| Voice readiness | **Partial** | Clips for *fixed* phrases only | Dynamic answers silent | TTS + STT |

---

## 17. Target architecture

```
EXISTS ──  Loamy SPA
           │
NEW    ──  Loam experience layer (chat, voice, deep links)
           │
NEW    ──  Loam intelligence contract   (intent, input/output schema)
           │
NEW    ──  Backend tier  ← REQUIRED: no server exists today
           │   · holds the provider key
           │   · executes tools AS THE CALLING USER (RLS preserved)
           │
NEW    ──  LiyaEngine   → tools · retrieval · memory · guardrails · routing
           │
NEW    ──  Model provider

EXISTS ──  Postgres + 281 security-definer RPCs + RLS      ← reuse wholesale
EXISTS ──  market_prices_history · macro_context · market_events
EXISTS ──  copilot_messages · copilot_flagged_questions    ← the evidence layer
NEW    ──  evaluation / analytics
NEW    ──  validated learning → knowledge / prompt / tool updates
```

**Already exists:** the data model, the authorization model, the RPC surface,
the provenance discipline, the batch-rollback mechanism, the provider-seam
pattern (`src/lib/providers/`).

**Proposed:** everything between the SPA and the database.

---

## 18. Risks

1. **Security model inverts on day one of tools.** Today's guarantees come from
   powerlessness. Tools must run as the caller.
2. **Service-role shortcut.** Tempting, bypasses RLS entirely. This codebase
   has already been bitten by exactly this in the payments layer.
3. **Prompt injection** via member-authored listing text and notes.
4. **Losing the provenance discipline.** Today every number is traceable. A
   fluent model will be believed more and evidenced less.
5. **Data sparsity will show.** A model will be asked about Enugu; there is no
   Enugu data. It must refuse as firmly as the current system does.
6. **Privacy/consent for reusing conversation logs.**
7. **Cost and latency** — unmodelled; currently zero.
8. **Regression with no harness.** There are no tests for `answer()`.

---

## 19. Product claims vs actual implementation

**This section is the point of the audit.**

| Claim | Status | Reality |
|---|---|---|
| "Loamy has an AI Copilot" | **Unsupported** | No model, no prompt, no inference. A keyword router |
| "22 years of historical data" | **Partially supported** | 52,225 real rows — but three disjoint series. The ~22-year one (`wholesale`) **ended Jan 2023** and is not what answers use |
| "…market, fuel prices, weather, disease outbreaks" | **Mostly unsupported** | Market: yes. **Fuel: no table** (one event row). **Weather: 27 forecast rows, not historical, not Copilot-accessible.** **Disease: nothing** |
| "Copilot gives current prices" | **Supported** | Ambassador prices are live — where an ambassador reported |
| "Loam remembers your farm" | **Unsupported** | No farm access, no persistent memory |
| "Copilot knows your financing status" | **Unsupported** | Named as unbuilt in the code itself (`engine.ts:365`) |
| "Copilot understands traceability" | **Unsupported** | `loamy_trace` exists; Copilot cannot call it |
| "Learns from users" | **Unsupported** | Signals recorded; no pipeline, no evaluation |
| "Nationwide market intelligence" | **Partially supported** | 15 of 37 states; 53% Borno + Yobe |
| "Speaks Hausa" | **Supported** | Genuine parallel EN/HA throughout |
| "Never invents data" | **Supported and well engineered** | Every number from a row; refusals logged |
| "Voice" | **Partially supported** | Clips for *fixed* phrases; dynamic answers silent; STT unimplemented |

---

## 20. Recommended next engineering steps

1. **Decide the backend tier.** Nothing else can start. Edge function or
   service; it holds the key and runs tools as the caller.
2. **Build a regression set first** — 50–100 real questions from
   `copilot_flagged_questions` with expected behaviour. You cannot safely
   replace a deterministic system without one.
3. **Mine the 34 flagged questions.** A day's work, tells you what members
   actually ask.
4. **Ship three read-only, RLS-scoped tools**: `get_my_farms`,
   `get_my_purchase` (wrap `loamy_transaction_fulfilment`),
   `get_my_financing`. This closes the largest gap in §4.
5. **Keep the deterministic engine as the fact layer.** Let the model *route
   and phrase*; keep numbers coming from SQL. Preserves the no-hallucination
   property that is currently the system's best feature.
6. **Wire `macro_context`** — 1,287 rows of FX and CPI already loaded and
   unread.
7. **Correct the public claims** in §19 before they become commitments.
8. **Then** evaluate LiyaEngine against the contract from steps 1–5.

---

## 21. Inspect next

| Path | Why |
|---|---|
| `src/lib/copilot/engine.ts` | The whole assistant |
| `src/lib/copilot/retrieval.ts` | Everything it can see |
| `src/components/copilot/Copilot.tsx` | UI + inlined persistence |
| `src/lib/copilot/conversations.ts` | Note unused `runTurn` |
| `src/lib/copilot/llm/adapter.ts` | The seam, uncalled |
| `src/lib/copilot/config.ts` | Provider keys (unset) |
| `supabase/migrations/20260804090001_loamy_copilot_v1_schema.sql` | RLS |
| `supabase/migrations/20260804090002_loamy_copilot_active_views.sql` | Batch views |
| `loamy_copilot_price_context` (RPC) | The 24-month window |
| `market_prices_history`, `macro_context`, `market_events` | The dataset |
| `copilot_flagged_questions` | The 34 real failures |
| `src/lib/providers/` | The seam pattern to follow |

---

## What Loamy already has that we should NOT rebuild

1. **The authorization model.** RLS + 281 security-definer functions, with
   ownership derived through parent rows rather than trusted from the client.
   Reuse it; do not build an AI-side permission model.
2. **The RPC surface.** `loamy_transaction_fulfilment`, `loamy_trace`,
   `loamy_application_bundle`, `loamy_resolve_fee` and ~277 others are
   *already* the tool layer. They need wrapping, not writing.
3. **Provenance discipline.** Every answer carries `data_sources` and
   `data_as_of`. Most teams retrofit this painfully. Keep it and require it of
   the model layer.
4. **The active-batch rollback.** Deactivate a batch and it vanishes from what
   the Copilot can say, instantly. Genuinely good design.
5. **Price-type separation.** The refusal to pool retail/wholesale/farmgate is
   correct and non-obvious.
6. **The devaluation guard.** Refusing to present a >2.5× spread as normal
   shows real domain judgement.
7. **The deterministic fact layer.** Keep it *under* the model.
8. **Hausa support.** Parallel throughout, not bolted on.
9. **The provider seam pattern** in `src/lib/providers/`.
10. **The failure signal.** `was_answered` + flagged questions is a working
    evidence layer waiting for a consumer.

## What Loamy is missing for a genuinely intelligent Loam

1. **A backend tier.** Nothing can be done without it.
2. **A model.** There is none.
3. **A tool runtime** that executes as the calling user.
4. **User and business context** — the single biggest gap: 17 of 23 data
   categories unreachable.
5. **Memory that is recalled**, not merely recorded.
6. **Semantic retrieval.** No embeddings, no pgvector.
7. **An agricultural knowledge base.** Four concept rows is not agronomy.
8. **Evaluation.** No regression set, no metric, no tests for `answer()`.
9. **A learning pipeline.** Signals exist; nothing consumes them.
10. **Write actions** with confirmation, permission checks, verification and
    rollback.
11. **Correlating data** — fuel, weather history, disease — without which the
    long price series cannot support the analysis being promised.
12. **Wider geographic coverage.** 15 of 37 states, half of it two states.
13. **Observability and cost control.**
14. **Voice for dynamic answers.**
15. **A privacy position on AI reuse** of member-authored conversation data.
