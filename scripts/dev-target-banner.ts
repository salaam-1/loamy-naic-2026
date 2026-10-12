/**
 * Say which Supabase project the dev server is about to serve.
 *
 * WHY THIS EXISTS
 *   `npm run dev` used to load `.env`, which points at the production project.
 *   Nothing on screen said so. A developer could click through the real
 *   Founding Member data for an hour believing they were on staging, and a
 *   single stray write would land on live records.
 *
 *   `npm run dev` now defaults to staging. This is the second half: when
 *   someone does deliberately run `npm run dev:production`, the terminal says
 *   so in a way that is hard to scroll past. Making production reachable is
 *   fine; making it indistinguishable is not.
 *
 * SCOPE
 *   Dev server only (`apply: 'serve'`). It reads `config/environments.json`,
 *   the same single source of truth the test and QA guards use, so a second
 *   protected project is still a one-line change there. It prints the project
 *   REF, which is not a secret -- it is compiled into every published bundle --
 *   and never a key.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { loadEnv } from 'vite'

interface Environments {
  production: { ref: string; label: string }
  protectedRefs: string[]
}

const RESET = '\x1b[0m'
const RED = '\x1b[41m\x1b[97m\x1b[1m'
const GREEN = '\x1b[32m'
const DIM = '\x1b[2m'

/** The project reference inside a Supabase URL, or null if it is not one. */
function refOf(url: string | undefined): string | null {
  const m = /^https:\/\/([a-z0-9]{16,})\.supabase\.co/.exec(url ?? '')
  return m ? m[1] : null
}

export function devTargetBanner(): Plugin {
  return {
    name: 'loamy-dev-target-banner',
    apply: 'serve',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '')
      const config = JSON.parse(
        readFileSync(fileURLToPath(new URL('../config/environments.json', import.meta.url)), 'utf8'),
      ) as Environments

      const ref = refOf(env.VITE_SUPABASE_URL)
      const log = server.config.logger

      if (!ref) {
        log.warn(`  ${DIM}Loamy: no Supabase project configured for mode "${server.config.mode}".${RESET}`)
        return
      }

      if (config.protectedRefs.includes(ref)) {
        const label = ref === config.production.ref ? config.production.label : 'a protected project'

        /**
         * `npm run dev` REFUSES production. It does not merely warn.
         *
         * `dev` runs `--mode test`, so reaching a protected project from that
         * mode means `.env.test` is misconfigured -- and the whole point of the
         * default is that ordinary development cannot touch real member data by
         * accident. A banner can be scrolled past; a server that will not start
         * cannot.
         *
         * `npm run dev:production` runs in `development` mode and is still
         * allowed, loudly, because legitimate maintenance has to stay possible.
         */
        if (server.config.mode === 'test') {
          throw new Error(
            `REFUSED: \`npm run dev\` resolved to ${label} (${ref}).\n` +
            `  This command must never serve a protected project.\n` +
            `  Check VITE_SUPABASE_URL in .env.test.\n` +
            `  If you genuinely need production, use: npm run dev:production`,
          )
        }

        // Printed as a block rather than a line: a one-line warning in a Vite
        // banner is exactly the kind of thing that gets scrolled past.
        log.warn('')
        log.warn(`  ${RED}  ┌──────────────────────────────────────────────────────────┐  ${RESET}`)
        log.warn(`  ${RED}  │  THIS DEV SERVER IS CONNECTED TO PRODUCTION              │  ${RESET}`)
        log.warn(`  ${RED}  │  ${label.padEnd(56)}│  ${RESET}`)
        log.warn(`  ${RED}  │  project ${ref.padEnd(48)}│  ${RESET}`)
        log.warn(`  ${RED}  │                                                          │  ${RESET}`)
        log.warn(`  ${RED}  │  Anything you click writes to real member data.          │  ${RESET}`)
        log.warn(`  ${RED}  │  For ordinary development use: npm run dev               │  ${RESET}`)
        log.warn(`  ${RED}  └──────────────────────────────────────────────────────────┘  ${RESET}`)
        log.warn('')
        return
      }

      log.info(`  ${GREEN}➜${RESET}  ${DIM}Loamy:${RESET}   data from ${ref} ${DIM}(not production)${RESET}`)
    },
  }
}
