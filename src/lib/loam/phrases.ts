/**
 * Deterministic phrases.
 *
 * Every sentence Loam says WITHOUT the model comes from here: the refusals, the
 * declines, the model-down notice and the guard fallback. They are fixed text
 * rather than generated text precisely because they are the sentences that must
 * be exactly right — a decline that drifted into a guess would defeat the whole
 * design.
 *
 * Phase 1 covers English and Hausa, matching the existing Co-pilot shell. Igbo,
 * Yoruba and French are Phase 8; note that N-ATLaS covers en/ha/ig/yo but NOT
 * French, so French needs a decided fallback rather than an assumption.
 */
import type { LoamLanguage } from '@/lib/loam/types'

export type PhraseKey =
  | 'greeting'
  | 'courtesy'
  | 'goodbye'
  | 'capability'
  | 'reasoningLabel'
  | 'noEvidence'
  | 'noEvidencePersonal'
  | 'forecastRefused'
  | 'forecastHasData'
  | 'forecastNoData'
  | 'modelUnavailable'
  | 'guardFallbackPrefix'
  | 'evidenceIntro'
  | 'reviewNote'

/**
 * English is required; the others are optional and fall back to it.
 *
 * Hausa is authored. Igbo and Yoruba are not: writing a farmer-facing refusal
 * in a language nobody on the team speaks is how a system ends up saying
 * something it did not mean. `phrase()` falls back to English for them, which
 * is visibly incomplete rather than quietly wrong.
 */
type PhraseSet = Partial<Record<LoamLanguage, string>> & { en: string }

