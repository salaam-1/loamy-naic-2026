/**
 * Language-independent provenance anchors.
 *
 * THE GAP THIS CLOSES
 *   Grounding by content-word overlap works only when the statement and the
 *   evidence are in the same language. Loam's evidence is canonical English; a
 *   correct Hausa, Igbo or Yoruba restatement of it shares almost no words with
 *   it. Phase 1.5 therefore skipped lexical grounding for those languages and
 *   leaned on two things: the structural guarantee (an uncited statement cannot
 *   enter the factual body) and provenance over numbers and months.
 *
 *   That left a real hole. A Hausa statement naming the WRONG CROP, the wrong
 *   state, the wrong unit or a quantity nobody recorded would pass, because
 *   none of those are numbers or months.
 *
 * WHAT AN ANCHOR IS
 *   A token whose identity survives translation. "Kaduna" is Kaduna in all four
 *   languages. 420 is 420. May is Mayu is Mee is Èbibi. A bag is a buhu is an
 *   akpa is an àpò. Maize is masara is oka is agbado. These can be extracted
 *   from text in any of the four languages, mapped to one canonical form, and
 *   compared against the evidence without translating a sentence.
 *
 *   So the check is: EVERY ANCHOR IN THE STATEMENT MUST BE AUTHORISED BY THE
 *   EVIDENCE OR BY THE MEMBER'S OWN QUESTION. An unauthorised anchor is a
 *   concrete, checkable invention -- a crop, place, unit, figure or month that
 *   nothing supplied -- and it fails closed.
 *
 * WHAT THIS IS NOT
 *   It is not semantic verification and it is not multilingual grounding. A
 *   statement with no anchors at all is not checked by this layer; it is
 *   checked only by the structural guarantee and, where language permits, by
 *   lexical overlap. See docs/loam-architecture.md for the accurate statement
 *   of what remains unverified.
 *
 * INCOMPLETENESS IS SAFE; INCORRECTNESS IS NOT
 *   A missing alias means a token is not treated as an anchor, so the check is
 *   weaker but never wrong. A WRONG alias would reject a correct statement. The
 *   tables below therefore carry only high-confidence names and are deliberately
 *   partial, especially for Igbo and Yoruba.
 */
import { NIGERIA_STATES } from '@/lib/nigeria'

/**
 * Strip the diacritics and extended Latin letters the four languages use, so
 * "ƙarshen" matches "karshen" and "ọka" matches "oka".
 *
 * Needed because N-ATLaS writes the same word both ways between runs -- a live
 * Hausa reply used "karshen" where the dictionary form is "ƙarshen".
 */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[ƙƴ]/g, 'k')   // ƙ
    .replace(/[ɗ]/g, 'd')          // ɗ
    .replace(/[ɓ]/g, 'b')          // ɓ
    .replace(/[ǝə]/g, 'e')    // ǝ ə
    .replace(/’|ʼ/g, "'")     // curly apostrophe (Igbo n'
}

// --- numbers, months, dates -------------------------------------------------

const MONTHS_EN = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]
const MONTHS_EN_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
/** Matches MONTHS_HA in src/lib/copilot/engine.ts. */
const MONTHS_HA = [
  'janairu', 'faburairu', 'maris', 'afrilu', 'mayu', 'yuni',
  'yuli', 'agusta', 'satumba', 'oktoba', 'nuwamba', 'disamba',
]
/** Igbo month names. Partial by design; a miss weakens, never breaks. */
const MONTHS_IG = [
  'jenuari', 'februari', 'machi', 'eprel', 'mee', 'juun',
  'julai', 'ogost', 'septemba', 'oktoba', 'novemba', 'disemba',
]
/** Yoruba month names, folded (Ṣẹ́rẹ́, Èrèlè, ...). Partial by design. */
const MONTHS_YO = [
  'serere', 'erele', 'erena', 'igbe', 'ebibi', 'okudu',
  'agemo', 'ogun', 'owewe', 'owara', 'belu', 'ope',
]

