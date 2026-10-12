/**
 * The model seam. Loam talks to this; nothing else knows N-ATLaS exists.
 *
 * WHY THIS IS AN INTERFACE AND NOT A FUNCTION
 *   The laptop that runs Phase 0 at 2.5-3.0 tok/s is not the production host.
 *   When the model moves to a GPU box or a hosted endpoint, the only thing that
 *   should change is LOAM_INFERENCE_URL. Keeping the host behind one small
 *   interface is what makes that a configuration change rather than a rewrite.
 *
 * WHY THE CONFIG IS NOT VITE_-PREFIXED
 *   A VITE_ variable is compiled into the browser bundle and served to every
 *   visitor. The existing Co-pilot seam did exactly that with
 *   VITE_COPILOT_LLM_API_KEY, and its own comment admits a browser-exposed key
 *   is wrong. Loam's inference config is read only in Node (the dev
 *   middleware) or Deno (the Edge Function), never in the browser.
 */

export interface GenerateRequest {
  system: string
  user: string
  /** Hard cap on output length. Short answers at 3 tok/s stay watchable. */
  maxTokens?: number
  temperature?: number
  /** Abort if the model has produced nothing by this deadline. */
  timeoutMs?: number
  /**
   * Caller cancellation -- a member navigating away, or starting a new turn.
   *
   * Distinct from `timeoutMs` on purpose: a timeout is the host failing to
   * answer, a cancellation is a person deciding they no longer want the
   * answer, and conflating them reports one as the other. An adapter
   * combines this with its own deadline.
   */
  signal?: AbortSignal
  /**
   * Tokens as they arrive, for a host that streams.
   *
   * AN EXTENSION POINT, NOT A RENDER PATH
   *   Nothing in Loam passes this today and nothing may render what it
   *   yields. `guardStructured` has to inspect the WHOLE answer before any of
   *   it reaches a member: it drops ungrounded statements, and on the general
   *   lane `guardGeneral` withholds the entire answer when a price or a
   *   platform claim appears. A token shown as it arrives is a token shown
   *   before either check has run, and retracting a sentence already on
   *   screen is worse than waiting for it.
   *
   *   So this exists to prove the seam fits -- streaming is verified working
   *   on the local host, 9 NDJSON frames with a first token at 3.9s -- and
   *   its only legitimate use before the guard can run incrementally is a
   *   progress indicator that displays no model text. A test asserts the
   *   orchestrator does not pass it.
   */
  onToken?: (token: string) => void
}

/**
 * What a host can actually do, as declared by the host rather than assumed.
 *
 *   text       generate a completion. Every adapter has this.
 *   streaming  emit tokens as they are produced.
 *   tools      accept function definitions and emit a call.
 *   json       constrain output to a JSON schema.
 *
 * WHY THIS IS DECLARED AND NOT INFERRED
 *   Ollama reports its own capabilities (`['tools','completion']` for
 *   natlas-q4km), and a hosted OpenAI-compatible provider may support a
 *   different set for the same weights. Guessing from the model name is how a
 *   caller ends up sending a JSON schema to a host that ignores it and then
 *   trusting the unvalidated result.
 */
export type ModelCapability = 'text' | 'streaming' | 'tools' | 'json'

export interface GenerateResult {
  text: string
  /** Inference wall time, so latency is measured rather than assumed. */
  ms: number
  /** Tokens the model produced, when the host reports them. */
  outputTokens?: number | null
  model: string
}

/**
 * The caller cancelled. NOT a provider failure.
 *
 * Separate from `ModelUnavailable` so a UI can stay silent about a turn the
 * member abandoned, instead of reporting an error nobody caused.
 */
export class ModelCancelled extends Error {
  constructor(message = 'the request was cancelled') {
    super(message)
    this.name = 'ModelCancelled'
  }
}

export class ModelUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelUnavailable'
  }
}

export interface ModelAdapter {
  readonly name: string
  /**
   * What this host can do. OPTIONAL on purpose: an adapter written before
   * this existed, or a test double, stays valid and is read as text-only.
   * Use `adapterCapabilities()` rather than reading it directly.
   */
  readonly capabilities?: readonly ModelCapability[]
  /** Cheap liveness probe, so the UI can show a model-down state honestly. */
  available(): Promise<boolean>
  generate(req: GenerateRequest): Promise<GenerateResult>
}

/**
 * An adapter's capabilities, defaulting to text-only.
 *
 * Every adapter can generate text -- that is what makes it an adapter -- so
 * an absent declaration means "text and nothing claimed", never "nothing".
 */
export function adapterCapabilities(adapter: ModelAdapter): readonly ModelCapability[] {
  return adapter.capabilities ?? ['text']
}

/** Whether a host has declared a capability. */
export function adapterSupports(adapter: ModelAdapter, c: ModelCapability): boolean {
  return adapterCapabilities(adapter).includes(c)
}

