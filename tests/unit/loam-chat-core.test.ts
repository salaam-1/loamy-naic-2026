import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  MAX_MESSAGE_CHARS, chatFailure, handleChat, parseChatRequest, type ChatDeps,
} from '../../server/chat-core'

/**
 * The shared `/loam/chat` handler.
 *
 * WHY THIS MODULE EXISTS AT ALL
 *   The chat route used to live inside the Vite plugin, which `apply: 'serve'`
 *   keeps out of every deployed build -- so production had no chat backend at
 *   all. Extracting the handler is what lets a deployable Node service and
 *   the dev middleware run THE SAME logic instead of two that drift.
 *
 *   These tests therefore guard two things: that the handler behaves, and
 *   that it stayed dependency-injected rather than quietly importing the
 *   application and becoming un-shareable.
 */

const PLACEHOLDER_JWT = 'header.payload.signature-for-tests'

const ANSWER = {
  kind: 'answer', demand: 'specific', level: 2,
  evidence: [{ level: 1 }, { level: 2 }],
  modelUsed: true, declined: false, modelMs: 4200,
  answer: 'Plant maize once the rains are established.',
}

function deps(over: Partial<ChatDeps> = {}): ChatDeps {
  const getUser = vi.fn(async () => ({ data: { user: { id: 'user-1' } } }))
  return {
    runLoam: vi.fn(async () => ANSWER),
    createRequestClient: vi.fn(() => ({ auth: { getUser } })),
    adapter: { name: 'hosted-openai-compatible' },
    adapterLabel: 'hosted',
    configured: true,
    ...over,
  }
}

/* ------------------------------------------------------------ validation */

