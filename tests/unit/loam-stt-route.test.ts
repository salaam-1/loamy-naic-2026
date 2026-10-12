import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /loam/stt/transcribe -- the authenticated dev-server route.
 *
 * WHAT THESE TESTS ARE FOR
 *   This route is the only thing standing between a browser and a process
 *   holding a shared secret and a 922 MiB model. The properties worth pinning
 *   are: it does not exist unless a flag says so, it refuses anyone without a
 *   valid JWT, it refuses cheaply before reading a body, it never returns a
 *   blank transcript as success, and it never writes a credential or a
 *   transcript into a log.
 *
 *   The Python worker is not started. Every test stubs `fetch`, so no model
 *   is loaded and no inference runs.
 */

const getUser = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser } }),
}))

const { registerLoamSttRoute } = await import('../../scripts/loam-stt-route')

/* --------------------------------------------------------------- harness */

const SECRET = 'z'.repeat(40)
const ENV = {
  LOAM_STT_ENABLED: '1',
  LOAM_STT_WORKER_PORT: '8111',
  LOAM_STT_WORKER_SECRET: SECRET,
  VITE_SUPABASE_URL: 'http://localhost:54321',
  VITE_SUPABASE_ANON_KEY: 'anon-key-for-tests',
}

type Handler = (req: unknown, res: unknown) => unknown

function makeServer() {
  const routes = new Map<string, Handler>()
  const logs: string[] = []
  const record = (m: unknown) => { logs.push(String(m)) }
  return {
    routes,
    logs,
    middlewares: { use: (path: string, h: Handler) => { routes.set(path, h) } },
    config: { logger: { info: record, warn: record, error: record } },
  }
}

function makeReq(body: Buffer, headers: Record<string, string>, method = 'POST') {
  const r = Readable.from(body.length ? [body] : []) as unknown as Record<string, unknown>
  r.headers = headers
  r.method = method
  return r
}

function makeRes() {
  const res = new EventEmitter() as unknown as Record<string, unknown> & {
    statusCode: number; body: string; headers: Record<string, string>
  }
  res.statusCode = 0
  res.body = ''
  res.headers = {}
  res.writableEnded = false
  res.setHeader = (k: string, v: string) => { res.headers[k] = v }
  res.end = (b?: string) => { res.body = b ?? ''; res.writableEnded = true }
  return res
}

/** A real 16 kHz mono WAV, so the route's RIFF check passes honestly. */
function wavBytes(seconds = 1): Buffer {
  const rate = 16_000, bytesPerFrame = 2
  const dataBytes = Math.round(rate * seconds) * bytesPerFrame
  const b = Buffer.alloc(44 + dataBytes)
  b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(36 + dataBytes, 4); b.write('WAVE', 8, 'latin1')
  b.write('fmt ', 12, 'latin1'); b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24)
  b.writeUInt32LE(rate * bytesPerFrame, 28); b.writeUInt16LE(bytesPerFrame, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36, 'latin1'); b.writeUInt32LE(dataBytes, 40)
  return b
}

const WAV = wavBytes(2)
const JWT = 'header.payload.signature-for-tests'

const HEADERS = {
  authorization: `Bearer ${JWT}`,
  'content-type': 'application/octet-stream',
  'content-length': String(WAV.length),
  'x-loam-language': 'yo',
}

/** Register, then call the route once. Returns the response and the logs. */
async function call(
  over: { env?: Record<string, string>; headers?: Record<string, string>
    body?: Buffer; method?: string } = {},
) {
  const server = makeServer()
  registerLoamSttRoute(server as never, { ...ENV, ...(over.env ?? {}) })
  const handler = server.routes.get('/loam/stt/transcribe')
  if (!handler) return { registered: false, server, res: null as never }
  const res = makeRes()
  await handler(
    makeReq(over.body ?? WAV, { ...HEADERS, ...(over.headers ?? {}) }, over.method),
    res,
  )
  return { registered: true, server, res }
}

const workerOk = (body: unknown, status = 200) => vi.fn(async () => new Response(
  JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } },
))