/** Month indices (1-12) named in a piece of text, in any of the four languages. */
export function monthsIn(text: string): Set<number> {
  const t = fold(text)
  const found = new Set<number>()
  const scan = (names: string[]) => {
    names.forEach((name, i) => {
      if (new RegExp(`\\b${name}\\b`).test(t)) found.add(i + 1)
    })
  }
  scan(MONTHS_EN)
  scan(MONTHS_EN_ABBR)
  scan(MONTHS_HA)
  scan(MONTHS_IG)
  scan(MONTHS_YO)
  // An ISO date carries a month: 2026-05-14 authorises May.
  for (const m of t.matchAll(/\b\d{4}-(\d{2})-\d{2}\b/g)) {
    const n = Number(m[1])
    if (n >= 1 && n <= 12) found.add(n)
  }
  return found
}

/** Numbers stated in a piece of text, normalised (commas stripped). */
export function numbersIn(text: string): Set<number> {
  const out = new Set<number>()
  // ISO dates are handled as months, not as three separate figures.
  const cleaned = text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
  for (const m of cleaned.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const n = Number(m[0].replace(/,/g, ''))
    if (Number.isFinite(n)) out.add(n)
  }
  return out
}

// --- units ------------------------------------------------------------------

/**
 * Measurement units, canonicalised across the four languages.
 *
 * A unit reversal is as consequential as a number reversal: "420 per bag" where
 * the record says "420 per kg" is off by the weight of a bag.
 */
const UNIT_ALIASES: Record<string, string[]> = {
  kg: ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', 'kilogiram', 'kilogiramu'],
  hectare: ['hectare', 'hectares', 'hekta', 'hektar', 'hektare'],
  bag: ['bag', 'bags', 'buhu', 'buhuna', 'akpa', 'apo'],
  litre: ['litre', 'litres', 'liter', 'liters', 'lita'],
  tonne: ['tonne', 'tonnes', 'ton', 'tons', 'tan'],
  naira: ['naira', 'ngn', 'kudi'],
}

export function unitsIn(text: string): Set<string> {
  const t = fold(text)
  const out = new Set<string>()
  for (const [canonical, aliases] of Object.entries(UNIT_ALIASES)) {
    if (aliases.some((a) => new RegExp(`\\b${a}\\b`).test(t))) out.add(canonical)
  }
  // The naira sign is a unit regardless of language.
  if (text.includes('₦')) out.add('naira')
  return out
}

// --- crops ------------------------------------------------------------------

/**
 * Crop names across the four demo languages, mapped to Loamy's canonical
 * taxonomy (the 15 crops the `farms.primary_crops` check constraint allows).
 *
 * WHY THIS IS NOT THE CO-PILOT'S TABLE
 *   `COMMODITY_ALIASES` in src/lib/copilot/language.ts covers English and Hausa
 *   and drives INTENT ROUTING: any message containing a commodity goes to the
 *   price flow. Adding Igbo and Yoruba names there would change which messages
 *   the existing deterministic Co-pilot routes to a price answer, which is a
 *   behaviour change to a system Phase 1 promised not to disturb. This table
 *   serves a different purpose -- anchor detection -- and English and Hausa
 *   names are kept consistent with that file on purpose.
 *
 * Igbo and Yoruba entries are limited to widely-attested names. Omissions are
 * safe (the token is simply not anchored); errors would not be.
 */
const CROP_ALIASES: Record<string, string[]> = {
  Maize: ['maize', 'corn', 'masara', 'oka', 'agbado'],
  Rice: ['rice', 'shinkafa', 'osikapa', 'iresi'],
  Sorghum: ['sorghum', 'guinea corn', 'dawa'],
  Millet: ['millet', 'gero', 'maiwa'],
  Soybeans: ['soybean', 'soybeans', 'waken soya'],
  Cowpea: ['cowpea', 'cowpeas', 'wake', 'agwa', 'ewa'],
  Groundnut: ['groundnut', 'groundnuts', 'peanut', 'gyada', 'ahuekere', 'epa'],
  Sesame: ['sesame', 'beniseed', 'ridi'],
  Cassava: ['cassava', 'rogo', 'akpu', 'ege', 'gbaguda'],
  Yam: ['yam', 'doya', 'ji', 'isu'],
  Cocoa: ['cocoa', 'koko'],
  Cashew: ['cashew'],
  Ginger: ['ginger', 'citta'],
  'Chili Pepper': ['chili', 'chilli', 'barkono', 'tattasai'],
  Hibiscus: ['hibiscus', 'zobo', 'yakuwa', 'roselle'],
}

