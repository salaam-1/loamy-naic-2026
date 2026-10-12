/**
 * Mechanical evidence/reasoning separation.
 *
 * THE PROBLEM THIS SOLVES
 *   Phase 1's guard checked numbers, months and forecast phrasing. It could not
 *   see this, from a real run:
 *
 *     "This is because the region experiences a dry season during the colder
 *      months of the year."
 *
 *   No numbers. No month names. No forecast verbs. Fluent, unevidenced, dubious,
 *   and sitting in the same paragraph as two correctly-grounded sentences, where
 *   it reads exactly like another retrieved fact. The prompt asked for inference
 *   to be marked "Likely:"; the model did not comply. Prompt compliance is not a
 *   safety mechanism.
 *
 * THE APPROACH: STRUCTURE, NOT VOCABULARY
 *   Adding regexes for "sustainable", "because" or "ensures" would be an endless
 *   game against a generative model, and would still miss the next phrasing. So
 *   the model is not asked for prose at all. It is asked for a list of
 *   statements, each of which must declare where it came from:
 *
 *     [1] Maize is sown at the onset of the rains, from late May into mid-June.
 *     [2] Sowing before the rains are established risks seedling loss.
 *     [?] The rains have been arriving later in recent years.
 *
 *   `[n]` claims evidence item n. `[?]` is the model's own reasoning. From that
 *   one structural fact, three things become mechanical:
 *
 *     1. An UNCITED statement cannot enter the factual body. It is routed to a
 *        separately-labelled reasoning section, so L3 can never be rendered as
 *        though it were L1 or L2. This holds in any language and needs no
 *        understanding of the sentence at all.
 *     2. A CITED statement is checked for GROUNDING against the item it cites:
 *        does it actually restate that item, or has it smuggled new content in
 *        under a citation? Measured as content-word overlap, which is a general
 *        metric rather than a list of banned words.
 *     3. If the model does not produce the structure, nothing is trusted and
 *        Loam falls back to the evidence verbatim. Fail closed.
 *
 * WHY A LINE FORMAT AND NOT JSON
 *   An 8B model at 3 tok/s is asked for the simplest thing that can be parsed.
 *   JSON invites unterminated strings, trailing commas and markdown fences; a
 *   line prefix is hard to get wrong and cheap to recover from when it is.
 */
import type { EvidenceItem, LoamLanguage } from '@/lib/loam/types'
import { anchorViolations, anchorsIn, mergeAnchors, type AnchorViolation } from '@/lib/loam/anchors'
import { polarityConflicts, type PolarityConflict } from '@/lib/loam/polarity'

export type StatementKind = 'cited' | 'inference'

export interface Statement {
  kind: StatementKind
  /** 1-based index into the evidence list, for a cited statement. */
  citation: number | null
  text: string
}

export interface GroundingResult {
  statement: Statement
  grounded: boolean
  /** Best fraction of the statement's content words found in any one item. */
  overlap: number
  matched: number
  total: number
  /**
   * Which evidence item actually supports this statement (1-based), which is
   * not always the one it cited. Null when nothing supports it.
   */
  groundedBy?: number | null
  /** Anchors asserted that no evidence authorised. Language-independent. */
  anchorViolations?: AnchorViolation[]
  /** Polarity reversals against the grounding evidence. */
  contradictions?: PolarityConflict[]
  reason?: string
}

/**
 * Words carrying no claim. Deliberately function words only -- no agricultural
 * or domain terms, because the moment this list contains subject matter it has
 * become the regex approach wearing a different hat.
 */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'your', 'with', 'from', 'this',
  'that', 'these', 'those', 'have', 'has', 'had', 'will', 'can', 'may', 'might',
  'should', 'would', 'could', 'into', 'onto', 'than', 'then', 'they', 'them',
  'their', 'there', 'where', 'when', 'which', 'what', 'who', 'whom', 'how',
  'why', 'because', 'about', 'also', 'more', 'most', 'some', 'any', 'all',
  'both', 'each', 'other', 'such', 'only', 'own', 'same', 'very', 'just',
  'over', 'under', 'between', 'during', 'before', 'after', 'while', 'been',
  'being', 'was', 'were', 'does', 'did', 'doing', 'done', 'its', 'his', 'her',
  'our', 'out', 'off', 'per', 'via', 'yet', 'via', 'one', 'two',
])

