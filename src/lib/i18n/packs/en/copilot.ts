/**
 * Co-pilot interface chrome.
 *
 * IMPORTANT BOUNDARY
 *   These are the LABELS around the assistant: the launcher, the input, the
 *   disclaimers. They are translated into all five languages.
 *
 *   The assistant's ANSWERS are not here. Those come from the deterministic
 *   phrase registry in src/lib/copilot/i18n/registry.ts and from
 *   copilot_concepts rows, which exist in English and Hausa only. There is no
 *   configured model provider that could produce reliable Igbo, Yoruba or
 *   French answers, so the platform does not claim them. A member on Igbo gets
 *   an Igbo interface and an English answer, and the UI says so rather than
 *   pretending otherwise.
 */
export const copilot = {
  'copilot.name': 'Loam',
  'copilot.open': 'Ask Loam',
  'copilot.openAria': 'Open Loam, the Loamy assistant',
  'copilot.close': 'Close',
  'copilot.placeholder': 'Ask about prices, verification or financing',
  'copilot.send': 'Send',
  'copilot.thinking': 'Looking that up…',
  'copilot.greeting': 'Ask me about market prices, verification or how financing works.',
  'copilot.capabilities': 'I can check current prices, explain verification and walk you through financing.',
  'copilot.noAnswer': 'I do not have reliable data for that yet.',
  'copilot.dataAsOf': 'Data as of {date}',
  'copilot.sources': 'Sources',
  'copilot.notAdvice': 'Loam reports recorded data. It does not give financial advice or predict prices.',
  'copilot.toggleLanguage': 'Toggle language',

  /** Shown when the UI language has no assistant coverage. */
  'copilot.answersInEnglish': 'Loam answers in English and Hausa for now. Your interface stays in {language}.',
} as const
