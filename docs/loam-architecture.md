# Loam architecture

Loam is the agricultural assistant inside Loamy, backed by **N-ATLaS**, Nigeria's
national LLM. It is not a separate application: it is a module in this
repository, a route on the existing dev server, and a flag in
`platform_config`.

This document is for engineers working on this codebase. It records what Loam
is, why it is shaped this way, and what is still unresolved.

---

## 1. The finding that shaped everything

Phase 0 measured N-ATLaS Q4_K_M on the development laptop. Asked *"When should I
plant maize in Kaduna State, Nigeria?"*, it answered, in fluent English:

> "the ideal time to plant maize is towards the end of the rainy season,
> specifically in **September and October**. This allows maize to mature before
> the onset of the dry season."

That is backwards. Kaduna's rains run roughly May to October and maize needs
moisture across a 90-120 day cycle, so a September sowing matures into the dry
season. The justifying clause contradicts the recommendation. Acting on it costs
a smallholder a season.

Asked the same question in Hausa, Igbo and Yoruba, the same model said March to
June - plausible, and mutually consistent. **One question, four answers, and the
wrong one was the English one.**

Two conclusions follow, and they are the whole design:

1. **A numeric provenance check is not enough.** That sentence contains no
   numbers. Month names are the currency of agronomic advice and the thing the
   model invents.
2. **The model must not be asked for facts.** It is good at explaining and at
   phrasing across four Nigerian languages, and unreliable at specifics. So
   Loam retrieves the specifics and lets the model do the part it is good at.

A general-knowledge probe in the same session ("why does crop rotation matter?")
produced a genuinely good answer. The split is consistent: **competent at
reasoning, unreliable at particulars.**

---

## 2. The evidence hierarchy

> **See also section 13.** Level 3 is now reachable: a question that needs no
> controlled data is answered from model knowledge and labelled as such. The
> levels and their meanings are unchanged.

Every claim Loam makes stands on exactly one of four things:

| Level | What it is | Who can produce it |
| --- | --- | --- |
| **L1** | Verified Loamy platform data | `src/lib/loam/evidence.ts`, RLS-scoped |
| **L2** | Approved agricultural knowledge | `src/lib/loam/knowledge.ts`, curated |
| **L3** | Model reasoning | N-ATLaS, always marked `Likely:` |
| **L4** | Unknown | said plainly, never filled in |

The rule: **no evidence, no authoritative recommendation.** Not "no answer" -
a general question about rotation is answerable from L2 alone. The bar rises
with how specific, current, consequential and personal a claim is, which is what
`ClaimDemand` in `src/lib/loam/types.ts` grades:

| Demand | Example | Minimum evidence |
| --- | --- | --- |
| `general` | "Why does crop rotation matter?" | L1 or L2 |
| `specific` | "When do I plant maize in Kaduna?" | L1 or L2 |
| `personal` | "What's on my farm?" | **L1 only** |
| `forecast` | "What will maize cost in March?" | **refused outright** |

`classify()` is deliberately pessimistic: an unrecognised question is graded
`specific`, so it needs evidence. Being too strict costs a decline, which is
recoverable. Being too lenient reproduces the Phase 0 failure, which is not.

### `contextOnly` evidence

Found by a test, not by design. "When should I plant pineapple in Sokoto?" was
passing the gate on a single L2 item reading *"Sokoto lies in the Sudan
Savanna"*. True, and no basis whatsoever for a planting date. Items marked
`contextOnly` are given to the model but ignored when deciding whether there is
enough to answer at all.

---

## 3. The pipeline

> **SUPERSEDED IN PART -- read section 13 with this one.** The GATE below no
> longer has a single outcome. It is a LANE SELECTOR: controlled data still
> gates current, private, transactional and platform claims, but a question
> needing none of those now reaches the model instead of being refused.
> Everything else in this section still holds.

```
classify -> retrieve evidence -> LANE -> prompt -> N-ATLaS -> GUARD -> answer
```

The gate runs **before** inference. A forecast question and a question with no
evidence never reach the model at all: the cheapest way to stop a model
inventing an answer is not to ask it.

### Phase 1.5: the model does not write prose

Phase 1 asked for prose and checked it. That caught invented months and
figures, and could not see this, from a live run:

> "This is because the region experiences a dry season during the colder months
> of the year."

No numbers, no month names, no forecast verbs. Fluent, unevidenced, dubious, and
sitting beside two correctly-grounded sentences where it reads like a third. The
prompt asked for inference to be marked `Likely:`; the model did not comply.
**Prompt compliance is not a safety mechanism.**

Adding regexes for "sustainable", "because" or "ensures" would be an endless
game against a generative model and would still miss the next phrasing. So the
model is no longer asked for prose. It is asked for statements, each declaring
where it came from:

```
[1] Sow once the rains are properly established.
[2] The right date depends on when the rains actually start.
[?] Neighbours who sowed early last year lost seedlings.
```

From that one structural fact, three things become mechanical:

1. **An uncited statement cannot enter the factual body.** `[?]` lines are
   routed to a separate, separately-labelled field (`reasoning`), never
   concatenated into `answer`. L3 cannot be rendered as L1 or L2 because the two
   never share a string. Language-independent; requires no understanding of the
   sentence.
2. **A cited statement is checked for grounding** - does it restate evidence,
   or has it smuggled new content in under a citation? Measured as content-word
   overlap, a general metric rather than a word list. The stopword list contains
   function words only; a test asserts no agricultural vocabulary is in it.
3. **No structure means nothing is trusted.** A reply without markers is
   discarded and the evidence is shown verbatim. Fail closed.

The threshold is calibrated, not chosen. Scored against statements taken
verbatim from live runs:

| population | scores |
| --- | --- |
| correctly grounded | 0.75, 0.80, 1.00, 1.00, 1.00 |
| observed + adversarial | 0.00, 0.08, 0.13, 0.14, 0.14, 0.29 |

`GROUNDING_THRESHOLD = 0.45` sits in the empty band between them. A test asserts
the populations do not overlap and the gap exceeds 0.2, so a change that narrows
the separation fails rather than silently degrading.

#### The citation is a hint; the evidence set is the test

Found in a live run, and it matters. Given `[1]` the zone and `[2]` the planting
window, N-ATLaS wrote four correct sowing statements and labelled every one
`[1]`. Scored against item 1 alone, all four failed, and a correct answer
collapsed to one sentence about which savanna Kaduna is in.

That is a false positive from **bookkeeping**, not invention. An 8B model cannot
reliably track which index a fact came from, and nothing about safety requires
it to: the question that protects a farmer is "does the evidence I supplied
support this sentence?", not "did the model get the number right". The cited item
is tried first; the rest of the set is a fallback. An out-of-range citation gets
the same treatment rather than a hard drop.

This does not weaken the check, and that is asserted rather than claimed in
prose: `loam-grounding.test.ts` scores every adversarial statement against the
**whole** evidence set and still requires each to fail.

#### A rejected statement is dropped, not demoted

A cited statement that fails grounding claimed a source it does not have. That
is a different and worse failure than reasoning honestly labelled, so it is
discarded. Silently relabelling it as `[?]` would still put the sentence in front
of a farmer, and would dress a false source claim as honesty.

#### The source attribution is withheld from the model

In a live Hausa run, N-ATLaS copied whole evidence lines into its answer,
attribution included, so the reply contained
`- source: Loam knowledge pack v0 ... PENDING AGRONOMIST REVIEW`. Rule 4 told it
not to name a source; it had simply copied the line it was given.

Provenance now reaches the user from the structured `evidence` field, which the
interface renders separately and the model cannot influence. Withholding the
string removes the cause rather than policing the output, and shortens the
prompt. A scaffolding check remains as a cheap assertion that a future prompt
change cannot quietly reintroduce internal text.

#### Format compliance, measured

