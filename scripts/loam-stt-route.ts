/**
 * POST /loam/stt/transcribe -- the authenticated hop between the browser and
 * the local Python transcription worker. DEVELOPMENT ONLY.
 *
 * WHY THE BROWSER DOES NOT TALK TO THE WORKER DIRECTLY
 *   The worker holds a shared secret. Anything the browser can send, page
 *   script can read, so a browser that authenticated to the worker would mean
 *   the secret was in the bundle. Instead the browser presents its Supabase
 *   JWT to this route, this route presents the worker secret to the worker,
 *   and the two credentials never meet.
 *
 * STRICTER THAN /loam/chat, DELIBERATELY
 *   The chat route treats a token as optional: an unauthenticated visitor can
 *   ask a general question and simply sees no private evidence. Transcription
 *   is different. It consumes a ~922 MiB model and a single CPU inference
 *   slot, and it carries a member's voice. So a VALID USER IS REQUIRED here.
 *   That difference is the point, not an inconsistency.
 *
 * WHAT IS NOT CHANGED BY THIS FILE
 *   /loam/chat, its optional-token behaviour, its prompt, its evidence
 *   retrieval, its model routing and its Ollama pre-warming. This module adds
 *   a route and touches none of that.
 *
 * THIS IS NOT A PRODUCTION BACKEND
 *   It is registered from a plugin with `apply: 'serve'` and exists in no
 *   deployed build. A production transcription path needs a real server
 *   boundary (an Edge Function plus a hosted worker), which nobody has built.
 */
import type { ViteDevServer } from 'vite'
import { createClient } from '@supabase/supabase-js'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Mirrors STT_MAX_AUDIO_BYTES in src/lib/providers/stt.ts. */
const MAX_AUDIO_BYTES = 2_000_000

/**
 * Languages this route will forward, and what is actually known about each.
 *
 * ROUTABLE is what the worker has a model for. VERIFIED is the subset
 * somebody has listened to. They are separate constants because collapsing
 * them is exactly how an untested language starts being described as working.
 */
const ROUTABLE_LANGUAGES = ['en', 'ha', 'ig', 'pcm', 'yo'] as const

/**
 * The four with their own official NCAIR model, each run against a real
 * recording in its own language. Pidgin is routable but its model is not
 * installed, so the worker answers 503 for it -- never a substitution.
 */
const VERIFIED_LANGUAGES = ['en', 'ha', 'ig', 'yo'] as const

/**
 * Nothing is refused outright any more: every one of the five has a model
 * route, Igbo included now that NCAIR1/Igbo-ASR is installed.
 *
 * Kept as an empty map rather than deleted, because the distinction it
 * encodes still matters: a language with NO possible model is different from
 * one whose weights are merely absent, and the second is what the worker's
 * 503 reports. If a sixth language is ever offered without a model, its
 * reason belongs here.
 */
const UNROUTABLE_REASON: Record<string, string> = {}

/**
 * The worker's host is a LITERAL, never configuration.
 *
 * Only the port is configurable. If the host were an environment variable, a
 * misconfigured `.env` could point audio at an arbitrary address, and a route
 * whose destination can be redirected is a server-side request forgery
 * waiting to happen. There is exactly one legitimate destination.
 */
const WORKER_HOST = '127.0.0.1'

/** Generous for CPU inference, finite so a hung worker cannot hold a socket. */
const WORKER_TIMEOUT_MS = 160_000

type Env = Record<string, string | undefined>

function enabled(env: Env): boolean {
  const flag = (env.LOAM_STT_ENABLED ?? '').trim().toLowerCase()
  return flag === '1' || flag === 'true' || flag === 'yes'
}

/**
 * Read a bounded raw body.
 *
 * The cap is enforced while streaming rather than after, so an oversized
 * upload is abandoned mid-flight instead of being buffered first.
 */
