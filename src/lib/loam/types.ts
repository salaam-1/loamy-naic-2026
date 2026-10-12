/**
 * Loam — the evidence model.
 *
 * Phase 0 produced the reason this file exists. Asked "when should I plant
 * maize in Kaduna?", N-ATLaS answered, in fluent English, "September and
 * October" — backwards for a crop that needs rain through a 100-day cycle in a
 * zone whose rains end in October. The same model, asked the same question in
 * Hausa, Igbo and Yoruba, said March–June. One question, four answers, and the
 * wrong one was the English one.
 *
 * No numeric provenance check catches that: "September and October" contains
 * no numbers. So Loam does not ask "are the numbers real?" It asks "what is
 * this claim standing on?" — and every claim stands on exactly one of four
 * things:
 *
 *   LEVEL 1  verified Loamy platform data — rows this user is allowed to see
 *   LEVEL 2  approved agricultural knowledge — curated, sourced, reviewable
 *   LEVEL 3  model reasoning — N-ATLaS inference, always labelled as such
 *   LEVEL 4  unknown — said plainly, never filled in
 *
 * The rule that follows: NO EVIDENCE -> NO AUTHORITATIVE RECOMMENDATION. Not
 * "no answer" — a general question about why crop rotation helps is answerable
 * from Level 2 alone. The bar rises with how specific, current, consequential
 * and personal the claim is, which is what `ClaimDemand` grades.
 */

export type EvidenceLevel = 1 | 2 | 3 | 4

export const EVIDENCE_LABEL: Record<EvidenceLevel, string> = {
  1: 'Loamy platform data',
  2: 'Established agricultural guidance',
  3: 'Model reasoning',
  4: 'Not available',
}

/**
 * One fact the model is allowed to build on.
 *
 * `numbers` and `periods` are the authorisation list: the guard will reject an
 * answer that states a figure or a month the evidence never mentioned. They are
 * populated by whoever produced the evidence, because only that code knows
 * which values are real.
 */
export interface EvidenceItem {
  level: EvidenceLevel
  /** A short, self-contained factual statement. */
  claim: string
  /** Attribution shown to the user. Never a bare table name. */
  source: string
  /** When the fact was observed, for anything time-sensitive. */
  asOf?: string | null
  /** Figures this item authorises the answer to state. */
  numbers?: number[]
  /** Months, date ranges or seasons this item authorises. */
  periods?: string[]
  /**
   * Background that helps the model phrase an answer but cannot BE the answer.
   *
   * Found by a test: "when should I plant pineapple in Sokoto?" was passing the
   * gate on a single Level 2 item reading "Sokoto lies in the Sudan Savanna".
   * That is true, and it is no basis whatsoever for a planting date. Items
   * marked contextOnly are given to the model but ignored when deciding whether
   * there is enough to answer at all.
   */
  contextOnly?: boolean
}

/**
 * How much backing a question demands before Loam may answer with authority.
 *
 *   general   "why does crop rotation matter" — stable agronomy, no specifics.
 *             Level 2 is enough; Level 3 reasoning is allowed if labelled.
 *   specific  "when do I plant maize in Kaduna" — a date, a place, a crop.
 *             Consequential and checkable, so it needs Level 1 or Level 2.
 *   personal  "what is on my farm" — this user's own records. Level 1 only;
 *             nothing else can possibly know the answer.
 *   forecast  "what will maize cost in March" — refused outright, before the
 *             model is called. Loamy does not predict prices (see
 *             DEFAULT_FLAGS in src/lib/types.ts: the naive baseline beat every
 *             model tried, so a forecast is a confident shape with no evidence
 *             behind it). N-ATLaS does not get a chance to invent one.
 */
export type ClaimDemand = 'general' | 'specific' | 'personal' | 'forecast'

/**
 * Which path a turn takes once evidence has been gathered.
 *
 *   grounded  controlled Loamy data or reviewed guidance backs the answer.
 *             The strict prompt and the full grounding guard apply.
 *   general   no controlled data was required and none was found, so the
 *             model answers from its own knowledge at Level 3. The narrowed
 *             guard still applies: prose is allowed, invented prices,
 *             records, listings and platform facts are not.
 *   withheld  controlled data WAS required and is unavailable. Loam says so
 *             rather than letting model knowledge stand in for a record.
 *
 * WHY THIS REPLACED A GATE
 *   The gate had one outcome for "no evidence": refuse. So "what is rice?"
 *   was declined with the model never invoked, while a standalone benchmark
 *   showed N-ATLaS answers it well. Refusing a definitional question protects
 *   nothing -- there is no Loamy record to get wrong -- and it made the whole
 *   assistant look broken. The lane keeps the protection exactly where it
 *   earns its place: current, private, transactional and platform claims.
 */
export type LoamLane = 'grounded' | 'general' | 'withheld'