The guard is safe whether the model complies or not, but a non-compliant reply
degrades to the evidence verbatim, which is a worse answer. Compliance was
intermittent at temperature 0.3 with the rules stated only in prose. Adding one
worked example and dropping to temperature 0.1 gave **12/12 usable replies**
across English specific, Hausa specific and English general
(`scripts/loam-compliance.mjs`). Nothing about safety rests on that number; it is
an answer-quality measure.

### Phase 1.6: anchors and contradiction

Phase 1.5 closed the qualitative gap for English and left two holes, both now
addressed.

#### Anchors: provenance that works in four languages

Lexical grounding compares words, so it only works when the statement and the
evidence are in the same language. Loam's evidence is canonical English, so for
Hausa, Igbo and Yoruba the overlap check could not run at all -- and Phase 1.5
simply skipped it. A statement in those languages naming the **wrong crop**, the
wrong state, the wrong unit or an invented quantity was checked by nothing.

An **anchor** is a token whose identity survives translation:

| class | example across languages |
| --- | --- |
| crop | maize / masara / oka / agbado -> `Maize` |
| month | May / Mayu / Mee / Ebibi -> `5` |
| unit | kg / kilo, bag / buhu / akpa / apo -> `kg`, `bag` |
| state | Kaduna -> `Kaduna` (same string in all four) |
| number | 420 -> `420` |
| ref | `LMY-123456` |

These are extracted from any of the four languages, mapped to one canonical
form, and compared without translating a sentence. The rule: **every anchor a
statement asserts must be authorised by the evidence or by the member's own
question.** An unauthorised anchor is a concrete, checkable invention and fails
closed. Diacritics are folded first, because N-ATLaS writes "karshen" and
"ƙarshen" interchangeably between runs.

`anchorsIn` also replaced the number and month extraction inside `guardAnswer`,
so there is one implementation rather than two that can drift.

**This is not multilingual semantic verification, and must not be described as
such.** See the limitation note below.

#### Contradiction: when overlap is high and the meaning is reversed

> Evidence: "sowing before the rains are established risks seedling loss"
> Statement: "sowing before established rains is safe"

Nearly every content word is shared, so grounding scores it near 1.0. The
anchors agree. The numbers and months agree. Only the meaning is inverted.

`polarity.ts` compares poles across five opposition classes -- RISK, ADVICE,
DIRECTION, MAGNITUDE, TIME_ORDER -- with markers defined in all four languages
and mapped to a shared pole, so English evidence conflicts with a Hausa
statement without either being translated. Three design decisions carry the
mechanism:

1. **A class is compared only when both sides carry a marker from it.** Without
   that rule, evidence mentioning a risk conflicts with every statement that
   does not mention one, and the check fires constantly.
2. **Negation is clause-scoped, and flips evaluative classes only.** Statement-
   level negation rejected "do not sow before the rains are established, or you
   risk seedling loss" -- correct advice, where the negation attaches to *sow*
   and the risk marker sits in another clause. And flipping before/after on
   negation rejected correctly-phrased warnings, so TIME_ORDER does not flip.
3. **A conflict drops the statement and leaves the evidence in its place.** On
   the brief's instruction: prefer dropping over guessing at meaning. A false
   positive costs a worse answer, never a wrong one.

Two special cases around TIME_ORDER, both found by testing:

- **The safe complement is not a contradiction.** Evidence warning about sowing
  BEFORE the rains, plus a statement advising to sow AFTER them, is the same
  advice from the other side. Suppressed when the evidence carries a risk
  warning and the statement carries no risk pole of its own.
- **The dropped warning is.** The mirror image -- "sow before the rains are
  established", same time pole, caution silently removed -- agrees on every axis
  and would otherwise pass. Reproducing a cautioned action while deleting the
  caution inverts the advice as surely as "safe" would, so it is reported.

#### Four bugs these layers exposed in themselves

Worth recording, because each was silent and each inverted a check:

- `hasNegation` matched substrings, so **"Northern Guinea Savanna" contains
  "nor"**. The evidence read as negated, its risk pole flipped to "safe", and a
  correct warning about seedling loss was reported as a contradiction. Word
  boundaries now.
- `'no risk'` sat in the POSITIVE risk markers, so "there is no risk in sowing
  early" registered both poles and the class was skipped as ambiguous. Removed;
  negation handles it.
- Bare `'should'` sat in the ADVICE positive markers, so "should be avoided" and
  "should not" registered as recommendations too. Removed.
- Exact word matching missed inflections: `\basara\b` does not match Hausa
  "asarar iri", and `\bavoid\b` does not match "avoided". Forms are now
  enumerated explicitly rather than matched by prefix, because prefix matching
  would make Yoruba "abo" (safe) match English "about".

#### Igbo and Yoruba were not actually supported

Discovered while writing the multilingual tests, and more serious than a gap in
checking. `LoamLanguage` was `'en' | 'ha'`, inherited from the Co-pilot shell, so
an Igbo or Yoruba message was classified as English, took the English lexical
path, scored near zero against English evidence, and was rejected. Loam answered
two of its four demo languages with nothing but the evidence verbatim.

Then the retrieval layer failed them too: the knowledge pack's `topics` were
English and Hausa only, and `extractCommodity` does not know "oka" or "agbado",
so no entry matched and the gate declined with no evidence at all.

Both are fixed -- the language type is widened, commodity extraction falls back
to the four-language anchor table, and the pack's topics carry Igbo and Yoruba
keywords. Verified live: both languages now return grounded Level 2 answers with
the model's reasoning separated.

**Loam's own deterministic sentences remain English and Hausa only.** Igbo and
Yoruba fall back to English, which `phrase()` does explicitly. Authoring a
farmer-facing refusal in a language nobody on the team speaks is how a system
ends up saying something it did not mean; that needs a speaker, not a guess.

### The provenance layer

The guard also runs the original checks, on the assembled body:

1. **Periods** - every month, season and date in the answer must be authorised
   by the evidence. This is the primary check, because this is what Phase 0 got
   wrong. Months are normalised to an index so English evidence can authorise a
   Hausa answer ("Mayu" = "May") without a correct Hausa answer being rejected
   for being in Hausa.
2. **Numbers** - every figure must appear in the evidence or in the member's own
   question. Rounding within 1 is tolerated; integers up to 12 are ignored as
   counts rather than claims.
3. **Forecast language** - a prediction is rejected even when its numbers check
   out.

On any failure the model's text is **discarded** and Loam presents the evidence
directly. Never shown-then-corrected, which is why the adapter is non-streaming:
a guard that retracts a sentence the user already read is not a guard.

---

## 4. Where Loam runs

```
Browser (Copilot panel, `loam` flag)
   |  POST /loam/chat   Authorization: Bearer <existing Supabase JWT>
   v
scripts/loam-dev-server.ts        <- Vite middleware, development
   v
src/lib/loam/orchestrator.ts      <- host-agnostic, pure TypeScript
   v
src/lib/loam/model/adapter.ts     <- ModelAdapter
   v
LOAM_INFERENCE_URL                <- Ollama + N-ATLaS Q4_K_M
```

Loamy is a static SPA with no application server; its only existing server
boundary is Supabase Edge Functions. Rather than add a second process, Loam's
server side is a **Vite middleware** (`apply: 'serve'`, so it is absent from
production builds). The orchestrator imports nothing from Vite, Deno, `process`
or `import.meta`, so the same file will serve a Supabase Edge Function without
an edit. A test in `tests/unit/loam-boundaries.test.ts` enforces that.

### Which project a dev server talks to

`npm run dev` used to load `.env`, which points at **production**, and nothing
on screen said so. Now:

| command | Supabase project |
| --- | --- |
| `npm run dev` | staging (`--mode test`, so `.env.test` overrides `.env`) |
| `npm run dev:test` | staging (unchanged, kept as the explicit name) |
| `npm run dev:production` | production, deliberately |
| `npm run build` | production, unchanged -- the release guard asserts it |