/**
 * How long Ollama keeps the weights resident after a request.
 *
 * Phase 0 measured a 17.3s cold load and a 25s first-token latency against
 * 4-7s warm. Ollama's default idle eviction is about five minutes, which is
 * easily exceeded between demo questions -- so the first question after a pause
 * pays the cold load again. Holding the model for half an hour removes that
 * from the demo without touching quantization or the model itself.
 */
export const KEEP_ALIVE = '30m'

/**
 * How long to wait for a complete answer before giving up.
 *
 * This was 120s, and a live Hausa run took 120.4s: the request was aborted a
 * fraction after the model would have finished, Loam reported the model as
 * unavailable, and the member got a fallback instead of the answer that was
 * almost ready. Hausa, Igbo and Yoruba generate noticeably more tokens than
 * English for the same question, and at 2.5-3 tok/s that difference is tens of
 * seconds.
 *
 * Aborting early does not make Loam safer -- the guard runs on whatever comes
 * back either way -- it only converts a slow answer into no answer. The ceiling
 * is therefore set above the slowest measured response, and
 * src/lib/loam/transport.ts allows longer still so the browser is never the
 * thing that gives up first.
 */
export const INFERENCE_TIMEOUT_MS = 220_000

export interface OllamaConfig {
  /** e.g. http://127.0.0.1:11434 in development. */
  url: string
  /** e.g. natlas-q4km:latest */
  model: string
  /** Only set when inference sits behind a gateway. Never in the browser. */
  token?: string
}

/**
 * N-ATLaS through Ollama.
 *
 * Non-streaming on purpose for Phase 1: the guard has to inspect the WHOLE
 * answer before any of it is shown. Streaming a sentence and then retracting it
 * because the period provenance check failed would be worse than waiting. The
 * interface leaves room to stream later once the guard can run incrementally.
 */
export class OllamaAdapter implements ModelAdapter {
  readonly name = 'ollama'
  /**
   * Measured against this host, not assumed. `/api/show` reports
   * `capabilities: ['tools','completion']` for natlas-q4km, and all four were
   * exercised directly: streaming returned 9 NDJSON frames with a first token
   * at 3.9s; a JSON schema produced `{"crop":"maize","family":"Poaceae"}`; and
   * a `get_price` definition produced a tool call with the right arguments.
   *
   * `streaming` being declared does NOT mean Loam streams. It does not --
   * `stream: false` is sent on every request, because the guard needs the
   * whole answer.
   */
  readonly capabilities = ['text', 'streaming', 'tools', 'json'] as const
  constructor(private readonly cfg: OllamaConfig) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.cfg.token) h.Authorization = `Bearer ${this.cfg.token}`
    return h
  }

  /**
   * Load the model without asking it anything.
   *
   * An empty prompt makes Ollama resident and returns immediately, so the cold
   * load happens while the dev server is starting rather than inside the first
   * question a demo asks. Failure is ignored: a warm-up that cannot run is a
   * slower first answer, not a broken one.
   */
  async warm(): Promise<boolean> {
    try {
      const res = await fetch(`${this.cfg.url}/api/generate`, {
        method: 'POST',
        headers: this.headers(),
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({ model: this.cfg.model, prompt: '', keep_alive: KEEP_ALIVE }),
      })
      return res.ok
    } catch {
      return false
    }
  }

  async available(): Promise<boolean> {
    try {
      const res = await fetch(`${this.cfg.url}/api/tags`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(4000),
      })
      if (!res.ok) return false
      const body = (await res.json()) as { models?: { name?: string }[] }
      const names = (body.models ?? []).map((m) => m.name ?? '')
      // Present under its exact tag, or under the bare name Ollama expands.
      return names.some((n) => n === this.cfg.model || n.startsWith(`${this.cfg.model.split(':')[0]}:`))
    } catch {
      return false
    }
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const started = Date.now()
    let res: Response
    try {
      res = await fetch(`${this.cfg.url}/api/chat`, {
        method: 'POST',
        headers: this.headers(),
        signal: AbortSignal.timeout(req.timeoutMs ?? INFERENCE_TIMEOUT_MS),
        body: JSON.stringify({
          model: this.cfg.model,
          stream: false,
          keep_alive: KEEP_ALIVE,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
          options: {
            // Pinned to 4096 while NCAIR confirms whether the authoritative
            // context is the card's 8,092 or the GGUF's 131,072.
            num_ctx: 4096,
            num_predict: req.maxTokens ?? 220,
            temperature: req.temperature ?? 0.3,
          },
        }),
      })
    } catch (e) {
      throw new ModelUnavailable(`inference host unreachable: ${(e as Error).message}`)
    }
    if (!res.ok) {
      throw new ModelUnavailable(`inference host returned ${res.status}`)
    }
    const body = (await res.json()) as {
      message?: { content?: string }
      eval_count?: number
    }
    const text = (body.message?.content ?? '').trim()
    if (!text) throw new ModelUnavailable('inference host returned an empty answer')
    return {
      text,
      ms: Date.now() - started,
      outputTokens: body.eval_count ?? null,
      model: this.cfg.model,
    }
  }
}

