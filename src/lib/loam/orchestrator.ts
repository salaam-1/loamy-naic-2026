/**
 * The Loam pipeline.
 *
 *   classify -> retrieve evidence -> GATE -> prompt -> N-ATLaS -> GUARD -> answer
 *
 * HOST-AGNOSTIC BY CONSTRUCTION
 *   Nothing here imports Vite, Deno, process or import.meta. The caller passes
 *   in a model adapter and a Supabase client, which is what lets the same file
 *   serve the dev middleware today and a Supabase Edge Function later without
 *   an edit. A test asserts this file stays free of host-specific imports.
 *
 * WHERE THE MODEL IS AND IS NOT CONSULTED
 *   The gate runs BEFORE inference, so a forecast question and a question with
 *   no evidence never reach N-ATLaS at all. That is deliberate: the cheapest
 *   way to stop a model inventing an answer is not to ask it. The model is
 *   consulted only once there is something true for it to work from, and then
 *   the guard checks what it did with it.
 */
import { classify, type Classification } from '@/lib/loam/classify'
import { detectSocial } from '@/lib/loam/social'
import { gatherEvidence, needsControlledData, type EvidenceClient } from '@/lib/loam/evidence'
import { evidenceOnlyAnswer, guardGeneral, guardStructured } from '@/lib/loam/guard'
import { phrase } from '@/lib/loam/phrases'
import { systemPrompt, userPrompt, generalSystemPrompt } from '@/lib/loam/prompt'
import { ModelUnavailable, type ModelAdapter } from '@/lib/loam/model/adapter'
import {
  REQUIRED_LEVEL,
  type LoamKind,
  type EvidenceItem,
  type EvidenceLevel,
  type LoamLanguage,
  type LoamRequest,
  type LoamResponse,
  type LoamTimings,
} from '@/lib/loam/types'

export interface OrchestratorDeps {
  model: ModelAdapter
  client: EvidenceClient
  /** From the verified JWT. Never from the request body. */
  userId: string | null
}

/**
 * The general lane: one model call, no evidence, narrowed guard.
 *
 * ONE CALL, NOT TWO
 *   The benchmark measured 2.6-3.2 tokens/sec on this CPU, so a second
 *   inference for classification or verification would double a 40-second
 *   answer for no safety the guard does not already provide.
 */
async function runGeneralLane(
  req: LoamRequest,
  c: Classification,
  deps: OrchestratorDeps,
  mark: { prompt: number; inference: number; guard: number },
  timings: () => LoamTimings,
): Promise<LoamResponse> {
  const tPrompt = Date.now()
  const system = generalSystemPrompt(c.language)
  mark.prompt = Date.now() - tPrompt

  let generated
  try {
    generated = await deps.model.generate({
      system,
      user: req.message,
      maxTokens: 320,
      temperature: 0.3,
    })
    mark.inference = generated.ms
  } catch {
    /**
     * The model is the only thing that can answer on this lane, so an
     * unreachable host is reported as unavailable rather than as a refusal --
     * "I will not guess" would be a lie about why there is no answer.
     */
    return {
      lane: 'general',
      answer: phrase('modelUnavailable', c.language),
      language: c.language,
      demand: c.demand,
      kind: 'refusal',
      level: 4,
      evidence: [],
      modelUsed: false,
      declined: true,
      guard: { unsupportedNumbers: [], unsupportedPeriods: [], fellBack: false, reason: 'model unavailable' },
      modelMs: null,
      refusal: 'no_evidence',
      reasoning: [],
      dropped: [],
      timings: timings(),
      commodity: c.commodity,
    }
  }

  const tGuard = Date.now()
  const checked = guardGeneral(generated.text, phrase('noEvidence', c.language))
  mark.guard = Date.now() - tGuard

  return {
    lane: 'general',
    answer: checked.answer,
    language: c.language,
    demand: c.demand,
    kind: checked.blocked ? 'no_evidence' : 'answer',
    // Level 3 is the honest label: the model reasoned, no record backs it.
    level: checked.blocked ? 4 : 3,
    evidence: [],
    modelUsed: !checked.blocked,
    declined: checked.blocked,
    guard: {
      unsupportedNumbers: [], unsupportedPeriods: [],
      fellBack: checked.blocked,
      reason: checked.reason,
    },
    modelMs: generated.ms,
    refusal: checked.blocked ? 'no_evidence' : undefined,
    reasoning: [],
    dropped: [],
    timings: timings(),
    commodity: c.commodity,
  }
}