`scripts/dev-target-banner.ts` prints which project is being served and shows a
red block when it is a protected one, reading `protectedRefs` from
`config/environments.json` -- the same single source of truth the test and QA
guards use. It prints the project ref, which is public and already compiled into
every published bundle, and never a key.

### Turning Loam on for one developer

Loam renders when the `loam` flag is on. In an environment where it is off --
production has no `loam` key at all -- enabling it used to mean writing
`platform_config.flags`, which is shared, live configuration being changed so
that one person can look at something locally.

Instead, in a dev server only, append `?loam=1` to any URL. It is remembered
for that origin, and `?loam=0` pins it back off. The parameter names must be
flags the platform already declares, so a typo cannot invent one.

`import.meta.env.DEV` is false in `vite build`, so `readDevFlags` is dead code
in every published bundle and Vite drops it -- verified by grepping `dist` for
`loamy.dev.flags`, `readDevFlags` and `DEV_FLAG_KEY`, all zero. Nothing served
from a build can be switched on from the address bar.

#### Why a query parameter and not the console

The override was originally console-only, into `localStorage`. localStorage is
scoped per **origin**, and a dev server's origin changes whenever its port
does. A flag set on `:5174` is simply not present on `:5300`, with no error and
nothing on screen to say so. Combined with the gate below, that is how the
launcher came to look as though it had been deleted.

#### What actually removed the launcher

The boundary change narrowed the panel's gate:

```diff
- if ((!flagEnabled('copilot') && !loamOn) || !profile) return null
+ if (!loamOn || !profile) return null
```

Production runs `copilot: true` and has no `loam` key, so the launcher it had
been keeping on screen disappeared the moment `copilot` stopped selecting
anything. The gate is correct -- falling back to the engine Loam replaced is
exactly what the boundary work removed -- so the fix was to make `loam` itself
reachable, not to widen the gate again.

### Why the config is not `VITE_`-prefixed

A `VITE_` variable is compiled into the browser bundle and served to every
visitor. The pre-existing Co-pilot seam did exactly that with
`VITE_COPILOT_LLM_API_KEY`, and its own comment admits a browser-exposed key is
wrong. Loam's three variables - `LOAM_INFERENCE_URL`, `LOAM_MODEL`,
`LOAM_INFERENCE_TOKEN` - are read only in Node, and a test asserts no `VITE_`
inference variable exists. A production build was checked: the bundle contains
the string `/loam/chat` and nothing else of Loam's server side - no system
prompt, no inference URL, no model tag, no knowledge pack.

### Authorization

The per-request Supabase client is built from the **anon key plus the caller's
JWT**, so Postgres RLS decides what Loam can read. There is no service-role path
and the user id is taken from the verified token, never from the request body.
Loam holds no privilege the member lacks.

Verified end to end against staging with two real users: the farm's owner gets
an L1 answer naming their farm; a different signed-in user gets a decline and
zero evidence.

Farm `latitude`/`longitude` are flagged `SECURITY-REVIEW` in the Stage 2
migration and restricted to the owner. They must never enter a prompt, because a
prompt is text that leaves this process and, on a hosted inference path, this
machine. `FARM_COLUMNS` names its columns, `select('*')` is forbidden in the
evidence layer, and tests assert both.

---

## 5. What was reused rather than rebuilt

The existing Co-pilot is **not** replaced. The `loam` and `copilot` flags are
independent, both default `false`, and the deterministic engine remains the
fallback - so Loam can be switched off mid-demo and the assistant still works.

Reused as-is:

- `src/lib/copilot/analysis.ts` - fully pure, no Supabase import. Seasonal
  normalisation, monthly averages, trend direction.
- `src/lib/copilot/language.ts` - `detectLanguage`, `extractCommodity` (knows
  masara = Maize), `extractState`.
- `loamy_copilot_price_context` - the seasonal index normalises each month
  against its own year's average so naira devaluation does not distort the
  pattern. Real work, already done in SQL, not reimplemented.

`src/lib/copilot/retrieval.ts` gained an **optional** `RetrievalClient`
parameter defaulting to the browser singleton, so Loam can run the same queries
server-side under the caller's JWT. Every existing call site is unchanged; a
test asserts the parameter stays optional.

---

## 6. N-ATLaS: verified facts

Checked against Hugging Face rather than assumed. Three corrections to earlier
briefs:

- The repo is **`NCAIR1/N-ATLaS`**, not `N-ATLAS`. The latter does not exist.
- It is **gated** (`gated: "auto"`): an account, terms acceptance and a token are
  needed. The GGUF mirrors are not gated.
- **No hosted inference serves it.** `inferenceProviderMapping` is absent, as are
  `pipeline_tag` and `library_name`. Self-hosting or a dedicated endpoint are the
  only options.

Specifications: Llama-3 family, `LlamaForCausalLM`, **8,030,261,248 parameters in
BF16 (~16.06 GB)**, English/Hausa/Igbo/Yoruba. The GGUF carries a 4,614-character
Llama-3.1 Jinja chat template, so Loam supplies none.

### Context length is unresolved

The model card says **8,092**. The GGUF metadata says
`llama.context_length = 131072` with `rope.freq_base = 500000`, both Llama-3.1
signatures. These disagree and we do not know which is authoritative.

**`num_ctx` is pinned to 4096** until NCAIR confirms. Do not build around
131,072 before then.

### Running it

`ollama pull hf.co/QuantFactory/N-ATLaS-GGUF:Q4_K_M` resolves and starts, but on
a marginal connection it dies with a TLS handshake timeout and has no
chunk-level resume. The weights were fetched out-of-band in resumable parallel
ranges and imported with `ollama create`; the resulting blob digest matched the
digest Ollama's own pull was fetching, confirming byte-identical weights. Expect
to fetch the weights out-of-band on a new machine.

Measured on the development laptop (i7-8650U, 16 GB, no usable GPU): resident
**5.19 GiB with `size_vram = 0.00`** - entirely CPU. **2.5-3.0 tok/s**, cold load
17.3 s, warm TTFT 4-7 s. With evidence in the prompt, a four-sentence answer
takes **40-75 s**. Usable for development and a prototype demo; not a production
latency budget.

### Where the time actually goes

Phase 1.5 profiled every stage rather than assuming. Mean over model-backed
responses, milliseconds:

| auth | retrieve | prompt | inference | guard | request |
| --- | --- | --- | --- | --- | --- |
| 993 | 651 | 0 | 58,329 | 3 | 60,048 |

**Inference is 97.1% of server wall time.** Everything Loam adds - JWT
verification, evidence retrieval, prompt construction, the structural guard and
the provenance checks - totals **1.7 s mean**, and the guard itself is **2-3 ms**.

Two consequences worth stating plainly:

- There is nothing to optimise outside the model. Caching retrieval, trimming
  the prompt or speeding up the guard would recover single-digit percentages of a
  60-second response.
- The guard is not the reason responses are slow, so **the non-streaming design
  costs nothing measurable**. It exists because the guard must see the whole
  answer before any of it is shown, and that safety property is worth keeping.
  Streaming would change *perceived* latency only, and would require the guard to
  run incrementally - meaning a sentence could be shown and then retracted, which
  is precisely what the design refuses.

The JWT verification figure is a cold-start artefact: 2.1 s on first call,
~435 ms warm. Worth knowing before reading too much into a single sample.

Authoritative numbers come from `scripts/loam-demo.mjs`, which reports each
stage per scenario.

---

## 7. LICENSING - UNRESOLVED, NEEDS NCAIR

> **This is not a legal conclusion. It is a flag for someone qualified.**

The N-ATLaS model card states the model is released under an **"Open-Source
Research and Innovation License"** with **commercial restrictions** and a stated
**1,000-user cap for free use**, and that commercial use requires separate
licensing. The card lists intended uses as research and academic study,
education and capacity development, civic technology and accessibility,
innovation, cultural preservation and community projects.

Loamy is a commercial agricultural platform. NAIC 2026 participation plausibly
sits inside the research-and-innovation purpose; **shipping Loam to Loamy's
production users plausibly does not.** We have not established which applies.

