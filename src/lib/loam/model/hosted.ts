import {
  ModelCancelled, ModelConfigurationError, ModelUnavailable,
  type GenerateRequest, type GenerateResult, type ModelAdapter, type ModelCapability,
} from '@/lib/loam/model/adapter'

/**
 * An OpenAI-compatible chat host, behind the same `ModelAdapter` the local
 * Ollama path uses. The orchestrator cannot tell them apart.
 *
 * WHAT THIS IS NOT
 *   It is NOT evidence that N-ATLaS is hosted anywhere. At the time of
 *   writing it is not: `NCAIR1/N-ATLaS` carries an empty
 *   `inferenceProviderMapping` and no `pipeline_tag`; the router's own
 *   `/v1/models` lists 127 servable models and none of them is NCAIR's; and
 *   `?inference=warm&author=NCAIR1` returns zero while `?author=NCAIR1`
 *   returns all five, which is a working positive control. So this adapter is
 *   COMPATIBLE with the API and has never completed a real inference call.
 *
 *   Those are different claims and the code keeps them apart. `available()`
 *   asks the provider whether the CONFIGURED model is served, and returns
 *   false when it is not. Being able to speak the protocol is not the same as
 *   having something at the other end.
 *
 * WHAT IT MUST NEVER DO
 *   Substitute a model. `meta-llama/Llama-3.1-8B-Instruct:featherless-ai`
 *   appears in research notes about this router and is Llama 3.1, not
 *   N-ATLaS. There is no default model here: an absent identifier is a
 *   configuration error, never a fallback. The identifier the host reports
 *   back is returned verbatim in `GenerateResult.model` so a caller can see
 *   what actually answered rather than what was asked for.
 *
 *   Fall back. A failure here throws. Nothing in this file knows about
 *   Ollama, so a hosted failure cannot quietly become a local answer; that
 *   decision belongs to whoever chose the adapter, where it is visible.
 */

/** The documented Hugging Face OpenAI-compatible base. */
export const HF_ROUTER_BASE_URL = 'https://router.huggingface.co/v1'

/** Generous: a cold hosted model can take a while to answer the first call. */
export const HOSTED_TIMEOUT_MS = 120_000

export interface HostedChatConfig {
  /** e.g. https://router.huggingface.co/v1 — no trailing slash required. */
  baseUrl: string
  /**
   * The EXACT model identifier the provider expects. No default exists and
   * none may be invented.
   */
  model: string
  /**
   * Bearer credential. Server-side only -- this adapter is constructed in the
   * dev middleware or an Edge Function, never in code that reaches a browser.
   */
  token: string
  timeoutMs?: number
  /**
   * Opt in to server-sent-event streaming.
   *
   * DEFAULT FALSE, DELIBERATELY. The parsing is implemented and tested below,
   * but no provider has ever been reached from here, so whether the ACTIVE
   * provider streams is unverified. Declaring `streaming` on the strength of
   * a protocol specification would be advertising a capability the running
   * provider may not implement. An operator turning this on is asserting
   * they have checked.
   */
  streaming?: boolean
}

interface ChatCompletionResponse {
  id?: string
  model?: string
  choices?: {
    message?: { content?: string | null }
    finish_reason?: string | null
  }[]
  usage?: { completion_tokens?: number; prompt_tokens?: number; total_tokens?: number }
}

/**
 * Validate configuration before a request can be built from it.
 *
 * Throws rather than returning a result, so a misconfigured adapter cannot be
 * constructed and then quietly fail per request.
 */
export function assertHostedConfig(cfg: HostedChatConfig): void {
  if (!cfg.model?.trim()) {
    throw new ModelConfigurationError(
      'A hosted model identifier is required. There is no default, because '
      + 'defaulting one would mean answering with a model nobody chose.',
    )
  }
  if (!cfg.token?.trim()) {
    throw new ModelConfigurationError(
      'A hosted inference credential is required and is not configured.',
    )
  }
  let url: URL
  try {
    url = new URL(cfg.baseUrl)
  } catch {
    throw new ModelConfigurationError(`Hosted base URL "${cfg.baseUrl}" is not a valid URL.`)
  }
  /**
   * HTTPS only. A bearer token on a plaintext connection is a leaked token,
   * and localhost is exempt solely so a test can point at a loopback stub.
   */
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  if (url.protocol !== 'https:' && !loopback) {
    throw new ModelConfigurationError(
      `Hosted base URL "${cfg.baseUrl}" is not HTTPS. A credential must not travel in plaintext.`,
    )
  }
}

/**
 * Map a status onto a message safe to show a member.
 *
 * The upstream body is deliberately NOT included. It can carry account
 * details, quota figures or echoed request content, and none of that belongs
 * in a farmer's chat window or a log line.
 */
