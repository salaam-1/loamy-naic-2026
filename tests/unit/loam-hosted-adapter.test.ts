import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HF_ROUTER_BASE_URL, HostedChatAdapter, assertHostedConfig, hostedAdapterFromEnv,
} from '@/lib/loam/model/hosted'
import {
  MockAdapter, ModelConfigurationError, ModelUnavailable, OllamaAdapter,
  adapterCapabilities, adapterSupports,
} from '@/lib/loam/model/adapter'

/**
 * The hosted OpenAI-compatible adapter.
 *
 * WHAT THESE TESTS ESTABLISH AND WHAT THEY CANNOT
 *   They establish that the adapter speaks the protocol correctly: the right
 *   URL, the right headers, the configured model and nothing else, `stream:
 *   false`, and a distinct sanitized failure for every class of error.
 *
 *   They establish NOTHING about whether N-ATLaS is hosted. It is not: the
 *   repo carries an empty `inferenceProviderMapping`, the router lists 127
 *   servable models with no NCAIR entry, and a warm+author query returns zero
 *   against a working positive control. Every response below is a fixture.
 *   **This adapter has never completed a real inference call.**
 */

/**
 * A fixture, prefixed so `no-hardcoded-credentials.test.ts` recognises it as
 * a placeholder rather than a leaked secret. That guard exists because an
 * admin fixture once sat in a helper for 16 published commits, and satisfying
 * it by its own allowlist is the right way to pass it.
 */
const TOKEN = 'PLACEHOLDER-not-a-real-credential'
const MODEL = 'some-provider/some-model'

function cfg(over: Partial<Parameters<typeof assertHostedConfig>[0]> = {}) {
  return { baseUrl: HF_ROUTER_BASE_URL, model: MODEL, token: TOKEN, ...over }
}