**Before any production or commercial deployment of Loam, confirmation is
required from NCAIR regarding the applicable licence terms and the stated user
limitation.** This is a prerequisite, not a formality. It does not block
development, local use or the NAIC prototype.

A secondary point of provenance: the GGUF used in development is a third-party
requantisation (`QuantFactory/N-ATLaS-GGUF`), not an NCAIR artefact. Fine for a
prototype; worth stating accurately in any claim about what is running.

---

## 8. The knowledge pack is NOT reviewed

`src/lib/loam/knowledge.ts` is the L2 source. **Every entry is marked
`pending_agronomist_review`, and its `source` string says so where the user can
see it.** Nothing in it has been checked by an agronomist. It is seeded to make
the architecture real and testable, not to be authoritative.

Planting guidance is expressed against **rainfall onset**, not fixed calendar
dates, because a fixed date is the wrong shape for rain-fed agriculture.

Before any demonstration that presents Loam's agricultural guidance as
trustworthy, the pack needs expert sign-off.

**Promotion is a data change, not a code change.** Each entry carries a
`sourceLabel` without a status, and `sourceFor()` derives the attribution the
user actually reads from the `review` field. To promote an entry: an agronomist
reviews it, their name and the date go on the entry as a `reviewer`, and
`review` becomes `'reviewed'`. The visible string updates itself and no code
path needs editing.

Two guards make that safe. The status cannot drift from the label, because the
label is computed from it -- previously both were typed by hand and could
disagree. And `'reviewed'` **without** a named reviewer is still reported as
pending, so flipping the flag alone is treated as the mistake it is rather than
as a promotion. A test asserts that no entry is currently promoted and that none
names a reviewer.

The state-to-zone map is deliberately partial. An uncovered state yields no zone
evidence, so Loam declines rather than guessing - adding a state is a reviewable
edit.

---

## 9. Known gaps

- **Non-English statements are checked by anchors and polarity, NOT by
  semantics.** This is the honest statement of the multilingual position. A
  Hausa, Igbo or Yoruba statement is protected by three things: it cannot enter
  the factual body without a citation; every crop, month, unit, state, figure
  and reference code it names must be authorised; and it must not reverse the
  evidence's polarity. What is NOT checked is whether an unanchored sentence is
  true. "Wannan babban abu ne mai muhimmanci ga manoma" -- *this is a very
  important matter for farmers* -- carries no anchor and no polarity marker, is
  unsupported by any evidence, and is admitted. The equivalent English sentence
  is caught by lexical overlap. **English has a layer the other three do not,
  and calling the anchor check "multilingual grounding" would overstate it.**
  `tests/unit/loam-multilingual.test.ts` asserts this gap explicitly, so that
  closing it later shows up as a failing test rather than a quiet improvement.
- **Polarity covers five axes, not meaning in general.** A reversal outside
  RISK, ADVICE, DIRECTION, MAGNITUDE and TIME_ORDER passes. So does a statement
  that substitutes one correct-sounding mechanism for another without tripping
  any pole -- the layer compares polarity, it does not parse claims.
- **Igbo and Yoruba marker tables are partial by design.** Omissions are safe (a
  token is not anchored, so the check is weaker) but incorrect entries would
  reject correct statements, so only widely-attested names are included. The
  practical consequence is that these two languages have thinner anchor coverage
  than English and Hausa.
- **Second-person phrasing.** Level 1 evidence claims are written in the third
  person ("The member has a farm..."), and the model carries that into answers
  addressed to the member. Cosmetic, but it reads oddly in a demo.
- **Languages.** Phase 1 covers English and Hausa, matching the existing
  Co-pilot shell. N-ATLaS covers en/ha/ig/yo but **not French**, so French needs
  a decided fallback rather than an assumption. Deterministic phrases exist in en
  and ha only.
- **Mixed-language fallback.** A guard fallback or model-unavailable response
  shows a fixed Hausa sentence followed by English evidence claims, because the
  claims are canonical English and there is no deterministic translator.
- **Conversation memory.** Only `lastCommodity` is carried. `copilot_messages`
  and `copilot_conversations` already exist with correct RLS and are not yet
  used by Loam.
- **Edge Function.** Not written. The orchestrator is portable by test, but
  "portable" is not "ported", and the Supabase CLI is not installed on the
  development machine.
- **No streaming.** A deliberate consequence of guarding the whole answer. At
  3 tok/s this means a 40-75 s wait with no visible progress.

---

---

## 11. The Co-pilot boundary, and what is preserved

Loam is the primary assistant when the `loam` flag is on. The Co-pilot is not
deleted: it keeps its flag, its engine and its behaviour, and it remains the
fallback. What changed is that Loam may not use it as a brain.

### The rule

```
Loam orchestrator -> trusted retrieval/analysis -> evidence -> N-ATLaS
```

and never

```
Loam orchestrator -> copilot/engine.ts -> canned answer
```

`engine.ts` is the keyword router: `parseIntent()`, `draftResult()`, the
fixed-phrase fallbacks. It answers questions by itself from a vocabulary. Loam
answers them from evidence. Those are different products and mixing them would
quietly reintroduce exactly the behaviour Loam exists to replace.

`tests/unit/loam-boundaries.test.ts` enforces this: no file under
`src/lib/loam/` may import `copilot/engine`, mention `parseIntent`,
`draftResult`, `phraseFixed` or `phraseNoData`, or import any Co-pilot module
outside a three-item allowlist. Adding to that allowlist fails a test until
someone changes it deliberately.

### A. Reused as capabilities, today

| Module | What Loam uses | Why it is safe |
| --- | --- | --- |
| `copilot/retrieval.ts` | `retrievePriceContext` | Returns ROWS, not prose. Wraps `loamy_copilot_price_context`, whose seasonal index measures each month against its own year's average so naira devaluation does not distort the pattern. Real SQL work, already done. |
| `copilot/analysis.ts` | `monthName`, and the rest available | Pure functions over rows. No Supabase import at all. |
| `copilot/language.ts` | `detectLanguage`, `extractCommodity`, `extractState` | Entity extraction and language detection. Data, not conversation. Knows masara = Maize. |

These three were given an optional `RetrievalClient` parameter in Phase 1 so
Loam can run them server-side under the caller's JWT. Every existing caller is
unchanged.

### B. Worth exposing to Loam later, not now

Deterministic, evidence-producing, and currently reachable only through the
engine's own handlers:

- `retrieveCrossMarket` — cheapest-market comparison across validated prices.
  Already client-parameterised; needs an evidence wrapper and a reader that
  scopes it.
- `retrieveRecentPrices`, `retrieveActiveEvents`, `retrieveEventsInRange` —
  event-annotated price history. Useful for "why did the price move?", which
  Loam currently cannot answer.
- `analysis.ts`'s `seasonalPattern`, `monthlySeries`, `recentDirection`,
  `dateCoverage` — the observed-pattern maths. Loam uses only `monthName`.
- `retrieveConcept` / `copilot_concepts` — admin-authored explanations, already
  reviewed content. The closest thing in the repo to approved knowledge, and a
  better Level 2 source than the unreviewed pack.
- `findOverride` / `copilot_qa_overrides` — admin answers that currently
  short-circuit the engine. As Loam evidence they would be Level 1-ish, but the
  precedence question (does an override outrank retrieval?) needs deciding.
- `lib/ambassador.ts` unit conversion — mudu, tiya, bag. Local units are
  exactly the kind of thing N-ATLaS should not be guessing.

Each needs the same treatment: a reader that returns `EvidenceItem[]` with
`numbers`/`periods` populated, plus a test. None needs a refactor of the
Co-pilot.

### C. Legacy conversational code, to retire from the primary experience

Not deleted, and still correct for the Co-pilot:

- `copilot/engine.ts` — `parseIntent()` (keyword matching over 11 intents),
  `draftResult()`, `answerConvert`, `answerConcept`, `answerNavigation`,
  `answerMarketUpdate`, `oneClarify()`, `notYetBuilt()`.
