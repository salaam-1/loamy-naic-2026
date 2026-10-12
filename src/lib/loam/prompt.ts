/**
 * Prompt construction.
 *
 * The prompt is not where safety lives — the gate in front of it and the guard
 * behind it are. Phase 0 showed why: N-ATLaS produced a confidently wrong
 * planting window with no prompting at all, and no instruction would have
 * reliably stopped it. So the prompt's job is narrow: hand over the evidence,
 * say plainly what may and may not be built on it, and ask for short prose.
 *
 * CONTEXT BUDGET
 *   num_ctx is pinned to 4096 while NCAIR confirms whether the authoritative
 *   context is the model card's 8,092 or the GGUF's 131,072. At ~4 characters
 *   per token that leaves room for roughly 1,400 tokens of evidence once the
 *   system text, the question and the answer are accounted for. Evidence is
 *   truncated to fit, strongest level first, so a long price history can never
 *   push the instructions out of the window.
 */
import { EVIDENCE_LABEL, type ClaimDemand, type EvidenceItem, type LoamLanguage } from '@/lib/loam/types'
import { STATEMENT_FORMAT_RULES } from '@/lib/loam/structure'

/** Characters of evidence the prompt will carry. ~1,400 tokens. */
export const EVIDENCE_CHAR_BUDGET = 5600

// Named in the prompt so N-ATLaS answers in the member's language. All four are
// languages it was trained on.
const LANGUAGE_NAME: Record<LoamLanguage, string> = {
  en: 'English', ha: 'Hausa', ig: 'Igbo', yo: 'Yoruba',
}

/**
 * The general lane: no controlled data was needed, so the model answers from
 * its own knowledge.
 *
 * WHY A SECOND PROMPT RATHER THAN A SOFTENED FIRST ONE
 *   The grounded prompt's first rule is "any specific claim must come from the
 *   evidence". With no evidence that instruction tells the model to refuse,
 *   which is how "what is rice?" would still have failed even after the gate
 *   stopped blocking it. The two situations want opposite defaults, so they
 *   get separate instructions.
 *
 * WHY UNCERTAINTY IS DESCRIBED BY CASE AND NOT DEMANDED EVERYWHERE
 *   A blanket hedge on every answer trains the reader to ignore it, and
 *   "rice is a cereal grain" needs no caveat. The benchmark showed the model
 *   does not volunteer calibration on its own -- it answered "What is Loamy?"
 *   as soil with complete confidence -- so the cases that DO need it are named
 *   explicitly instead of hoped for.
 */
export function generalSystemPrompt(language: LoamLanguage): string {
  return [
    'You are Loam, the agricultural assistant inside Loamy, a Nigerian agricultural platform.',
    '',
    'No Loamy records were needed to answer this question, so answer it from your own',
    'agricultural and general knowledge. Be genuinely useful and direct.',
    '',
    'RULES',
    '1. Do NOT state a current price, an amount a seller is asking, a market rate, or any',
    '   figure presented as what something costs now. You have no price data here.',
    '2. Do NOT describe any Loamy listing, order, transaction, account or member record,',
    '   and do NOT state how the Loamy platform works, what it verifies or what it',
    '   charges. You have no Loamy records here. Say that you do not have that detail.',
    '3. Do NOT invent a quantity, a date or a statistic and present it as a verified fact.',
    '   General ranges and well-established agronomy are fine; fabricated precision is not.',
    '4. Where the honest answer depends on local conditions -- the onset of the rains,',
    '   the variety, the soil, the season, the state -- say what it depends on rather than',
    '   giving one figure as if it were settled. A planting window, an expected yield or a',
    '   spacing is exactly this kind of answer.',
    '5. A definition, a comparison, an explanation or a piece of arithmetic needs no',
    '   hedging. Answer it plainly.',
    '6. If you do not know, say so.',
    `7. Write in ${LANGUAGE_NAME[language]}. Plain language for a smallholder farmer.`,
    '',
    'Write two to five short sentences of ordinary prose. Do not number your sentences,',
    'do not cite anything, and do not mention evidence, levels or sources.',
  ].join('\n')
}