export function cropsIn(text: string): Set<string> {
  const t = fold(text)
  const out = new Set<string>()
  for (const [canonical, aliases] of Object.entries(CROP_ALIASES)) {
    if (aliases.some((a) => new RegExp(`\\b${fold(a)}\\b`).test(t))) out.add(canonical)
  }
  return out
}

// --- places -----------------------------------------------------------------

const FOLDED_STATES = NIGERIA_STATES.map((s) => ({ canonical: s, folded: fold(s) }))

/**
 * Nigerian states named in the text. State names are the same string in all
 * four languages, which is what makes them usable as anchors.
 */
export function statesIn(text: string): Set<string> {
  const t = fold(text)
  const out = new Set<string>()
  for (const s of FOLDED_STATES) {
    if (new RegExp(`\\b${s.folded}\\b`).test(t)) out.add(s.canonical)
  }
  return out
}

// --- references -------------------------------------------------------------

/** Platform reference codes (LMY-123456, batch refs). Never translated. */
export function refsIn(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(/\b[A-Z]{2,}[-_]\d{3,}\b/g)) out.add(m[0].toUpperCase())
  return out
}

// --- the anchor set ---------------------------------------------------------

export interface AnchorSet {
  numbers: Set<number>
  months: Set<number>
  units: Set<string>
  crops: Set<string>
  states: Set<string>
  refs: Set<string>
}

export function anchorsIn(text: string): AnchorSet {
  return {
    numbers: numbersIn(text),
    months: monthsIn(text),
    units: unitsIn(text),
    crops: cropsIn(text),
    states: statesIn(text),
    refs: refsIn(text),
  }
}

export function mergeAnchors(sets: AnchorSet[]): AnchorSet {
  const out: AnchorSet = {
    numbers: new Set(), months: new Set(), units: new Set(),
    crops: new Set(), states: new Set(), refs: new Set(),
  }
  for (const s of sets) {
    for (const n of s.numbers) out.numbers.add(n)
    for (const m of s.months) out.months.add(m)
    for (const u of s.units) out.units.add(u)
    for (const c of s.crops) out.crops.add(c)
    for (const st of s.states) out.states.add(st)
    for (const r of s.refs) out.refs.add(r)
  }
  return out
}

export interface AnchorViolation {
  kind: 'number' | 'month' | 'unit' | 'crop' | 'state' | 'ref'
  value: string
}

/**
 * Anchors the statement asserts that the authorised set does not contain.
 *
 * Tolerances, each for a stated reason:
 *   - a number within 1 of an authorised one passes, so "about 420" against a
 *     recorded 419.6 is not a violation;
 *   - integers up to 12 are ignored as counts ("two or three bags"), because
 *     treating every small integer as a factual claim produced constant noise
 *     and caught nothing; months are covered by the month check instead.
 */
export function anchorViolations(statement: string, authorised: AnchorSet): AnchorViolation[] {
  const a = anchorsIn(statement)
  const out: AnchorViolation[] = []

  for (const n of a.numbers) {
    if (n <= 12 && Number.isInteger(n)) continue
    if (![...authorised.numbers].some((x) => Math.abs(x - n) <= 1)) {
      out.push({ kind: 'number', value: String(n) })
    }
  }
  for (const m of a.months) {
    if (!authorised.months.has(m)) out.push({ kind: 'month', value: MONTHS_EN[m - 1] })
  }
  for (const u of a.units) {
    if (!authorised.units.has(u)) out.push({ kind: 'unit', value: u })
  }
  for (const c of a.crops) {
    if (!authorised.crops.has(c)) out.push({ kind: 'crop', value: c })
  }
  for (const s of a.states) {
    if (!authorised.states.has(s)) out.push({ kind: 'state', value: s })
  }
  for (const r of a.refs) {
    if (!authorised.refs.has(r)) out.push({ kind: 'ref', value: r })
  }
  return out
}
