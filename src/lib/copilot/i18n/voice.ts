import type { CopilotLanguage } from '@/lib/copilot/types'
import { getDialect, type FixedPhraseKey } from '@/lib/copilot/i18n/registry'

/**
 * Voice output, v1: pre-recorded clips from a SINGLE Kano voice actor for FIXED
 * phrases only. No synthetic TTS. Where no clip exists we fall back to text.
 *
 * To add a clip: record the fixed phrase, drop the file at
 *   public/audio/copilot/<dialect-code>/<phrase-key>.mp3
 * and set its key to `true` in VOICE_CLIPS below. Nothing else changes — the
 * player and UI pick it up automatically. See public/audio/copilot/RECORDING-BRIEF.md.
 */

/** Which fixed phrases currently HAVE a recorded clip, per dialect code. Empty
 * until the voice actor's clips are added — the UI shows no speaker until then. */
export const VOICE_CLIPS: Record<string, Partial<Record<FixedPhraseKey, boolean>>> = {
  'ha-KAN': {
    // welcome: true,            // ← flip to true once the recording is added
    // clarify_commodity: true,
    // capabilities: true,
    // market_update_none: true,
  },
  en: {},
}

/** URL of a recorded clip for a fixed phrase, or null if none exists yet. */
export function clipUrl(lang: CopilotLanguage, key: FixedPhraseKey): string | null {
  const code = getDialect(lang).code
  return VOICE_CLIPS[code]?.[key] ? `/audio/copilot/${code}/${key}.mp3` : null
}

/** Play a clip URL. Best-effort — audio autoplay may be blocked until a gesture. */
export function playClip(url: string): void {
  try {
    void new Audio(url).play()
  } catch {
    /* non-fatal — the text is always shown regardless */
  }
}
