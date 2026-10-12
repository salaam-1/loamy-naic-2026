/**
 * The deployable Loam backend. A plain `node:http` service, no framework.
 *
 * WHY A PERSISTENT SERVICE AND NOT A SERVERLESS FUNCTION
 *   A Loam turn can take minutes on a cold model, and the hosted adapter's
 *   own ceiling is 120s. Most serverless platforms cap a request well below
 *   that, and the adapter is built to be reused across requests rather than
 *   constructed per invocation. A long-lived process is the shape that fits.
 *
 * WHY NO FRAMEWORK
 *   Two routes. Adding Express would mean a dependency install, and the
 *   brief is explicit about not installing silently. `node:http` is already
 *   there and the routing fits in twenty lines.
 *
 * WHAT IT SHARES WITH THE DEV SERVER
 *   Everything that decides anything: `handleChat` in ./chat-core, the
 *   orchestrator, the evidence layer, the guard, the adapter selection. This
 *   file is transport only -- reading a body, choosing a route, writing a
 *   response, shutting down cleanly.
 *
 * IT REFUSES TO START MISCONFIGURED
 *   Adapter selection happens at boot. A production environment pointed at a
 *   local model, or a hosted provider with no credentials, exits non-zero
 *   with a message rather than accepting traffic it cannot serve.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createClient } from '@supabase/supabase-js'

import { runLoam } from '@/lib/loam/orchestrator'
import { describeAdapter, isProductionEnv, resolveAdapter, resolveProvider } from '@/lib/loam/model/select'
import { MAX_BODY_BYTES, chatFailure, handleChat, type ChatDeps } from './chat-core'
import { transcribeWithModalYoruba } from './modal-stt'
import { inspectWav } from '@/lib/providers/wav'

const env = process.env as Record<string, string | undefined>

/** Hosting platforms assign the port. Honour it, with a local default. */
const PORT = Number(env.PORT) || 8787
const HOST = env.HOST || '0.0.0.0'

/**
 * Browser origins allowed to call this service.
 *
 * Explicit, comma-separated, and NOT defaulted to `*`. A wildcard plus
 * credentials is rejected by browsers anyway, and a wildcard without them
 * would still let any page read answers meant for a member.
 */
const ALLOWED_ORIGINS = (env.LOAM_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let overflowed = false
    req.on('data', (c: Buffer) => {
      if (overflowed) return
      size += c.length
      // A chat turn is small; refuse anything that is not, while streaming,
      // rather than buffering megabytes before deciding.
      if (size > MAX_BODY_BYTES) {
        overflowed = true
        /**
         * PAUSE, DO NOT DESTROY.
         *
         * `req.destroy()` here tears down the socket before the 413 can be
         * written, so the client sees a connection reset instead of the
         * clear, correct status it was about to be sent. Testing an
         * oversized upload is what caught it: the probe got status 0.
         *
         * Pausing stops us accumulating while leaving the socket alive long
         * enough to answer. `_send` sets `Connection: close` on errors, so
         * the client is not left writing into a connection nobody drains.
         */
        req.pause()
        chunks.length = 0
        reject(new Error('body too large'))
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
      catch { reject(new Error('invalid JSON')) }
    })
    req.on('error', reject)
  })
}


function readRawAudio(req: IncomingMessage, maxBytes = 2_000_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false

    req.on('data', (chunk: Buffer) => {
      if (settled) return
      size += chunk.length
      if (size > maxBytes) {
        settled = true
        chunks.length = 0
        req.pause()
        reject(new Error('audio too large'))
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks))
    })

    req.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
  })
}

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Loam-Language')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Max-Age', '600')
}

