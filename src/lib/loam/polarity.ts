/**
 * Contradiction and negation: catching a statement that reverses its evidence.
 *
 * THE FAILURE
 *   Evidence: "sowing before the rains are established risks seedling loss"
 *   Statement: "sowing before established rains is safe"
 *
 *   Nearly every content word is shared, so grounding by overlap scores this
 *   near 1.0 and waves it through. The anchors agree. The numbers and months
 *   agree. The meaning is inverted, and the inverted version would cost a
 *   farmer a crop.
 *
 * NOT A THEOREM PROVER
 *   This does not understand sentences. It compares POLARITY across a small set
 *   of opposition classes -- risk/safety, increase/decrease, advised/discouraged,
 *   before/after, high/low -- and treats a disagreement as a reason to fail
 *   closed. That is the smallest mechanism that catches the reversals which
 *   actually matter in agricultural advice.
 *
 * THE RULE THAT MAKES IT WORK
 *   A class is compared ONLY when the statement and the evidence both carry a
 *   marker from it. Without that rule the check fires constantly: evidence that
 *   mentions a risk would conflict with every statement that does not. With it,
 *   the check is silent unless both sides have said something about the same
 *   axis and said opposite things.
 *
 * NEGATION FLIPS EVALUATIVE CLASSES ONLY
 *   "not risky" means safe, so negation inverts the risk pole. But "do not sow
 *   before the rains" is not a claim about sowing *after* them -- it is the same
 *   temporal claim, negated. Flipping before/after on negation rejected
 *   correctly-phrased advice, so negation applies to RISK, ADVICE, DIRECTION
 *   and MAGNITUDE and not to TIME_ORDER.
 *
 * CROSS-LANGUAGE BY CONSTRUCTION
 *   Each class carries markers in all four languages, and both sides are mapped
 *   to the same pole before comparison. So English evidence reading "risks
 *   seedling loss" conflicts with a Hausa statement reading "yana da lafiya"
 *   (it is safe) without either sentence being translated. This is the main
 *   reason the contradiction check helps the multilingual gap as well.
 *
 * WHAT IS NOT DETECTED -- see docs/loam-architecture.md
 *   Single-word Yoruba negation is omitted: folding collapses "kò" (not) and
 *   "kó"/"ko" (or, that), so matching bare "ko" would reject correct Yoruba.
 *   Only unambiguous multi-word forms are used.
 */
import { fold } from '@/lib/loam/anchors'

export type Pole = 'neg' | 'pos'
export type ClassName = 'RISK' | 'ADVICE' | 'DIRECTION' | 'MAGNITUDE' | 'TIME_ORDER'

interface OppositionClass {
  name: ClassName
  /** Negation inverts this axis ("not risky" = safe). */
  flippable: boolean
  /** For TIME_ORDER, 'neg' is BEFORE and 'pos' is AFTER; labels are in `label`. */
  label: Record<Pole, string>
  markers: Record<Pole, string[]>
}

/**
 * Markers are folded before matching, so diacritics and extended Latin letters
 * do not matter. Multi-word markers are matched as phrases.
 */