- `copilot/i18n/registry.ts`, `copilot/language.ts`'s `phrase*` helpers — the
  fixed-phrase answer system.
- `copilot/i18n/voice.ts` — pre-recorded clips keyed to fixed phrases.
- `copilot/stt/adapter.ts` — the microphone seam. `NullSttAdapter`, no provider,
  and the button has no `onClick`. Untouched here.
- In the UI: the draft/"Confirm & continue" flow and the "Not helpful?"
  improvement loop, both now gated to the Co-pilot.

### What a member sees, by flag

| `copilot` | `loam` | Panel | Engine |
| --- | --- | --- | --- |
| off | off | hidden | - |
| on | off | Co-pilot copy, draft flow, "Not helpful?" | `copilot/engine.ts`, in-browser |
| any | on | Loam copy, evidence chips, reasoning block | `/loam/chat` -> orchestrator -> N-ATLaS |

One floating button and one panel serve both. Loam wins when both are on.

---

## 12. Historical agricultural data: what actually exists

Checked against the database rather than recollection, because this is the kind
of claim that hardens into a slide.

`market_prices_history` is the table the Co-pilot's price answers are built on.
Its schema establishes the shape: `date`, `state`, `lga`, `market`, `commodity`,
`price_type` (retail / wholesale / farmgate), `price_ngn_per_kg`, a free-text
`source`, and an `upload_batch_id` pointing at an admin CSV upload. The
`loamy_copilot_prices` view exposes only rows whose batch is still `active`, so
deactivating a batch removes it from what the assistant can say.

**On staging, that table is empty.** Measured: `market_prices_history` 0 rows,
`upload_batches` 0, `macro_context` 0, `market_events` 0,
`ambassador_price_submissions` 0, and therefore `loamy_copilot_prices` 0.

What staging does hold: `market_price_updates` 317 rows, `weather_observations`
22, `copilot_concepts` 4.

### Provenance, stated accurately

- The repository **does not establish** how many years of data exist, where it
  came from, or under what licence. `source` is a free-text column an uploader
  fills in. Code comments mention WFP/FEWS NET, but a comment is not provenance.
- **No claim about the span or size of this dataset should be made** -- not "12
  years", not "22 years", not any number -- until someone with authorised access
  reads the production table and the batch notes.
- It is reference data, not training data. Nothing in this repository trains
  anything.

### Can it serve as Loam evidence?

The path already exists and is already safe: `retrievePriceContext` returns
aggregates, `priceEvidence()` turns them into `EvidenceItem`s with `numbers` and
`periods` populated, and the guard authorises only those figures. When the table
is empty the function returns nothing and Loam declines -- which is what happens
on staging today, and is correct.

Two things to resolve before leaning on it:

1. **Provenance and licence** for whatever is loaded in production.
2. **`market_price_updates` has 317 rows and Loam cannot see it.** It is the one
   price source with real data -- commodity, state, min/max, unit, recorded date,
   source note -- and no reader exposes it as evidence. That, not the empty
   historical table, is the gap worth closing.

---
---

## 13. The lanes, which replaced the gate

Sections 2 and 3 describe an evidence gate with one outcome for "no
evidence": refuse. That is right when a question needs a Loamy record and
wrong when it does not, and the difference was never asked.

`what is rice?` was declined **with the model never invoked**, while a
standalone benchmark of the same weights answered it well in 38 seconds.
Refusing a definition protects nothing: there is no Loamy record about what
rice is to get wrong. Four of the five questions a new member is most likely
to type were refused by a system that was working exactly as designed.

### Three barriers, not one

Removing the gate alone would not have worked. Three mechanisms each refused
independently:

1. **The gate** -- no qualifying evidence, return `decline`.
2. **The system prompt** -- *"any specific claim must come from the evidence;
   if the evidence is silent, say the information is not available."*
3. **The guard** -- `GROUNDING_THRESHOLD = 0.45` scored every statement
   against the evidence, so a correct answer with no evidence scored about
   zero and was discarded wholesale.

All three are addressed. `LoamResponse.lane` records which path a turn took:

| Lane | When | Prompt | Guard |
| --- | --- | --- | --- |
| `grounded` | controlled data or reviewed guidance backs the answer | `systemPrompt` (strict) | `guardStructured` (full grounding) |
| `withheld` | controlled data was REQUIRED and is missing | none, no inference | n/a -- refuses |
| `general` | nothing controlled was needed | `generalSystemPrompt` | `guardGeneral` (narrowed) |

### How the lane is chosen

`needsControlledData(message, classification)` in `src/lib/loam/evidence.ts`
answers one question: does the honest answer depend on something only Loamy
can supply? It returns `'private' | 'current_price' | 'marketplace' |
'platform' | null`, from a handful of data-dependency signals.

It is deliberately **not** an intent router. The old design asked "does a
reader match this phrasing?", which is why `when should I plant maize in
Kaduna?` was answered and `when should I plant in Kaduna` was declined, one
word apart. That is not acceptable behaviour for a conversational assistant.

A `null` means ordinary knowledge and needs no permission from a reader. A
non-null means the readers are the only thing that may state the answer, so a
missing record is still a refusal -- `withheld`, the part the gate was right
about.

### What the general lane may not do

`guardGeneral` allows ordinary explanatory prose and refuses claims only
Loamy can make: a price, a seller's asking price, a listing, an order, an
account record, how the platform works, or a price forecast. The forecast
vocabulary is shared with the grounded lane by substring, so the two lanes
cannot disagree about what counts as predicting a price.

A hit **withholds the whole answer** rather than editing it. Deleting the
offending sentence would leave prose reading as though the claim were still
supported.

The reason this guard exists is measured, not theoretical: asked
`What is Loamy?` with no evidence, N-ATLaS confidently described loam **soil**.
A model that will invent an entity will invent a price, and a fabricated
price in a farmer's hands is the worst thing this system could produce. So
platform questions still require platform evidence -- while `what is loamy
soil?` routes to general knowledge, because that one really is agronomy.

### Provenance in the interface

A general-lane answer is Level 3 and carries no sources. The chip under it
reads **"General knowledge, not a Loamy record"**. It previously read "Based
on available information", which implied Loam had consulted records it never
had.

### Context contamination

`classify` returns `namedCommodity` -- what **this** message names -- beside
`commodity`, which may be inherited from the previous turn. **Tool selection
reads `namedCommodity`; only phrasing and continuity read `commodity`.**

The bug this fixes was found only by driving a browser. The panel sends
`lastCommodity` every turn and `classify` honours it, so after a rice query
`transport offers` arrived carrying Rice and was answered with six Level 1
rice listing claims, and `What is Loamy?` was declined because a commodity
was present. Every unit test asks one question with no history, so nothing
caught it.

Verified live against staging with context carried throughout: `What is yam?`
arriving with Rice, `What is Loamy?` arriving with Maize, and `transport
offers` arriving with Maize all routed correctly.

Coverage: `tests/unit/loam-lanes.test.ts` (33 tests).

---

## 14. The model seam: local, hosted, and what is not activated

`ModelAdapter` in `src/lib/loam/model/adapter.ts` is the only thing that
knows where inference happens. The orchestrator cannot tell local from
hosted.

```
Loam orchestrator
      |
  ModelAdapter
      |
  +---+--------------------+
  |                        |
OllamaAdapter        HostedChatAdapter
  |                        |
local Ollama         OpenAI-compatible API
(WORKING)            (NOT ACTIVATED, NEVER CALLED)
```

### The local path, which is the only one that works

`natlas-q4km:latest` through Ollama at `http://127.0.0.1:11434/api/chat`.
This needs no internet connection and is unaffected by everything else in
this section.

`PINNED_MODEL` is a named constant, and `resolveModel` / `resolveInferenceUrl`
refuse two things outright:

- a model tagged `:cloud`, because Ollama resolves those against ollama.com
  and this machine has `glm-5.2:cloud` registered with
  `OLLAMA_NO_CLOUD:false`;
- a `LOAM_INFERENCE_URL` pointing at ollama.com.

Any model other than the pinned one requires `LOAM_ALLOW_MODEL_OVERRIDE=true`
set deliberately, and **the override cannot opt into cloud**. Before this, one
env line could have sent Nigerian agricultural questions to a hosted
third-party model while every log line still said N-ATLaS.

### Capabilities are declared, never inferred

`ModelAdapter.capabilities` is **optional**, so an adapter written before it
existed, or an external test double, stays valid and is read as text-only
through `adapterCapabilities()`.

| Capability | OllamaAdapter | HostedChatAdapter |
| --- | --- | --- |
| `text` | yes | yes |
| `streaming` | **yes** | not declared |
| `tools` | **yes** | not declared |
| `json` | **yes** | not declared |

The local row is measured, not assumed. `/api/show` reports
`capabilities: ['tools','completion']`; streaming returned 9 NDJSON frames
with a first token at 3.9s; a JSON schema produced
`{"crop":"maize","family":"Poaceae"}`; and a `get_price` function definition
produced a tool call with the right arguments.

The hosted row declares **text only** because nothing has been measured
against it. Declaring a capability from a provider's documentation is the
assumption this type exists to prevent.

### Streaming is a seam, not a path

`GenerateRequest.onToken` is optional and **nothing passes it**. It must stay
that way until the guard can run incrementally: `guardStructured` drops
ungrounded statements and `guardGeneral` withholds an entire answer that
states a price or a platform fact, and both need the complete response. A
token shown as it arrives is a token shown before either check has run, and
retracting a sentence already on screen is worse than waiting for it.

Three tests in `tests/unit/loam-boundaries.test.ts` hold that line: the
orchestrator source contains no `onToken`; what the model actually receives
has it `undefined`; and both adapters send `stream: false` with no
`stream: true` branch anywhere. Supplying `onToken` to the hosted adapter
still sends `stream: false` and still never invokes the callback.

### The hosted adapter

`src/lib/loam/model/hosted.ts`. OpenAI-compatible, base
`https://router.huggingface.co/v1`, endpoint `POST /chat/completions`.

**It has never completed a real inference call.** Every response under test
is a fixture. It is referenced by nothing in the orchestrator, the dev server
or the panel.

Four properties worth knowing:

- **No default model.** An absent identifier throws
  `ModelConfigurationError`. A default would mean answering agricultural
  questions with a model nobody chose, and
  `meta-llama/Llama-3.1-8B-Instruct:featherless-ai` -- which appears in
  research notes about this router -- is **Llama 3.1, not N-ATLaS**.
- **`GenerateResult.model` returns what answered**, not what was asked for,
  so a provider silently routing to another build is visible.
- **It cannot fall back.** The module imports nothing about Ollama, so a
  hosted failure cannot quietly become a local answer. A test asserts the
  failing path makes exactly one request and never touches `:11434`.
- **HTTPS is required** -- a bearer token on a plaintext connection is a
  leaked token -- with loopback exempt only so a test can use a stub.

Errors map to distinct sanitized messages for 401/403, 404, 400/422, 429 and
5xx, plus network, timeout, malformed JSON and empty completion. **The
upstream body is never included**: it can carry account details, quota
figures or echoed content, none of which belongs in a farmer's chat window or
a log line. A test feeds an error body containing a token and asserts the
message leaks neither it, nor the quota text, nor the word `Bearer`.

### Why it is not activated: N-ATLaS is not served

Four independent confirmations, all from public metadata:

| Check | Result |
| --- | --- |
| `NCAIR1/N-ATLaS` -> `inferenceProviderMapping` | `{}` empty |
| `pipeline_tag`, `inference` | `None`, `None` |
| `router.huggingface.co/v1/models` | 127 models listed, **no NCAIR entry** |
| `?inference=warm&author=NCAIR1` | **0**, while `?author=NCAIR1` returns all 5 |

The last row is a working positive control: the author filter finds all five
NCAIR models, and adding `inference=warm` drops them to zero. N-ATLaS is not
a cold model awaiting first use; **no provider has ever been configured to
serve it.**

`available()` is where that honesty lives. It asks the provider whether the
**configured** model is listed and returns false when it is not. A `true`
means the provider lists the identifier -- it still does not mean a
completion will succeed.

Coverage: `tests/unit/loam-hosted-adapter.test.ts` (46 tests), all mocked.

---

## 15. Languages

Loam answers in **English, Hausa, Igbo and Yoruba** -- the four the N-ATLaS
model card documents. `LoamLanguage` has had all four for some time; the
panel was `'en' | 'ha'`, a narrowing inherited from the Co-pilot shell, so
Igbo and Yoruba were answerable and unreachable.

### The platform has five locales; Loam answers in four

`src/lib/loam/language.ts` is where that is decided.
`loamLanguageFromLocale(locale)` passes through `en ha ig yo` and maps
**French to English**.

French is a real interface locale with a full translation pack and is **not**
a language the model card documents. So **a French member gets a French
interface and an English answer.** Asking the model for French because a
dropdown offered it would be exactly the unverified claim this codebase keeps
refusing to make. A test pins it, and `fr` does not appear among the panel's
options.

### The control

A four-option `<select>`, not a cycling toggle: two languages can be cycled
with a button, four cannot without putting the fourth three taps away, and a
native select is better for a screen reader and for a thumb. Options carry
each language's **endonym** from `LOCALE_META`, so "Yorùbá" keeps its
diacritics -- a selector showing "Yoruba" to someone looking for "Yorùbá" is
not one they can use.

It seeds from the member's saved `languagePreference` (persisted in
`role_details`, already on `AuthContext`), so somebody who set the platform
to Hausa months ago is not asked again.

### What is translated and what falls back

| Surface | Status |
| --- | --- |
| `ui()`, `phrase()`, `tone()` | English and Hausa authored; Igbo and Yoruba fall back to English |
| `SUGGESTED_PROMPTS` | English and Hausa authored; others fall back |
| The ANSWER | comes from the model, in the member's language |

Igbo and Yoruba deterministic sentences are deliberately not authored. The
standing reason: a farmer-facing sentence written in a language nobody on the
team speaks is how a system ends up saying something it did not mean. That
needs a speaker, not a guess.

### What has and has not been established

**Verified live through `/loam/chat` on staging**, each in its own language:

| | Question | Latency | Result |
| --- | --- | --- | --- |
| ig | *Kedu ihe bu oka?* | 137.0s | `lane=general L3 language=ig` |
| ha | *Menene masara?* | 90.3s | `lane=general L3 language=ha` |
| yo | *Kini agbado?* | 76.5s | `lane=general L3 language=yo` |

All three answered in the language asked, with diacritics intact.

**Language QUALITY is not established and these tests do not establish it.**
The Hausa answer above opens *"Masara, wanda aka fi sani da masara"* --
"maize, also known as maize", a visible tautology -- and the Igbo contains a
construction nobody on the team can assess. A separate benchmark found the
model gives **temperate-climate advice when no location is named** (frost in
English and Hausa, autumn in Igbo, in a country with neither) while answering
a Kaduna-specific question correctly. That is an argument for Loam supplying
location, not for trusting the model to assume it.

**Nigerian Pidgin is not supported.** It is not in the documented list, and a
direct probe returned the wrong language with a repetition loop. Do not infer
it from Llama-3.1 inheritance.

The lanes are language-independent: grounded, withheld and general behave
identically in all four, so multilingual support does not weaken the evidence
boundary.

Coverage: `tests/unit/loam-language.test.ts` (24 tests), plus 7 panel tests.

---

## 16. Voice: two seams, both disabled

Voice is **two services and neither of them is the model.**

```
member speaks
     |
SpeechToTextProvider        <- separate service, none selected
     |
   text
     |
Loam orchestration + evidence
     |
   N-ATLaS                  <- text in, text out
     |
   text  (always shown)
     |
TextToSpeechProvider        <- separate service, none selected
     |
member hears it
```