beforeEach(() => {
  getUser.mockReset()
  getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/* ------------------------------------------------------- not registered */

describe('the route does not exist unless it is switched on', () => {
  it('registers nothing when the flag is absent', async () => {
    const fetchSpy = workerOk({ text: 'nope' })
    vi.stubGlobal('fetch', fetchSpy)
    const r = await call({ env: { LOAM_STT_ENABLED: '' } })
    expect(r.registered).toBe(false)
    // Disabled means no middleware at all -- not a route that 503s.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('treats only explicit truthy values as enabled', async () => {
    for (const flag of ['0', 'false', 'no', 'off', '']) {
      const r = await call({ env: { LOAM_STT_ENABLED: flag } })
      expect(r.registered, flag).toBe(false)
    }
    for (const flag of ['1', 'true', 'yes', 'TRUE']) {
      const r = await call({ env: { LOAM_STT_ENABLED: flag } })
      expect(r.registered, flag).toBe(true)
    }
  })

  it('refuses to register with a missing or weak secret, and says so', async () => {
    for (const secret of ['', 'short', 'x'.repeat(31)]) {
      const server = makeServer()
      registerLoamSttRoute(server as never, { ...ENV, LOAM_STT_WORKER_SECRET: secret })
      expect(server.routes.size, secret.length.toString()).toBe(0)
      expect(server.logs.join(' ')).toMatch(/REFUSED/)
    }
  })

  it('refuses to register with an invalid port', async () => {
    for (const port of ['', 'abc', '0', '80', '70000', '-1']) {
      const server = makeServer()
      registerLoamSttRoute(server as never, { ...ENV, LOAM_STT_WORKER_PORT: port })
      expect(server.routes.size, port).toBe(0)
    }
  })

  it('never writes the secret into a startup log, enabled or disabled', async () => {
    const enabled = makeServer()
    registerLoamSttRoute(enabled as never, ENV)
    const disabled = makeServer()
    registerLoamSttRoute(disabled as never, { ...ENV, LOAM_STT_ENABLED: '' })
    for (const s of [enabled, disabled]) {
      expect(s.logs.join('\n')).not.toContain(SECRET)
    }
  })
})

/* ----------------------------------------------------- authentication */

describe('a valid authenticated user is required', () => {
  it('rejects a missing token without calling the worker', async () => {
    const fetchSpy = workerOk({ text: 'nope' })
    vi.stubGlobal('fetch', fetchSpy)
    const { res } = await call({ headers: { authorization: '' } })
    expect(res.statusCode).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects an invalid token rather than downgrading to anonymous', async () => {
    /**
     * The deliberate difference from /loam/chat, which treats a token as
     * optional. Transcription costs a model and carries a voice, so there is
     * no anonymous path here.
     */
    const fetchSpy = workerOk({ text: 'nope' })
    vi.stubGlobal('fetch', fetchSpy)
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } })
    const { res } = await call()
    expect(res.statusCode).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects a token that resolves to no user id', async () => {
    vi.stubGlobal('fetch', workerOk({ text: 'nope' }))
    getUser.mockResolvedValue({ data: { user: {} }, error: null })
    const { res } = await call()
    expect(res.statusCode).toBe(401)
  })

  it('rejects a non-POST method', async () => {
    const { res } = await call({ method: 'GET' })
    expect(res.statusCode).toBe(405)
  })
})

/* ------------------------------------------------------------ validation */