const CLASSES: OppositionClass[] = [
  {
    name: 'RISK',
    flippable: true,
    label: { neg: 'risky/harmful', pos: 'safe' },
    markers: {
      neg: [
        'risk', 'risks', 'risky', 'danger', 'dangerous', 'loss', 'losses', 'lose',
        'losing', 'damage', 'damaging', 'harm', 'harmful', 'fail', 'fails', 'failure',
        'rot', 'spoil', 'spoilage', 'die', 'dies', 'death',
        // Hausa. Inflected forms are listed explicitly rather than matched by
        // prefix: Hausa takes a genitive linker (-r/-n), so \basara\b misses
        // "asarar iri" -- a correct warning about seed loss. Prefix matching
        // would fix that and break other things ('abo' would match 'about'),
        // so the forms are enumerated instead.
        'hadari', 'hadarin', 'asara', 'asarar', 'illa', 'illar',
        'lahani', 'lahanin', 'bata', 'bace',
        // Igbo
        'mfu', 'ihe egwu', 'mebie',
        // Yoruba
        'ewu', 'ipadanu', 'baje',
      ],
      pos: [
        'safe', 'safely', 'safer', 'safest', 'secure', 'protect', 'protects',
        'protected', 'harmless',
        // NOT 'no risk': it contains the negative marker 'risk', so the phrase
        // registered both poles at once and the class was skipped as ambiguous,
        // letting "there is no risk in sowing early" through. The negation
        // handling below is what inverts it, correctly.
        // Hausa, with the same genitive forms.
        'lafiya', 'lafiyar', 'aminci', 'amincin', 'kariya', 'kariyar',
        // Igbo
        'nchebe', 'enweghi nsogbu',
        // Yoruba
        'ailewu', 'abo', 'laabo',
      ],
    },
  },
  {
    name: 'ADVICE',
    flippable: true,
    label: { neg: 'discouraged', pos: 'recommended' },
    markers: {
      neg: [
        // Inflections listed explicitly, for the same reason as the Hausa
        // forms above: exact word-boundary matching means "avoided" is a
        // different token from "avoid".
        'avoid', 'avoids', 'avoided', 'avoiding', 'discouraged', 'discourage',
        'not recommended', 'not advisable', 'should not', 'must not',
        'do not', 'never', 'inadvisable',
        // Hausa
        'kada', 'kar ka', 'ka guji',
        // Igbo
        'zere', 'ekwesighi',
        // Yoruba
        'yago', 'ma se',
      ],
      pos: [
        // NOT bare 'should': "should be avoided" and "should not" both contain
        // it, so every discouragement registered as a recommendation too and
        // the class was skipped as ambiguous.
        'recommended', 'recommend', 'advisable', 'advised', 'best',
        'preferable', 'ideal',
        // Hausa
        'ya kamata', 'mafi kyau', 'shawara',
        // Igbo
        'kwesiri', 'kacha mma',
        // Yoruba
        'yẹ', 'o dara julo', 'imoran',
      ],
    },
  },
  {
    name: 'DIRECTION',
    flippable: true,
    label: { neg: 'decreases', pos: 'increases' },
    markers: {
      neg: [
        'decrease', 'decreases', 'decreasing', 'reduce', 'reduces', 'reducing',
        'reduction', 'lower', 'lowers', 'lowering', 'less', 'fewer', 'drop',
        'drops', 'decline', 'declines', 'worsen', 'worsens',
        'rage', 'raguwa', 'ragi',
        'belata', 'mbelata',
        'din ku', 'dinku',
      ],
      pos: [
        'increase', 'increases', 'increasing', 'improve', 'improves', 'improving',
        'improvement', 'raise', 'raises', 'boost', 'boosts', 'higher', 'more',
        'gain', 'gains', 'enhance', 'enhances',
        'kara', 'karuwa', 'inganta',
        'mmuba', 'kwalite',
        'pelesi', 'ilosiwaju',
      ],
    },
  },
  {
    name: 'MAGNITUDE',
    flippable: true,
    label: { neg: 'low', pos: 'high' },
    markers: {
      neg: ['low', 'lowest', 'least', 'minimum', 'minimal', 'kasa', 'ala ala', 'kekere'],
      pos: ['high', 'highest', 'most', 'maximum', 'peak', 'sama', 'elu', 'ga julo'],
    },
  },
  {
    name: 'TIME_ORDER',
    // Deliberately NOT flippable: see the module comment.
    flippable: false,
    label: { neg: 'before', pos: 'after' },
    markers: {
      neg: ['before', 'prior to', 'ahead of', 'kafin', 'tupu'],
      pos: ['after', 'following', 'bayan', 'mgbe e mesiri'],
    },
  },
]

/**
 * Negation markers. English, Hausa and Igbo only -- see the module comment on
 * why single-word Yoruba negation is omitted.
 */
const NEGATION = [
  // English
  'not', 'no', 'never', 'cannot', 'without', 'nor', 'neither',
  // Hausa. `babu` and `kada` are unambiguous; bare `ba` is not (it is also
  // "give" and a question particle), so only the "ba ... ba" frame is used.
  'babu', 'kada', 'kar ka',
  // Igbo
  'adighi', 'anaghi', 'ekwesighi', 'dighi', 'enweghi',
  // Yoruba, unambiguous multi-word forms only
  'ko si', 'kii se', 'maa se',
]

/**
 * MATCHED ON WORD BOUNDARIES, WHICH IS NOT A DETAIL.
 *
 * This was a substring check, and "Northern Guinea Savanna" contains "nor". The
 * evidence was therefore read as negated, its risk pole flipped to "safe", and
 * a statement correctly warning of seedling loss was reported as contradicting
 * it. A silent inversion of the entire contradiction check, caused by three
 * letters inside an unrelated word.
 */