/** The strongest level actually backing the answer. */
function strongestLevel(evidence: EvidenceItem[], modelUsed: boolean): EvidenceLevel {
  if (evidence.some((e) => e.level === 1)) return 1
  if (evidence.some((e) => e.level === 2)) return 2
  return modelUsed ? 3 : 4
}

function decline(
  language: LoamLanguage,
  demand: LoamResponse['demand'],
  evidence: EvidenceItem[],
  key: Parameters<typeof phrase>[0],
  timings: LoamTimings,
): LoamResponse {
  return {
    lane: 'withheld',
    answer: phrase(key, language),
    language,
    demand,
    kind: 'no_evidence',
    level: 4,
    evidence,
    modelUsed: false,
    declined: true,
    guard: { unsupportedNumbers: [], unsupportedPeriods: [], fellBack: false, reason: 'gate: no qualifying evidence' },
    modelMs: null,
    refusal: 'no_evidence',
    reasoning: [],
    dropped: [],
    timings,
  }
}

export async function runLoam(req: LoamRequest, deps: OrchestratorDeps): Promise<LoamResponse> {
  // Stage timings, so a latency question can be answered with measurements
  // instead of an opinion about where the time probably goes.
  const t0 = Date.now()
  const mark = { classify: 0, retrieve: 0, prompt: 0, inference: 0, guard: 0 }
  const timings = (): LoamTimings => ({
    classifyMs: mark.classify, retrieveMs: mark.retrieve, promptMs: mark.prompt,
    inferenceMs: mark.inference, guardMs: mark.guard, totalMs: Date.now() - t0,
  })

  /**
   * SOCIAL PRE-ROUTER, before classification and therefore before evidence.
   *
   * "Hi" used to fall through to `specific`, find nothing, and be declined.
   * It is answered here instead, deterministically: no model, no retrieval, no
   * gate. This cannot weaken the evidence architecture because it only
   * intercepts turns that make no claim about the world -- anything carrying a
   * request, including "Hi, what is the maize price?", is left alone and goes
   * through the pipeline exactly as before.
   */
  const social = detectSocial(req.message)
  if (social) {
    const language = classify(req.message, req.language ?? 'en').language
    return {
      lane: 'general',
      answer: phrase(social.kind, language),
      language,
      demand: 'general',
      kind: social.kind,
      // NOT Level 4. A greeting is not a failed lookup.
      level: null,
      evidence: [],
      modelUsed: false,
      declined: false,
      guard: { unsupportedNumbers: [], unsupportedPeriods: [], fellBack: false },
      modelMs: null,
      reasoning: [],
      dropped: [],
      timings: timings(),
    }
  }

  const c = classify(req.message, req.language ?? 'en', req.lastCommodity)
  mark.classify = Date.now() - t0

  /**
   * Does the honest answer depend on something only Loamy can supply? Decided
   * from THIS message, so an inherited commodity cannot turn an unrelated
   * question into a marketplace one.
   */
  const need = needsControlledData(req.message, c)
  // `grounded` by default: every site spreading this one reached the model
  // with evidence, or fell back to the evidence itself. The forecast refusal
  // overrides it, because refusing to predict is a withholding.
  const base = {
    lane: 'grounded' as const,
    language: c.language, demand: c.demand, commodity: c.commodity,
  }

  // --- forecast: refused before inference ---------------------------------
  // The question still gets the observed record, because "I won't predict" is
  // more useful when it comes with what is actually known.
  if (c.demand === 'forecast') {
    const tF = Date.now()
    const evidence = await gatherEvidence({
      client: deps.client, userId: deps.userId, classification: c, message: req.message,
    }).catch(() => [] as EvidenceItem[])
    mark.retrieve = Date.now() - tF
    /**
     * Say what IS recorded, or say plainly that nothing is.
     *
     * The refusal used to end "...what I can show you is what prices have
     * actually been recorded" whether or not any had been. On staging, where
     * no price history exists for maize, that promised a follow-up that never
     * came. Offering nothing is fine; implying there is something is not.
     */
    const observed = evidence.length
      ? `\n\n${phrase('forecastHasData', c.language)}\n`
        + evidenceOnlyAnswer(evidence, c.language, undefined, { heading: false })
      : `\n\n${phrase('forecastNoData', c.language)}`
    return {
      ...base,
      lane: 'withheld' as const,
      kind: 'refusal',
      answer: `${phrase('forecastRefused', c.language)}${observed}`,
      level: evidence.length ? strongestLevel(evidence, false) : 4,
      evidence,
      modelUsed: false,
      declined: true,
      guard: { unsupportedNumbers: [], unsupportedPeriods: [], fellBack: false, reason: 'price forecasting is refused by policy' },
      modelMs: null,
      refusal: 'policy',
      reasoning: [],
      dropped: [],
      timings: timings(),
    }
  }

  // --- retrieve -----------------------------------------------------------
  const tRetrieve = Date.now()
  let evidence: EvidenceItem[] = []
  try {
    evidence = await gatherEvidence({
      client: deps.client, userId: deps.userId, classification: c, message: req.message,
    })
  } catch {
    // A database failure must not become a fabricated answer. Fall through
    // with no evidence and let the gate decline.
    evidence = []
  }
  mark.retrieve = Date.now() - tRetrieve

  // --- lane selection -----------------------------------------------------
  /**
   * This replaced the gate.
   *
   * The gate had one outcome for "no evidence": refuse. That is right when the
   * question needs a Loamy record and wrong when it does not, and the
   * difference was never asked. "What is rice?" was declined with the model
   * never invoked, while a standalone benchmark of the same model answered it
   * well in 38 seconds. Refusing a definition protects nothing.
   *
   *   grounded  qualifying controlled data or reviewed guidance exists.
   *   withheld  a CURRENT, PRIVATE, TRANSACTIONAL or LOAMY fact was required
   *             and is not available. Still refuses, and says why.
   *   general   nothing controlled was required, so the model answers from its
   *             own knowledge at Level 3 under the narrowed guard.
   *
   * A mixed question lands in `grounded`: the records that exist are supplied
   * and the model explains the remainder around them.
   */
  const accepted = REQUIRED_LEVEL[c.demand]
  // contextOnly items are excluded from the DECISION but kept in the prompt:
  // they can colour an answer, they cannot justify one.
  const substantive = evidence.filter((e) => accepted.includes(e.level) && !e.contextOnly)
  const qualifying = substantive.length
    ? evidence.filter((e) => accepted.includes(e.level))
    : []

  if (!qualifying.length) {
    if (need) {
      /**
       * The question asked for something only Loamy can state and Loamy does
       * not have it. Model knowledge must not stand in for a record, so this
       * is still a refusal -- the one the gate was right about.
       */
      return decline(
        c.language, c.demand, evidence,
        c.demand === 'personal' ? 'noEvidencePersonal' : 'noEvidence',
        timings(),
      )
    }
    return runGeneralLane(req, c, deps, mark, timings)
  }

  // --- prompt + inference -------------------------------------------------
  const tPrompt = Date.now()
  const system = systemPrompt(c.language, c.demand)
  const { text: user, included } = userPrompt(req.message, qualifying)
  mark.prompt = Date.now() - tPrompt

  let generated: Awaited<ReturnType<ModelAdapter['generate']>>
  try {
    // Low temperature: this prompt asks for a strict line format, and format
    // adherence is where a small model drifts first. Nothing about safety
    // rests on it -- a non-compliant reply is discarded -- but a compliant one
    // is a better answer, so there is no reason to sample creatively.
    generated = await deps.model.generate({ system, user, maxTokens: 220, temperature: 0.1 })
    mark.inference = generated.ms
  } catch (e) {
    const unavailable = e instanceof ModelUnavailable
    return {
      ...base,
      kind: 'answer',
      answer: evidenceOnlyAnswer(included, c.language, unavailable ? 'modelUnavailable' : undefined),
      level: strongestLevel(included, false),
      evidence: included,
      modelUsed: false,
      declined: false,
      guard: {
        unsupportedNumbers: [], unsupportedPeriods: [], fellBack: true,
        reason: unavailable ? 'inference host unavailable' : `inference failed: ${(e as Error).message}`,
      },
      modelMs: null,
      reasoning: [],
      dropped: [],
      timings: timings(),
    }
  }

  // --- guard --------------------------------------------------------------
  const tGuard = Date.now()
  const guarded = guardStructured({
    raw: generated.text,
    answer: generated.text,
    question: req.message,
    evidence: included,
    language: c.language,
  })
  mark.guard = Date.now() - tGuard

  return {
    ...base,
    kind: 'answer',
    answer: guarded.answer,
    level: strongestLevel(included, !guarded.report.fellBack),
    evidence: included,
    modelUsed: !guarded.report.fellBack,
    declined: false,
    guard: guarded.report,
    modelMs: generated.ms,
    // Kept in its own field so no caller can accidentally concatenate the
    // model's reasoning into the factual answer.
    reasoning: guarded.reasoning,
    dropped: guarded.dropped,
    timings: timings(),
  }
}