describe('requests are refused cheaply, before the worker is involved', () => {
  it('rejects the wrong content type', async () => {
    const fetchSpy = workerOk({ text: 'nope' })
    vi.stubGlobal('fetch', fetchSpy)
    for (const ct of ['application/json', 'audio/webm', 'text/plain', '']) {
      const { res } = await call({ headers: { 'content-type': ct } })
      expect(res.statusCode, ct).toBe(415)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects an oversized declared length on the header alone', async () => {
    const fetchSpy = workerOk({ text: 'nope' })
    vi.stubGlobal('fetch', fetchSpy)
    const { res } = await call({ headers: { 'content-length': String(2_000_001) } })
    expect(res.statusCode).toBe(413)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects an unroutable language instead of substituting a model', async () => {
    const fetchSpy = workerOk({ text: 'nope' })
    vi.stubGlobal('fetch', fetchSpy)
    // 'pcm' is NOT here any more: Nigerian Pidgin is routable. Its model is
    // not installed, which the worker reports as 503 -- a different state
    // from "that language is not offered".
    for (const lang of ['', 'fr', 'sw', 'ar', 'zz']) {
      const { res } = await call({ headers: { 'x-loam-language': lang } })
      expect(res.statusCode, lang).toBe(400)
      expect(JSON.parse(res.body).languages).toEqual(['en', 'ha', 'ig', 'pcm', 'yo'])
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('routes all five languages, each to its own model', async () => {
    /**
     * Five SEPARATE models. A wrong route is not a degraded transcript, it is
     * fluent text in the wrong language, so what matters is that the language
     * asked for is the language forwarded -- unchanged, unnormalised, with no
     * nearest match.
     */
    for (const lang of ['en', 'ha', 'ig', 'pcm', 'yo']) {
      const fetchSpy = workerOk({ text: 'something', verified: lang !== 'pcm' })
      vi.stubGlobal('fetch', fetchSpy)
      const { res } = await call({ headers: { 'x-loam-language': lang } })
      expect(res.statusCode, lang).toBe(200)
      const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
      expect((init.headers as Record<string, string>)['X-Loam-Language'], lang).toBe(lang)
      expect(JSON.parse(res.body).language, lang).toBe(lang)
    }
  })

  it('routes each available language to the worker with that language', async () => {
    for (const lang of ['yo', 'en', 'ha']) {
      const fetchSpy = workerOk({ text: 'something', verified: lang === 'yo' })
      vi.stubGlobal('fetch', fetchSpy)
      const { res } = await call({ headers: { 'x-loam-language': lang } })
      expect(res.statusCode, lang).toBe(200)
      const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
      // The language asked for is the language forwarded. No translation,
      // no normalisation, no nearest match.
      expect((init.headers as Record<string, string>)['X-Loam-Language']).toBe(lang)
      expect(JSON.parse(res.body).language).toBe(lang)
    }
  })

  it('rejects an empty body', async () => {
    vi.stubGlobal('fetch', workerOk({ text: 'nope' }))
    const { res } = await call({ body: Buffer.alloc(0), headers: { 'content-length': '0' } })
    expect(res.statusCode).toBe(400)
  })

  it('rejects bytes that are not a WAV file, whatever the headers said', async () => {
    const fetchSpy = workerOk({ text: 'nope' })
    vi.stubGlobal('fetch', fetchSpy)
    const webm = Buffer.alloc(200)
    webm.writeUInt32BE(0x1a45dfa3, 0) // EBML magic: a WebM blob
    const { res } = await call({ body: webm, headers: { 'content-length': '200' } })
    expect(res.statusCode).toBe(415)
    expect(JSON.parse(res.body).error).toMatch(/not a WAV/i)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

/* ---------------------------------------------------------- the worker */

describe('talking to the worker', () => {
  it('authenticates with the server-side secret over loopback only', async () => {
    const fetchSpy = workerOk({ text: 'bale o', audioSeconds: 2, inferenceMs: 5200 })
    vi.stubGlobal('fetch', fetchSpy)
    const { res } = await call()
    expect(res.statusCode).toBe(200)

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8111/transcribe')
    const headers = init.headers as Record<string, string>
    expect(headers['X-Loam-Worker-Secret']).toBe(SECRET)
    expect(headers['X-Loam-Language']).toBe('yo')
    expect(headers['Content-Type']).toBe('application/octet-stream')
  })

  it('returns only the transcript and its metadata', async () => {
    vi.stubGlobal('fetch', workerOk({
      text: 'bale o', audioSeconds: 2, inferenceMs: 5200,
      model: 'NCAIR1/Yoruba-ASR', languageForced: 'yo',
    }))
    const { res } = await call()
    const body = JSON.parse(res.body)
    expect(body.text).toBe('bale o')
    expect(body.language).toBe('yo')
    expect(body.audioSeconds).toBe(2)
    // No user id echoed, no worker address, no model id, no model key.
    expect(Object.keys(body).sort()).toEqual(
      ['audioSeconds', 'inferenceMs', 'language', 'provider', 'text', 'verified'],
    )
    expect(body.model).toBeUndefined()
    expect(body.modelKey).toBeUndefined()
  })

  it('never defaults `verified` to true when the worker omits it', async () => {
    /**
     * An absent field must not read as "a person checked this". The fallback
     * is this route's own verified list, which is Yoruba alone.
     */
    vi.stubGlobal('fetch', workerOk({ text: 'i wan know price of maize' }))
    const pcm = await call({ headers: { 'x-loam-language': 'pcm' } })
    expect(JSON.parse(pcm.res.body).verified).toBe(false)

    vi.stubGlobal('fetch', workerOk({ text: 'bale o' }))
    const yo = await call({ headers: { 'x-loam-language': 'yo' } })
    expect(JSON.parse(yo.res.body).verified).toBe(true)
  })

  it('trusts the worker over its own list when the worker reports verification', async () => {
    // The worker owns the model registry, so its answer wins -- including
    // when it says a language this route thought was fine is not.
    vi.stubGlobal('fetch', workerOk({ text: 'bale o', verified: false }))
    const { res } = await call({ headers: { 'x-loam-language': 'yo' } })
    expect(JSON.parse(res.body).verified).toBe(false)
  })

  it('passes diacritics through byte for byte', async () => {
    /**
     * The real Igbo transcript from the local model. If the route normalised,
     * escaped or re-encoded anything, this is where it would show: those are
     * dotted-below vowels, not ASCII lookalikes.
     */
    const igbo = 'afọ ọhụrụ ga-adị mma'
    vi.stubGlobal('fetch', workerOk({ text: igbo, verified: true }))
    const { res } = await call({ headers: { 'x-loam-language': 'ig' } })
    const returned = JSON.parse(res.body).text
    expect(returned).toBe(igbo)
    expect([...returned].filter((c) => c.codePointAt(0)! > 127).join('')).toBe('ọọụụị')
  })

  it('marks an unverified transcript in the log', async () => {
    vi.stubGlobal('fetch', workerOk({ text: 'i wan know price', verified: false, modelKey: 'pidgin' }))
    const { server } = await call({ headers: { 'x-loam-language': 'pcm' } })
    expect(server.logs.join('\n')).toMatch(/UNVERIFIED language/)
  })

  it('reports a missing model as 503 and not as a bad request', async () => {
    // The worker says the files are not cached. That is a configuration
    // state, not something the caller got wrong.
    vi.stubGlobal('fetch', workerOk(
      { error: "That language's transcriber is not installed.", retryable: false }, 503,
    ))
    const { res } = await call({ headers: { 'x-loam-language': 'pcm' } })
    expect(res.statusCode).toBe(503)
    expect(JSON.parse(res.body).error).toMatch(/not installed/i)
  })

  it('refuses a blank transcript the worker returned with status 200', async () => {
    for (const body of [{ text: '' }, { text: '   ' }, { text: null }, {}]) {
      vi.stubGlobal('fetch', workerOk(body))
      const { res } = await call()
      expect(res.statusCode, JSON.stringify(body)).toBe(422)
    }
  })

  it('reports an unreachable worker as 503, not as a crash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    const { res, server } = await call()
    expect(res.statusCode).toBe(503)
    expect(JSON.parse(res.body).error).toMatch(/not running/i)
    // The log says unreachable; it does not quote the error or the address.
    expect(server.logs.join(' ')).not.toContain(SECRET)
  })

  it('reports a timeout as 504', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const e = new Error('aborted'); e.name = 'AbortError'; throw e
    }))
    const { res } = await call()
    expect(res.statusCode).toBe(504)
  })

  it('passes through the worker statuses it recognises', async () => {
    for (const status of [400, 413, 415, 422, 503, 504]) {
      vi.stubGlobal('fetch', workerOk({ error: 'worker said no' }, status))
      const { res } = await call()
      expect(res.statusCode, String(status)).toBe(status)
    }
  })

  it('does not forward an unrecognised worker status or its body', async () => {
    // A 401 from the worker means OUR secret was wrong -- an internal fault.
    // Surfacing it verbatim would tell a member about the worker's auth.
    vi.stubGlobal('fetch', workerOk({ error: 'unauthorized' }, 401))
    const { res } = await call()
    expect(res.statusCode).toBe(502)
    expect(JSON.parse(res.body).error).toBe('Transcription failed.')
  })
})

/* ------------------------------------------------------------- logging */

describe('nothing sensitive reaches a log', () => {
  it('logs no JWT, no secret and no transcript on success', async () => {
    const transcript = 'bale o se daadaa ni oko mi'
    vi.stubGlobal('fetch', workerOk({ text: transcript, audioSeconds: 2, inferenceMs: 5200 }))
    const { server, res } = await call()
    expect(res.statusCode).toBe(200)

    const logs = server.logs.join('\n')
    expect(logs).not.toContain(SECRET)
    expect(logs).not.toContain(JWT)
    expect(logs).not.toContain(transcript)
    expect(logs).not.toContain('user-1')
    // What it DOES record: the language, a size, and a character count.
    expect(logs).toMatch(/STT yo/)
    expect(logs).toMatch(new RegExp(`${transcript.length} chars`))
  })

  it('logs only an error NAME on an unexpected failure', async () => {
    getUser.mockRejectedValue(new Error(`boom https://project.supabase.co?apikey=${SECRET}`))
    vi.stubGlobal('fetch', workerOk({ text: 'nope' }))
    const { res, server } = await call()
    expect(res.statusCode).toBe(500)
    // A thrown Supabase error can quote a URL with a key in it.
    expect(server.logs.join('\n')).not.toContain(SECRET)
    expect(JSON.parse(res.body)).toEqual({ error: 'Transcription failed.' })
  })
})

/* --------------------------------------------- the rest stays untouched */

describe('the existing chat route and model path are unchanged', () => {
  const devServer = readFileSync('scripts/loam-dev-server.ts', 'utf8')

  it('/loam/chat is still registered and still treats the token as optional', () => {
    /**
     * UPDATED for the backend extraction. The route is still registered here,
     * but the token handling moved into server/chat-core.ts, shared with the
     * deployable service. The property -- an anonymous turn is allowed and
     * gets no private evidence -- is unchanged and is asserted where it now
     * lives.
     */
    expect(devServer).toContain("server.middlewares.use('/loam/chat'")
    const core = readFileSync('server/chat-core.ts', 'utf8')
    expect(core, 'a token is optional, not required').toContain('if (token) {')
    expect(core).toContain('await client.auth.getUser(token)')
  })

  it('the Ollama pre-warm is still there and now goes through provider selection', () => {
    /**
     * The pre-warm must resolve through `resolveAdapter`, not the raw Ollama
     * factory: otherwise it would warm a local model that requests no longer
     * use once a hosted provider is configured, and the startup banner would
     * announce the wrong thing.
     */
    expect(devServer).toContain('adapter.warm()')
    expect(devServer).toContain('resolveAdapter(env)')
    expect(devServer).toContain('describeAdapter(env)')
    expect(devServer, 'the raw factory must not be called directly')
      .not.toMatch(/adapterFromEnv\(/)
    // And warming only applies to the local provider.
    expect(devServer).toContain("resolveProvider(env) !== 'ollama'")
  })

  it('STT was added as one import and one call, not by editing the chat handler', () => {
    expect(devServer).toContain("import { registerLoamSttRoute } from './loam-stt-route'")
    expect(devServer).toContain('registerLoamSttRoute(server, env)')
    // Exactly one call site: the import names it without calling it.
    expect(devServer.match(/registerLoamSttRoute\(/g)).toHaveLength(1)
  })

  it('the STT route module does not import the orchestrator or the model adapter', () => {
    /**
     * Transcription is a separate seam. If this module reached into the
     * orchestrator it would couple voice input to the chat pipeline, and a
     * change to one would become a risk to the other.
     */
    const route = readFileSync('scripts/loam-stt-route.ts', 'utf8')
    // No imports of either, and no call into the model path. Ollama is named
    // only in a comment saying what this module leaves alone, so the test is
    // on the CODE: no inference URL, no adapter, no warm-up.
    expect(route).not.toMatch(/ssrLoadModule/)
    expect(route).not.toMatch(/adapterFromEnv|resolveInferenceUrl|resolveModel|resolveAdapter/)
    expect(route).not.toMatch(/\bwarm\(/)
    expect(route).not.toMatch(/11434/)
    expect(route).not.toMatch(/from ['"].*orchestrator/)
  })

  it('the worker script never mentions Ollama as something it uses', () => {
    const worker = readFileSync('scripts/stt-worker/natlas_stt_worker.py', 'utf8')
    // It is named once, in a comment saying it is not touched.
    expect(worker).not.toMatch(/subprocess|ollama ps|11434/)
  })

  it('the worker binds to loopback and nothing else', () => {
    const worker = readFileSync('scripts/stt-worker/natlas_stt_worker.py', 'utf8')
    expect(worker).toContain('ThreadingHTTPServer(("127.0.0.1", port)')
    // `0.0.0.0` appears once, in a comment saying it is never used. What must
    // not exist is a bind to it, or a configurable host.
    expect(worker).not.toMatch(/\(\s*\(\s*["']0\.0\.0\.0["']/)
    expect(worker).not.toMatch(/LOAM_STT_WORKER_HOST/)
    // Offline, and never downloading.
    expect(worker).toContain('HF_HUB_OFFLINE')
    expect(worker).toContain('local_files_only=True')
    // Constant-time secret comparison.
    expect(worker).toContain('hmac.compare_digest')
  })
})