function main(): void {
  const supabaseUrl = env.VITE_SUPABASE_URL ?? env.SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY
  const configured = Boolean(supabaseUrl && anonKey)

  /**
   * Fail at boot, not on the first question. A startup crash is visible in a
   * deploy log; a per-request failure looks like a flaky model.
   */
  let adapter: unknown
  try {
    adapter = resolveAdapter(env)
  } catch (e) {
    console.error(`[loam] REFUSED to start: ${(e as Error).message}`)
    process.exit(1)
  }

  const adapterLabel = resolveProvider(env)
  // Credential-free by construction; `describeAdapter` never prints a token.
  console.log(`[loam] inference: ${describeAdapter(env)}`)
  console.log(`[loam] supabase: ${configured ? 'configured' : 'NOT CONFIGURED'}`)
  console.log(`[loam] production mode: ${isProductionEnv(env)}`)
  console.log(`[loam] cors origins: ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(', ') : 'none (same-origin only)'}`)

  if (!configured) {
    // Not fatal: the health endpoint should still answer so a platform can
    // report WHY the service is unhealthy rather than just restarting it.
    console.error('[loam] Supabase is not configured; chat will return 503.')
  }

  const deps: ChatDeps = {
    runLoam: runLoam as ChatDeps['runLoam'],
    createRequestClient: (token) => createClient(supabaseUrl!, anonKey!, {
      // Anon key plus the caller's own JWT. RLS does the authorizing, exactly
      // as in the dev server. No service-role key is read in this file.
      global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      auth: { persistSession: false, autoRefreshToken: false },
    }) as unknown as ReturnType<ChatDeps['createRequestClient']>,
    adapter,
    adapterLabel,
    configured,
  }

  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      /**
       * Close the connection on an error.
       *
       * An error may be decided while the client is still uploading -- an
       * oversized body is exactly that case. Under keep-alive, answering
       * without draining the rest desynchronises the connection and the
       * client reports a timeout instead of the status it was sent.
       */
      if (status >= 400) res.setHeader('Connection', 'close')
      res.end(JSON.stringify(body))
    }

    applyCors(req, res)
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }

    const path = (req.url ?? '').split('?')[0]

    /**
     * Liveness. Deliberately says nothing a stranger should not know: no
     * model name, no origin list, no Supabase URL. Whether the service is up
     * is not a secret; what it is wired to is.
     */
    if (path === '/healthz') {
      return send(200, { ok: true, service: 'loam' })
    }

    /**
     * Readiness. Reports whether chat COULD serve a request -- which is a
     * different question from whether the process is running, and the one a
     * platform should gate traffic on.
     */
    if (path === '/readyz') {
      return send(configured ? 200 : 503, { ready: configured, chat: configured })
    }


    if (path === '/loam/stt/transcribe') {
      if (req.method !== 'POST') return send(405, { error: 'Method not allowed' })

      void (async () => {
        try {
          if (!configured) return send(503, { error: 'Voice transcription is unavailable.' })

          const authorization = req.headers.authorization ?? ''
          const match = authorization.match(/^Bearer\s+(\S+)$/i)
          if (!match) return send(401, { error: 'Please sign in to use voice transcription.' })
          const token = match[1]

          const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
          if (contentType !== 'application/octet-stream') {
            return send(415, { error: 'Upload audio as a WAV file.' })
          }

          if (typeof req.headers['x-loam-language'] !== 'string' || req.headers['x-loam-language'].toLowerCase() !== 'yo') {
            return send(400, { error: 'Yoruba voice input is currently supported.' })
          }

          const rawLength = req.headers['content-length']
          if (rawLength !== undefined && Number(rawLength) > 2_000_000) {
            req.pause()
            return send(413, { error: 'The audio recording is too large.' })
          }

          const authClient = createClient(supabaseUrl!, anonKey!, {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          })
          const { data: authData, error: authError } = await authClient.auth.getUser(token)
          if (authError || !authData.user) {
            return send(401, { error: 'Your session is invalid. Please sign in again.' })
          }

          const audio = await readRawAudio(req)
          if (!audio.length) return send(400, { error: 'No audio was received.' })

          const wav = inspectWav(new Uint8Array(audio))
          if (!wav.ok) {
            return send(400, { error: 'Please record a valid mono 16 kHz WAV clip up to 30 seconds long.' })
          }

          const transcript = await transcribeWithModalYoruba(new Uint8Array(audio), env)
          return send(200, {
            text: transcript.text,
            language: transcript.language,
            provider: 'modal-yoruba-asr',
            verified: false,
          })
        } catch (error) {
          const message = (error as Error).message
          if (message === 'audio too large') return send(413, { error: 'The audio recording is too large.' })
          if (message === 'STT_NOT_CONFIGURED') return send(503, { error: 'Voice transcription is not configured.' })
          if (message === 'STT_INVALID_AUDIO') return send(400, { error: 'The audio recording is invalid.' })
          if (message === 'STT_TIMEOUT') return send(504, { error: 'Transcription took too long. Please try again.' })
          if (message === 'STT_RATE_LIMITED') return send(429, { error: 'Voice transcription is busy. Please try again shortly.' })
          if (message === 'STT_CONFIGURATION_ERROR') {
            console.error('[loam] Modal STT configuration is invalid.')
            return send(503, { error: 'Voice transcription is unavailable.' })
          }
          if (message === 'STT_INVALID_RESPONSE') {
            console.error('[loam] Modal STT returned an invalid response.')
            return send(502, { error: 'Transcription could not be completed.' })
          }
          console.error('[loam] Modal STT request failed.')
          return send(502, { error: 'Transcription could not be completed. Please try again.' })
        }
      })()
      return
    }

    if (path === '/loam/chat') {
      if (req.method !== 'POST') return send(405, { error: 'Method not allowed' })
      void (async () => {
        try {
          const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim() || null
          const raw = await readJson(req)
          const result = await handleChat(raw, token, deps)
          if (result.log) console.log(`[loam] ${result.log}`)
          return send(result.status, result.body)
        } catch (e) {
          const message = (e as Error).message
          if (message === 'body too large') return send(413, { error: 'That question is too long.' })
          if (message === 'invalid JSON') return send(400, { error: 'A question is required.' })
          const failure = chatFailure(e)
          if (failure.log) console.error(failure.log)
          return send(failure.status, failure.body)
        }
      })()
      return
    }

    return send(404, { error: 'Not found' })
  })

  // Longer than the hosted adapter's own ceiling, so the socket is never the
  // component that gives up first on a slow but succeeding answer.
  server.headersTimeout = 70_000
  server.requestTimeout = 300_000

  server.listen(PORT, HOST, () => {
    console.log(`[loam] listening on http://${HOST}:${PORT}`)
    console.log('[loam] POST /loam/chat   GET /healthz   GET /readyz')
  })

  /**
   * Graceful shutdown. A platform sends SIGTERM and then kills; finishing
   * in-flight turns matters when a turn can be a minute long.
   */
  let shuttingDown = false
  const shutdown = (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[loam] ${signal} received; draining`)
    server.close(() => {
      console.log('[loam] closed')
      process.exit(0)
    })
    // A cap, so a stuck connection cannot block the deploy indefinitely.
    setTimeout(() => {
      console.warn('[loam] drain timed out; exiting')
      process.exit(0)
    }, 30_000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main()
