/**
 * Level 2 — approved agricultural knowledge.
 *
 * ================== READ THIS BEFORE TRUSTING ANYTHING HERE ==================
 * Every entry is marked `pending_agronomist_review` and its `source` string
 * says so, which means the user sees it too. Nothing in this file has been
 * signed off by an agronomist. It is seeded to make the evidence architecture
 * real and testable, NOT to be authoritative. An entry may only become
 * 'reviewed' when a named agronomist has checked it; a test asserts that none
 * has been promoted silently.
 * ============================================================================
 *
 * WHY THIS FILE EXISTS AT ALL
 *   Phase 0: N-ATLaS said to plant Kaduna maize in "September and October".
 *   That is backwards, and it came out fluent and confident. The fix is not a
 *   better prompt — it is to stop asking the model for the fact. Loam retrieves
 *   the planting window from here and lets the model do what it is actually
 *   good at: explaining and phrasing it, in the farmer's language.
 *
 * WHY PLANTING GUIDANCE IS EXPRESSED AGAINST RAINFALL ONSET
 *   A fixed calendar date is the wrong shape for rain-fed agriculture. Sowing
 *   tracks the onset of the rains, which moves year to year. Entries therefore
 *   state the typical window AND its dependency, so Loam can never imply a
 *   date is guaranteed.
 */

import { fold } from '@/lib/loam/anchors'

export type ReviewStatus = 'pending_agronomist_review' | 'reviewed'

/**
 * Who checked an entry, recorded on the entry itself.
 *
 * Required when `review` is 'reviewed', so promotion cannot happen by flipping
 * a flag: there is nowhere to put 'reviewed' without naming a reviewer and a
 * date. `sourceFor()` then derives the user-visible attribution, which is what
 * makes promotion a data change rather than a code change.
 */
export interface Reviewer {
  /** The agronomist's name, as they wish to be credited. */
  name: string
  /** Their institution, where there is one. */
  affiliation?: string
  /** ISO date of the review. */
  reviewedOn: string
}

export interface KnowledgeEntry {
  id: string
  /** Lowercase substrings that make this entry relevant to a question. */
  topics: string[]
  crops?: string[]
  /** Nigerian states this applies to, lowercase. Absent = nationally general. */
  states?: string[]
  /** The fact, in English. Canonical: the model translates, never re-derives. */
  claim: string
  /**
   * What the claim rests on, WITHOUT the review status.
   *
   * The status is appended by `sourceFor()`. It used to be typed into this
   * string by hand, which meant the label and the `review` field could disagree
   * -- an entry marked 'reviewed' could still carry "PENDING AGRONOMIST REVIEW"
   * in the text a farmer reads, or worse, the reverse.
   */
  sourceLabel: string
  review: ReviewStatus
  /** Required when review is 'reviewed'. Absent while pending. */
  reviewer?: Reviewer
  /** Months or seasons this entry authorises an answer to state. */
  periods?: string[]
  /** Figures this entry authorises an answer to state. */
  numbers?: number[]
}

/**
 * The attribution shown to the user, derived from the review status.
 *
 * This is the whole promotion mechanism. To promote an entry, an agronomist
 * reviews it, their name and the date go on the entry, and `review` becomes
 * 'reviewed'. The user-visible string changes to match, automatically, and
 * every test and consumer keeps working. No code path needs editing, and the
 * label cannot drift from the status because it is computed from it.
 */
export function sourceFor(entry: Pick<KnowledgeEntry, 'sourceLabel' | 'review' | 'reviewer'>): string {
  if (entry.review === 'reviewed' && entry.reviewer) {
    const who = entry.reviewer.affiliation
      ? `${entry.reviewer.name}, ${entry.reviewer.affiliation}`
      : entry.reviewer.name
    return `${entry.sourceLabel} - reviewed by ${who}, ${entry.reviewer.reviewedOn}`
  }
  // Anything not fully reviewed says so, including an entry that claims
  // 'reviewed' without a reviewer -- which is a mistake, not a promotion.
  return `${entry.sourceLabel} - PENDING AGRONOMIST REVIEW`
}

/**
 * Agro-ecological zone by state. Deliberately partial — a state that is absent
 * yields no zone evidence, which makes Loam decline rather than guess. Adding a
 * state is a reviewable edit, which is the point.
 */
/**
 * Attribution for the zone mapping, derived like every other entry's so the
 * state-to-zone table cannot be promoted out of step with the rest.
 */
export const ZONE_SOURCE = sourceFor({
  sourceLabel: 'Loam knowledge pack v0, agro-ecological zones',
  review: 'pending_agronomist_review',
})

export const STATE_ZONE: Record<string, string> = {
  kaduna: 'Northern Guinea Savanna',
  kano: 'Sudan Savanna',
  katsina: 'Sudan Savanna',
  jigawa: 'Sudan Savanna',
  sokoto: 'Sudan Savanna',
  zamfara: 'Sudan Savanna',
  kebbi: 'Sudan Savanna',
  bauchi: 'Northern Guinea Savanna',
  gombe: 'Northern Guinea Savanna',
  plateau: 'Northern Guinea Savanna',
  niger: 'Southern Guinea Savanna',
  kwara: 'Southern Guinea Savanna',
  benue: 'Southern Guinea Savanna',
  nasarawa: 'Southern Guinea Savanna',
  taraba: 'Southern Guinea Savanna',
  oyo: 'Derived Savanna',
  ogun: 'Humid Forest',
  osun: 'Humid Forest',
  ondo: 'Humid Forest',
  enugu: 'Derived Savanna',
  anambra: 'Humid Forest',
  imo: 'Humid Forest',
  abia: 'Humid Forest',
  'cross river': 'Humid Forest',
}

