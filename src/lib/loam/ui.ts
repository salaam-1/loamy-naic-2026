/**
 * Loam's product language.
 *
 * WHY THIS FILE EXISTS
 *   The engine thinks in L1/L2/L3/L4, grounding scores, anchors and polarity.
 *   None of that belongs in front of a farmer. This module is the single place
 *   where internal state becomes product copy, which means the component never
 *   imports an internal label and a reviewer can read every user-facing string
 *   in one file.
 *
 *   A test asserts the component does not import EVIDENCE_LABEL or render the
 *   internal vocabulary, so the separation cannot erode quietly.
 *
 * TONE
 *   Subtle. The answer is the thing the user came for; provenance is a short
 *   line underneath it, not a banner. A farmer should be able to tell at a
 *   glance whether Loam is reading their own records or offering general
 *   guidance, without being taught a taxonomy.
 */
import type { EvidenceLevel, LoamLanguage, RefusalKind } from '@/lib/loam/types'

/**
 * What Loam is doing, in product terms.
 *
 * `policy` is separate from `unverified` on purpose. "I will not forecast a
 * price" and "I have nothing to answer from" are different statements about
 * Loam, and collapsing them made a deliberate refusal look like ignorance.
 */
export type EvidenceTone = 'loamy' | 'guidance' | 'reasoned' | 'unverified' | 'policy'

type Copy = Partial<Record<LoamLanguage, string>> & { en: string }

/** Tone for a response. A refusal wins over the evidence level. */
export function evidenceTone(
  level: EvidenceLevel,
  declined: boolean,
  refusal?: RefusalKind,
): EvidenceTone {
  if (declined) return refusal === 'policy' ? 'policy' : 'unverified'
  if (level === 1) return 'loamy'
  if (level === 2) return 'guidance'
  if (level === 3) return 'reasoned'
  return 'unverified'
}

/**
 * The short line under an answer.
 *
 * Hausa is authored; Igbo and Yoruba fall back to English, deliberately and
 * visibly, until a speaker has checked them. Igbo and Yoruba are supported by
 * the engine but are not the centrepiece of this UX yet.
 */
export const TONE_COPY: Record<EvidenceTone, Copy> = {
  loamy: {
    en: 'From your Loamy data',
    ha: 'Daga bayanan Loamy naka',
  },
  guidance: {
    en: 'Agricultural guidance',
    ha: 'Shawarar noma',
  },
  /**
   * The general lane.
   *
   * "Based on available information" was written when Level 3 only ever
   * appeared alongside evidence, and it now reads as though Loam consulted
   * records it never had. The distinction the hierarchy exists to protect is
   * exactly this one, so the chip states it: this came from the model, not
   * from Loamy.
   *
   * TRANSLATION: the Hausa below needs a speaker's review, as the Igbo and
   * Yoruba packs already do. The English is authoritative meanwhile.
   */
  reasoned: {
    en: 'General knowledge, not a Loamy record',
    ha: 'Bayanin gama-gari, ba tarihin Loamy ba',
  },
  unverified: {
    en: 'Not enough verified information',
    ha: 'Babu isassun bayanan da aka tabbatar',
  },
  // A capability boundary, not a gap. Phrased so a farmer reads it as "Loam
  // doesn't do that" rather than "Loam doesn't know".
  policy: {
    en: 'Not something Loam provides',
    ha: 'Ba abin da Loam ke yi ba',
  },
}