N-ATLaS lists no audio capability, has no projector and declares no
`pipeline_tag`. NCAIR publishes four separate ASR models --
NigerianAccentedEnglish, Hausa, Igbo, Yoruba -- **every one with an empty
`inferenceProviderMapping`**, and publishes **no text-to-speech model at
all**. The only adjacent artefact found is `AWARRITech/awarri_tts_v2_eval`,
which has no declared task and no downloads, so its suitability is unknown.

That is why both seams live in `src/lib/providers/` beside weather and
messaging, and not behind `ModelAdapter`, where they would encode a claim
about N-ATLaS that is false.

### Current state

`src/lib/providers/stt.ts` and `src/lib/providers/tts.ts`. Both return the
existing `ProviderResult<T>` and use the established `ProviderMode` and
`ProviderError` taxonomy. Both are registered as `mode: 'disabled'` and
appear in `providerStatus()`.

**Nothing records, transcribes, synthesizes or plays.** A disabled provider
returns `{ ok: false, error: NOT_CONFIGURED }` **without inspecting the
audio** -- there is nowhere to send it, so the honest response precedes
validation. Tests stub `fetch`, `navigator.mediaDevices.getUserMedia`,
`MediaRecorder`, `Audio` and `speechSynthesis` and assert none is touched,
and a source check asserts neither module contains a call site for any of
them.

**`languages` is `[]` on both.** Zero is the truthful count for a provider
nobody has chosen, and for TTS it is not a placeholder: no NCAIR synthesis
model exists for any of the four languages.

### Rules a concrete adapter must hold

**Speech to text.** No audio leaves without the member starting a recording
-- a recording is an act, not a setting. A language is supported when it has
been tested, not when it is advertised; a vendor claiming "100+ languages" is
not evidence about Hausa. Audio is not kept: a farmer's voice recording is
biometric-adjacent and Loamy does not need it.

**Text to speech.** The text is authoritative and always shown, so synthesis
failing can never discard an answer. Never speak a language with the wrong
voice -- reading Hausa with an English voice produces confident-sounding
gibberish, and a farmer hearing a mangled application rate is worse off than
one reading it. An unsupported language returns `rejected`, not
`invalid_request`: the request was understood and declined, and the message
points at the written answer above it. Audio is not retained, and nothing
plays unasked.

Shared validators exist so future adapters enforce the same limits in one
place: **2 MB** of audio, **4,000** characters of text, and a MIME check that
compares the type alone -- Chrome produces `audio/webm;codecs=opus`, and
rejecting codec parameters would reject every recording Chrome makes.

Coverage: `tests/unit/providers-speech.test.ts` (30 tests).

---

## 17. Administrator configuration, secrets, and one audit limitation

Admin -> System Settings -> **AI model and voice**, backed by
`src/lib/aiSettings.ts`.

### Where configuration lives, and the policy that decided it

```sql
-- platform_config
select  to authenticated using (true)              -- EVERY signed-in member reads
update  to authenticated using (loamy_is_admin())
                        with check (loamy_is_admin())
-- no insert/delete policies; single seeded row (id = 1)
```

Write authorization is sound and enforced by the database. **The read policy
is what matters here: every signed-in member can read this row.** So the risk
was never an unauthorized write -- it is a secret sitting somewhere everyone
can read.

No migration was required. `platform_config.settings` is an existing
admin-writable jsonb of platform tunables, and AI configuration lives under
`settings.ai`.

### `settings.ai` structure and defaults

```jsonc
{
  "inference": {
    "provider": "ollama",                              // 'ollama' | 'hosted'
    "localBaseUrl": "http://127.0.0.1:11434",
    "localModel": "natlas-q4km:latest",
    "hostedBaseUrl": "https://router.huggingface.co/v1",
    "hostedModel": "",                                 // NO default, ever
    "hostedEnabled": false,
    "requestTimeoutMs": 220000,
    "maxOutputTokens": 220,
    "temperature": 0.3
  },
  "stt": { "provider": "", "enabled": false },
  "tts": { "provider": "", "enabled": false }
}
```

Every field here is **browser-readable**. `normalizeAiSettings` fills gaps
from the defaults and tolerates rubbish in the column, so a malformed blob
cannot break the admin page -- and it never invents a `hostedModel` from a
junk value.

Saving is **read-merge-write**. `settings` also holds `eligibility_weights`,
`wallet_min_withdrawal_ngn` and the verification thresholds; a whole-column
write would be the difference between saving a model name and silently
resetting the financing engine. A test asserts the neighbours survive.

### Secrets

**There is no credential field** -- not on the form, not in the type. A test
reads the interface source and asserts none was added, and the page contains
no `type="password"`.

`assertNoSecrets` guards the write path and **throws rather than stripping**,
because silently dropping a field an admin typed would leave them believing a
credential was saved. It is the **first statement** in `saveAiSettings`, before
the read, so a rejected update cannot partially modify the record -- a test
asserts zero writes occur.

It matches on an exact deny-list of field names plus a **singular** camelCase
suffix (`Token`, `Secret`, `Password`, `Credential`, `ApiKey`, `PrivateKey`,
`Authorization`), and separately on credential-shaped **values** (`hf_…`,
`sk-…`, a JWT, `Bearer …`) under any name at all. The singular distinction is
load-bearing: `hostedToken` is a credential, `maxOutputTokens` is a number.
The first version used a substring match and rejected the latter, and a guard
that blocks valid configuration gets disabled by the next person who hits it.

**The intended server-side mechanism**, when a hosted provider is actually
available: a **Supabase Function secret**, read with `Deno.env.get`, exactly
as `PAYSTACK_SECRET_KEY` already is in `supabase/functions/paystack-initialize`.
Set with `supabase secrets set`; never in the repository, never in
`platform_config`, never returned to a browser. The admin UI would write it
through a function with **no read-back path**. Do not upload `.env` files
through the admin UI.

Environment variable **names** (values belong in secrets, never here):

| Name | Read by | Purpose |
| --- | --- | --- |
| `LOAM_INFERENCE_URL` | `adapterFromEnv` | local Ollama host |
| `LOAM_MODEL` | `resolveModel` | overrides the pinned model |
| `LOAM_ALLOW_MODEL_OVERRIDE` | `resolveModel` | must be `true` to use a non-pinned model |
| `LOAM_INFERENCE_TOKEN` | `OllamaAdapter` | only if local inference sits behind a gateway |
| `LOAM_HOSTED_BASE_URL` | `hostedAdapterFromEnv` | defaults to the HF router |
| `LOAM_HOSTED_MODEL` | `hostedAdapterFromEnv` | exact identifier, no default |
| `LOAM_HOSTED_TOKEN` | `hostedAdapterFromEnv` | **secret** -- server-side only |
| `LOAM_HOSTED_TIMEOUT_MS` | `hostedAdapterFromEnv` | optional |

Nothing above may carry a `VITE_` prefix. `scripts/check-release-env.mjs`
fails the build on `VITE_`-prefixed test credentials, and the same reasoning
applies to these. Verified: no credential name appears in `dist/`.

### Status: configured is not available is not verified

Four states are tracked **separately**, because "a model id has been typed
in" and "inference works" are different questions, and conflating them is how
a settings page shows a green badge for a service that has never answered.

| Service | configured | credential | availability | inference-verified |
| --- | --- | --- | --- | --- |
| Local Ollama | yes | n/a | `unknown` | **false** |
| Hosted inference | only with a model id | **`unknown`** | `unknown` | **false** |
| Speech to text | no | `unknown` | `unavailable` | **false** |
| Text to speech | no | `unknown` | `unavailable` | **false** |

`inferenceVerified` is **false everywhere** and is never derived from
configuration. The badge reads **"Configured, unverified"** -- never
"Connected". Credential presence reports `unknown` from the browser, which is
correct: a browser that could tell would be a browser that can read the
secret.

