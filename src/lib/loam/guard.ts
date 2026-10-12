/**
 * The guard — what stands between a fluent answer and a published one.
 *
 * THE CASE THIS FILE EXISTS FOR
 *   Phase 0, verbatim: "the ideal time to plant maize is towards the end of the
 *   rainy season, specifically in September and October." Fluent, confident,
 *   and backwards. Note what it contains: no numbers. A numeric provenance
 *   check reads that sentence and finds nothing to object to.
 *
 *   So the primary check here is on PERIODS, not numbers. Months, seasons and
 *   dates are the currency of agronomic advice, and they are exactly what the
 *   model invents. With the Kaduna knowledge entry as evidence, the authorised
 *   months are May and June; an answer naming September and October fails and
 *   never reaches the user.
 *
 * CROSS-LANGUAGE PERIODS
 *   Evidence is canonical English ("late May into mid-June") while the answer
 *   may be Hausa ("Mayu zuwa Yuni"). Months are therefore normalised to an
 *   index before comparison, so a correct Hausa answer is not rejected for
 *   being in Hausa, and a wrong Hausa answer is still caught.
 *
 * WHAT A FAILURE DOES
 *   The model's text is discarded and Loam presents the evidence directly.
 *   Never shown-then-corrected: that is why the adapter is non-streaming for
 *   now. A guard that retracts a sentence the user already read is not a guard.
 */
import type { EvidenceItem, GuardReport, LoamLanguage } from '@/lib/loam/types'
import { phrase } from '@/lib/loam/phrases'
import { assemble, groundStatement, leaksScaffolding, parseStatements } from '@/lib/loam/structure'
import { anchorViolations, anchorsIn, mergeAnchors, monthsIn, numbersIn } from '@/lib/loam/anchors'

/**
 * Re-exported so callers and tests have one import for provenance primitives.
 * The implementations moved to anchors.ts in Phase 1.6, where they grew Igbo
 * and Yoruba month names and diacritic folding alongside the other anchors.
 */
export { monthsIn, numbersIn }

/** Language that claims to know a future price, in either language. */
const FORECAST_LANGUAGE = [
  'will cost', 'will be ₦', 'will rise to', 'will fall to', 'i predict',
  'i expect the price', 'is expected to reach', 'forecast is', 'will likely cost',
  'zai kai', 'zai zama',
]

export interface GuardInput {
  answer: string
  question: string
  /** Only the evidence the model actually saw. */
  evidence: EvidenceItem[]
  language: LoamLanguage
}

export interface GuardOutcome {
  answer: string
  report: GuardReport
}

/** A deterministic answer built only from evidence. No model involved. */
export function evidenceOnlyAnswer(
  evidence: EvidenceItem[],
  language: LoamLanguage,
  prefixKey?: Parameters<typeof phrase>[0],
  /**
   * `heading: false` suppresses the "What the records show:" line.
   *
   * The forecast refusal introduces the list itself ("What I can show you is
   * what has actually been recorded:"), and printing both stacked two headings
   * on top of each other in a live run.
   */
  opts: { heading?: boolean } = {},
): string {
  /**
   * THE ATTRIBUTION IS NOT PUT IN THE ANSWER TEXT.
   *
   * It was, as `(${e.source})`, and a live Hausa run put this on screen:
   *
   *   "... (Loam knowledge pack v0, agro-ecological zones - PENDING AGRONOMIST
   *    REVIEW)"
   *
   * Engineer phrasing, in English, inside a Hausa answer. Provenance still
   * reaches the member -- it travels in the structured `evidence` field, which
   * the interface renders through describeSource() as "Agricultural guidance
   * (pending expert review)". Nothing is lost by taking it out of the prose;
   * the caveat is shown in the member's own language instead.
   */
  const lines = evidence
    .filter((e) => e.level === 1 || e.level === 2)
    .slice(0, 4)
    .map((e) => `• ${e.claim}`)
  const head = prefixKey ? `${phrase(prefixKey, language)}\n\n` : ''
  if (!lines.length) return `${head}${phrase('noEvidence', language)}`.trim()
  const intro = opts.heading === false ? '' : `${phrase('evidenceIntro', language)}\n`
  return `${head}${intro}${lines.join('\n')}`
}

/** Every anchor the evidence and the member's own question authorise. */
export function authorisedAnchors(input: GuardInput) {
  return mergeAnchors([
    anchorsIn(input.question),
    ...input.evidence.map((e) => anchorsIn(`${e.claim} ${e.asOf ?? ''} ${(e.periods ?? []).join(' ')}`)),
    // Explicit numbers a reader recorded alongside a claim.
    { numbers: new Set(input.evidence.flatMap((e) => e.numbers ?? [])), months: new Set<number>(),
      units: new Set<string>(), crops: new Set<string>(), states: new Set<string>(), refs: new Set<string>() },
  ])
}

/**
 * Check an answer against the anchors its evidence authorises.
 *
 * Phase 1.6 moved the extraction into anchors.ts, which widened the check from
 * numbers and months to units, crops, states and reference codes, and made all
 * of them work across the four demo languages. A Hausa statement naming the
 * wrong crop or the wrong unit is now caught here; previously it was not
 * checked at all.
 */