export const UI_COPY = {
  title: { en: 'Loam', ha: 'Loam' },
  subtitle: {
    en: 'Agricultural copilot',
    ha: 'Mataimakin noma',
  },
  openLabel: {
    en: 'Open Loam, your agricultural copilot',
    ha: 'Bude Loam, mataimakin noma',
  },
  /**
   * The language control. Hausa is translated; Igbo and Yoruba fall back to
   * English through `ui()` rather than being guessed here.
   */
  languageLabel: {
    en: 'Answer language',
    ha: 'Harshen amsa',
  },
  composerLabel: {
    en: 'Ask Loam a question',
    ha: 'Tambayi Loam',
  },
  placeholder: {
    en: 'Ask about your farm, a crop, or the market…',
    ha: 'Tambaya game da gonarka, amfanin gona, ko kasuwa…',
  },
  /**
   * Shown once per session. States what Loam answers from and what it will not
   * do, because a farmer deciding whether to act on an answer needs both.
   *
   * It says the guidance is pending expert review. The knowledge pack has not
   * been checked by an agronomist, and presenting it as validated Loamy
   * guidance would be the one claim this project must not make.
   */
  disclaimer: {
    en: 'Loam answers from your own Loamy records and from agricultural guidance that is '
      + 'still pending expert review. It tells you when it does not have enough verified '
      + 'information, and it does not predict future prices.',
    ha: 'Loam yana amsa daga bayanan Loamy naka da kuma shawarar noma wacce har yanzu tana '
      + 'jiran bitar masani. Yana gaya maka idan ba shi da isassun bayanan da aka tabbatar, '
      + 'kuma ba ya hasashen farashin nan gaba.',
  },
  welcome: {
    en: 'Ask me about your farm, your crops, or growing in Nigeria.',
    ha: 'Tambaye ni game da gonarka, amfanin gonarka, ko noma a Najeriya.',
  },
  /** Primary processing line. The elapsed seconds are appended by the caller. */
  thinking: {
    en: 'Loam is thinking',
    ha: 'Loam yana tunani',
  },
  /**
   * Why it takes as long as it does.
   *
   * N-ATLaS runs on CPU at 2.5-3 tokens a second on the development machine, so
   * an answer takes 30-100 seconds. Naming the model and saying it runs locally
   * turns a suspicious pause into a visible fact -- and it is the fact the NAIC
   * demo wants on screen. The inference URL and model configuration stay on the
   * server; the model's NAME is a product detail, not a secret.
   */
  thinkingNote: {
    en: 'Running N-ATLaS on this device. This can take up to a minute.',
    ha: 'Ana amfani da N-ATLaS a wannan na’urar. Yana iya daukar har minti daya.',
  },
  reasoningLabel: {
    en: 'Loam’s own thinking, not from records',
    ha: 'Tunanin Loam, ba daga bayanan da aka rubuta ba',
  },
  unreachable: {
    en: 'Loam could not be reached. Please try again.',
    ha: 'Ba a sami Loam ba. Da fatan za a sake gwadawa.',
  },
} as const

export type UiKey = keyof typeof UI_COPY

/**
 * Prompts for the empty state, falling back to English.
 *
 * Igbo and Yoruba are deliberately absent rather than guessed. `ui()` and
 * `phrase()` already fall back the same way, and the reason is the one this
 * codebase keeps returning to: a farmer-facing sentence written in a language
 * nobody on the team speaks is how a system ends up saying something it did
 * not mean. The ANSWER still arrives in Igbo or Yoruba -- that comes from the
 * model, not from this table.
 */
export function suggestedPrompts(language: LoamLanguage): string[] {
  return SUGGESTED_PROMPTS[language] ?? SUGGESTED_PROMPTS.en
}

export function ui(key: UiKey, language: LoamLanguage): string {
  const entry = UI_COPY[key] as Copy
  return entry[language] ?? entry.en
}

export function tone(t: EvidenceTone, language: LoamLanguage): string {
  return TONE_COPY[t][language] ?? TONE_COPY[t].en
}

/**
 * Suggested prompts for the empty state.
 *
 * Chosen to show the four things that make Loam more than a chatbot, in the
 * order the NAIC story tells them: general agronomy, location-specific
 * guidance, the member's own records, and a question Loam will decline.
 * English and Hausa only -- Igbo and Yoruba are supported underneath but are
 * not promoted in the UX until a speaker has validated the copy.
 */
export const SUGGESTED_PROMPTS: Partial<Record<LoamLanguage, string[]>> & { en: string[] } = {
  en: [
    'When should I plant maize in Kaduna?',
    'Why does crop rotation matter?',
    "What's on my farm?",
    'Is my maize ready to harvest?',
  ],
  ha: [
    'Yaushe zan shuka masara a jihar Kaduna?',
    'Me ya sa juya amfanin gona ke da muhimmanci?',
    'Me ke gonata?',
    'Yaya ake ajiye hatsi?',
  ],
}

/**
 * Turn an internal evidence source string into something a farmer can read.
 *
 * The knowledge pack's attribution carries "PENDING AGRONOMIST REVIEW" so the
 * status can never be lost between the data and the screen. That phrasing is
 * for engineers; this converts it to plain words without dropping the caveat,
 * which is the part that matters.
 */
export function describeSource(source: string, language: LoamLanguage): string {
  if (source.includes('PENDING AGRONOMIST REVIEW')) {
    return language === 'ha'
      ? 'Shawarar noma (tana jiran bitar masani)'
      : 'Agricultural guidance (pending expert review)'
  }
  if (source.toLowerCase().includes('loamy')) {
    return language === 'ha' ? 'Bayanan Loamy naka' : 'Your Loamy records'
  }
  return source
}