function readAudio(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) { reject(new Error('too large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * Minimal RIFF/WAVE check, so obviously wrong bytes are refused before a slot
 * is spent on them. The worker validates properly; this is the cheap gate.
 * `src/lib/providers/wav.ts` holds the full parser used by the adapter.
 */
function looksLikeWav(b: Buffer): boolean {
  return b.length >= 44 && b.subarray(0, 4).toString('latin1') === 'RIFF'
    && b.subarray(8, 12).toString('latin1') === 'WAVE'
}

export function registerLoamSttRoute(server: ViteDevServer, env: Env): void {
  if (!enabled(env)) {
    // Silent about the secret and the port. It says the feature is off and
    // how to turn it on, and nothing about what is configured.
    server.config.logger.info(
      `  \x1b[90m➜\x1b[0m  \x1b[1mLoam\x1b[0m:    STT disabled (set LOAM_STT_ENABLED=1 to enable)`,
    )
    return
  }

  const portRaw = (env.LOAM_STT_WORKER_PORT ?? '').trim()
  const secret = (env.LOAM_STT_WORKER_SECRET ?? '').trim()
  const port = Number(portRaw)

  // Misconfiguration must be loud at startup and must NOT register the route.
  // A route that exists but cannot work produces 500s that look like bugs.
  if (!portRaw || !Number.isInteger(port) || port < 1024 || port > 65535) {
    server.config.logger.error(
      `  \x1b[31m➜\x1b[0m  \x1b[1mLoam\x1b[0m:    STT REFUSED - LOAM_STT_WORKER_PORT must be 1024-65535`,
    )
    return
  }
  if (secret.length < 32) {
    server.config.logger.error(
      `  \x1b[31m➜\x1b[0m  \x1b[1mLoam\x1b[0m:    STT REFUSED - LOAM_STT_WORKER_SECRET must be 32+ random chars`,
    )
    return
  }

  const workerUrl = `http://${WORKER_HOST}:${port}/transcribe`

  server.middlewares.use('/loam/stt/transcribe', async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: unknown) => {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'POST') return send(405, { error: 'Method not allowed' })

    try {
      /* ---------------------------------------------------- authentication */
      const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim()
      if (!token) {
        return send(401, { error: 'Sign in to use voice input.' })
      }

      const url = env.VITE_SUPABASE_URL
      const anon = env.VITE_SUPABASE_ANON_KEY
      if (!url || !anon) return send(503, { error: 'Loam is not configured.' })

      const client = createClient(url, anon, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      })

      // REQUIRED, unlike /loam/chat. An invalid or expired token is a 401,
      // never a downgrade to anonymous.
      const { data: auth, error: authError } = await client.auth.getUser(token)
      if (authError || !auth?.user?.id) {
        return send(401, { error: 'Your session has expired. Sign in again.' })
      }

      /* ------------------------------------------------- cheap validation */
      const ctype = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
      if (ctype !== 'application/octet-stream') {
        return send(415, { error: 'Send the recording as raw WAV bytes.' })
      }

      const declared = Number(req.headers['content-length'] ?? NaN)
      if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES) {
        return send(413, { error: 'That recording is too large.' })
      }

      const language = String(req.headers['x-loam-language'] ?? '').trim().toLowerCase()
      if (UNROUTABLE_REASON[language]) {
        // Specific, not a bare "unsupported": the reason is what stops this
        // being routed through a model that cannot produce the language.
        return send(400, {
          error: 'That language is not available for voice input.',
          reason: UNROUTABLE_REASON[language],
          languages: [...ROUTABLE_LANGUAGES],
        })
      }
      if (!(ROUTABLE_LANGUAGES as readonly string[]).includes(language)) {
        // Refused, never detected and never substituted with another model.
        return send(400, {
          error: 'That language is not available for voice input.',
          languages: [...ROUTABLE_LANGUAGES],
        })
      }

      /* -------------------------------------------------------- the audio */
      let audio: Buffer
      try {
        audio = await readAudio(req, MAX_AUDIO_BYTES)
      } catch {
        return send(413, { error: 'That recording is too large.' })
      }
      if (audio.length === 0) return send(400, { error: 'No audio was recorded.' })
      if (!looksLikeWav(audio)) return send(415, { error: 'That file is not a WAV recording.' })

      /* ------------------------------------------------------- the worker */
      // Cancellation: if the browser goes away, stop waiting on the worker.
      const ac = new AbortController()
      const onClose = () => ac.abort()
      req.once('aborted', onClose)
      res.once('close', onClose)
      const timer = setTimeout(() => ac.abort(), WORKER_TIMEOUT_MS)

      let workerRes: Response
      try {
        workerRes = await fetch(workerUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(audio.length),
            'X-Loam-Language': language,
            // Server to server, over loopback. This header never exists in
            // anything the browser receives.
            'X-Loam-Worker-Secret': secret,
          },
          body: new Uint8Array(audio),
          signal: ac.signal,
        })
      } catch (e) {
        const aborted = (e as Error).name === 'AbortError'
        if (aborted && res.writableEnded) return
        server.config.logger.warn(
          `  \x1b[33m➜\x1b[0m  \x1b[1mLoam\x1b[0m:    STT worker ${aborted ? 'timed out' : 'unreachable'}`,
        )
        return send(aborted ? 504 : 503, {
          error: aborted
            ? 'Transcription took too long.'
            : 'The transcriber is not running.',
          retryable: true,
        })
      } finally {
        clearTimeout(timer)
        req.off('aborted', onClose)
        res.off('close', onClose)
      }

      const payload = await workerRes.json().catch(() => null) as {
        text?: unknown; error?: unknown; audioSeconds?: unknown; inferenceMs?: unknown
        modelKey?: unknown; verified?: unknown
      } | null

      if (!workerRes.ok) {
        // The worker's messages are already client-safe by construction; a
        // status we do not recognise becomes a neutral message rather than
        // whatever the body happened to contain.
        const known = [400, 413, 415, 422, 503, 504].includes(workerRes.status)
        const message = known && typeof payload?.error === 'string'
          ? payload.error
          : 'Transcription failed.'
        return send(known ? workerRes.status : 502, { error: message })
      }

      const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
      if (!text) {
        // A blank transcript is never returned as success.
        return send(422, { error: 'Nothing could be transcribed from that recording.' })
      }

      /**
       * One line per transcription. Deliberately NOT logged: the JWT, the
       * worker secret, the member's id or email, the audio, and the
       * transcript. Lengths and durations only -- enough to answer "did this
       * work and how slow was it", and nothing that identifies anyone.
       */
      // `verified` is taken from the worker, which owns the model registry,
      // but falls back to this route's own list rather than defaulting to
      // true. An absent field must never read as "checked".
      const verified = typeof payload?.verified === 'boolean'
        ? payload.verified
        : (VERIFIED_LANGUAGES as readonly string[]).includes(language)

      server.config.logger.info(
        `  \x1b[36m➜\x1b[0m  \x1b[1mLoam\x1b[0m:    STT ${language} `
        + `${typeof payload?.modelKey === 'string' ? `${payload.modelKey} ` : ''}`
        + `${(audio.length / 1024).toFixed(0)}KiB `
        + `${typeof payload?.audioSeconds === 'number' ? `${payload.audioSeconds}s ` : ''}`
        + `-> ${text.length} chars `
        + `${typeof payload?.inferenceMs === 'number' ? `in ${payload.inferenceMs}ms` : ''}`
        + `${verified ? '' : ' \x1b[33m(UNVERIFIED language)\x1b[0m'}`,
      )

      // Only the transcript and the metadata needed to show it. No model
      // internals, no worker URL, no user id echoed back. `verified` is
      // included because a caller rendering an unchecked transcript should be
      // able to say so.
      return send(200, {
        text,
        language,
        verified,
        provider: 'loam-local-stt',
        audioSeconds: typeof payload?.audioSeconds === 'number' ? payload.audioSeconds : null,
        inferenceMs: typeof payload?.inferenceMs === 'number' ? payload.inferenceMs : null,
      })
    } catch (e) {
      // Never a stack trace to the browser. The server log gets the type only:
      // a thrown Supabase error can quote a URL with a key in it.
      server.config.logger.error(`[loam-stt] ${(e as Error).name}`)
      return send(500, { error: 'Transcription failed.' })
    }
  })

  server.config.logger.info(
    `  \x1b[32m➜\x1b[0m  \x1b[1mLoam\x1b[0m:    POST /loam/stt/transcribe `
    + `-> 127.0.0.1:${port} (auth required) `
    + `verified=${VERIFIED_LANGUAGES.join(',')} `
    + `unverified=${ROUTABLE_LANGUAGES.filter(
      (l) => !(VERIFIED_LANGUAGES as readonly string[]).includes(l)).join(',')} `
    + `unavailable=${Object.keys(UNROUTABLE_REASON).join(',')}`,
  )
}
