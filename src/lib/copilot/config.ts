/**
 * Co-pilot provider configuration (pluggable adapter seams).
 *
 * SECURITY-REVIEW: LLM / STT provider integration. In production the model and
 * speech-to-text calls MUST be proxied through a backend / Supabase Edge
 * Function so the API key never reaches the browser. These VITE_ placeholders
 * exist only so the backend engineer has a clear seam to wire; the frontend
 * ships with NO provider configured and falls back to the deterministic
 * template phraser (which cannot invent facts) and to text input (no STT).
 */

const llmKey = import.meta.env.VITE_COPILOT_LLM_API_KEY as string | undefined
const llmModel = import.meta.env.VITE_COPILOT_LLM_MODEL as string | undefined
const sttKey = import.meta.env.VITE_COPILOT_STT_API_KEY as string | undefined

const isReal = (v?: string) => Boolean(v && !v.includes('YOUR_'))

export const copilotConfig = {
  // TODO: API KEY — LLM provider (backend-proxied). Phrasing only; never a source of facts.
  llm: { apiKey: llmKey, model: llmModel, configured: isReal(llmKey) },
  // TODO: API KEY — speech-to-text provider (backend-proxied).
  stt: { apiKey: sttKey, configured: isReal(sttKey) },
}