export function guardAnswer(input: GuardInput): GuardOutcome {
  const violations = anchorViolations(input.answer, authorisedAnchors(input))
  const unsupportedNumbers = violations.filter((v) => v.kind === 'number').map((v) => v.value)
  const unsupportedPeriods = violations.filter((v) => v.kind === 'month').map((v) => v.value)
  const otherAnchors = violations.filter((v) => v.kind !== 'number' && v.kind !== 'month')

  const lower = input.answer.toLowerCase()
  const forecasting = FORECAST_LANGUAGE.filter((p) => lower.includes(p))

  if (violations.length || forecasting.length) {
    const why = [
      unsupportedPeriods.length ? `months not in evidence: ${unsupportedPeriods.join(', ')}` : '',
      unsupportedNumbers.length ? `figures not in evidence: ${unsupportedNumbers.join(', ')}` : '',
      otherAnchors.length
        ? `not in evidence: ${otherAnchors.map((v) => `${v.kind} ${v.value}`).join(', ')}` : '',
      forecasting.length ? `forecast language: ${forecasting.join(', ')}` : '',
    ].filter(Boolean).join('; ')
    return {
      answer: evidenceOnlyAnswer(input.evidence, input.language, 'guardFallbackPrefix'),
      report: { unsupportedNumbers, unsupportedPeriods, fellBack: true, reason: why },
    }
  }

  return {
    answer: input.answer,
    report: { unsupportedNumbers: [], unsupportedPeriods: [], fellBack: false },
  }
}

// ---------------------------------------------------------------------------
// Structural guard (Phase 1.5)
// ---------------------------------------------------------------------------

/**
 * The structural layer, which runs before the provenance checks above.
 *
 * Phase 1's guard could not see an unevidenced causal sentence, because such a
 * sentence contains nothing checkable. This layer does not try to check it
 * either -- it changes the shape of the problem. The model must declare a
 * source per statement, so a statement with no source is IDENTIFIED rather than
 * detected, and routed where it cannot masquerade as a record.
 *
 * Order of operations, and why:
 *   1. parse        no structure at all -> trust nothing, show the evidence
 *   2. ground       a statement citing evidence it does not restate is DROPPED
 *   3. assemble     cited -> body, inference -> a separate labelled section
 *   4. provenance   the assembled body still goes through the number, period
 *                   and forecast checks, because a statement can be lexically
 *                   grounded and still have mangled a figure or a month
 *
 * Inference statements are provenance-checked too: being labelled as reasoning
 * does not license inventing a price or a planting month. A violation there
 * drops the reasoning section rather than the whole answer, since the body is
 * independently grounded.
 */
export interface StructuredGuardInput extends GuardInput {
  /** The reply as the model produced it, markers included. */
  raw: string
}

export interface StructuredGuardOutcome extends GuardOutcome {
  /** Statements that cited evidence and passed grounding. */
  body: string[]
  /** The model's own reasoning, for separate labelled rendering. */
  reasoning: string[]
  /** What was thrown away and why -- surfaced for tests and the demo. */
  dropped: { text: string; reason: string }[]
  /** True when the reply had no usable structure and was discarded wholesale. */
  unstructured: boolean
}

export function guardStructured(input: StructuredGuardInput): StructuredGuardOutcome {
  const parsed = parseStatements(input.raw)
  const dropped: { text: string; reason: string }[] = []

  // 1. No structure -> nothing is trusted. Fail closed.
  if (!parsed.length) {
    return {
      answer: evidenceOnlyAnswer(input.evidence, input.language, 'guardFallbackPrefix'),
      report: {
        unsupportedNumbers: [], unsupportedPeriods: [], fellBack: true,
        reason: 'the model produced no citable statements',
      },
      body: [], reasoning: [], dropped, unstructured: true,
    }
  }

  // 2. Drop anything that copied the prompt's own scaffolding rather than
  //    answering. Cheap, and independent of language.
  const answering = parsed.filter((s) => {
    const marker = leaksScaffolding(s.text)
    if (marker) dropped.push({ text: s.text, reason: `copied prompt scaffolding ("${marker}")` })
    return !marker
  })
  if (!answering.length) {
    return {
      answer: evidenceOnlyAnswer(input.evidence, input.language, 'guardFallbackPrefix'),
      report: {
        unsupportedNumbers: [], unsupportedPeriods: [], fellBack: true,
        reason: 'every statement copied the prompt scaffolding',
      },
      body: [], reasoning: [], dropped, unstructured: false,
    }
  }

  // 3. Ground every cited statement against the evidence set.
  const checked = answering.map((s) => groundStatement(s, input.evidence, input.question, input.language))
  const { body, reasoning, rejected } = assemble(checked)
  for (const r of rejected) {
    dropped.push({ text: r.statement.text, reason: r.reason ?? 'ungrounded' })
  }

  // 3. Nothing survived as fact -> show the evidence rather than a page of
  //    the model's own reasoning dressed as an answer.
  if (!body.length) {
    return {
      answer: evidenceOnlyAnswer(input.evidence, input.language, 'guardFallbackPrefix'),
      report: {
        unsupportedNumbers: [], unsupportedPeriods: [], fellBack: true,
        reason: rejected.length
          ? `every cited statement failed grounding (${rejected.length})`
          : 'the model offered only its own reasoning, with nothing from the evidence',
      },
      body: [], reasoning: [], dropped, unstructured: false,
    }
  }

  // 4. Provenance over the grounded body.
  const bodyCheck = guardAnswer({ ...input, answer: body.join(' ') })
  if (bodyCheck.report.fellBack) {
    return {
      ...bodyCheck,
      body: [], reasoning: [], dropped, unstructured: false,
    }
  }

  // 5. Reasoning is held to the same provenance bar; failing it costs only the
  //    reasoning, because the body stands on its own.
  const keptReasoning: string[] = []
  for (const r of reasoning) {
    const check = guardAnswer({ ...input, answer: r })
    if (check.report.fellBack) dropped.push({ text: r, reason: `reasoning: ${check.report.reason}` })
    else keptReasoning.push(r)
  }

  return {
    answer: body.join(' '),
    report: { unsupportedNumbers: [], unsupportedPeriods: [], fellBack: false },
    body,
    reasoning: keptReasoning,
    dropped,
    unstructured: false,
  }
}

