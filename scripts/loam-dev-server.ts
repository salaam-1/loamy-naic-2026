/**
 * Loam's server side, in development: a Vite middleware, not a new service.
 *
 * WHY A MIDDLEWARE AND NOT A SIDECAR
 *   Loamy is a static SPA with no application server; its only existing server
 *   boundary is Supabase Edge Functions. Rather than stand up a second process
 *   with its own port, lifecycle and start script, this plugin adds one route
 *   to the dev server that is already running. `npm run dev` is unchanged.
 *
 * WHY ssrLoadModule
 *   The orchestrator is TypeScript using the `@/` alias. ssrLoadModule hands it
 *   to Vite's own transform pipeline, so there is no separate build, no
 *   duplicated tsconfig paths, and edits hot-reload like any other source file.
 *
 * WHY THE SYSTEM PROMPT LIVES HERE AND NOT IN THE BROWSER
 *   This handler holds the prompt, the evidence retrieval and the inference
 *   URL. None of it is shipped to the client, so a member cannot read the
 *   prompt, cannot call the model directly, and cannot widen what Loam reads.
 *
 * AUTHORIZATION
 *   The caller's JWT is verified with Supabase, and the per-request client is
 *   built from the ANON key plus that JWT. Every query therefore runs as the
 *   member, under the same RLS policies as the rest of Loamy. The service-role
 *   key is deliberately absent: Loam has no privilege the member lacks.
 */
import type { Plugin, ViteDevServer } from 'vite'
import { loadEnv } from 'vite'
import { createClient } from '@supabase/supabase-js'
import { registerLoamSttRoute } from './loam-stt-route'

interface ChatBody {
  message?: unknown
  language?: unknown
  lastCommodity?: unknown
}

const MAX_MESSAGE_CHARS = 2000

function readJson(req: import('node:http').IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      // A chat turn is small; refuse anything that is not.
      if (size > 64_000) { reject(new Error('body too large')); return }
      chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
      catch { reject(new Error('invalid JSON')) }
    })
    req.on('error', reject)
  })
}

export function loamDevServer(): Plugin {
  return {
    name: 'loam-dev-server',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      // Empty prefix so the non-VITE_ Loam variables are visible here. They are
      // read in Node only and never reach the bundle.
      const env = loadEnv(server.config.mode, process.cwd(), '')

      server.middlewares.use('/loam/chat', async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }
        if (req.method !== 'POST') return send(405, { error: 'Method not allowed' })

        try {
          /**
           * The handler itself lives in server/chat-core.ts, shared with the
           * deployable service in server/index.ts. This block is transport
           * and wiring only: read a body, get the modules through Vite's
           * pipeline, hand over, write the answer.
           *
           * ssrLoadModule is still how the orchestrator is reached, because
           * that is what gives it the `@/` alias and hot reload. The
           * standalone server imports the same modules statically. Two ways
           * in, one implementation -- which is the point of the extraction.
           */
          const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim() || null
          const raw = await readJson(req)

          const { runLoam } = await server.ssrLoadModule('/src/lib/loam/orchestrator.ts')
          const { resolveAdapter, describeAdapter } =
            await server.ssrLoadModule('/src/lib/loam/model/select.ts')
          const { handleChat } = await server.ssrLoadModule('/server/chat-core.ts')

          const url = env.VITE_SUPABASE_URL
          const anon = env.VITE_SUPABASE_ANON_KEY

          const result = await handleChat(raw, token, {
            runLoam,
            // Anon key plus the caller's own JWT, exactly as before: every
            // query runs as the member under RLS, and the service-role key
            // is deliberately absent from this path.
            createRequestClient: (jwt: string | null) => createClient(url!, anon!, {
              global: { headers: jwt ? { Authorization: `Bearer ${jwt}` } : {} },
              auth: { persistSession: false, autoRefreshToken: false },
            }),
            adapter: resolveAdapter(env),
            adapterLabel: describeAdapter(env),
            configured: Boolean(url && anon),
          })

          if (result.log) server.config.logger.info(`  Loam:    ${result.log}`)
          return send(result.status, result.body)
        } catch (e) {
          const message = (e as Error).message
          if (message === 'body too large') return send(413, { error: 'That question is too long.' })
          if (message === 'invalid JSON') return send(400, { error: 'A question is required.' })
          // Never hand a stack trace or a database message to the browser.
          server.config.logger.error(`[loam] ${(e as Error).stack ?? (e as Error).message}`)
          return send(500, { error: 'Loam could not answer that right now.' })
        }
      })

      server.config.logger.info(
        `  \x1b[32m➜\x1b[0m  \x1b[1mLoam\x1b[0m:    POST /loam/chat`,
      )

      /**
       * Speech-to-text, off unless LOAM_STT_ENABLED is set.
       *
       * Registered AFTER the chat route and in its own module so this file's
       * behaviour is unchanged when the flag is absent -- which is the
       * default. It registers no middleware at all when disabled, so there is
       * no route to probe and nothing to misconfigure into existence.
       */
      registerLoamSttRoute(server, env)

      /**
       * Pre-warm in the background.
       *
       * Phase 0 measured a 17.3s cold load and 25s first-token latency against
       * 4-7s warm, and Ollama evicts an idle model after about five minutes --
       * easily exceeded between demo questions. Loading it here pays that cost
       * while the dev server starts rather than inside the first question
       * someone asks. Never blocks startup and never fails the server.
       */
      void (async () => {
        let mod: Record<string, unknown>
        try {
          mod = await server.ssrLoadModule('/src/lib/loam/model/select.ts')
        } catch {
          return /* the adapter module failing to load is reported per request */
        }

        /**
         * Resolved through `adapterFromEnv`, not from the raw env, so the pin
         * and the cloud-routing refusal apply HERE too. The warm-up used to
         * build its own OllamaAdapter from `env` directly, which meant it
         * could have loaded a model that every actual request then refused --
         * and the startup banner would have announced it as N-ATLaS.
         */
        const { resolveAdapter, describeAdapter, resolveProvider } = mod as {
          resolveAdapter: (e: Record<string, string | undefined>) => { warm?(): Promise<boolean> }
          describeAdapter: (e: Record<string, string | undefined>) => string
          resolveProvider: (e: Record<string, string | undefined>) => string
        }

        let adapter: { warm?(): Promise<boolean> }
        try {
          adapter = resolveAdapter(env)
          // Credential-free by construction: describeAdapter reports whether
          // a token is PRESENT, never its value.
          server.config.logger.info(`  Loam:    model   ${describeAdapter(env)}`)
        } catch (e) {
          // A pinned-model or cloud-routing refusal must be loud at startup,
          // not a surprise inside someone's first question.
          server.config.logger.error(
            `  \x1b[31m➜\x1b[0m  \x1b[1mLoam\x1b[0m:    REFUSED inference config - ${(e as Error).message}`,
          )
          return
        }

        /**
         * Only the local adapter has anything to warm. A hosted provider has
         * no cold model to load, and calling it at startup would spend money
         * to discover that.
         */
        if (resolveProvider(env) !== 'ollama' || typeof adapter.warm !== 'function') return

        try {
          const started = Date.now()
          const ok = await adapter.warm()
          server.config.logger.info(ok
            ? `  \x1b[32m➜\x1b[0m  \x1b[1mLoam\x1b[0m:    model warm in ${((Date.now() - started) / 1000).toFixed(1)}s`
            : `  \x1b[33m➜\x1b[0m  \x1b[1mLoam\x1b[0m:    model not reachable (first answer will be slower)`)
        } catch {
          /* a warm-up that cannot run is a slower first answer, not a failure */
        }
      })()
    },
  }
}