function fromStatus(status: number, model: string): ModelUnavailable {
  if (status === 401 || status === 403) {
    return new ModelUnavailable('the inference host rejected our credentials')
  }
  if (status === 404) {
    return new ModelUnavailable(
      `the inference host does not serve "${model}"`,
    )
  }
  if (status === 422 || status === 400) {
    return new ModelUnavailable('the inference host rejected the request as malformed')
  }
  if (status === 429) {
    return new ModelUnavailable('the inference host is rate limiting us')
  }
  if (status >= 500) {
    return new ModelUnavailable(`the inference host returned ${status}`)
  }
  return new ModelUnavailable(`the inference host returned ${status}`)
}

export class HostedChatAdapter implements ModelAdapter {
  readonly name = 'hosted-openai-compatible'

  /**
   * Text only, until this host has been exercised.
   *
   * The local adapter declares streaming, tools and json because each was
   * measured against it. Nothing has been measured against this one -- there
   * is no reachable endpoint to measure -- and declaring a capability on the
   * strength of the provider's documentation is the assumption this type
   * exists to prevent.
   */
  readonly capabilities: readonly ModelCapability[]

  constructor(private readonly cfg: HostedChatConfig) {
    assertHostedConfig(cfg)
    // `streaming` is declared only when an operator has opted in, because
    // nothing here has been measured against a real provider.
    this.capabilities = cfg.streaming ? ['text', 'streaming'] : ['text']
  }

  /**
   * One signal combining the caller's cancellation with our own deadline.
   *
   * `AbortSignal.any` resolves whichever fires first, and the two are then
   * told apart by checking the caller's signal -- a cancellation is a person
   * changing their mind, a timeout is the host failing to answer, and
   * reporting one as the other is misleading in both directions.
   */
  private abortSignal(req: GenerateRequest): AbortSignal {
    const deadline = AbortSignal.timeout(
      req.timeoutMs ?? this.cfg.timeoutMs ?? HOSTED_TIMEOUT_MS,
    )
    return req.signal ? AbortSignal.any([req.signal, deadline]) : deadline
  }

