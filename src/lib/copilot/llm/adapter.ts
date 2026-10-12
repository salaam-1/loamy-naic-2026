import type { CopilotLanguage } from '@/lib/copilot/types'
import { copilotConfig } from '@/lib/copilot/config'

/**
 * LLM adapter seam. The language model's ONLY job is to phrase an answer more
 * naturally FROM the retrieved facts — it must never add information from model
 * knowledge, never predict a price, never give advice. The deterministic
 * phrasing (built from rows) is always passed in and is the safe fallback.
 */
export interface PhrasingRequest {
  language: CopilotLanguage
  /** The deterministic, data-derived answer text. Safe to return as-is. */
  deterministic: string
  /** Structured facts (already extracted from rows) a provider may rephrase. */
  facts: Record<string, unknown>
}

export interface LlmAdapter {
  readonly name: string
  phrase(req: PhrasingRequest): Promise<string>
}

/**
 * Default adapter — NO provider. Returns the deterministic phrasing unchanged,
 * which guarantees "answers only from data". Always available, needs no key.
 */
export const templatePhraser: LlmAdapter = {
  name: 'template',
  async phrase(req) {
    return req.deterministic
  },
}

/**
 * SECURITY-REVIEW: LLM provider integration. A real provider plugs in here,
 * proxied through a backend. It MUST be constrained to `facts` with a strict
 * system prompt ("answer ONLY from the provided rows; if the rows do not
 * contain the answer, say so; never predict a future price; never give
 * financial advice") and MUST fall back to the deterministic text on any error
 * or low-confidence response. Left unimplemented on purpose in v1.
 */
class ProviderLlmAdapter implements LlmAdapter {
  readonly name = 'provider'
  async phrase(req: PhrasingRequest): Promise<string> {
    // TODO: API KEY — wire the backend-proxied provider call here.
    // Until implemented we never risk inventing: return the deterministic text.
    return req.deterministic
  }
}

export function getLlmAdapter(): LlmAdapter {
  return copilotConfig.llm.configured ? new ProviderLlmAdapter() : templatePhraser
}