export const PHRASES: Record<PhraseKey, PhraseSet> = {
  /**
   * Social replies. Deterministic, and never routed through N-ATLaS.
   *
   * A greeting is not a query with no evidence; it is a greeting. Sending it
   * to the model would cost 30-100 seconds and invite it to invent a
   * capability list, which is precisely what the evidence architecture exists
   * to prevent.
   */
  greeting: {
    en: 'Hello, and welcome to Loamy. I am Loam, your agricultural copilot.\n\n'
      + 'I can help with growing decisions, recorded market prices, and your own farm '
      + 'records on Loamy.\n\nWhat are you working on today?',
    ha: 'Sannu, maraba da zuwa Loamy. Ni ne Loam, mataimakin noma naka.\n\n'
      + 'Zan iya taimaka da shawarar noma, farashin kasuwa da aka rubuta, da bayanan '
      + 'gonarka a Loamy.\n\nMe kake aiki a kai yau?',
  },
  courtesy: {
    en: 'You are welcome. Ask me whenever you need something about your farm or the market.',
    ha: 'Babu komai. Ka tambaye ni duk lokacin da kake bukatar wani abu game da gonarka ko kasuwa.',
  },
  goodbye: {
    en: 'Goodbye, and good luck with the work. I am here whenever you need me.',
    ha: 'Sai anjima, Allah ya sa aiki ya yi kyau. Ina nan duk lokacin da kake bukata.',
  },
  /**
   * CAPABILITIES ACTUALLY IMPLEMENTED, AND NOTHING ELSE.
   *
   * Weather, selling, logistics, disease detection and alerts are all absent
   * on purpose. `weather_observations` has rows but no Loam reader; the
   * selling and logistics flows exist only in the legacy engine. Advertising
   * them here would be the assistant hallucinating about itself -- the one
   * kind of invention the evidence guard cannot catch, because it is not a
   * claim about the world.
   */
  capability: {
    en: 'I am Loam, the agricultural copilot inside Loamy. Three things I can do today:\n\n'
      + '• Answer growing questions, such as when to plant a crop in your area\n'
      + '• Show market prices that have actually been recorded on Loamy\n'
      + '• Tell you what is on your own farm, from your Loamy records\n\n'
      + 'I answer from recorded data and reviewed guidance. When I do not have either, '
      + 'I say so rather than guessing, and I do not predict future prices.',
    ha: 'Ni ne Loam, mataimakin noma a cikin Loamy. Abubuwa uku da zan iya yi yau:\n\n'
      + '• Amsa tambayoyin noma, kamar lokacin da za a shuka amfanin gona a yankinka\n'
      + '• Nuna farashin kasuwa da aka rubuta a Loamy\n'
      + '• Fada maka abin da ke gonarka, daga bayanan Loamy naka\n\n'
      + 'Ina amsa daga bayanan da aka rubuta da shawarwarin da aka duba. Idan ba ni da '
      + 'ko daya, zan fadi haka maimakon yin tsammani, kuma ba na hasashen farashin nan gaba.',
  },
  // Heads the section where the model's own reasoning is shown. The wording
  // has to make the status unmistakable: this is Loam thinking, not a record.
  reasoningLabel: {
    en: "Loam's own reasoning, not from records:",
    ha: 'Tunanin Loam, ba daga bayanan da aka rubuta ba:',
  },
  // No Level 1 or Level 2 backing for a specific question. Says what is
  // missing and what would answer it, rather than apologising vaguely.
  noEvidence: {
    en: 'I do not have recorded information to answer that reliably, so I will not guess. '
      + 'Loam answers specific questions only from Loamy records or from reviewed agricultural guidance, and neither covers this yet.',
    ha: 'Ba ni da bayanan da aka rubuta don amsa wannan daidai, don haka ba zan yi tsammani ba. '
      + 'Loam yana amsa takamaiman tambayoyi daga bayanan Loamy ko shawarwarin noma da aka duba kawai, kuma babu ɗayansu da ya rufe wannan tukuna.',
  },
  noEvidencePersonal: {
    en: 'I cannot find records of your own on Loamy for that. If you have not added them yet, '
      + 'adding your farm and crop records will let me answer questions about them.',
    ha: 'Ban sami bayanan ka a Loamy game da wannan ba. Idan ba ka ƙara su ba tukuna, '
      + 'ƙara gonarka da bayanan amfanin gona zai sa in iya amsa tambayoyi game da su.',
  },
  /**
   * Loamy's institutional position, said as a boundary rather than a failure.
   *
   * Split into three parts so the response only promises what it can deliver:
   * the refusal always, then EITHER the recorded prices OR an honest statement
   * that none are recorded. It used to say "what I can show you is what has
   * actually been recorded" unconditionally, which on staging was followed by
   * nothing at all.
   */
  forecastRefused: {
    en: 'Future price forecasts are not something Loam provides. Loamy does not predict prices, '
      + 'so I will not put a number on what maize will cost later.',
    ha: 'Hasashen farashin nan gaba ba abin da Loam ke yi ba ne. Loamy ba ya hasashen farashi, '
      + 'don haka ba zan faɗi adadin da masara za ta kai nan gaba ba.',
  },
  forecastHasData: {
    en: 'What I can show you is what has actually been recorded:',
    ha: 'Abin da zan iya nuna maka shi ne abin da aka rubuta a zahiri:',
  },
  forecastNoData: {
    en: 'I do not have recorded prices for that to show you either, so there is nothing here I can '
      + 'stand behind.',
    ha: 'Haka kuma ba ni da farashin da aka rubuta don nuna maka, don haka babu abin da zan iya '
      + 'tabbatarwa a nan.',
  },
  modelUnavailable: {
    en: 'The language model is not available right now, so I can only show you the recorded information below.',
    ha: 'Samfurin harshe ba ya aiki a yanzu, don haka zan iya nuna maka bayanan da aka rubuta a ƙasa kawai.',
  },
  guardFallbackPrefix: {
    en: 'I am showing the recorded information directly, because my drafted answer went beyond what the records support.',
    ha: 'Ina nuna bayanan da aka rubuta kai tsaye, saboda amsar da na tsara ta wuce abin da bayanan ke tallafawa.',
  },
  evidenceIntro: {
    en: 'What the records show:',
    ha: 'Abin da bayanan ke nunawa:',
  },
  reviewNote: {
    en: 'Agricultural guidance in this answer is pending agronomist review.',
    ha: 'Shawarar noma a cikin wannan amsa na jiran bitar masanin noma.',
  },
}

export function phrase(key: PhraseKey, language: LoamLanguage): string {
  return PHRASES[key][language] ?? PHRASES[key].en
}