/** A fetch stub that records what it was asked to send. */
function stubFetch(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = []
  const fn = vi.fn(async (url: unknown, init?: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit })
    return responder(String(url), (init ?? {}) as RequestInit)
  })
  vi.stubGlobal('fetch', fn)
  return calls
}

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const COMPLETION = {
  id: 'chatcmpl-fixture',
  model: MODEL,
  choices: [{ message: { content: 'Maize is a cereal grain.' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 20, completion_tokens: 7, total_tokens: 27 },
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

/* ------------------------------------------------- backward compatibility */

describe('the contract extension is additive', () => {
  it('existing adapters keep working and now declare what they can do', () => {
    const ollama = new OllamaAdapter({ url: 'http://127.0.0.1:11434', model: 'natlas-q4km:latest' })
    expect(ollama.name).toBe('ollama')
    expect(adapterSupports(ollama, 'text')).toBe(true)
    // Measured against that host, not assumed.
    expect(adapterSupports(ollama, 'streaming')).toBe(true)
    expect(adapterSupports(ollama, 'tools')).toBe(true)
    expect(adapterSupports(ollama, 'json')).toBe(true)
  })

  it('a double that declares nothing is read as text-only, not as nothing', () => {
    // `capabilities` is optional precisely so an older adapter or an external
    // test double stays valid.
    const bare = {
      name: 'bare',
      available: async () => true,
      generate: async () => ({ text: 'x', ms: 1, model: 'bare' }),
    }
    expect(adapterCapabilities(bare)).toEqual(['text'])
    expect(adapterSupports(bare, 'text')).toBe(true)
    expect(adapterSupports(bare, 'streaming')).toBe(false)
  })

  it('MockAdapter is unchanged in behaviour', async () => {
    const m = new MockAdapter('hello')
    const r = await m.generate({ system: 's', user: 'u' })
    expect(r.text).toBe('hello')
    expect(adapterCapabilities(m)).toEqual(['text'])
  })
})

/* -------------------------------------------------------- configuration */

describe('configuration is validated before a request can be built', () => {
  it('refuses a missing model rather than defaulting one', () => {
    /**
     * The safeguard that matters most. `meta-llama/Llama-3.1-8B-Instruct`
     * is Llama 3.1, not N-ATLaS, and a default would mean answering
     * agricultural questions with a model nobody chose.
     */
    expect(() => assertHostedConfig(cfg({ model: '' }))).toThrow(ModelConfigurationError)
    expect(() => assertHostedConfig(cfg({ model: '   ' }))).toThrow(/no default/i)
  })

  it('refuses a missing credential', () => {
    expect(() => assertHostedConfig(cfg({ token: '' }))).toThrow(ModelConfigurationError)
    expect(() => assertHostedConfig(cfg({ token: '' }))).toThrow(/credential is required/i)
  })

  it('refuses plaintext HTTP, because a bearer token would travel in the clear', () => {
    expect(() => assertHostedConfig(cfg({ baseUrl: 'http://router.huggingface.co/v1' })))
      .toThrow(/not HTTPS/i)
  })

  it('allows loopback so a test can point at a stub', () => {
    expect(() => assertHostedConfig(cfg({ baseUrl: 'http://127.0.0.1:9999/v1' }))).not.toThrow()
  })

  it('refuses a malformed URL', () => {
    expect(() => assertHostedConfig(cfg({ baseUrl: 'not a url' }))).toThrow(/not a valid URL/i)
  })

  it('a constructor cannot produce a misconfigured adapter', () => {
    expect(() => new HostedChatAdapter(cfg({ model: '' }))).toThrow(ModelConfigurationError)
  })
})

/* ------------------------------------------------------ the request sent */

describe('the request is exactly what the API expects', () => {
  it('posts to /chat/completions on the configured base', async () => {
    const calls = stubFetch(() => ok(COMPLETION))
    await new HostedChatAdapter(cfg()).generate({ system: 's', user: 'u' })
    expect(calls[0].url).toBe('https://router.huggingface.co/v1/chat/completions')
  })

  it('tolerates a trailing slash on the base URL', async () => {
    const calls = stubFetch(() => ok(COMPLETION))
    await new HostedChatAdapter(cfg({ baseUrl: `${HF_ROUTER_BASE_URL}/` }))
      .generate({ system: 's', user: 'u' })
    expect(calls[0].url).toBe('https://router.huggingface.co/v1/chat/completions')
  })

  it('sends the credential as a bearer header', async () => {
    const calls = stubFetch(() => ok(COMPLETION))
    await new HostedChatAdapter(cfg()).generate({ system: 's', user: 'u' })
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('sends the configured model and never a substitute', async () => {
    const calls = stubFetch(() => ok(COMPLETION))
    await new HostedChatAdapter(cfg()).generate({ system: 's', user: 'u' })
    const body = JSON.parse(String(calls[0].init.body))
    expect(body.model).toBe(MODEL)
    expect(body.model).not.toMatch(/llama/i)
  })

  it('sends stream: false', async () => {
    // The guard inspects the whole answer before any of it is shown.
    const calls = stubFetch(() => ok(COMPLETION))
    await new HostedChatAdapter(cfg()).generate({ system: 's', user: 'u' })
    expect(JSON.parse(String(calls[0].init.body)).stream).toBe(false)
  })

  it('still sends stream: false when onToken is supplied', async () => {
    /**
     * `onToken` is an extension point, not a render path. Passing one must not
     * turn streaming on behind the guard's back.
     */
    const calls = stubFetch(() => ok(COMPLETION))
    const onToken = vi.fn()
    await new HostedChatAdapter(cfg()).generate({ system: 's', user: 'u', onToken })
    expect(JSON.parse(String(calls[0].init.body)).stream).toBe(false)
    expect(onToken, 'nothing may be emitted token-by-token yet').not.toHaveBeenCalled()
  })

  it('serializes system and user as separate messages, in order', async () => {
    const calls = stubFetch(() => ok(COMPLETION))
    await new HostedChatAdapter(cfg()).generate({ system: 'SYS', user: 'USR' })
    expect(JSON.parse(String(calls[0].init.body)).messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USR' },
    ])
  })

  it('passes generation settings through', async () => {
    const calls = stubFetch(() => ok(COMPLETION))
    await new HostedChatAdapter(cfg())
      .generate({ system: 's', user: 'u', maxTokens: 99, temperature: 0.11 })
    const body = JSON.parse(String(calls[0].init.body))
    expect(body.max_tokens).toBe(99)
    expect(body.temperature).toBe(0.11)
  })

  it('preserves non-ASCII content byte-for-byte', async () => {
    const calls = stubFetch(() => ok(COMPLETION))
    const user = 'Yaushe zan shuka masara a ƙasar Kaduna? Ìgbà wo? Kedu mgbe ị ga-akụ ọka?'
    await new HostedChatAdapter(cfg()).generate({ system: 's', user })
    expect(JSON.parse(String(calls[0].init.body)).messages[1].content).toBe(user)
  })
})

/* ----------------------------------------------------- response parsing */

describe('the response is read from the documented shape', () => {
  it('returns the assistant content', async () => {
    stubFetch(() => ok(COMPLETION))
    const r = await new HostedChatAdapter(cfg()).generate({ system: 's', user: 'u' })
    expect(r.text).toBe('Maize is a cereal grain.')
    expect(r.outputTokens).toBe(7)
    expect(typeof r.ms).toBe('number')
  })

  it('reports the model that ANSWERED, not the one requested', async () => {
    /**
     * If a provider silently routes to another build, that must be visible
     * rather than hidden behind the configured name.
     */
    stubFetch(() => ok({ ...COMPLETION, model: 'someone-else/other-build' }))
    const r = await new HostedChatAdapter(cfg()).generate({ system: 's', user: 'u' })
    expect(r.model).toBe('someone-else/other-build')
    expect(r.model).not.toBe(MODEL)
  })

  it('falls back to the configured name when the host omits one', async () => {
    stubFetch(() => ok({ choices: [{ message: { content: 'x' } }] }))
    const r = await new HostedChatAdapter(cfg()).generate({ system: 's', user: 'u' })
    expect(r.model).toBe(MODEL)
  })
})

/* ------------------------------------------------------- failure classes */

describe('every failure class is distinct and says nothing sensitive', () => {
  const cases: [number, RegExp][] = [
    [401, /rejected our credentials/i],
    [403, /rejected our credentials/i],
    [404, /does not serve/i],
    [400, /malformed/i],
    [422, /malformed/i],
    [429, /rate limiting/i],
    [500, /returned 500/i],
    [503, /returned 503/i],
  ]

  for (const [status, expected] of cases) {
    it(`HTTP ${status}`, async () => {
      stubFetch(() => ok({ error: { message: 'upstream detail', quota: 'sensitive' } }, status))
      const adapter = new HostedChatAdapter(cfg())
      await expect(adapter.generate({ system: 's', user: 'u' })).rejects.toThrow(ModelUnavailable)
      await expect(adapter.generate({ system: 's', user: 'u' })).rejects.toThrow(expected)
    })
  }

  it('never leaks the credential or the upstream body into an error', async () => {
    stubFetch(() => ok({ error: { message: 'account 123 over quota', key: TOKEN } }, 429))
    try {
      await new HostedChatAdapter(cfg()).generate({ system: 's', user: 'u' })
      throw new Error('should have thrown')
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).not.toContain(TOKEN)
      expect(msg).not.toContain('Bearer')
      expect(msg).not.toContain('account 123')
      expect(msg).not.toContain('over quota')
    }
  })

  it('a network error is unavailable, not a crash', async () => {
    stubFetch(() => { throw new TypeError('fetch failed') })
    await expect(new HostedChatAdapter(cfg()).generate({ system: 's', user: 'u' }))
      .rejects.toThrow(/could not be reached/i)
  })

  it('a timeout is reported as a timeout', async () => {
    stubFetch(() => {
      const e = new Error('timed out'); e.name = 'TimeoutError'; throw e
    })
    await expect(new HostedChatAdapter(cfg()).generate({ system: 's', user: 'u' }))
      .rejects.toThrow(/took too long/i)
  })

  it('malformed JSON is unavailable, not a parse crash', async () => {
    stubFetch(() => new Response('not json', { status: 200 }))
    await expect(new HostedChatAdapter(cfg()).generate({ system: 's', user: 'u' }))
      .rejects.toThrow(/could not read/i)
  })

  it('an empty completion is a failure, not an empty answer', async () => {
    stubFetch(() => ok({ model: MODEL, choices: [{ message: { content: '   ' } }] }))
    await expect(new HostedChatAdapter(cfg()).generate({ system: 's', user: 'u' }))
      .rejects.toThrow(/empty answer/i)
  })

  it('a response with no choices is a failure', async () => {
    stubFetch(() => ok({ model: MODEL, choices: [] }))
    await expect(new HostedChatAdapter(cfg()).generate({ system: 's', user: 'u' }))
      .rejects.toThrow(ModelUnavailable)
  })

  it('a failure NEVER reaches another model', async () => {
    /**
     * The adapter must not fall back. It imports nothing about Ollama, so a
     * hosted failure cannot quietly become a local answer -- that choice
     * belongs to whoever selected the adapter, where it is visible.
     */
    const calls = stubFetch(() => ok({ error: 'nope' }, 500))
    await expect(new HostedChatAdapter(cfg()).generate({ system: 's', user: 'u' }))
      .rejects.toThrow(ModelUnavailable)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).not.toContain('11434')
    expect(calls.some((c) => c.url.includes('/api/chat'))).toBe(false)
  })
})

/* -------------------------------- availability is not compatibility */

describe('availability is separate from compatibility', () => {
  it('is available only when the provider lists the configured model', async () => {
    stubFetch(() => ok({ data: [{ id: MODEL }, { id: 'other/model' }] }))
    await expect(new HostedChatAdapter(cfg()).available()).resolves.toBe(true)
  })

  it('is NOT available when the provider does not serve it', async () => {
    /**
     * The real case today. The router lists 127 servable models and none is
     * NCAIR's, so a correctly configured N-ATLaS adapter still reports
     * unavailable -- which is the honest answer.
     */
    stubFetch(() => ok({ data: [{ id: 'meta-llama/Llama-3.1-8B-Instruct' }] }))
    await expect(
      new HostedChatAdapter(cfg({ model: 'NCAIR1/N-ATLaS' })).available(),
    ).resolves.toBe(false)
  })

  it('is not available when the listing itself fails', async () => {
    stubFetch(() => ok({ error: 'unauthorized' }, 401))
    await expect(new HostedChatAdapter(cfg()).available()).resolves.toBe(false)
  })

  it('is not available when the network is down, without throwing', async () => {
    stubFetch(() => { throw new TypeError('fetch failed') })
    await expect(new HostedChatAdapter(cfg()).available()).resolves.toBe(false)
  })

  it('declares only text, because nothing else has been measured here', () => {
    stubFetch(() => ok(COMPLETION))
    const a = new HostedChatAdapter(cfg())
    expect(adapterCapabilities(a)).toEqual(['text'])
    expect(adapterSupports(a, 'streaming')).toBe(false)
    expect(adapterSupports(a, 'json')).toBe(false)
  })
})

/* ------------------------------------------------------ env construction */

describe('hostedAdapterFromEnv', () => {
  it('returns null when nothing is configured, because that is not an error', () => {
    expect(hostedAdapterFromEnv({})).toBeNull()
  })

  it('defaults the base URL to the documented router', () => {
    const a = hostedAdapterFromEnv({ LOAM_HOSTED_MODEL: MODEL, LOAM_HOSTED_TOKEN: TOKEN })
    expect(a).not.toBeNull()
    expect(a!.name).toBe('hosted-openai-compatible')
  })

  it('throws on a half-configuration rather than reading it as absence', () => {
    // A token with no model is a typo, not "no hosted provider".
    expect(() => hostedAdapterFromEnv({ LOAM_HOSTED_TOKEN: TOKEN }))
      .toThrow(ModelConfigurationError)
    expect(() => hostedAdapterFromEnv({ LOAM_HOSTED_MODEL: MODEL }))
      .toThrow(ModelConfigurationError)
  })
})

/* ------------------------------- the local path is untouched by all this */

describe('the local path is unaffected', () => {
  let warned: string[] = []
  beforeEach(() => { warned = [] })

  it('the Ollama adapter still targets the local host and pinned model', async () => {
    const calls = stubFetch(() => ok({ message: { content: 'local answer' }, eval_count: 3 }))
    const r = await new OllamaAdapter({
      url: 'http://127.0.0.1:11434', model: 'natlas-q4km:latest',
    }).generate({ system: 's', user: 'u' })
    expect(calls[0].url).toBe('http://127.0.0.1:11434/api/chat')
    expect(JSON.parse(String(calls[0].init.body)).model).toBe('natlas-q4km:latest')
    expect(JSON.parse(String(calls[0].init.body)).stream).toBe(false)
    expect(r.text).toBe('local answer')
    expect(warned).toHaveLength(0)
  })

  it('nothing in the hosted module references Ollama', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('src/lib/loam/model/hosted.ts', 'utf8'))
    expect(src).not.toContain('11434')
    expect(src).not.toContain('/api/chat')
    expect(src).not.toContain('natlas-q4km')
  })
})