/**
 * A scripted adapter for tests.
 *
 * DEVELOPMENT MOCK — never selected by configuration. The dev middleware and
 * the Edge Function both construct OllamaAdapter; this class is reachable only
 * from a test that imports it directly, which is what keeps "the demo uses the
 * real model" a structural fact rather than a promise.
 */
export class MockAdapter implements ModelAdapter {
  readonly name = 'mock'
  /** Text only. A test that needs more declares it explicitly. */
  readonly capabilities = ['text'] as const
  public lastRequest: GenerateRequest | null = null
  constructor(
    private readonly reply: string | ((req: GenerateRequest) => string),
    private readonly opts: { availableFlag?: boolean; throws?: Error } = {},
  ) {}

  async available(): Promise<boolean> {
    return this.opts.availableFlag ?? true
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    this.lastRequest = req
    if (this.opts.throws) throw this.opts.throws
    const text = typeof this.reply === 'function' ? this.reply(req) : this.reply
    return { text, ms: 1, outputTokens: text.split(/\s+/).length, model: 'mock' }
  }
}

/**
 * The model Loam runs on, pinned by name.
 *
 * WHY A NAMED CONSTANT RATHER THAN AN INLINE DEFAULT
 *   `LOAM_MODEL` used to be a bare `??` fallback, so any value in any env file
 *   silently became the agricultural adviser. Ollama resolves a model whose tag
 *   is `cloud` against ollama.com instead of this host, this machine already
 *   has one registered (`glm-5.2:cloud`), and its server reports
 *   `OLLAMA_NO_CLOUD:false`. A one-line env edit could therefore have sent
 *   Nigerian farming questions to a third-party hosted model while every log
 *   line still said N-ATLaS.
 *
 *   Hash-verified as QuantFactory's Q4_K_M quantization of NCAIR1/N-ATLaS.
 */
export const PINNED_MODEL = 'natlas-q4km:latest'

/** Ollama routes a model whose tag is `cloud` to ollama.com, not to this host. */
const CLOUD_MODEL_TAG = /:cloud$/i
const OLLAMA_CLOUD_HOST = /(^|\.)ollama\.com$/i

/**
 * A configuration that must not be allowed to serve a single request.
 *
 * Thrown rather than logged: a wrong model answering agricultural questions
 * correctly-shaped but from the wrong weights is the failure mode hardest to
 * notice from the outside, so it fails loudly at construction instead.
 */
export class ModelConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelConfigurationError'
  }
}

/** The model name to use, refusing anything that would leave this machine. */
export function resolveModel(env: Record<string, string | undefined>): string {
  const requested = env.LOAM_MODEL?.trim()
  if (!requested) return PINNED_MODEL

  if (CLOUD_MODEL_TAG.test(requested)) {
    throw new ModelConfigurationError(
      `LOAM_MODEL "${requested}" is an Ollama cloud model. Loam runs inference locally; `
      + 'it will not route agricultural answers to a hosted third-party model.',
    )
  }
  if (requested !== PINNED_MODEL && env.LOAM_ALLOW_MODEL_OVERRIDE !== 'true') {
    throw new ModelConfigurationError(
      `LOAM_MODEL "${requested}" is not the pinned model (${PINNED_MODEL}). `
      + 'Set LOAM_ALLOW_MODEL_OVERRIDE=true to run a different one deliberately.',
    )
  }
  return requested
}

/** The inference host, refusing Ollama's hosted cloud. */
export function resolveInferenceUrl(env: Record<string, string | undefined>): string {
  const url = env.LOAM_INFERENCE_URL?.trim() || 'http://127.0.0.1:11434'
  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    throw new ModelConfigurationError(`LOAM_INFERENCE_URL "${url}" is not a valid URL.`)
  }
  if (OLLAMA_CLOUD_HOST.test(hostname)) {
    throw new ModelConfigurationError(
      `LOAM_INFERENCE_URL "${url}" points at Ollama's hosted cloud. Loam uses a local host.`,
    )
  }
  return url
}

/**
 * Build the adapter from the environment of whichever host is running.
 *
 * Takes a plain record rather than reading process.env, so the same function
 * serves Node (dev middleware) and Deno (Edge Function) without either
 * runtime's globals leaking into the orchestrator.
 */
export function adapterFromEnv(env: Record<string, string | undefined>): ModelAdapter {
  return new OllamaAdapter({
    url: resolveInferenceUrl(env),
    model: resolveModel(env),
    token: env.LOAM_INFERENCE_TOKEN || undefined,
  })
}