/** The minimum evidence level that can support an authoritative answer. */
export const REQUIRED_LEVEL: Record<ClaimDemand, EvidenceLevel[]> = {
  general: [1, 2],
  specific: [1, 2],
  personal: [1],
  forecast: [],
}

/**
 * The four languages N-ATLaS was trained on.
 *
 * Phase 1.5 had only 'en' | 'ha', inherited from the existing Co-pilot shell.
 * That was not a cosmetic limit: an Igbo or Yoruba message was classified as
 * English, took the English lexical-grounding path, scored near zero against
 * English evidence and was rejected -- so Loam answered two of its four demo
 * languages with nothing but the evidence verbatim. The type is widened here
 * so those languages take the non-lexical path that is correct for them.
 *
 * NOT full localisation. Loam's own deterministic sentences (refusals,
 * declines) exist in English and Hausa only; Igbo and Yoruba fall back to
 * English, which `phrase()` does explicitly rather than by accident. Authoring
 * those two is Phase 8 work and needs a speaker, not a guess.
 *
 * French is deliberately absent: N-ATLaS does not cover it, and pretending
 * otherwise would be the kind of claim this project does not make.
 */
export type LoamLanguage = 'en' | 'ha' | 'ig' | 'yo'

export interface LoamRequest {
  message: string
  language?: LoamLanguage
  /** Carried so a follow-up like "and sorghum?" keeps its subject. */
  lastCommodity?: string | null
}

export interface GuardReport {
  /** Figures in the answer that no evidence item authorised. */
  unsupportedNumbers: string[]
  /** Months or periods in the answer that no evidence item authorised. */
  unsupportedPeriods: string[]
  /** True when the model's text was discarded for a deterministic answer. */
  fellBack: boolean
  reason?: string
}

/**
 * Where the wall time went. Phase 1 measured only inference, which turned out
 * to hide the question that matters: whether the 40-75s path is the model or
 * everything around it. Measured rather than assumed.
 */
export interface LoamTimings {
  classifyMs: number
  retrieveMs: number
  promptMs: number
  inferenceMs: number
  guardMs: number
  totalMs: number
}

/**
 * Why Loam declined, when it declined.
 *
 *   policy       it could have answered and chose not to. Price forecasting is
 *                the case: Loamy does not predict prices, so the question is
 *                refused before the model is ever asked.
 *   no_evidence  it had nothing to answer from.
 *
 * These are different things and a live demo showed why the difference
 * matters. Both surfaced as "Not enough verified information", so a deliberate
 * refusal read as ignorance -- and the refusal's own text ("what I can show you
 * is what has actually been recorded") contradicted the label above it.
 *
 * Declared here rather than inferred in the component from `demand` or from a
 * guard reason string, because the orchestrator is the only thing that knows.
 */
export type RefusalKind = 'policy' | 'no_evidence'

/**
 * What kind of turn this was.
 *
 * Separate from the evidence level on purpose. A greeting has no evidence
 * behind it, but it is not an evidence FAILURE -- labelling it Level 4
 * alongside "I could not find anything" is what made Loam answer "Hi" with a
 * refusal. The kind says what Loam did; the level says what it stood on, and
 * for a social turn the second question does not apply.
 */
export type LoamKind =
  | 'greeting'
  | 'courtesy'
  | 'goodbye'
  | 'capability'
  | 'answer'
  | 'refusal'
  | 'no_evidence'

/** Social turns carry no evidence and are not evidence failures. */
export const SOCIAL_KINDS: LoamKind[] = ['greeting', 'courtesy', 'goodbye', 'capability']

export interface LoamResponse {
  /** Which path this turn took. See LoamLane. */
  lane: LoamLane
  answer: string
  language: LoamLanguage
  demand: ClaimDemand
  /** What Loam did on this turn. */
  kind: LoamKind
  /**
   * The strongest level actually backing this answer, or null when the turn
   * carries no evidential claim at all (a greeting, a thank-you).
   */
  level: EvidenceLevel | null
  evidence: EvidenceItem[]
  /** False when the answer never went near N-ATLaS (refusal, decline, guard). */
  modelUsed: boolean
  /** True when Loam declined rather than answered. */
  declined: boolean
  /** Why it declined. Absent when it answered. */
  refusal?: RefusalKind
  guard: GuardReport
  commodity?: string | null
  /** Milliseconds spent in inference, for the demo and for latency budgets. */
  modelMs?: number | null
  /**
   * The model's own reasoning, kept OUT of `answer` on purpose.
   *
   * Phase 1 put everything in one string, which is how an unevidenced causal
   * sentence came to sit beside two grounded ones looking just like them.
   * Separate fields make it structurally impossible for the UI to render L3 as
   * though it were L1 or L2, whatever the UI later decides to do with it.
   */
  reasoning?: string[]
  /** Statements discarded by the guard, with the reason. For tests and demos. */
  dropped?: { text: string; reason: string }[]
  timings?: LoamTimings
}