function hasNegation(folded: string): boolean {
  for (const n of NEGATION) {
    const re = n.includes(' ')
      ? new RegExp(`\\b${n.replace(/\s+/g, '\\s+')}\\b`)
      : new RegExp(`\\b${n}\\b`)
    if (re.test(folded)) return true
  }
  // English contractions: isn't, won't, doesn't. No boundary before the n.
  if (/n't\b/.test(folded)) return true
  // Hausa "ba ... ba" frame: two standalone `ba` tokens in one short statement.
  const baCount = (folded.match(/\bba\b/g) ?? []).length
  return baCount >= 2
}

function polesPresent(folded: string, cls: OppositionClass): Set<Pole> {
  const out = new Set<Pole>()
  for (const pole of ['neg', 'pos'] as Pole[]) {
    for (const marker of cls.markers[pole]) {
      const m = fold(marker)
      const re = m.includes(' ')
        ? new RegExp(m.replace(/\s+/g, '\\s+'))
        : new RegExp(`\\b${m}\\b`)
      if (re.test(folded)) { out.add(pole); break }
    }
  }
  return out
}

const flip = (p: Pole): Pole => (p === 'neg' ? 'pos' : 'neg')

export interface PolarityConflict {
  class: ClassName
  statementPole: string
  evidencePole: string
  detail: string
}

/**
 * Compare a statement against the evidence that grounds it.
 *
 * TWO SPECIAL CASES AROUND TIME_ORDER, BOTH FOUND BY TESTING
 *
 *   Suppression. Evidence "sowing BEFORE the rains are established RISKS
 *   seedling loss" plus statement "sow AFTER the rains are established" is a
 *   correct restatement of the safe complement, and a plain before/after
 *   comparison rejects it. So when the evidence attaches a negative risk pole
 *   and the statement carries no risk pole at all, the time-order disagreement
 *   is taken as that complement rather than a contradiction.
 *
 *   Dropped warning. The mirror image is dangerous: the same evidence with a
 *   statement that says "sow BEFORE the rains" -- the same time pole, with the
 *   warning silently removed. Time order agrees, so nothing else would flag it.
 *   That combination is reported as a conflict, because reproducing a cautioned
 *   action while deleting the caution inverts the advice as surely as "safe"
 *   would.
 */
/**
 * Split into clauses, so a negation binds only what it governs.
 *
 * Statement-level negation was too coarse and rejected correct advice. "Do not
 * sow before the rains are established, or you risk seedling loss" carries a
 * negation and a risk marker, but the negation attaches to *sow* and the risk
 * marker sits in a different clause. Flipping the whole statement turned a
 * correct warning into an apparent claim of safety.
 */
function clauses(folded: string): string[] {
  return folded
    .split(/[,;.!?]+|\s+(?:or|but|however|although|while|whereas)\s+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
}

export function polarityConflicts(statement: string, evidenceClaim: string): PolarityConflict[] {
  const s = fold(statement)
  const e = fold(evidenceClaim)
  const eNeg = hasNegation(e)
  const conflicts: PolarityConflict[] = []

  const sRisk = polesPresent(s, CLASSES[0])
  const eRisk = polesPresent(e, CLASSES[0])
  const evidenceWarns = eRisk.has('neg') && !eNeg
  const statementSilentOnRisk = sRisk.size === 0

  for (const cls of CLASSES) {
    const ePoles = polesPresent(e, cls)
    if (!ePoles.size) continue

    /**
     * The statement's effective pole, computed per clause and then unioned.
     * A clause contributes its markers flipped by ITS OWN negation, which is
     * what keeps "do not sow ... or you risk loss" reading as a warning rather
     * than as a claim of safety.
     */
    const sEff = new Set<Pole>()
    for (const clause of clauses(s)) {
      const poles = polesPresent(clause, cls)
      if (!poles.size) continue
      const negated = cls.flippable && hasNegation(clause)
      for (const pole of poles) sEff.add(negated ? flip(pole) : pole)
    }
    // The rule that keeps this quiet: both sides must have spoken about this axis.
    if (!sEff.size) continue

    const eEff = cls.flippable && eNeg ? new Set([...ePoles].map(flip)) : ePoles

    // Either side genuinely carrying both poles is ambiguous, not contradictory.
    if (sEff.size > 1 || eEff.size > 1) continue
    const sp = [...sEff][0]
    const ep = [...eEff][0]
    if (sp === ep) continue

    if (cls.name === 'TIME_ORDER' && evidenceWarns && statementSilentOnRisk) {
      // The safe complement, not a contradiction. See the doc comment.
      continue
    }
    conflicts.push({
      class: cls.name,
      statementPole: cls.label[sp],
      evidencePole: cls.label[ep],
      detail: `evidence says ${cls.label[ep]}, statement says ${cls.label[sp]}`,
    })
  }

  // The dropped-warning case: same cautioned action, caution removed.
  if (evidenceWarns && statementSilentOnRisk) {
    const sTime = polesPresent(s, CLASSES[4])
    const eTime = polesPresent(e, CLASSES[4])
    if (sTime.size === 1 && eTime.size === 1 && [...sTime][0] === [...eTime][0]) {
      conflicts.push({
        class: 'RISK',
        statementPole: 'no caution',
        evidencePole: 'risky/harmful',
        detail: 'the statement repeats the cautioned action but drops the evidence\'s warning',
      })
    }
  }
  return conflicts
}