  /** Translate an aborted fetch into the right error for the right cause. */
  private abortError(req: GenerateRequest, e: unknown): Error {
    if (req.signal?.aborted) return new ModelCancelled()
    const name = (e as Error).name
    if (name === 'TimeoutError') return new ModelUnavailable('the inference host took too long to answer')
    if (name === 'AbortError') return new ModelCancelled()
    return new ModelUnavailable('the inference host could not be reached')
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.cfg.token}`,
    }
  }

  /** The base with any trailing slash removed, so paths join predictably. */
  private get base(): string {
    return this.cfg.baseUrl.replace(/\/+$/, '')
  }

  /**
   * Whether the CONFIGURED model is actually served.
   *
   * This is the availability half of the availability-versus-compatibility
   * distinction. A true here means the provider lists this identifier; it
   * still does not mean a completion will succeed.
   */
  async available(): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) return false
      const body = (await res.json()) as { data?: { id?: string }[] }
      const ids = (body.data ?? []).map((m) => m.id)
      return ids.includes(this.cfg.model)
    } catch {
      return false
    }
  }

  /**
   * Read a server-sent-event stream into a complete answer.
   *
   * THE PROPERTY THAT MATTERS MOST
   *   A stream that stops early is NOT a successful short answer. Without an
   *   explicit `[DONE]`, this throws -- because the alternative is handing the
   *   orchestrator a truncated answer that looks finished, and a truncated
   *   agricultural instruction is worse than no instruction. Tokens already
   *   delivered to `onToken` are reported in the error so a caller can show an
   *   explicit failure state rather than silently keeping half a sentence.
   *
   * WHAT IT HANDLES
   *   Events split across network chunks, multiple events in one chunk,
   *   comment/heartbeat lines, malformed JSON in a single event, an upstream
   *   error object mid-stream, caller cancellation, and the deadline.
   */
  private async readStream(
    res: Response,
    req: GenerateRequest,
    started: number,
  ): Promise<GenerateResult> {
    const body = res.body
    if (!body) throw new ModelUnavailable('the inference host returned no stream')

    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''
    let done = false
    let model: string | null = null
    let outputTokens: number | null = null

    const emit = (chunk: string) => {
      if (!chunk) return
      text += chunk
      // A throwing callback must not be mistaken for a provider failure.
      try { req.onToken?.(chunk) } catch { /* the caller's problem, not ours */ }
    }

    try {
      for (;;) {
        const { value, done: finished } = await reader.read()
        if (finished) break
        buffer += decoder.decode(value, { stream: true })

        // SSE events are separated by a blank line. Keep the remainder:
        // an event split across two network reads must not be parsed twice.
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''

        for (const event of events) {
          for (const line of event.split('\n')) {
            const trimmed = line.trim()
            // Comments and heartbeats carry no data.
            if (!trimmed || trimmed.startsWith(':')) continue
            if (!trimmed.startsWith('data:')) continue

            const payload = trimmed.slice(5).trim()
            if (payload === '[DONE]') { done = true; continue }

            let parsed: {
              model?: string
              choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[]
              usage?: { completion_tokens?: number }
              error?: unknown
            }
            try {
              parsed = JSON.parse(payload)
            } catch {
              /**
               * One malformed event does not invalidate the stream, but it is
               * not silently dropped either: the final `[DONE]` check is what
               * decides whether the answer is complete.
               */
              continue
            }

            if (parsed.error) {
              // An upstream error object mid-stream. Say nothing about its
              // contents: it can carry account or quota detail.
              throw new ModelUnavailable('the inference host reported an error mid-stream')
            }
            if (parsed.model) model = parsed.model
            if (typeof parsed.usage?.completion_tokens === 'number') {
              outputTokens = parsed.usage.completion_tokens
            }
            emit(parsed.choices?.[0]?.delta?.content ?? '')
          }
        }
      }
    } catch (e) {
      if (e instanceof ModelUnavailable || e instanceof ModelCancelled) throw e
      throw this.abortError(req, e)
    } finally {
      // Release the connection whether we finished, failed or were cancelled.
      try { reader.releaseLock() } catch { /* already released */ }
    }

    if (!done) {
      throw new ModelUnavailable(
        'the inference host ended the stream before finishing the answer',
      )
    }
    if (!text.trim()) throw new ModelUnavailable('the inference host returned an empty answer')

    return {
      text: text.trim(),
      ms: Date.now() - started,
      outputTokens,
      model: model ?? this.cfg.model,
    }
  }

  /**
   * Whether this call will stream.
   *
   * BOTH conditions are required: the operator opted in AND the caller wants
   * tokens. So the default remains a non-streaming request, and a caller that
   * does not pass `onToken` gets byte-identical behaviour to before.
   */
  private willStream(req: GenerateRequest): boolean {
    return Boolean(this.cfg.streaming && req.onToken)
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const started = Date.now()
    const streaming = this.willStream(req)
    let res: Response
    try {
      res = await fetch(`${this.base}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        signal: this.abortSignal(req),
        body: JSON.stringify({
          model: this.cfg.model,
          /**
           * False unless BOTH the operator opted in and the caller asked for
           * tokens. Loam's orchestrator passes no `onToken`, by design and by
           * test: the guard inspects the whole answer before any of it is
           * shown, so nothing it yields may be rendered.
           */
          stream: streaming,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
          max_tokens: req.maxTokens ?? 220,
          temperature: req.temperature ?? 0.3,
        }),
      })
    } catch (e) {
      throw this.abortError(req, e)
    }

    if (!res.ok) throw fromStatus(res.status, this.cfg.model)
    if (streaming) return this.readStream(res, req, started)

    let body: ChatCompletionResponse
    try {
      body = (await res.json()) as ChatCompletionResponse
    } catch {
      throw new ModelUnavailable('the inference host returned a response we could not read')
    }

    const text = (body.choices?.[0]?.message?.content ?? '').trim()
    if (!text) throw new ModelUnavailable('the inference host returned an empty answer')

    return {
      text,
      ms: Date.now() - started,
      outputTokens: body.usage?.completion_tokens ?? null,
      /**
       * What ANSWERED, not what was asked for. If a provider silently routes
       * to a different build, the difference is visible here rather than
       * hidden behind the configured name.
       */
      model: body.model ?? this.cfg.model,
    }
  }
}

/**
 * Build a hosted adapter from the host's environment, or return null.
 *
 * Returns null rather than throwing when nothing is configured, because "no
 * hosted provider" is an ordinary state and not an error. A configuration
 * that is present but wrong still throws, so a typo cannot read as absence.
 */
export function hostedAdapterFromEnv(
  env: Record<string, string | undefined>,
): HostedChatAdapter | null {
  const model = env.LOAM_HOSTED_MODEL?.trim()
  const token = env.LOAM_HOSTED_TOKEN?.trim()
  if (!model && !token) return null

  return new HostedChatAdapter({
    baseUrl: env.LOAM_HOSTED_BASE_URL?.trim() || HF_ROUTER_BASE_URL,
    model: model ?? '',
    token: token ?? '',
    timeoutMs: Number(env.LOAM_HOSTED_TIMEOUT_MS) || undefined,
  })
}