None of these states establishes licensing compliance, ongoing availability
or production readiness.

### Test Connection

**Makes no network request, for any service** -- asserted with a stubbed
`fetch`. Every hosted or speech check needs a credential, and a credential a
browser holds is a leaked credential, so verification belongs in a
server-side function that **does not exist yet**. Saying so is more useful
than a check that cannot mean anything.

Results carry `checked: 'nothing' | 'configuration' | 'model-list' |
'inference'`, so a caller cannot present a configuration check as a
successful inference. **A model list is not an inference test, and neither is
this.** No result contains `Bearer`, `hf_`, `sk-`, `eyJ` or `service_role`.

### OPEN LIMITATION: `settings` changes are not audited

`loamy_audit_config_change()` records **only `flags` and `partner_rates`**:

```sql
jsonb_build_object(
  'flags_before', old.flags, 'flags_after', new.flags,
  'rates_before', old.partner_rates, 'rates_after', new.partner_rates)
```

So **changes under `settings` are not captured by the configuration audit
trigger.** This is a pre-existing platform-level gap, not an AI-settings one:
it already applies to `eligibility_weights`, `wallet_min_withdrawal_ngn` and
the verification thresholds.

**AI settings changes must not be described as audited until this is fixed.**

Closing it needs a **separately authorized migration** extending the trigger
to record `settings_before` / `settings_after`. That migration has not been
written or applied. It must also exclude anything secret-shaped from
`audit_events`, though `assertNoSecrets` already prevents a secret reaching
the column in the first place.

Coverage: `tests/unit/ai-settings.test.ts` (35 tests).

---

## 18. Activation and rollback

### Hosted inference: prerequisites, all of them

Hosted inference must stay disabled until **every** one of these is true:

1. **An exact model identifier** that the provider serves. Not a guess, not a
   similar model, and never `meta-llama/Llama-3.1-8B-Instruct` in place of
   N-ATLaS.
2. **Verified provider availability** -- `available()` returning true against
   the real provider, not a fixture.
3. **A server-side credential**, in a Supabase Function secret, never in
   `platform_config` and never `VITE_`-prefixed.
4. **A successful real inference call.** Mocked tests do not establish this.
   Nothing in this repository has ever made one.
5. **Licensing approval from NCAIR.** The model card states an "Open-Source
   Research and Innovation License" with commercial restrictions and a stated
   **1,000-user cap**, commercial use requiring separate licensing. Loamy is
   a commercial platform. See section 7; this is a prerequisite, not a
   formality.

### How to keep it disabled -- which is the current state

Nothing needs doing. `hostedModel` defaults to `''`, `hostedEnabled` defaults
to `false`, `LOAM_HOSTED_MODEL` and `LOAM_HOSTED_TOKEN` are unset, and
`HostedChatAdapter` is referenced by nothing in the orchestrator, the dev
server or the panel. `hostedAdapterFromEnv` returns `null` when neither
variable is set, because "no hosted provider" is an ordinary state and not an
error -- though a **half**-configuration throws, so a typo cannot read as
absence.

### Disabled STT/TTS behaviour

Both return `not_configured` from `ProviderResult`. No microphone prompt, no
network call, no playback, and `languages` is `[]`. A caller should present
that as "voice is unavailable" and continue with text. There is no
microphone control in the interface, deliberately: a control that cannot work
is worse than none.

### Rollback

The local path is the rollback. It is independent of everything in sections
14, 16 and 17 and needs no internet connection.

| To undo | Do this |
| --- | --- |
| A hosted activation | set `hostedEnabled: false` and clear `hostedModel` in Admin -> System Settings; unset `LOAM_HOSTED_*`. The local adapter is unaffected |
| A bad model override | unset `LOAM_MODEL` and `LOAM_ALLOW_MODEL_OVERRIDE`; `resolveModel` returns to `natlas-q4km:latest` |
| Bad AI configuration | re-save in the admin form. `settings.ai` is a single merged key; the surrounding `settings` are preserved on every write |
| The assistant entirely | set `platform_config.flags.loam` to `false`. With `loam` off there is no assistant, which is quieter and safer than falling back to the engine Loam replaced (section 11) |
| A code change | ordinary `git revert` of the relevant commit. Phases land as separate commits for exactly this reason |

Rolling back configuration is a `platform_config` update and takes effect on
the next page load. Rolling back code follows the existing deployment
process; there is no AI-specific deployment step, because
`POST /loam/chat` is `apply: 'serve'` and exists in no deployed build at all
(section 4).

### What is implemented, and what that does not mean

| | Status |
| --- | --- |
| Local Ollama inference | **working**, verified live, four languages |
| Lanes (grounded / withheld / general) | **working**, verified live |
| Multilingual panel (en, ha, ig, yo) | **working**, verified live |
| Listings, price, platform, farm evidence | **working**, verified live |
| Hosted adapter | implemented; **never called**; unregistered |
| STT seam | contract only; disabled; no provider |
| TTS seam | contract only; disabled; no provider |
| Admin AI settings | **working** for non-secret configuration |
| Audit of `settings` changes | **NOT IMPLEMENTED** -- see section 17 |
| Microphone UI, transcription, synthesis | **not implemented** |
| Hosted N-ATLaS | **blocked**: not served by any provider, no credential, licensing open |

---

## 10. Files

| Path | Role |
| --- | --- |
| `src/lib/loam/types.ts` | Evidence levels, `ClaimDemand`, request/response |
| `src/lib/loam/classify.ts` | How much backing a question demands |
| `src/lib/loam/knowledge.ts` | L2 pack (**unreviewed**) + state-to-zone map |
| `src/lib/loam/evidence.ts` | L1 retrieval, RLS-scoped, column allowlists |
| `src/lib/loam/prompt.ts` | System prompt, evidence rendering, context budget |
| `src/lib/loam/structure.ts` | Statement parsing, grounding, assembly |
| `src/lib/loam/anchors.ts` | Language-independent anchors; diacritic folding |
| `src/lib/loam/polarity.ts` | Contradiction and negation across four languages |
| `src/lib/loam/guard.ts` | Structural guard, period/number/forecast checks |
| `src/lib/loam/phrases.ts` | Every sentence Loam says without the model |
| `src/lib/loam/orchestrator.ts` | The pipeline. Host-agnostic |
| `src/lib/loam/model/adapter.ts` | `ModelAdapter`, `OllamaAdapter`, `MockAdapter`, capabilities, model pin |
| `src/lib/loam/model/hosted.ts` | `HostedChatAdapter` -- OpenAI-compatible, **unregistered, never called** |
| `src/lib/loam/language.ts` | Locale to answer-language bridge; French maps to English |
| `src/lib/providers/stt.ts` | Speech-to-text seam, **disabled**, no provider |
| `src/lib/providers/tts.ts` | Text-to-speech seam, **disabled**, no provider |
| `src/lib/aiSettings.ts` | Admin AI configuration, secret guard, status model |
| `src/pages/admin/AdminConfig.tsx` | Admin -> System Settings, including AI model and voice |
| `src/lib/loam/transport.ts` | Browser to `/loam/chat` |
| `scripts/loam-dev-server.ts` | Vite middleware (development host) |
| `scripts/loam-demo.mjs` | The slice against the real model |

Tests: `tests/unit/loam-{guard,grounding,multilingual,contradiction,orchestrator,classify,boundaries,lanes,language,listings,hosted-adapter,platform-knowledge,runtime-pin,social}.test.ts`,
`tests/unit/{providers-speech,ai-settings}.test.ts`, and
`tests/components/loam-{panel,launcher-flag}.test.tsx`.

`scripts/loam-compliance.mjs` measures how often the model produces the
citation format, which is an answer-quality number rather than a safety one.

The unit tests script the model so they can assert boundaries deterministically;
`scripts/loam-demo.mjs` exercises the real one. Both matter: the first proves
the rules hold for any output, the second proves the thing works.