describe('a request is validated before anything expensive happens', () => {
  it('requires a message', () => {
    for (const raw of [{}, { message: '' }, { message: '   ' }, { message: 42 }, null, undefined]) {
      const r = parseChatRequest(raw)
      expect(r.ok, JSON.stringify(raw)).toBe(false)
      if (!r.ok) expect(r.result.status).toBe(400)
    }
  })

  it('refuses an over-long question', () => {
    const r = parseChatRequest({ message: 'a'.repeat(MAX_MESSAGE_CHARS + 1) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.result.status).toBe(400)
  })

  it('keeps the four answer languages and maps anything else to English', () => {
    /**
     * Unchanged behaviour. A language Loam does not answer in becomes
     * English rather than being asserted as supported -- including `pcm`,
     * which voice input can TRANSCRIBE but the model has no documented mode
     * for.
     */
    for (const language of ['ha', 'ig', 'yo']) {
      const r = parseChatRequest({ message: 'hello', language })
      expect(r.ok && r.language, language).toBe(language)
    }
    for (const language of ['en', 'fr', 'pcm', 'sw', '', null, 7]) {
      const r = parseChatRequest({ message: 'hello', language })
      expect(r.ok && r.language, String(language)).toBe('en')
    }
  })

  it('trims the message and normalises lastCommodity', () => {
    const r = parseChatRequest({ message: '  maize?  ', lastCommodity: 'maize' })
    expect(r.ok && r.message).toBe('maize?')
    expect(r.ok && r.lastCommodity).toBe('maize')
    const r2 = parseChatRequest({ message: 'x', lastCommodity: 99 })
    expect(r2.ok && r2.lastCommodity).toBeNull()
  })
})

/* ------------------------------------------------------- authorization */

describe('authorization is unchanged by the extraction', () => {
  it('builds the per-request client from the caller JWT', async () => {
    const d = deps()
    await handleChat({ message: 'When should I plant maize?' }, PLACEHOLDER_JWT, d)
    expect(d.createRequestClient).toHaveBeenCalledWith(PLACEHOLDER_JWT)
  })

  it('verifies the token and passes the resulting user id to the orchestrator', async () => {
    const d = deps()
    await handleChat({ message: 'my farm' }, PLACEHOLDER_JWT, d)
    const ctx = (d.runLoam as ReturnType<typeof vi.fn>).mock.calls[0]![1] as { userId: string | null }
    expect(ctx.userId).toBe('user-1')
  })

  it('keeps an anonymous turn ANONYMOUS rather than refusing it', async () => {
    /**
     * Deliberately unchanged: a caller with no token gets a general answer
     * and no private evidence, because the client carries no Authorization
     * header and RLS sees an anonymous request. This is what makes the
     * WhatsApp path safe today -- it sends no token, so it can reach no
     * member's data.
     */
    const d = deps()
    const r = await handleChat({ message: 'What is maize?' }, null, d)
    expect(r.status).toBe(200)
    const ctx = (d.runLoam as ReturnType<typeof vi.fn>).mock.calls[0]![1] as { userId: string | null }
    expect(ctx.userId).toBeNull()
    expect(d.createRequestClient).toHaveBeenCalledWith(null)
  })

  it('treats an unverifiable token as anonymous, not as an error', async () => {
    // Same as before the extraction. An expired token degrades to a general
    // answer rather than a 401, because chat has no authenticated-only path.
    const getUser = vi.fn(async () => ({ data: { user: null } }))
    const d = deps({ createRequestClient: vi.fn(() => ({ auth: { getUser } })) })
    const r = await handleChat({ message: 'hello' }, PLACEHOLDER_JWT, d)
    expect(r.status).toBe(200)
    const ctx = (d.runLoam as ReturnType<typeof vi.fn>).mock.calls[0]![1] as { userId: string | null }
    expect(ctx.userId).toBeNull()
  })

  it('never constructs a privileged client of its own', () => {
    /**
     * The handler receives a client factory and uses nothing else. If it ever
     * grew a service-role path, WhatsApp traffic would be able to read any
     * member's data -- which is the single worst outcome available here.
     */
    const src = readFileSync('server/chat-core.ts', 'utf8')
    expect(src).not.toMatch(/service_role|SERVICE_ROLE|serviceRole/)
    expect(src).not.toMatch(/createClient/)
  })
})

/* ------------------------------------------------------------ behaviour */

describe('the response contract is preserved', () => {
  it('returns the orchestrator result plus serverTimings', async () => {
    const r = await handleChat({ message: 'maize' }, PLACEHOLDER_JWT, deps())
    expect(r.status).toBe(200)
    const body = r.body as typeof ANSWER & { serverTimings: { authMs: number; requestMs: number } }
    expect(body.kind).toBe('answer')
    expect(body.answer).toBe(ANSWER.answer)
    expect(body.evidence).toHaveLength(2)
    expect(typeof body.serverTimings.authMs).toBe('number')
    expect(typeof body.serverTimings.requestMs).toBe('number')
  })

  it('reports 503 when Supabase is not configured, without calling the model', async () => {
    const d = deps({ configured: false })
    const r = await handleChat({ message: 'maize' }, null, d)
    expect(r.status).toBe(503)
    expect(d.runLoam).not.toHaveBeenCalled()
  })

  it('passes the chosen adapter through to the orchestrator', async () => {
    const adapter = { name: 'hosted-openai-compatible' }
    const d = deps({ adapter })
    await handleChat({ message: 'maize' }, null, d)
    const ctx = (d.runLoam as ReturnType<typeof vi.fn>).mock.calls[0]![1] as { model: unknown }
    expect(ctx.model).toBe(adapter)
  })
})

/* -------------------------------------------------------------- logging */

describe('the log line carries no secret and no identity', () => {
  it('records the model, evidence and verdict', async () => {
    const r = await handleChat({ message: 'When should I plant maize?' }, PLACEHOLDER_JWT, deps())
    expect(r.log).toContain('kind=answer')
    expect(r.log).toContain('evidence=[L1,L2]')
    expect(r.log).toContain('hosted 4200ms')
    expect(r.log).toContain('answered L2')
  })

  it('omits the JWT, the user id and the answer', async () => {
    const r = await handleChat({ message: 'what is my balance' }, PLACEHOLDER_JWT, deps())
    expect(r.log).not.toContain(PLACEHOLDER_JWT)
    expect(r.log).not.toContain('user-1')
    expect(r.log).not.toContain(ANSWER.answer)
  })

  it('truncates the question rather than logging it whole', async () => {
    const long = 'z'.repeat(400)
    const r = await handleChat({ message: long }, null, deps())
    expect(r.log!.length).toBeLessThan(220)
    expect(r.log).toContain('…')
  })

  it('says NOT CALLED when the model was not reached', async () => {
    const d = deps({ runLoam: vi.fn(async () => ({ ...ANSWER, modelUsed: false, modelMs: null })) })
    const r = await handleChat({ message: 'hello' }, null, d)
    expect(r.log).toContain('model=NOT CALLED')
  })

  it('distinguishes a no-claim social turn from Level 4', async () => {
    // `level: null` is a turn carrying no evidential claim at all, which is
    // not the same thing as "unknown".
    const d = deps({ runLoam: vi.fn(async () => ({ ...ANSWER, level: null, evidence: [] })) })
    const r = await handleChat({ message: 'hello' }, null, d)
    expect(r.log).toContain('answered no-claim')
    expect(r.log).toContain('evidence=[none]')
  })
})

describe('an unexpected failure is safe at the boundary', () => {
  it('gives the client a sentence and keeps the detail for the log', () => {
    const r = chatFailure(new Error('relation "profiles" does not exist at https://x.supabase.co?apikey=AAA'))
    expect(r.status).toBe(500)
    // The RESPONSE must not carry a database message or a URL with a key.
    expect(JSON.stringify(r.body)).not.toMatch(/supabase|apikey|relation/i)
    expect(r.body).toEqual({ error: 'Loam could not answer that right now.' })
  })
})

/* --------------------------------------------------- shared, not copied */

describe('one implementation, two wirings', () => {
  const core = readFileSync('server/chat-core.ts', 'utf8')

  it('the core imports nothing from the application', () => {
    /**
     * The property that makes sharing possible. The Vite plugin reaches the
     * orchestrator through `ssrLoadModule` for the `@/` alias; the standalone
     * server imports it statically. If this module imported `@/...` directly,
     * the plugin could not use it and someone would copy it instead.
     */
    expect(core).not.toMatch(/from '@\//)
    expect(core).not.toMatch(/require\(/)
  })

  it('both servers call handleChat rather than reimplementing it', () => {
    const dev = readFileSync('scripts/loam-dev-server.ts', 'utf8')
    const node = readFileSync('server/index.ts', 'utf8')
    expect(dev).toContain('handleChat(')
    expect(node).toContain('handleChat(')
    // And neither keeps its own copy of the orchestrator call.
    expect(dev.match(/runLoam\(/g) ?? []).toHaveLength(0)
    expect(node.match(/runLoam\(/g) ?? []).toHaveLength(0)
  })

  it('both servers select the provider through the same module', () => {
    const dev = readFileSync('scripts/loam-dev-server.ts', 'utf8')
    const node = readFileSync('server/index.ts', 'utf8')
    for (const [name, src] of [['dev', dev], ['node', node]] as const) {
      expect(src, name).toContain('resolveAdapter')
      // The raw Ollama factory must not be reached directly any more, or the
      // production guard could be bypassed.
      expect(src, name).not.toMatch(/adapterFromEnv\(/)
    }
  })

  it('the deployable server honours the platform PORT', () => {
    const node = readFileSync('server/index.ts', 'utf8')
    expect(node).toMatch(/env\.PORT/)
    expect(node).toContain('SIGTERM')
  })

  it('the deployable server does not default CORS to a wildcard', () => {
    const node = readFileSync('server/index.ts', 'utf8')
    expect(node).not.toMatch(/Allow-Origin', '\*'|Allow-Origin",\s*"\*"/)
    expect(node).toContain('LOAM_ALLOWED_ORIGINS')
  })

  it('the deployable server reads no service-role key', () => {
    const node = readFileSync('server/index.ts', 'utf8')
    expect(node).not.toMatch(/SERVICE_ROLE|service_role/)
  })

  it('an oversized body is answered, not reset', () => {
    /**
     * REGRESSION. The first version called `req.destroy()` on exceeding the
     * limit, which tore down the socket before the 413 could be written -- so
     * the client saw a connection reset instead of the clear status it was
     * about to be sent. A probe against the built server returned status 0,
     * which is how it was found.
     *
     * The fix pauses the request instead and closes the connection through
     * the response, so the status actually arrives. The same mistake was made
     * and fixed in the Python speech worker, which is why it is pinned here.
     */
    // Comments stripped: the explanation above names `req.destroy()` on
    // purpose, and deleting the reason to satisfy a substring match would
    // lose why this test exists.
    const node = readFileSync('server/index.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(node, 'destroying the socket loses the response').not.toContain('req.destroy()')
    expect(node).toContain('req.pause()')
    // And an error response must close the connection rather than leave a
    // half-uploaded body undrained under keep-alive.
    expect(node).toMatch(/status >= 400\) res\.setHeader\('Connection', 'close'\)/)
  })

  it('the body limit is shared with the handler rather than restated', () => {
    // Two different limits in two files is how a request that one layer
    // accepts gets rejected by the next.
    const node = readFileSync('server/index.ts', 'utf8')
    expect(node).toContain('MAX_BODY_BYTES')
    expect(node).not.toMatch(/size > \d/)
  })
})