/* ---------------------------------------------------------------------------
 * The general lane
 * ------------------------------------------------------------------------ */

/**
 * The guard for an answer the model wrote from its own knowledge.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   It does not require grounding. There is no evidence to ground against,
 *   and the grounding check would delete a correct definition of rice for
 *   scoring zero overlap against an empty evidence set. Ordinary explanatory
 *   prose is the point of this lane.
 *
 * WHAT IT STILL REFUSES TO LET THROUGH
 *   Claims only Loamy can make. A current price, a seller's asking price, a
 *   listing, an order, an account record, or a statement about how the Loamy
 *   platform works. The benchmark is the reason: asked "What is Loamy?" with
 *   no evidence, the model confidently described loam SOIL. A model that will
 *   invent an entity will invent a price, and a fabricated price in a farmer's
 *   hands is the worst thing this system could produce.
 *
 *   On a hit the whole answer is withheld rather than edited. Deleting the
 *   offending sentence would leave prose that reads as if the claim were
 *   still supported.
 */

/** Money, presented as what something costs. */
const PRICE_CLAIM =
  /(?:₦|NGN|naira)\s?[\d,]+|\b[\d,]{3,}\s*(?:naira|ngn)\b|\bper\s+(?:kg|tonne|bag|mudu|tiya)\b[^.]{0,30}\b[\d,]{3,}/i

/** A claim about Loamy's own records or mechanics. */
const PLATFORM_CLAIM =
  /\bloamy\b[^.?!]{0,60}\b(charges?|fee|fees|verifies|verification|escrow|holds?|guarantees?|requires?|offers?|provides?|listing|listings|order|orders|account)\b|\b(listing|listings|order|orders|escrow|verified badge)\b[^.?!]{0,40}\bloamy\b/i

/** A claim to be reporting records that were never supplied. */
const RECORD_CLAIM =
  /\b(?:there (?:are|is)|we have|loamy (?:has|currently has)|your (?:listing|order|farm|account))\b[^.?!]{0,40}\b(?:listing|listings|order|orders|record|records|seller|sellers)\b|\b(?:currently|right now|today)\b[^.?!]{0,30}\b(?:listed|available on loamy|on the marketplace)\b/i

export interface GeneralGuardOutcome {
  answer: string
  /** True when the answer was withheld for making a controlled claim. */
  blocked: boolean
  reason?: string
}

/**
 * Check a general-lane answer. Returns it unchanged, or withholds it.
 *
 * `fallback` is the deterministic sentence shown when the answer is withheld;
 * the caller supplies it so this module stays free of phrase lookups.
 */
export function guardGeneral(answer: string, fallback: string): GeneralGuardOutcome {
  const text = answer.trim()
  if (!text) return { answer: fallback, blocked: true, reason: 'empty answer' }

  const checks: [RegExp, string][] = [
    [PRICE_CLAIM, 'stated a price without price evidence'],
    [PLATFORM_CLAIM, 'described Loamy platform mechanics without platform evidence'],
    [RECORD_CLAIM, 'reported Loamy records that were never supplied'],
  ]
  for (const [re, reason] of checks) {
    if (re.test(text)) return { answer: fallback, blocked: true, reason }
  }

  // Reuses the grounded lane's forecast vocabulary verbatim, by substring
  // rather than a built regex, so the two lanes cannot disagree about what
  // counts as predicting a price.
  const lower = text.toLowerCase()
  if (FORECAST_LANGUAGE.some((w) => lower.includes(w.toLowerCase()))) {
    return { answer: fallback, blocked: true, reason: 'predicted a future price' }
  }

  return { answer: text, blocked: false }
}