/**
 * The standing instructions.
 *
 * Written as prohibitions with reasons rather than a persona, because the
 * failure being guarded against is fluent invention and a persona encourages
 * exactly that. "Loam" is named so the assistant does not introduce itself as
 * Llama or as a generic assistant.
 */
export function systemPrompt(language: LoamLanguage, demand: ClaimDemand): string {
  const lines = [
    'You are Loam, the agricultural assistant inside Loamy, a Nigerian agricultural platform.',
    '',
    'You will be given numbered EVIDENCE. Each item is labelled with its level:',
    `  [L1] ${EVIDENCE_LABEL[1]} - records from this platform for this member.`,
    `  [L2] ${EVIDENCE_LABEL[2]} - curated agronomic guidance.`,
    '',
    'RULES',
    '1. Any specific claim - a date, a month, a place, a quantity, a price, a status -',
    '   must come from the evidence. If the evidence does not contain it, do not state it.',
    '2. Never invent a record, a figure, a date or a status. If the evidence is silent,',
    '   say that the information is not available.',
    '3. Never predict or estimate a future price. Loamy does not forecast prices.',
    '   You may describe observed prices and observed seasonal patterns only.',
    '4. Do not name a source or describe where the evidence came from. The',
    '   interface shows sources separately.',
    `5. Write in ${LANGUAGE_NAME[language]}. Plain language for a smallholder farmer.`,
    '',
    ...STATEMENT_FORMAT_RULES,
  ]
  if (demand === 'personal') {
    lines.push(
      '',
      'This question is about the reader\'s own records.',
      '- Use only [L1] evidence for what they have. Do not generalise about what',
      '  farmers usually have.',
      '- Speak to them directly as "you" and "your". Never call them "the member",',
      '  "the user" or "the farmer" -- you are talking to them, not about them.',
    )
  }
  return lines.join('\n')
}

/**
 * Render evidence into the prompt, strongest level first and truncated to the
 * budget. Returns what was actually included, so the guard authorises exactly
 * the figures the model could see — not ones that were dropped.
 */
export function renderEvidence(evidence: EvidenceItem[]): { text: string; included: EvidenceItem[] } {
  const ordered = [...evidence].sort((a, b) => a.level - b.level)
  const included: EvidenceItem[] = []
  const parts: string[] = []
  let used = 0

  for (const e of ordered) {
    const asOf = e.asOf ? ` (as of ${e.asOf})` : ''
    /**
     * THE SOURCE STRING IS WITHHELD FROM THE MODEL, ON PURPOSE.
     *
     * It used to be appended here. In a live Hausa run N-ATLaS copied whole
     * evidence lines into its answer, attribution included, so the reply
     * contained "- source: Loam knowledge pack v0 ... PENDING AGRONOMIST
     * REVIEW". Rule 4 tells it not to name a source; it had simply copied the
     * line it was given.
     *
     * The model does not need the attribution: provenance reaches the user
     * from the structured `evidence` field, which the interface renders
     * separately and which the model cannot influence. Withholding it removes
     * the leak at the source rather than policing the output for it, and
     * shortens the prompt.
     */
    const line = `${parts.length + 1}. [L${e.level}] ${e.claim}${asOf}`
    if (used + line.length > EVIDENCE_CHAR_BUDGET) break
    parts.push(line)
    included.push(e)
    used += line.length + 1
  }
  return {
    text: parts.length ? parts.join('\n') : '(no evidence available)',
    included,
  }
}

export function userPrompt(message: string, evidence: EvidenceItem[]): { text: string; included: EvidenceItem[] } {
  const { text, included } = renderEvidence(evidence)
  return {
    text: `EVIDENCE\n${text}\n\nQUESTION\n${message}`,
    included,
  }
}