export const KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'maize-planting-northern-guinea',
    topics: [
      'plant', 'planting', 'sow', 'sowing', 'when', 'calendar', 'season',
      'shuka', 'yaushe',           // Hausa
      'iku', 'mgbe', 'oge',        // Igbo
      'gbin', 'nigba', 'akoko',    // Yoruba
    ],
    crops: ['maize'],
    states: ['kaduna', 'bauchi', 'gombe', 'plateau'],
    claim:
      'In the Northern Guinea Savanna, rain-fed maize is sown at the onset of the rains, '
      + 'typically from late May into mid-June. The sowing date follows the actual onset of '
      + 'rainfall for that season rather than a fixed calendar date, and sowing before the '
      + 'rains are established risks seedling loss.',
    sourceLabel: 'Loam knowledge pack v0, Northern Guinea Savanna planting guidance',
    review: 'pending_agronomist_review',
    periods: ['late May', 'May', 'June', 'mid-June'],
  },
  {
    id: 'maize-planting-sudan-savanna',
    topics: [
      'plant', 'planting', 'sow', 'sowing', 'when', 'calendar', 'season',
      'shuka', 'yaushe', 'iku', 'mgbe', 'oge', 'gbin', 'nigba', 'akoko',
    ],
    crops: ['maize'],
    states: ['kano', 'katsina', 'jigawa', 'sokoto', 'zamfara', 'kebbi'],
    claim:
      'In the Sudan Savanna, where the rains arrive later and the wet season is shorter, '
      + 'rain-fed maize is sown from June into early July, following the onset of rainfall '
      + 'for that season.',
    sourceLabel: 'Loam knowledge pack v0, Sudan Savanna planting guidance',
    review: 'pending_agronomist_review',
    periods: ['June', 'July', 'early July'],
  },
  {
    id: 'maize-cycle-length',
    topics: [
      'harvest', 'mature', 'maturity', 'how long', 'cycle', 'days',
      'girbi',                     // Hausa
      'owuwe ihe ubi', 'ubi',      // Igbo
      'ikore', 'ojo melo',         // Yoruba
    ],
    crops: ['maize'],
    claim:
      'Maize varieties grown in Nigeria reach maturity roughly 90 to 120 days after sowing, '
      + 'depending on whether the variety is early, medium or late maturing. The crop needs '
      + 'adequate moisture across that whole period, which is why sowing is tied to the rains.',
    sourceLabel: 'Loam knowledge pack v0, maize maturity ranges',
    review: 'pending_agronomist_review',
    numbers: [90, 120],
  },
  {
    id: 'crop-rotation-benefits',
    topics: [
      'rotation', 'rotate', 'soil fertility', 'intercrop', 'succession',
      'juya', 'sauya',             // Hausa
      'gbanwe',                    // Igbo
      'yiyi pada', 'iyipada',      // Yoruba
    ],
    claim:
      'Rotating cereals with legumes such as cowpea, groundnut or soybean helps maintain soil '
      + 'nitrogen, interrupts the life cycle of crop-specific pests and diseases, and spreads a '
      + "household's risk across more than one crop.",
    sourceLabel: 'Loam knowledge pack v0, rotation principles',
    review: 'pending_agronomist_review',
  },
  {
    id: 'storage-moisture',
    topics: [
      'store', 'storage', 'dry', 'drying', 'moisture', 'weevil',
      'ajiya', 'bushe',            // Hausa
      'chekwa', 'kpoo',            // Igbo
      'ipamo', 'gbigbe',           // Yoruba
    ],
    crops: ['maize', 'sorghum', 'millet', 'rice', 'cowpea'],
    claim:
      'Grain should be dried before storage, because storing grain that is still moist invites '
      + 'mould and insect damage. Grain that feels and sounds dry, stored in sealed bags away '
      + 'from ground moisture, keeps substantially longer.',
    sourceLabel: 'Loam knowledge pack v0, post-harvest storage principles',
    review: 'pending_agronomist_review',
  },
]

export interface KnowledgeQuery {
  text: string
  crop?: string | null
  state?: string | null
}

/**
 * Entries relevant to a question.
 *
 * An entry matches on topic AND, when it declares them, on crop and state. The
 * conjunction matters: the Sudan Savanna window must not surface for Kaduna,
 * because answering with the wrong zone's dates is the same class of error
 * Phase 0 exposed, just committed by us instead of the model.
 */
export function findKnowledge(q: KnowledgeQuery): KnowledgeEntry[] {
  // Folded, so a question written with diacritics matches a topic written
  // without them, and vice versa.
  const t = ` ${fold(q.text)} `
  const crop = q.crop?.toLowerCase() ?? null
  const state = q.state?.toLowerCase() ?? null

  return KNOWLEDGE.filter((e) => {
    if (!e.topics.some((k) => t.includes(k))) return false
    if (e.crops && (!crop || !e.crops.includes(crop))) return false
    if (e.states && (!state || !e.states.includes(state))) return false
    return true
  })
}

/** The zone for a state, or null when the pack does not cover it. */
export function zoneFor(state: string | null | undefined): string | null {
  if (!state) return null
  return STATE_ZONE[state.toLowerCase()] ?? null
}
