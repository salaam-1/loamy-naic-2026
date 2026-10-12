/**
 * The `/loam/chat` request, once. Shared by the Vite dev middleware and the
 * deployable Node service.
 *
 * WHY DEPENDENCIES ARE INJECTED RATHER THAN IMPORTED
 *   The orchestrator lives at `@/lib/loam/orchestrator` and uses the `@/`
 *   alias. The Vite plugin cannot import that directly -- it reaches it
 *   through `server.ssrLoadModule`, which is what gives it Vite's transform
 *   pipeline and hot reload. The standalone service CAN import it, because
 *   its bundle resolves the alias at build time.
 *
 *   Two different ways of getting the same module. So this file imports
 *   nothing from the application and takes what it needs as arguments, and
 *   the business logic exists in exactly one place instead of being copied
 *   into a second server that then drifts.
 *
 * WHAT THIS FILE IS NOT ALLOWED TO BECOME
 *   A second chat implementation. It holds request parsing, the authorization
 *   decision and the response shape -- the parts that were previously tangled
 *   into the Vite plugin. Every judgement about what Loam may say stays in the
 *   orchestrator, the evidence layer and the guard, untouched.
 *
 * AUTHORIZATION IS UNCHANGED, DELIBERATELY
 *   A token is OPTIONAL, exactly as before: an anonymous caller gets a
 *   general answer and no private evidence, because the per-request Supabase
 *   client is built from the ANON key plus the caller's own JWT and every
 *   query runs under RLS as that member. The service-role key is absent here
 *   and must stay absent -- Loam has no privilege the member lacks.
 *
 *   Widening this to "WhatsApp needs a shared token" would hand every
 *   WhatsApp sender one member's data. That is why the seam takes a token
 *   per request and never a service identity.
 */

/** The JSON body a client may send. Everything is validated before use. */
export interface ChatBody {
  message?: unknown
  language?: unknown
  lastCommodity?: unknown
}

export const MAX_MESSAGE_CHARS = 2000
export const MAX_BODY_BYTES = 64_000

/** The four languages Loam answers in. Anything else becomes English. */
const ANSWER_LANGUAGES = ['ha', 'ig', 'yo'] as const

export interface ChatResult {
  status: number
  /** Already-safe JSON. Never a stack trace, never a database message. */
  body: unknown
  /** One line for the server log, or null. Contains no token and no user id. */
  log?: string | null
}

/** What the caller must supply. Nothing here is constructed by this module. */
export interface ChatDeps {
  /** The orchestrator's entry point. */
  runLoam: (req: unknown, ctx: unknown) => Promise<unknown>
  /** A per-request Supabase client built from the anon key plus this JWT. */
  createRequestClient: (token: string | null) => {
    auth: { getUser: (token: string) => Promise<{ data: { user: { id: string } | null } }> }
  }
  /** The chosen inference adapter. Built once at startup, not per request. */
  adapter: unknown
  /** A credential-free description of that adapter, for the log line. */
  adapterLabel: string
  /** Whether Supabase is configured at all. */
  configured: boolean
}

/**
 * Parse and validate a request body.
 *
 * Returns a `ChatResult` when the request is unacceptable, so a caller can
 * return it directly, or the cleaned input when it is fine.
 */
export function parseChatRequest(raw: unknown):
  | { ok: false; result: ChatResult }
  | { ok: true; message: string; language: 'en' | 'ha' | 'ig' | 'yo'; lastCommodity: string | null } {
  const body = (raw ?? {}) as ChatBody
  const message = typeof body.message === 'string' ? body.message.trim() : ''

  if (!message) {
    return { ok: false, result: { status: 400, body: { error: 'A question is required.' } } }
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return { ok: false, result: { status: 400, body: { error: 'That question is too long.' } } }
  }

  // Unchanged behaviour: a language Loam does not answer in becomes English
  // rather than being asserted as supported.
  const asked = body.language
  const language = (ANSWER_LANGUAGES as readonly string[]).includes(asked as string)
    ? (asked as 'ha' | 'ig' | 'yo')
    : 'en'

  return {
    ok: true,
    message,
    language,
    lastCommodity: typeof body.lastCommodity === 'string' ? body.lastCommodity : null,
  }
}

/**
 * Run one chat turn.
 *
 * `token` is the bearer token as presented, or null. It is passed to Supabase
 * and never logged, never returned, and never used to build anything but the
 * caller's own client.
 */
export async function handleChat(
  raw: unknown,
  token: string | null,
  deps: ChatDeps,
): Promise<ChatResult> {
  const started = Date.now()

  const parsed = parseChatRequest(raw)
  if (!parsed.ok) return parsed.result

  if (!deps.configured) {
    return { status: 503, body: { error: 'Loam is not configured.' } }
  }

  const client = deps.createRequestClient(token)

  let authMs = 0
  let userId: string | null = null
  if (token) {
    /**
     * Measured separately because the first profile showed ~10s of wall time
     * the orchestrator reported as 0ms: verifying a JWT is a network
     * round-trip to Supabase and it happens out here.
     */
    const t = Date.now()
    const { data } = await client.auth.getUser(token)
    authMs = Date.now() - t
    userId = data.user?.id ?? null
  }

  const result = (await deps.runLoam(
    { message: parsed.message, language: parsed.language, lastCommodity: parsed.lastCommodity },
    { model: deps.adapter, client, userId },
  )) as {
    kind: string
    demand: string
    level: number | null
    evidence: { level: number }[]
    modelUsed: boolean
    declined: boolean
    modelMs: number | null
    guard?: { fellBack?: boolean }
  }

  /**
   * One line per turn, so "did this request actually reach the model?" is
   * answered by the server that served it rather than inferred.
   *
   * Deliberately NOT logged: the Authorization header, the JWT, the member's
   * id, and the answer. The question is truncated and is here only to
   * correlate a line with a turn.
   */
  const levels = result.evidence.map((e) => `L${e.level}`).join(',') || 'none'
  const log =
    `"${parsed.message.slice(0, 48)}${parsed.message.length > 48 ? '…' : ''}" `
    + `lang=${parsed.language} kind=${result.kind} demand=${result.demand} `
    + `evidence=[${levels}] `
    + `model=${result.modelUsed ? `${deps.adapterLabel} ${result.modelMs ?? '?'}ms` : 'NOT CALLED'} `
    // `level: null` is a social turn carrying no evidential claim, which is
    // not the same thing as Level 4 / unknown.
    + `${result.declined ? 'DECLINED' : `answered ${result.level === null ? 'no-claim' : `L${result.level}`}`}`
    + `${result.guard?.fellBack ? ' guard=fellBack' : ''}`

  return {
    status: 200,
    body: { ...result, serverTimings: { authMs, requestMs: Date.now() - started } },
    log,
  }
}

/**
 * Turn an unexpected error into a response.
 *
 * The browser gets a plain sentence. The server log gets the error's own
 * message, which is safe here only because callers pass it to a logger and
 * not to the client -- a thrown Supabase error can quote a URL with a key in
 * it, so the RESPONSE never carries it.
 */
export function chatFailure(e: unknown): ChatResult {
  return {
    status: 500,
    body: { error: 'Loam could not answer that right now.' },
    log: `[loam] ${(e as Error).name}: ${(e as Error).message}`,
  }
}
