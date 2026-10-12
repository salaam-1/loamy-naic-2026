import type { CopilotLanguage } from '@/lib/copilot/types'
import { copilotConfig } from '@/lib/copilot/config'

/** Speech-to-text adapter seam. Placeholder in v1 — the UI falls back to text. */
export interface Transcript {
  text: string
  language: CopilotLanguage
}

export interface SttAdapter {
  /** When false, the mic UI is shown disabled with a "type instead" hint. */
  readonly available: boolean
  transcribe(audio: Blob, language: CopilotLanguage): Promise<Transcript>
}

/**
 * SECURITY-REVIEW: STT provider integration. Same rule as the LLM adapter —
 * proxy through a backend so the key never ships to the browser. Not wired in v1.
 */
class ProviderSttAdapter implements SttAdapter {
  readonly available = true
  async transcribe(_audio: Blob, _language: CopilotLanguage): Promise<Transcript> {
    // TODO: API KEY — wire the backend-proxied speech-to-text provider here.
    throw new Error('copilot_stt_not_configured')
  }
}

class NullSttAdapter implements SttAdapter {
  readonly available = false
  async transcribe(): Promise<Transcript> {
    throw new Error('copilot_stt_not_configured')
  }
}

export function getSttAdapter(): SttAdapter {
  return copilotConfig.stt.configured ? new ProviderSttAdapter() : new NullSttAdapter()
}
