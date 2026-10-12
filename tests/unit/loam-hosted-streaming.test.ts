import { afterEach, describe, expect, it, vi } from 'vitest'
import { HF_ROUTER_BASE_URL, HostedChatAdapter } from '@/lib/loam/model/hosted'
import {
  ModelCancelled, ModelUnavailable, adapterCapabilities, adapterSupports,
} from '@/lib/loam/model/adapter'

/**
 * Server-sent-event streaming on the hosted adapter.
 *
 * WHAT THESE TESTS ESTABLISH
 *   That the SSE parsing is correct under the conditions a real network
 *   produces: events split across reads, several events in one read,
 *   heartbeats, one malformed event, an upstream error mid-stream, and a
 *   stream that stops early.
 *
 *   They establish NOTHING about whether the provider streams. No provider
 *   has ever been reached from here. `streaming` is opt-in for exactly that
 *   reason, and the default remains a non-streaming request.
 */

const TOKEN = 'PLACEHOLDER-not-a-real-credential'
const MODEL = 'some-provider/some-model'

const cfg = (over: Record<string, unknown> = {}) =>
  ({ baseUrl: HF_ROUTER_BASE_URL, model: MODEL, token: TOKEN, ...over }) as
    ConstructorParameters<typeof HostedChatAdapter>[0]

/** Build an SSE response from pre-chunked network reads. */
function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder()
  let i = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) { controller.close(); return }
      controller.enqueue(encoder.encode(chunks[i++]))
    },
  })
  return new Response(stream, { status, headers: { 'Content-Type': 'text/event-stream' } })
}

const delta = (content: string) =>
  `data: ${JSON.stringify({ model: MODEL, choices: [{ delta: { content } }] })}\n\n`
const DONE = 'data: [DONE]\n\n'

function stubFetch(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit })
    return responder(String(url), (init ?? {}) as RequestInit)
  }))
  return calls
}

const okJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const COMPLETION = {
  model: MODEL,
  choices: [{ message: { content: 'Non-streamed answer.' }, finish_reason: 'stop' }],
  usage: { completion_tokens: 4 },
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

/* --------------------------------------------- the default is unchanged */

describe('streaming is opt-in and off by default', () => {
  it('does not declare streaming unless an operator opted in', () => {
    expect(adapterCapabilities(new HostedChatAdapter(cfg()))).toEqual(['text'])
    expect(adapterSupports(new HostedChatAdapter(cfg({ streaming: true })), 'streaming')).toBe(true)
  })

  it('sends stream:false when streaming is not enabled, even with onToken', async () => {
    const calls = stubFetch(() => okJson(COMPLETION))
    const onToken = vi.fn()
    await new HostedChatAdapter(cfg()).generate({ system: 's', user: 'u', onToken })
    expect(JSON.parse(String(calls[0].init.body)).stream).toBe(false)
    expect(onToken).not.toHaveBeenCalled()
  })

  it('sends stream:false when enabled but the caller wants no tokens', async () => {
    /**
     * Both conditions are required. Loam's orchestrator passes no `onToken`,
     * so turning streaming on at the provider cannot start streaming into the
     * guarded pipeline.
     */
    const calls = stubFetch(() => okJson(COMPLETION))
    await new HostedChatAdapter(cfg({ streaming: true })).generate({ system: 's', user: 'u' })
    expect(JSON.parse(String(calls[0].init.body)).stream).toBe(false)
  })

  it('non-streaming results are byte-identical to before', async () => {
    stubFetch(() => okJson(COMPLETION))
    const r = await new HostedChatAdapter(cfg({ streaming: true })).generate({ system: 's', user: 'u' })
    expect(r.text).toBe('Non-streamed answer.')
    expect(r.outputTokens).toBe(4)
  })
})

/* --------------------------------------------------------- SSE parsing */

describe('the stream is parsed as a real network produces it', () => {
  const stream = (chunks: string[]) => {
    stubFetch(() => sseResponse(chunks))
    const onToken = vi.fn()
    return {
      onToken,
      run: () => new HostedChatAdapter(cfg({ streaming: true }))
        .generate({ system: 's', user: 'u', onToken }),
    }
  }

  it('assembles tokens in order and reports the whole answer', async () => {
    const s = stream([delta('Rice '), delta('is a '), delta('cereal grain.'), DONE])
    const r = await s.run()
    expect(r.text).toBe('Rice is a cereal grain.')
    expect(s.onToken.mock.calls.map((c) => c[0])).toEqual(['Rice ', 'is a ', 'cereal grain.'])
  })

  it('handles several events arriving in ONE network read', async () => {
    const s = stream([delta('a') + delta('b') + delta('c') + DONE])
    expect((await s.run()).text).toBe('abc')
    expect(s.onToken).toHaveBeenCalledTimes(3)
  })

  it('handles ONE event split across network reads', async () => {
    /**
     * The failure this prevents: treating a half-received event as complete,
     * or parsing its two halves as two events.
     */
    const full = delta('split-token')
    const cut = Math.floor(full.length / 2)
    const s = stream([full.slice(0, cut), full.slice(cut), DONE])
    expect((await s.run()).text).toBe('split-token')
    expect(s.onToken).toHaveBeenCalledTimes(1)
  })

  it('ignores heartbeats and comment lines', async () => {
    const s = stream([': keep-alive\n\n', delta('x'), ':\n\n', DONE])
    expect((await s.run()).text).toBe('x')
  })

  it('survives one malformed event without inventing content', async () => {
    const s = stream([delta('good '), 'data: {not json\n\n', delta('parts'), DONE])
    expect((await s.run()).text).toBe('good parts')
  })

  it('reports usage and the answering model when the stream carries them', async () => {
    stubFetch(() => sseResponse([
      `data: ${JSON.stringify({ model: 'who/actually-answered', choices: [{ delta: { content: 'hi' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { completion_tokens: 11 } })}\n\n`,
      DONE,
    ]))
    const r = await new HostedChatAdapter(cfg({ streaming: true }))
      .generate({ system: 's', user: 'u', onToken: () => {} })
    expect(r.model).toBe('who/actually-answered')
    expect(r.outputTokens).toBe(11)
  })

  it('a throwing onToken is the caller\'s problem, not a provider failure', async () => {
    stubFetch(() => sseResponse([delta('a'), delta('b'), DONE]))
    const r = await new HostedChatAdapter(cfg({ streaming: true })).generate({
      system: 's', user: 'u', onToken: () => { throw new Error('UI blew up') },
    })
    expect(r.text).toBe('ab')
  })
})

/* ------------------------------------------------------- stream failure */

describe('a stream that stops early is NOT a successful answer', () => {
  it('throws when [DONE] never arrives', async () => {
    /**
     * THE PROPERTY THAT MATTERS MOST. Returning the partial text would hand
     * the orchestrator a truncated answer that looks finished, and a
     * truncated agricultural instruction is worse than no instruction.
     */
    stubFetch(() => sseResponse([delta('Apply 2 bags per'), delta(' hectare of')]))
    await expect(new HostedChatAdapter(cfg({ streaming: true }))
      .generate({ system: 's', user: 'u', onToken: () => {} }))
      .rejects.toThrow(/ended the stream before finishing/i)
  })

  it('an upstream error mid-stream fails, and says nothing about its contents', async () => {
    stubFetch(() => sseResponse([
      delta('partial'),
      `data: ${JSON.stringify({ error: { message: 'account 42 over quota', key: TOKEN } })}\n\n`,
    ]))
    try {
      await new HostedChatAdapter(cfg({ streaming: true }))
        .generate({ system: 's', user: 'u', onToken: () => {} })
      throw new Error('should have thrown')
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toMatch(/error mid-stream/i)
      expect(msg).not.toContain(TOKEN)
      expect(msg).not.toContain('account 42')
      expect(msg).not.toContain('quota')
    }
  })

  it('an empty stream is a failure, not an empty answer', async () => {
    stubFetch(() => sseResponse([DONE]))
    await expect(new HostedChatAdapter(cfg({ streaming: true }))
      .generate({ system: 's', user: 'u', onToken: () => {} }))
      .rejects.toThrow(/empty answer/i)
  })

  it('a missing body is a failure', async () => {
    stubFetch(() => new Response(null, { status: 200 }))
    await expect(new HostedChatAdapter(cfg({ streaming: true }))
      .generate({ system: 's', user: 'u', onToken: () => {} }))
      .rejects.toThrow(/no stream/i)
  })

  it('an HTTP error is mapped before any stream is read', async () => {
    stubFetch(() => okJson({ error: 'nope' }, 429))
    await expect(new HostedChatAdapter(cfg({ streaming: true }))
      .generate({ system: 's', user: 'u', onToken: () => {} }))
      .rejects.toThrow(/rate limiting/i)
  })

  it('never falls back to another model after partial output', async () => {
    const calls = stubFetch(() => sseResponse([delta('half an answer')]))
    await expect(new HostedChatAdapter(cfg({ streaming: true }))
      .generate({ system: 's', user: 'u', onToken: () => {} })).rejects.toThrow()
    expect(calls, 'exactly one request, no retry and no second model').toHaveLength(1)
    expect(calls[0].url).not.toContain('11434')
  })
})

/* -------------------------------------------------------- cancellation */

describe('cancellation is distinguished from failure', () => {
  it('a caller abort BEFORE connecting is a cancellation', async () => {
    stubFetch(() => { const e = new Error('aborted'); e.name = 'AbortError'; throw e })
    const ac = new AbortController()
    ac.abort()
    await expect(new HostedChatAdapter(cfg())
      .generate({ system: 's', user: 'u', signal: ac.signal }))
      .rejects.toThrow(ModelCancelled)
  })

  it('a timeout is reported as a timeout, not a cancellation', async () => {
    stubFetch(() => { const e = new Error('slow'); e.name = 'TimeoutError'; throw e })
    const p = new HostedChatAdapter(cfg()).generate({ system: 's', user: 'u' })
    await expect(p).rejects.toThrow(ModelUnavailable)
    await expect(p).rejects.toThrow(/took too long/i)
  })

  it('an abort DURING a stream is a cancellation, not a truncated answer', async () => {
    const ac = new AbortController()
    const encoder = new TextEncoder()
    stubFetch(() => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        // Deliver one token, then the caller changes their mind.
        controller.enqueue(encoder.encode(delta('start')))
        ac.abort()
        throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      },
    }), { status: 200 }))

    await expect(new HostedChatAdapter(cfg({ streaming: true }))
      .generate({ system: 's', user: 'u', signal: ac.signal, onToken: () => {} }))
      .rejects.toThrow(ModelCancelled)
  })

  it('the caller signal is combined with the deadline, not replaced by it', async () => {
    const calls = stubFetch(() => okJson(COMPLETION))
    const ac = new AbortController()
    await new HostedChatAdapter(cfg()).generate({ system: 's', user: 'u', signal: ac.signal })
    const signal = calls[0].init.signal as AbortSignal
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
  })

  it('aborting the caller signal aborts the request signal', async () => {
    const calls = stubFetch(() => okJson(COMPLETION))
    const ac = new AbortController()
    await new HostedChatAdapter(cfg()).generate({ system: 's', user: 'u', signal: ac.signal })
    const signal = calls[0].init.signal as AbortSignal
    ac.abort()
    expect(signal.aborted, 'the combined signal must follow the caller').toBe(true)
  })
})