/**
 * Light suffix stripping so "sown"/"sowing" and "rain"/"rains" compare equal.
 *
 * Not a real stemmer on purpose: an aggressive one collapses distinct words and
 * would make an ungrounded statement look grounded, which is the failure that
 * matters here. Erring towards NOT matching makes the check stricter.
 */
function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3)
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2)
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1)
  return w
}

/** Content words of a piece of text, stemmed and de-duplicated. */
export function contentWords(text: string): Set<string> {
  const out = new Set<string>()
  for (const raw of text.toLowerCase().split(/[^a-z0-9À-ɏ'-]+/)) {
    const w = raw.replace(/^[-']+|[-']+$/g, '')
    if (w.length < 3) continue
    if (STOPWORDS.has(w)) continue
    out.add(stem(w))
  }
  return out
}

/**
 * Minimum share of a statement's content words that must appear in the evidence
 * it cites.
 *
 * Calibrated, not guessed. Measured against statements taken verbatim from live
 * N-ATLaS runs (the corpus is in tests/unit/loam-grounding.test.ts):
 *
 *   correctly grounded   0.75  0.80  1.00  1.00  1.00
 *   observed/adversarial 0.00  0.08  0.13  0.14  0.14  0.29
 *
 * The two populations do not overlap and the gap between them is wide. 0.45 is
 * the middle of that empty band, so the threshold is not sitting on top of
 * either distribution. If a future change narrows the gap, the calibration test
 * fails rather than the separation silently degrading.
 */
export const GROUNDING_THRESHOLD = 0.45

/** A short statement needs this many matches regardless of its ratio. */
const MIN_MATCHED = 2

/**
 * Parse the model's reply into statements.
 *
 * Tolerant of the things a small model actually does: markdown bullets before
 * the marker, `[1]` vs `(1)`, a stray fence, prose wrapped across lines. Returns
 * an empty list when nothing parses, which the caller must treat as failure.
 */
export function parseStatements(reply: string): Statement[] {
  const out: Statement[] = []
  const lines = reply
    .replace(/```[a-z]*\n?/gi, '')
    .split(/\r?\n/)

  let current: Statement | null = null
  for (const raw of lines) {
    const line = raw.replace(/^\s*[-*•]\s*/, '').trim()
    if (!line) continue
    const m = /^[[(](\?|\d{1,2})[\])]\s*(.*)$/.exec(line)
    if (m) {
      if (current && current.text.trim()) out.push(current)
      const token = m[1]
      current = token === '?'
        ? { kind: 'inference', citation: null, text: m[2].trim() }
        : { kind: 'cited', citation: Number(token), text: m[2].trim() }
      continue
    }
    // A continuation of the previous statement, not a new one.
    if (current) current.text = `${current.text} ${line}`.trim()
  }
  if (current && current.text.trim()) out.push(current)
  return out.filter((s) => s.text.length > 0)
}

/**
 * Is a cited statement actually supported by the item it cites?
 *
 * LANGUAGE LIMITATION, STATED PLAINLY
 *   Evidence is canonical English. A Hausa statement restating it correctly has
 *   near-zero lexical overlap with it, so this check cannot run on Hausa without
 *   rejecting correct answers. For non-English answers the protections are the
 *   structural one (an uncited statement cannot enter the factual body, which is
 *   language-independent) and the number/period provenance checks in guard.ts
 *   (which normalise months to an index and so work across languages). This is
 *   a real gap in depth for Hausa, not a solved problem.
 */
export function groundStatement(
  stmt: Statement,
  evidence: EvidenceItem[],
  question: string,
  language: LoamLanguage,
): GroundingResult {
  const words = contentWords(stmt.text)
  const total = words.size

  if (stmt.kind === 'inference') {
    // Inference is not required to be grounded; it is required to be LABELLED,
    // which the structure already guarantees.
    return { statement: stmt, grounded: true, overlap: 1, matched: total, total }
  }
  if (stmt.citation === null) {
    return {
      statement: stmt, grounded: false, overlap: 0, matched: 0, total,
      reason: 'cited statement carries no citation',
    }
  }
  /**
   * ANCHORS: checked in EVERY language, before anything else.
   *
   * Phase 1.5 returned early here for non-English and checked nothing but
   * structure, numbers and months. That let a Hausa statement name the wrong
   * crop, the wrong state or the wrong unit unchallenged. Anchors are tokens
   * whose identity survives translation, so they can be compared without
   * translating the sentence -- see anchors.ts.
   */
  const authorised = mergeAnchors([
    anchorsIn(question),
    ...evidence.map((e) => anchorsIn(`${e.claim} ${e.asOf ?? ''} ${(e.periods ?? []).join(' ')}`)),
    {
      numbers: new Set(evidence.flatMap((e) => e.numbers ?? [])),
      months: new Set<number>(), units: new Set<string>(), crops: new Set<string>(),
      states: new Set<string>(), refs: new Set<string>(),
    },
  ])
  const badAnchors = anchorViolations(stmt.text, authorised)
  if (badAnchors.length) {
    return {
      statement: stmt, grounded: false, overlap: 0, matched: 0, total,
      anchorViolations: badAnchors,
      reason: `asserts ${badAnchors.map((v) => `${v.kind} "${v.value}"`).join(', ')}, which no evidence contains`,
    }
  }

  /**
   * CONTRADICTION: also checked in every language.
   *
   * Polarity markers are defined per language and mapped to a shared pole, so
   * English evidence reading "risks seedling loss" conflicts with a Hausa
   * statement reading "yana da lafiya" without either being translated.
   */
  const contradictionTarget = stmt.citation >= 1 && stmt.citation <= evidence.length
    ? [evidence[stmt.citation - 1]]
    : evidence
  for (const item of contradictionTarget) {
    const conflicts = polarityConflicts(stmt.text, item.claim)
    if (conflicts.length) {
      return {
        statement: stmt, grounded: false, overlap: 0, matched: 0, total,
        contradictions: conflicts,
        reason: `contradicts the evidence (${conflicts.map((c) => c.detail).join('; ')})`,
      }
    }
  }

  if (language !== 'en') {
    /**
     * Lexical overlap cannot run here: the evidence is canonical English and a
     * correct Hausa, Igbo or Yoruba restatement of it shares almost no words.
     * What remains for these languages is the structural guarantee, the anchor
     * check and the contradiction check above -- NOT semantic verification. A
     * statement with no anchors and no polarity markers is unverified beyond
     * carrying a citation. Documented in docs/loam-architecture.md.
     */
    return {
      statement: stmt, grounded: true, overlap: 1, matched: total, total,
      groundedBy: stmt.citation,
      reason: 'anchors and polarity checked; lexical grounding not applicable to this language',
    }
  }
  if (total === 0) {
    return { statement: stmt, grounded: false, overlap: 0, matched: 0, total, reason: 'no content' }
  }

  /**
   * THE CITATION IS A HINT; THE EVIDENCE SET IS THE TEST.
   *
   * Found in a live run. Given two evidence items -- [1] the agro-ecological
   * zone and [2] the planting window -- N-ATLaS wrote four correct statements
   * about sowing and labelled every one of them [1]. Scored against item 1
   * alone they all failed, and a correct answer collapsed to a single sentence
   * about which savanna Kaduna is in.
   *
   * That is a false positive from BOOKKEEPING, not from invention. An 8B model
   * cannot reliably track which index a fact came from, and nothing about
   * safety requires it to: the question that protects a farmer is "does the
   * evidence I supplied support this sentence?", not "did the model get the
   * number right". So the cited item is tried first (and a correct citation is
   * still the common case) and the rest of the set is tried as a fallback.
   *
   * This does not weaken the check. A hallucination is unsupported by EVERY
   * item, not just the one it cited -- asserted directly in
   * tests/unit/loam-grounding.test.ts, which scores each adversarial statement
   * against the whole set and still requires it to fail.
   */
  const questionWords = contentWords(question)
  const score = (item: EvidenceItem) => {
    const allowed = new Set([...contentWords(item.claim), ...questionWords])
    let matched = 0
    for (const w of words) if (allowed.has(w)) matched++
    return matched
  }

  // An out-of-range citation is the same bookkeeping error as a wrong one, and
  // gets the same treatment rather than a hard drop: a live run produced a
  // correct, fully-grounded sentence labelled [2] when only one evidence item
  // existed, and dropping it lost true content over an index the model guessed.
  const citedIndex = stmt.citation >= 1 && stmt.citation <= evidence.length
    ? stmt.citation - 1
    : -1
  let bestMatched = citedIndex >= 0 ? score(evidence[citedIndex]) : -1
  let bestIndex = citedIndex
  if (bestMatched / total < GROUNDING_THRESHOLD) {
    for (let i = 0; i < evidence.length; i++) {
      if (i === citedIndex) continue
      const m = score(evidence[i])
      if (m > bestMatched) { bestMatched = m; bestIndex = i }
    }
  }
  if (bestMatched < 0) {
    return {
      statement: stmt, grounded: false, overlap: 0, matched: 0, total,
      reason: 'no evidence was supplied to ground against',
    }
  }

  const overlap = bestMatched / total
  const grounded = overlap >= GROUNDING_THRESHOLD && bestMatched >= MIN_MATCHED
  const miscited = grounded && bestIndex !== citedIndex

  // Re-check polarity against whichever item actually grounded the statement.
  // The pass above used the cited item; when grounding landed elsewhere, that
  // is the claim the statement is really restating and the one it must agree
  // with. High lexical overlap with a reversed meaning is the whole failure
  // this guards: "sowing before established rains is safe" shares nearly every
  // word with evidence saying it risks seedling loss.
  if (grounded && bestIndex !== citedIndex) {
    const conflicts = polarityConflicts(stmt.text, evidence[bestIndex].claim)
    if (conflicts.length) {
      return {
        statement: stmt, grounded: false, overlap, matched: bestMatched, total,
        contradictions: conflicts,
        reason: `contradicts the evidence (${conflicts.map((c) => c.detail).join('; ')})`,
      }
    }
  }

  return {
    statement: stmt, grounded, overlap, matched: bestMatched, total,
    groundedBy: grounded ? bestIndex + 1 : null,
    reason: grounded
      ? (miscited ? `grounded by evidence ${bestIndex + 1}, not the cited ${stmt.citation}` : undefined)
      : `only ${bestMatched}/${total} content words (${(overlap * 100).toFixed(0)}%) appear in any supplied evidence`,
  }
}

export interface AssembledAnswer {
  /** Statements that cite evidence and pass grounding. The factual answer. */
  body: string[]
  /** The model's own reasoning, to be rendered separately and labelled. */
  reasoning: string[]
  /** Cited statements that failed grounding. Dropped, never shown. */
  rejected: GroundingResult[]
}

/**
 * Split checked statements into what may be asserted and what must be labelled.
 *
 * A rejected statement is DROPPED rather than demoted to reasoning. It claimed
 * a source it does not have, which is a different and worse failure than
 * reasoning honestly labelled: silently relabelling it would teach the model
 * nothing and would still put the sentence in front of a farmer.
 */
export function assemble(results: GroundingResult[]): AssembledAnswer {
  const body: string[] = []
  const reasoning: string[] = []
  const rejected: GroundingResult[] = []
  for (const r of results) {
    if (r.statement.kind === 'inference') reasoning.push(r.statement.text)
    else if (r.grounded) body.push(r.statement.text)
    else rejected.push(r)
  }
  return { body, reasoning, rejected }
}

/** The format instruction. Lives here so it cannot drift from the parser. */
export const STATEMENT_FORMAT_RULES = [
  'FORMAT -- this matters, follow it exactly.',
  'Write your answer as separate lines. Begin EVERY line with a marker:',
  '  [1], [2], ... when the line restates that numbered piece of evidence.',
  '  [?] when the line is your own reasoning and no evidence states it.',
  'Write nothing outside these lines: no preamble, no closing remark, no heading.',
  'A line marked [1] must say what evidence 1 says, in your own words, and',
  'must not add anything evidence 1 does not contain. If you want to add',
  'something of your own, put it on its own [?] line instead.',
  'Prefer two or three short lines. Never more than five.',
  '',
  // A worked example, because telling a small model the format is measurably
  // less effective than showing it one. This is FORMAT compliance only -- the
  // safety property does not depend on the model obeying, since a reply with no
  // markers is discarded rather than trusted.
  'Example, for evidence about sowing dates:',
  '[1] Sow once the rains are properly established.',
  '[1] The right date depends on when the rains actually start, not the calendar.',
  '[?] Neighbours who sowed early last year lost seedlings.',
]

/**
 * Did a statement copy the prompt's own scaffolding instead of answering?
 *
 * This is NOT hallucination detection -- it is a format check, and the only
 * strings it looks for are ones Loam itself puts in the prompt. The source
 * attribution has been withheld from the model (see prompt.ts), which removes
 * the cause; this remains as a cheap assertion that a future prompt change
 * cannot quietly reintroduce internal text into a user-facing answer.
 */
const SCAFFOLD_MARKERS = ['source:', 'PENDING AGRONOMIST', '[L1]', '[L2]', 'EVIDENCE', 'QUESTION']

export function leaksScaffolding(text: string): string | null {
  for (const m of SCAFFOLD_MARKERS) {
    if (text.includes(m)) return m
  }
  return null
}
