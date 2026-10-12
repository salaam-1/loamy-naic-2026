/**
 * The conversational pre-router.
 *
 * THE BUG THIS FIXES
 *   A new member opened Loam, typed "Hi", and got "I do not have recorded
 *   information to answer that reliably, so I will not guess." Technically
 *   consistent -- there is no evidence for "Hi" -- and completely wrong as a
 *   product. A greeting is not a failed query; treating it as one makes the
 *   assistant feel broken on the very first turn.
 *
 *   The fault was routing, not N-ATLaS. "Hi" fell through classification to
 *   `specific`, found no evidence, and hit the decline. It never should have
 *   reached the evidence pipeline at all.
 *
 * WHAT THIS IS NOT
 *   Not a chat fallback, and not a widening of what Loam will answer. It
 *   recognises four closed sets of social phrases and returns fixed text. No
 *   model, no evidence, no inference. Anything it does not recognise falls
 *   through to the existing pipeline completely unchanged, which is why this
 *   cannot weaken the evidence architecture: it only ever removes turns that
 *   were going to be declined anyway.
 *
 * THE HARD PART: SOCIAL-ONLY vs SOCIAL + REQUEST
 *   "Hi" is a greeting. "Hi, what's the price of maize in Kano?" is a market
 *   question with a greeting stuck on the front, and answering it with a
 *   welcome message would be worse than the bug being fixed.
 *
 *   So matching a social phrase is necessary but not sufficient. The phrase is
 *   removed, along with vocatives and politeness filler, and whatever remains
 *   must be empty. If anything substantive is left, the message is a request
 *   and goes to the pipeline untouched.
 */
import { fold } from '@/lib/loam/anchors'

export type SocialKind = 'greeting' | 'courtesy' | 'goodbye' | 'capability'

/**
 * Phrases, longest first within each kind so "good morning" is matched before
 * "good" could ever be, and "thank you" before "thanks".
 *
 * Hausa is included because it is a demo language and "sannu" deserves the
 * same welcome as "hi". Igbo and Yoruba greetings are deliberately absent:
 * guessing at them is how a system greets someone incorrectly in their own
 * language, which is worse than falling through to English.
 */
const PHRASES: Record<SocialKind, string[]> = {
  capability: [
    'what can you help me with', 'what can you do for me', 'tell me what you can do',
    'what are you able to do', 'what can you help with', 'how can you help me',
    'what can you do', 'how can you help', 'what do you do', 'who are you',
    'what is loam', 'what are you', 'help me', 'help',
    // Hausa
    'me kake iya yi', 'yaya za ka taimake ni', 'wane taimako',
  ],
  greeting: [
    'good afternoon', 'good evening', 'good morning', 'good day',
    'ina kwana', 'ina wuni', 'ina yini',
    'hello', 'hiya', 'howdy', 'greetings', 'salam', 'sannu', 'barka',
    'hey', 'hi',
  ],
  courtesy: [
    'thank you very much', 'thanks a lot', 'much appreciated', 'appreciate it',
    'thank you', 'thanks', 'cheers', 'na gode', 'nagode',
  ],
  goodbye: [
    'talk to you later', 'speak to you later', 'see you later', 'see you',
    'goodbye', 'good bye', 'sai an jima', 'sai anjima', 'bye',
  ],
}

/**
 * Words that carry no request: vocatives, politeness, acknowledgement.
 *
 * Kept deliberately short. Every word added here widens what counts as
 * "social only", and a word added carelessly -- "price", say -- would route a
 * real question into a greeting.
 */
const FILLER = new Set([
  // Vocatives and politeness.
  'loam', 'loamy', 'there', 'please', 'pls', 'ok', 'okay', 'kay',
  'so', 'well', 'hmm', 'oh', 'ah', 'yo', 'dear', 'sir', 'madam',
  'you', 'u', 'again', 'now', 'today', 'friend', 'team', 'everyone', 'all',
  'very', 'much', 'lot', 'and', 'a', 'the', 'my', 'me', 'to', 'for', 'is', 'it',
  'good', 'nice', 'great',
  /**
   * Greetings and thanks are filler TOO, not only phrases.
   *
   * "Hi, what can you do?" must reach the capability answer. The capability
   * phrase is matched and removed, and the leftover "hi" has to count as
   * nothing or the whole message falls through to the evidence pipeline and
   * gets declined -- the original bug, one layer deeper.
   */
  'hi', 'hello', 'hey', 'hiya', 'sannu', 'barka', 'greetings',
  'thanks', 'thank', 'cheers', 'bye', 'goodbye',
  'morning', 'afternoon', 'evening',
])

/** Order matters: the most specific kind is tried first. */
const ORDER: SocialKind[] = ['capability', 'goodbye', 'courtesy', 'greeting']

export interface SocialMatch {
  kind: SocialKind
  /** The phrase that matched, for logging and tests. */
  matched: string
}

/**
 * Is this message purely social, and if so which kind?
 *
 * Returns null for anything carrying an actual request, which is the common
 * case and the safe default.
 */
export function detectSocial(message: string): SocialMatch | null {
  // Fold diacritics, drop punctuation and emoji, collapse whitespace.
  const text = fold(message)
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return null

  for (const kind of ORDER) {
    for (const phrase of PHRASES[kind]) {
      // Word-boundary match, so "hi" does not fire inside "this" and "help"
      // does not fire inside "helpful".
      const re = new RegExp(`(^|\\s)${phrase.replace(/\s+/g, '\\s+')}(\\s|$)`)
      if (!re.test(text)) continue

      // Remove the phrase, then judge what is left over.
      const rest = text.replace(re, ' ').trim()
      const leftover = rest.split(/\s+/).filter((w) => w && !FILLER.has(w))
      if (leftover.length === 0) return { kind, matched: phrase }

      /**
       * Something substantive remains, so this is a request with a
       * pleasantry attached. Stop looking: trying other kinds would only
       * find a shorter phrase inside the same sentence and reach the same
       * conclusion more slowly.
       */
      return null
    }
  }
  return null
}
