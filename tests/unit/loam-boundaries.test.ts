import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KNOWLEDGE, STATE_ZONE, ZONE_SOURCE, findKnowledge, sourceFor } from '@/lib/loam/knowledge'
import { CROP_RECORD_COLUMNS, FARM_COLUMNS } from '@/lib/loam/evidence'
import { EVIDENCE_CHAR_BUDGET, renderEvidence, systemPrompt, userPrompt } from '@/lib/loam/prompt'
import { PHRASES } from '@/lib/loam/phrases'
import type { EvidenceItem } from '@/lib/loam/types'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/**
 * The properties that must hold for Loam to be safe and portable, asserted
 * over the source where behaviour cannot show them.
 */

describe('the knowledge pack cannot quietly become authoritative', () => {
  it('every entry carries a source and a review status', () => {
    for (const e of KNOWLEDGE) {
      expect(e.sourceLabel, `${e.id} has no source`).toBeTruthy()
      expect(e.claim.length, `${e.id} claim is too thin to be useful`).toBeGreaterThan(40)
      expect(e.topics.length, `${e.id} matches nothing`).toBeGreaterThan(0)
    }
  })

  it('NOTHING has been promoted to reviewed without a named agronomist', () => {
    // When a real review happens, this test is the place to record it: name the
    // reviewer and the date here, then flip the entry. Until then, an entry
    // marked 'reviewed' is almost certainly someone editing a flag by mistake.
    const promoted = KNOWLEDGE.filter((e) => e.review === 'reviewed')
    expect(promoted.map((e) => e.id), 'promote only with a recorded review').toEqual([])
  })

  it('every entry says "PENDING AGRONOMIST REVIEW" where the user can see it', () => {
    for (const e of KNOWLEDGE) {
      expect(sourceFor(e), `${e.id} hides its review status`).toContain('PENDING AGRONOMIST REVIEW')
    }
  })

  it('zone-specific planting entries never match the wrong zone', () => {
    // Answering Kaduna with the Sudan Savanna window would be our own version
    // of the Phase 0 error, so the conjunction of crop AND state is load-bearing.
    const kaduna = findKnowledge({ text: 'when should I plant maize', crop: 'Maize', state: 'Kaduna' })
    expect(kaduna.map((e) => e.id)).toContain('maize-planting-northern-guinea')
    expect(kaduna.map((e) => e.id)).not.toContain('maize-planting-sudan-savanna')

    const kano = findKnowledge({ text: 'when should I plant maize', crop: 'Maize', state: 'Kano' })
    expect(kano.map((e) => e.id)).toContain('maize-planting-sudan-savanna')
    expect(kano.map((e) => e.id)).not.toContain('maize-planting-northern-guinea')
  })

  it('a crop-specific entry does not match a different crop', () => {
    const found = findKnowledge({ text: 'when should I plant', crop: 'Cocoa', state: 'Kaduna' })
    expect(found.map((e) => e.id)).not.toContain('maize-planting-northern-guinea')
  })

  it('an uncovered state yields no zone, so Loam declines rather than guessing', () => {
    expect(STATE_ZONE['lagos']).toBeUndefined()
    expect(findKnowledge({ text: 'when should I plant maize', crop: 'Maize', state: 'Lagos' })).toEqual([])
  })
})

describe('the prompt never carries what it must not', () => {
  it('the farm reader selects no coordinates and no address', () => {
    for (const col of ['latitude', 'longitude', 'address', 'address_description']) {
      expect(FARM_COLUMNS as readonly string[], `${col} must never be read`).not.toContain(col)
    }
    expect(FARM_COLUMNS as readonly string[]).toContain('state')
    expect(FARM_COLUMNS as readonly string[]).toContain('lga')
  })

  it('the evidence readers never use select(*)', () => {
    const src = stripComments(read('src/lib/loam/evidence.ts'))
    expect(src, "select('*') would sweep in coordinates").not.toMatch(/\.select\(\s*['"`]\*/)
  })

  it('the crop-record reader stays within its allowlist', () => {
    expect(CROP_RECORD_COLUMNS as readonly string[]).toContain('planting_date')
    expect((CROP_RECORD_COLUMNS as readonly string[]).length).toBe(9)
  })

  it('truncates evidence to the context budget, strongest level first', () => {
    const many: EvidenceItem[] = [
      { level: 2, claim: 'B'.repeat(4000), source: 'knowledge' },
      { level: 1, claim: 'A'.repeat(4000), source: 'loamy' },
    ]
    const { text, included } = renderEvidence(many)
    expect(text.length).toBeLessThanOrEqual(EVIDENCE_CHAR_BUDGET + 200)
    expect(included.length, 'the second item does not fit').toBe(1)
    expect(included[0].level, 'Level 1 must survive truncation').toBe(1)
  })

  it('returns only the evidence that was actually included', () => {
    // The guard authorises figures from what the model SAW. If truncation
    // dropped an item, authorising its numbers would let an invented figure
    // through on the strength of evidence the model never received.
    const { included } = userPrompt('q', [
      { level: 1, claim: 'x'.repeat(6000), source: 's', numbers: [999] },
      { level: 1, claim: 'y', source: 's', numbers: [111] },
    ])
    expect(included.flatMap((e) => e.numbers ?? [])).not.toContain(111)
  })
})

describe('the system prompt states the rules that matter', () => {
  const sys = systemPrompt('en', 'specific')

  it('forbids inventing specifics and forbids forecasting', () => {
    expect(sys).toMatch(/must come from the evidence/i)
    expect(sys).toMatch(/[Nn]ever invent/)
    expect(sys).toMatch(/[Nn]ever predict or estimate a future price/)
  })

  it('demands a citation per statement rather than asking politely for marking', () => {
    // Phase 1 asked the model to prefix inference with "Likely:" and it did not
    // comply. The contract is now structural: every line declares a source.
    expect(sys).toContain('[?]')
    expect(sys).toMatch(/begin every line with a marker/i)
    expect(sys, 'prompt compliance is not the mechanism any more').not.toContain('Likely:')
  })

  it('names the answer language', () => {
    expect(systemPrompt('ha', 'general')).toContain('Write in Hausa')
    expect(systemPrompt('en', 'general')).toContain('Write in English')
  })

  it('withholds the source attribution from the model', () => {
    // A live Hausa run copied whole evidence lines into the answer, "- source:
    // ... PENDING AGRONOMIST REVIEW" included. Provenance reaches the user from
    // the structured evidence field instead.
    const { text } = renderEvidence([{
      level: 2, claim: 'Maize is sown at the onset of the rains.',
      source: 'Loam knowledge pack v0 - PENDING AGRONOMIST REVIEW',
    }])
    expect(text).toContain('Maize is sown')
    expect(text, 'the model must not be shown text it can copy as attribution')
      .not.toContain('PENDING AGRONOMIST')
    expect(text).not.toContain('source:')
  })

  it('adds a stricter instruction for personal questions', () => {
    expect(systemPrompt('en', 'personal')).toMatch(/own records/i)
    expect(systemPrompt('en', 'general')).not.toMatch(/own records/i)
  })
})

describe('deterministic phrases exist in both Phase 1 languages', () => {
  it('no phrase is missing or left in English by accident', () => {
    for (const [key, byLang] of Object.entries(PHRASES)) {
      expect(byLang.en, `${key}.en`).toBeTruthy()
      expect(byLang.ha, `${key}.ha`).toBeTruthy()
      expect(byLang.ha, `${key}.ha is identical to English`).not.toBe(byLang.en)
    }
  })
})

describe('Loam stays portable to another host', () => {
  it('the orchestrator imports nothing host-specific', () => {
    const src = stripComments(read('src/lib/loam/orchestrator.ts'))
    for (const banned of ['import.meta', 'process.env', 'node:', 'from \'vite\'', 'Deno.']) {
      expect(src, `orchestrator must not depend on ${banned}`).not.toContain(banned)
    }
  })

  it('the model adapter reads config from a passed-in record, not a global', () => {
    const src = stripComments(read('src/lib/loam/model/adapter.ts'))
    expect(src).toContain('adapterFromEnv')
    expect(src, 'reading process.env here would tie the adapter to Node').not.toContain('process.env')
    expect(src).not.toContain('import.meta.env')
  })

  it('no inference setting is exposed through a VITE_ variable', () => {
    /**
     * A VITE_ variable is compiled into the bundle and served to every
     * visitor. The old Co-pilot seam did exactly that with
     * VITE_COPILOT_LLM_API_KEY; Loam must not repeat it.
     *
     * NARROWED, with the reason stated, when the backend was extracted. The
     * rule used to ban `VITE_LOAM` outright. That caught
     * `VITE_LOAM_API_BASE_URL`, which is the address of Loamy's OWN backend
     * -- a public endpoint the browser must know in order to call it, and
     * categorically different from an inference setting.
     *
     * What must never be exposed is the thing that lets a visitor talk to the
     * MODEL directly, or pay for it: the inference URL, the model id, and any
     * token. Those are enumerated below, and the list is now stricter than
     * the pattern it replaced -- it names TOKEN, KEY and SECRET explicitly.
     */
    const FORBIDDEN = [
      /VITE_[A-Z_]*INFERENCE/,
      /VITE_[A-Z_]*MODEL/,
      /VITE_[A-Z_]*TOKEN/,
      /VITE_[A-Z_]*API_KEY/,
      /VITE_[A-Z_]*SECRET/,
      /VITE_LOAM_HOSTED/,
      /VITE_LOAM_PROVIDER/,
    ]
    for (const f of [
      'src/lib/loam/model/adapter.ts', 'src/lib/loam/model/hosted.ts',
      'src/lib/loam/model/select.ts', 'src/lib/loam/orchestrator.ts',
      'src/lib/loam/transport.ts', 'scripts/loam-dev-server.ts',
      'server/index.ts', 'server/chat-core.ts',
    ]) {
      /**
       * Comments stripped. `adapter.ts` names VITE_COPILOT_LLM_API_KEY in a
       * comment recording the old Co-pilot mistake, and a variable NAME in
       * prose exposes nothing -- deleting that history to satisfy a regex
       * would lose the reason the rule exists.
       */
      const src = stripComments(read(f))
      for (const pattern of FORBIDDEN) {
        expect(src, `${f} exposes inference config to the browser via ${pattern}`)
          .not.toMatch(pattern)
      }
    }
  })

  it('the only browser-visible Loam variable is the backend address', () => {
    /**
     * The counterpart to the rule above: having allowed one VITE_ variable,
     * pin down exactly which one, so a second cannot appear unnoticed.
     */
    const transport = read('src/lib/loam/transport.ts')
    const exposed = [...transport.matchAll(/VITE_[A-Z_]+/g)].map((m) => m[0])
    expect([...new Set(exposed)]).toEqual(['VITE_LOAM_API_BASE_URL'])
    // And it is used as an ORIGIN only -- never to carry a credential.
    expect(transport).toContain('url.origin')
  })

  it('the browser never holds the system prompt or the inference URL', () => {
    const transport = read('src/lib/loam/transport.ts')
    expect(transport).not.toContain('11434')
    expect(transport).not.toContain('systemPrompt')
    expect(transport, 'the endpoint must be same-origin').toContain('/loam/chat')
  })

  it('no server path uses the service-role key', () => {
    /**
     * UPDATED for the backend extraction. `auth.getUser(token)` moved into
     * server/chat-core.ts, which the dev middleware and the deployable
     * service now share. So the property is checked across ALL THREE files
     * rather than in the one that used to hold it -- and widened, because
     * there is now a second server that could get this wrong.
     */
    for (const file of [
      'scripts/loam-dev-server.ts', 'server/index.ts', 'server/chat-core.ts',
    ]) {
      expect(read(file), `${file}: Loam must hold no privilege the member lacks`)
        .not.toMatch(/SERVICE_ROLE|service_role|serviceRole/)
    }
    // Both servers build the per-request client from the ANON key.
    expect(read('scripts/loam-dev-server.ts')).toContain('VITE_SUPABASE_ANON_KEY')
    expect(read('server/index.ts')).toContain('VITE_SUPABASE_ANON_KEY')
    // The user id comes from the verified token, never from the request body,
    // and that now happens in exactly one place.
    expect(read('server/chat-core.ts')).toContain('auth.getUser(token)')
  })

  it('the deployable server is the only one not excluded from a build', () => {
    // The dev middleware stays development-only; the extracted service is the
    // thing that is MEANT to be deployed. Confusing the two is how the
    // production backend went missing in the first place.
    expect(read('scripts/loam-dev-server.ts')).toContain("apply: 'serve'")
    expect(read('server/index.ts')).not.toContain("apply: 'serve'")
  })

  it('the dev middleware is excluded from production builds', () => {
    expect(read('scripts/loam-dev-server.ts')).toContain("apply: 'serve'")
  })
})

describe('the existing Co-pilot is preserved, not replaced', () => {
  it('the loam flag is independent of the copilot flag and defaults off', () => {
    const src = read('src/lib/types.ts')
    expect(src).toMatch(/\bloam:\s*false/)
    expect(src).toMatch(/\bcopilot:\s*false/)
  })

  it('the assistant panel imports nothing from the legacy engine', () => {
    /**
     * This test used to assert the OPPOSITE -- that the panel still called
     * `answer()` so the Co-pilot kept working. That was right while two
     * assistants shared one surface. Loam is now the only assistant, so the
     * legacy engine must have no route to a screen at all.
     */
    const src = stripComments(read('src/components/copilot/Copilot.tsx'))
    expect(src, 'the panel must not call the keyword router').not.toContain('answer(text, language')
    expect(src, 'and must not branch between assistants').not.toContain('if (loamOn)')
    for (const legacy of [
      '@/lib/copilot/engine', '@/lib/copilot/conversations', '@/lib/copilot/language',
      '@/lib/copilot/i18n', '@/lib/copilot/stt', '@/lib/copilot/llm',
      'CopilotPriceChart', 'COPILOT_DISCLAIMER',
    ]) {
      expect(src, `the panel still imports ${legacy}`).not.toContain(legacy)
    }
  })

  it('the retrieval client seam is optional, so existing callers are unaffected', () => {
    const src = read('src/lib/copilot/retrieval.ts')
    expect(src).toContain('client: RetrievalClient = supabase')
    expect(src).not.toContain('client: RetrievalClient)')
  })
})

describe('L3 cannot be rendered as L1 or L2', () => {
  it('the response keeps reasoning in its own field, never in the answer', () => {
    const src = stripComments(read('src/lib/loam/orchestrator.ts'))
    // If reasoning were concatenated into `answer` anywhere, the separation
    // would be cosmetic. It is returned as its own field and nothing joins it.
    expect(src).toMatch(/reasoning:\s*guarded\.reasoning/)
    expect(src).not.toMatch(/answer[^\n]*reasoning\.join/)
    expect(src).not.toMatch(/reasoning\.join[^\n]*answer/)
  })

  it('the UI renders reasoning from its own field, in its own block', () => {
    const src = read('src/components/copilot/Copilot.tsx')
    expect(src, 'reasoning must come from the dedicated field').toContain('reasoning: r.reasoning ?? []')
    expect(src, 'and be labelled where the user can see the distinction')
      .toContain("ui('reasoningLabel', language)")
    // The factual answer and the reasoning are separate JSX nodes: `content`
    // renders the grounded body, `reasoning` renders in the dashed block.
    expect(src).toMatch(/t\.reasoning!\.map/)
  })

  it('the guard is the only thing that can promote a statement to the body', () => {
    const src = stripComments(read('src/lib/loam/structure.ts'))
    // assemble() routes by kind and grounding, with no third path.
    expect(src).toMatch(/if \(r\.statement\.kind === 'inference'\) reasoning\.push/)
    expect(src).toMatch(/else if \(r\.grounded\) body\.push/)
    expect(src).toMatch(/else rejected\.push/)
  })

  it('an ungrounded cited statement is dropped, not demoted to reasoning', () => {
    // Demoting would still put the sentence in front of a farmer, and would
    // mislabel a false source claim as honest reasoning.
    const src = stripComments(read('src/lib/loam/structure.ts'))
    expect(src).not.toMatch(/rejected[^\n]*reasoning\.push/)
  })
})

describe('the knowledge pack can be promoted without changing the system', () => {
  it('the user-visible source is DERIVED from the review status', () => {
    // It used to be typed into each entry by hand, so the label and the status
    // could disagree -- an entry marked reviewed could still read "PENDING".
    expect(sourceFor({ sourceLabel: 'Pack v0, planting', review: 'pending_agronomist_review' }))
      .toBe('Pack v0, planting - PENDING AGRONOMIST REVIEW')

    expect(sourceFor({
      sourceLabel: 'Pack v0, planting',
      review: 'reviewed',
      reviewer: { name: 'A. Agronomist', affiliation: 'IAR Zaria', reviewedOn: '2026-11-01' },
    })).toBe('Pack v0, planting - reviewed by A. Agronomist, IAR Zaria, 2026-11-01')
  })

  it("'reviewed' without a named reviewer is treated as NOT reviewed", () => {
    // Flipping the flag alone is a mistake, not a promotion, and must not
    // silently remove the warning a farmer sees.
    expect(sourceFor({ sourceLabel: 'Pack v0', review: 'reviewed' }))
      .toContain('PENDING AGRONOMIST REVIEW')
  })

  it('no entry carries a hand-written review status any more', () => {
    const src = read('src/lib/loam/knowledge.ts')
    const entryBlock = src.slice(src.indexOf('export const KNOWLEDGE'))
    expect(entryBlock, 'the status belongs to sourceFor, not to the data')
      .not.toContain('PENDING AGRONOMIST REVIEW')
  })

  it('every entry still reports as pending, and none names a reviewer', () => {
    for (const e of KNOWLEDGE) {
      expect(e.review, `${e.id}`).toBe('pending_agronomist_review')
      expect(e.reviewer, `${e.id} must not claim a review that has not happened`).toBeUndefined()
      expect(sourceFor(e)).toContain('PENDING AGRONOMIST REVIEW')
    }
  })

  it('the zone mapping is attributed the same way', () => {
    expect(ZONE_SOURCE).toContain('PENDING AGRONOMIST REVIEW')
  })
})

describe('Loam does not use the Co-pilot as its conversational brain', () => {
  /**
   * THE BOUNDARY, ENFORCED RATHER THAN DOCUMENTED.
   *
   * The intended relationship is:
   *
   *   Loam orchestrator -> trusted retrieval/analysis -> evidence -> N-ATLaS
   *
   * and explicitly NOT:
   *
   *   Loam orchestrator -> copilot/engine.ts -> canned answer
   *
   * `engine.ts` is the old keyword router: parseIntent(), draftResult(), the
   * fixed-phrase fallbacks. It answers questions by itself. Loam answers them
   * from evidence, so it must never reach for that module -- not for a
   * fallback, not for "just the intent parser", not for convenience.
   *
   * The allowlist below is small on purpose. Adding to it should be a decision
   * someone makes deliberately, which is what a failing test forces.
   */
  const LOAM_FILES = (function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e)
      if (statSync(full).isDirectory()) walk(full, out)
      else if (full.endsWith('.ts')) out.push(full)
    }
    return out
  })(join(ROOT, 'src', 'lib', 'loam'))

  /**
   * Co-pilot modules Loam may import, and why each is safe:
   *   retrieval  deterministic queries that RETURN ROWS. No phrasing, no
   *              intent, no canned text. The price-context RPC it wraps is
   *              real SQL work worth reusing.
   *   analysis   pure functions over rows. No Supabase import at all.
   *   language   entity extraction (masara -> Maize) and language detection.
   *              Data, not conversation.
   */
  const ALLOWED = [
    '@/lib/copilot/retrieval', '@/lib/copilot/analysis', '@/lib/copilot/language',
    // Types and constants only. No queries, no phrasing, no conversation; the
    // type import is erased at runtime entirely.
    '@/lib/copilot/types',
  ]

  it('no Loam module imports the Co-pilot engine', () => {
    for (const f of LOAM_FILES) {
      const src = stripComments(readFileSync(f, 'utf8'))
      expect(src, `${f.replace(ROOT, '')} imports the old conversational engine`)
        .not.toMatch(/from\s+['"]@\/lib\/copilot\/engine['"]/)
      for (const banned of ['parseIntent', 'draftResult', 'phraseFixed', 'phraseNoData']) {
        expect(src, `${f.replace(ROOT, '')} uses ${banned}, which belongs to the keyword router`)
          .not.toContain(banned)
      }
    }
  })

  it('Loam imports only the allowlisted deterministic capabilities', () => {
    const seen = new Set<string>()
    for (const f of LOAM_FILES) {
      const src = stripComments(readFileSync(f, 'utf8'))
      for (const m of src.matchAll(/from\s+['"](@\/lib\/copilot\/[^'"]+)['"]/g)) seen.add(m[1])
    }
    for (const mod of seen) {
      expect(ALLOWED, `${mod} is not an allowlisted capability`).toContain(mod)
    }
  })

  it('the capabilities Loam reuses produce evidence, never prose', () => {
    // retrieval returns rows; analysis is pure. If either grew a phrasing
    // helper, Loam would be one import away from canned answers again.
    const retrieval = stripComments(read('src/lib/copilot/retrieval.ts'))
    expect(retrieval, 'retrieval must not phrase answers').not.toMatch(/\bphrase[A-Z]/)
    const analysis = read('src/lib/copilot/analysis.ts')
    expect(analysis, 'analysis must stay pure').not.toContain("from '@/lib/supabase'")
  })

  it('the Co-pilot engine is intact on disk but no longer reachable', () => {
    /**
     * Preserved, not deleted: capabilities are still being migrated out of it,
     * and docs/loam-legacy-audit.md records what remains to rebuild. What
     * changed is that no user-facing surface imports it any more -- the last
     * line of this test used to assert the opposite.
     */
    const engine = read('src/lib/copilot/engine.ts')
    expect(engine).toContain('export function parseIntent')
    expect(engine).toContain('export async function answer')
    expect(read('src/components/copilot/Copilot.tsx'), 'the panel must not call it')
      .not.toContain('answer(text, language')
  })
})

describe('ordinary local development does not target production', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
  const envs = JSON.parse(read('config/environments.json')) as {
    production: { ref: string }; protectedRefs: string[]
  }

  it('`npm run dev` runs in a mode that overrides the production env file', () => {
    // Bare `vite` loads .env, which points at production. A developer could
    // click through real Founding Member data believing it was staging.
    expect(pkg.scripts.dev, '`dev` must not be bare vite').not.toBe('vite')
    expect(pkg.scripts.dev).toContain('--mode test')
  })

  it('production-connected development exists, but has to be asked for by name', () => {
    const prod = pkg.scripts['dev:production']
    expect(prod, 'maintenance must stay possible').toBeTruthy()
    // It is the production target precisely BECAUSE it has no `--mode`, so
    // bare `vite` loads .env. That is the property, not the exact string.
    expect(prod, 'dev:production must not be redirected to staging').not.toContain('--mode')
  })

  it('every dev server pins its port, so a second one cannot drift onto another', () => {
    /**
     * The forensic audit found three dev servers live at once on 5174, 5200
     * and 5300 across TWO Supabase projects. Vite silently walks to the next
     * free port, so "npm run dev" twice gives two servers and no warning, and
     * a result attributed to the wrong one proves nothing. `--strictPort`
     * makes the second one fail instead of drifting.
     */
    for (const name of ['dev', 'dev:test', 'dev:production']) {
      expect(pkg.scripts[name], `${name} must pin a port`).toMatch(/--port \d+/)
      expect(pkg.scripts[name], `${name} must not drift to another port`)
        .toContain('--strictPort')
    }
  })

  it('staging and production development cannot collide on one port', () => {
    const portOf = (s: string) => s.match(/--port (\d+)/)?.[1]
    expect(portOf(pkg.scripts.dev)).toBe(portOf(pkg.scripts['dev:test']))
    expect(portOf(pkg.scripts['dev:production'])).not.toBe(portOf(pkg.scripts.dev))
  })

  it('the production build is untouched', () => {
    // The release guard asserts the bundle points at production, so `build`
    // must keep loading .env.
    expect(pkg.scripts.build).toBe('tsc --noEmit && vite build && node scripts/check-release-env.mjs')
  })

  it('the dev server announces which project it serves', () => {
    const banner = read('scripts/dev-target-banner.ts')
    expect(banner).toContain('protectedRefs')
    expect(banner).toContain('THIS DEV SERVER IS CONNECTED TO PRODUCTION')
    expect(banner).toContain("apply: 'serve'")
    // It prints the project ref, which is public, and never a key.
    expect(banner).not.toMatch(/ANON_KEY|SERVICE_ROLE|apikey/)
    expect(read('vite.config.ts')).toContain('devTargetBanner()')
  })

  it('reads the protected list from the single source of truth', () => {
    expect(envs.protectedRefs).toContain(envs.production.ref)
    expect(read('scripts/dev-target-banner.ts')).toContain('config/environments.json')
  })

  it('no inference or database secret was moved into a VITE_ variable', () => {
    for (const f of ['.env.example', '.env.test.example']) {
      const src = read(f)
      expect(src, `${f}`).not.toMatch(/VITE_[A-Z_]*(SERVICE_ROLE|SECRET|INFERENCE|LOAM_MODEL)/)
    }
  })
})

const SRC = join(ROOT, 'src')

/** Resolve an import specifier to a file on disk, or null if external. */
function resolveSpec(spec: string, fromFile: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = join(dirname(fromFile), spec)
  else return null
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    try { if (statSync(cand).isFile()) return cand } catch { /* keep looking */ }
  }
  return null
}

/** Every file reachable from `entries` through static imports. */
function closure(entries: string[]): Set<string> {
  const seen = new Set<string>()
  const queue = [...entries]
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    const src = stripComments(readFileSync(file, 'utf8'))
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const next = resolveSpec(m[1], file)
      if (next) queue.push(next)
    }
  }
  return seen
}

describe('the legacy engine is not reachable from Loam, transitively', () => {
  /**
   * A DIRECT-IMPORT CHECK IS NOT A PROOF OF UNREACHABILITY.
   *
   * The earlier test asserted that no file under src/lib/loam imports
   * copilot/engine. That misses the case that actually occurred: Loam's
   * persistence helpers lived in `copilot/conversations.ts`, which imports
   * `answer` from `copilot/engine.ts` at module level. No Loam file named the
   * engine, and the engine was in Loam's module graph anyway.
   *
   * This walks the whole import closure from Loam's entry points and fails if
   * the engine, or any other legacy conversational module, is anywhere in it.
   */
  /**
   * Modules that make up the old conversational brain and must not be in
   * Loam's graph at all.
   *
   * `copilot/i18n/registry.ts` is deliberately NOT on this list, and that is a
   * finding rather than an omission. The transitive walk showed Loam reaches it
   * through `copilot/language.ts`, which exports both the entity extractors
   * Loam uses and the `phrase*` helpers the registry backs. Splitting that file
   * is a refactor, and this task was told to establish the boundary rather than
   * perform one. So the registry stays reachable but inert, and the test below
   * asserts that no Loam file ever CALLS into it. Residual coupling, recorded
   * in docs/loam-legacy-audit.md.
   */
  const LEGACY_BRAIN = [
    'copilot/engine.ts',          // the keyword router and answer generator
    'copilot/conversations.ts',   // imports the engine at module level
    'copilot/i18n/voice.ts',      // the legacy voice path
    'copilot/stt/adapter.ts',     // the legacy speech path
    'copilot/llm/adapter.ts',     // the dead phrasing seam
  ]

  const LOAM_ENTRIES = [
    join(SRC, 'lib', 'loam', 'orchestrator.ts'),
    join(SRC, 'lib', 'loam', 'transport.ts'),
    join(SRC, 'lib', 'loam', 'conversations.ts'),
  ]

  it('no legacy conversational module is in Loam’s import closure', () => {
    const reached = [...closure(LOAM_ENTRIES)].map((f) => f.replace(ROOT, '').replace(/\\/g, '/'))
    for (const legacy of LEGACY_BRAIN) {
      const hit = reached.find((f) => f.endsWith(`/src/lib/${legacy}`))
      expect(hit, `Loam can reach ${legacy}`).toBeUndefined()
    }
  })

  it('the closure is real: it does reach the capabilities Loam legitimately uses', () => {
    // A closure walk that resolved nothing would pass the test above vacuously.
    const reached = [...closure(LOAM_ENTRIES)].map((f) => f.replace(/\\/g, '/'))
    expect(reached.some((f) => f.endsWith('/src/lib/copilot/retrieval.ts')), 'retrieval').toBe(true)
    expect(reached.some((f) => f.endsWith('/src/lib/copilot/analysis.ts')), 'analysis').toBe(true)
    expect(reached.some((f) => f.endsWith('/src/lib/copilot/language.ts')), 'language').toBe(true)
    expect(reached.length, 'the walk resolved a real graph').toBeGreaterThan(10)
  })

  it('the reachable phrase registry is never called from Loam', () => {
    /**
     * `copilot/language.ts` is allowlisted for its entity extractors, and it
     * drags the fixed-phrase answer bank in behind it. Loam may not use that
     * bank: its own refusals live in src/lib/loam/phrases.ts, which is
     * evidence-aware. This pins the distinction between "in the graph" and
     * "on the execution path".
     */
    const loamFiles = [...closure(LOAM_ENTRIES)]
      .filter((f) => f.replace(/\\/g, '/').includes('/src/lib/loam/'))
    expect(loamFiles.length, 'the walk found Loam modules').toBeGreaterThan(5)
    for (const f of loamFiles) {
      const src = stripComments(readFileSync(f, 'utf8'))
      for (const banned of ['getDialect', 'phrasePriceCheck', 'phraseFixed', 'phraseNoData', 'phraseClarifyCommodity', 'FIXED_PHRASE_KEYS']) {
        expect(src, `${f.replace(ROOT, '')} calls the legacy phrase bank via ${banned}`)
          .not.toContain(banned)
      }
    }
  })

  it('Loam has no fallback into the legacy answer generator', () => {
    const orch = stripComments(read('src/lib/loam/orchestrator.ts'))
    // Every exit from runLoam is one of these. None of them consults another engine.
    for (const banned of ['answer(', 'parseIntent', 'draftResult', 'oneClarify', 'notYetBuilt', 'phraseFixed']) {
      expect(orch, `orchestrator must not use ${banned}`).not.toContain(banned)
    }
    expect(orch, 'an unanswerable question declines').toContain("'noEvidence'")
  })

  it('the legacy engine survives on disk as a rollback boundary', () => {
    // Kept, not deleted: capabilities are still being migrated out of it, and
    // docs/loam-legacy-audit.md records what is left to rebuild.
    const engine = read('src/lib/copilot/engine.ts')
    expect(engine).toContain('export function parseIntent')
    expect(engine).toContain('export async function answer')
  })

  it('but nothing a user can reach imports it', () => {
    /**
     * The real test of isolation. Walks every file reachable from the app
     * entry point and asserts the legacy engine is not among them.
     */
    const appEntry = [join(SRC, 'App.tsx'), join(SRC, 'main.tsx')]
      .filter((f) => { try { return statSync(f).isFile() } catch { return false } })
    const reached = [...closure(appEntry)].map((f) => f.replace(/\\/g, '/'))
    expect(reached.length, 'the walk resolved a real graph').toBeGreaterThan(50)
    const hit = reached.find((f) => f.endsWith('/src/lib/copilot/engine.ts'))
    expect(hit, 'the legacy engine is reachable from the running app').toBeUndefined()
  })
})

describe('no legacy response flow exists on the assistant surface', () => {
  const ui = stripComments(read('src/components/copilot/Copilot.tsx'))

  /**
   * These were previously GATED behind `!loamOn`. They are now absent: the
   * panel serves one assistant, so there is no branch for them to sit in and
   * no field for them to render from.
   */
  for (const [label, needle] of [
    ['Confirm & continue draft flow', 'Confirm &amp; continue'],
    ['draft slots', "kind === 'draft'"],
    ['Not helpful? improvement loop', 'Not helpful?'],
    ['flagged-question write', 'logFlaggedQuestion'],
    ['legacy price chart', 'CopilotPriceChart'],
    ['legacy voice clip playback', 'clipUrl'],
    ['legacy deep link', 'deepLink'],
    ['legacy disclaimer', 'COPILOT_DISCLAIMER'],
    ['legacy starter prompts', 'SUGGESTIONS'],
    ['legacy fixed phrases', 'phraseFixed'],
  ] as const) {
    it(`${label} is gone from the panel`, () => {
      expect(ui, `${label} is still present`).not.toContain(needle)
    })
  }

  it('voice input does not go through the legacy speech adapter', () => {
    /**
     * UPDATED: the microphone used to be a permanently disabled button, and
     * this test asserted it had no `onClick`. Voice input is now implemented,
     * so that assertion is obsolete -- but the property it was protecting is
     * not. What still matters is WHICH speech path the panel uses: Loam owns
     * this surface, and the legacy Co-pilot adapter must stay out of its
     * module graph.
     */
    const stt = read('src/lib/copilot/stt/adapter.ts')
    expect(stt, 'the legacy adapter is kept on disk').toContain('class NullSttAdapter')
    expect(ui, 'but the panel does not import it').not.toContain('getSttAdapter')
    expect(ui, 'nor reach the legacy stt directory at all').not.toContain('copilot/stt')
  })

  it('a transcript reaches the composer and never the send path', () => {
    /**
     * The property that replaces "the microphone is unwired". Voice is an
     * INPUT method: a transcript is written into the composer state and the
     * member sends it themselves. If `onTranscript` ever called `send`, voice
     * would bypass the orchestrator, the evidence layer and the guard.
     */
    const handler = ui.slice(ui.indexOf('onTranscript={'), ui.indexOf('{fromVoice &&'))
    expect(handler, 'it fills the composer').toContain('setInput(')
    expect(handler, 'and must not submit').not.toMatch(/\bsend\(/)
    expect(handler, 'and must not translate the transcript').not.toMatch(/translat/i)
  })

  it('the panel gates on `loam` alone, not on a choice between assistants', () => {
    expect(ui).toContain('if (!loamOn || !profile) return null')
    expect(ui, 'copilot must not select anything user-facing').not.toContain("flagEnabled('copilot')")
  })
})

describe('the developer flag override cannot reach a deployed build', () => {
  const src = read('src/context/AuthContext.tsx')
  const fn = src.slice(src.indexOf('function readDevFlags'), src.indexOf('export function AuthProvider'))

  it('is guarded by import.meta.env.DEV', () => {
    /**
     * The guard is the whole safety property. `import.meta.env.DEV` is false
     * in `vite build`, so the branch is dead code in any deployed bundle and
     * Vite drops it. Without this, a localStorage key -- or now a query
     * parameter -- on a production origin could switch on an unreleased
     * surface for whoever set it.
     */
    expect(fn).toContain('if (!import.meta.env.DEV')
    expect(fn).toContain('return {}')
    // The guard must come before anything that could read an override, so
    // nothing in a build reaches storage or the query string at all.
    const guard = fn.indexOf('if (!import.meta.env.DEV')
    expect(guard, 'the guard must be the first statement').toBeLessThan(
      Math.min(fn.indexOf('localStorage'), fn.indexOf('location.search')),
    )
  })

  it('resolves every override inside the guarded function', () => {
    // Nothing outside readDevFlags may read the override, or the DEV guard
    // stops being the single point that disables all of this in a build.
    // The whole declaration, its doc comment included -- the comment explains
    // the storage scoping and so names `localStorage` in prose.
    const region = src.slice(
      src.indexOf('const DEV_FLAG_KEY'),
      src.indexOf('export function AuthProvider'),
    )
    const outside = src.replace(region, '')
    expect(outside).not.toContain('localStorage')
    expect(outside).not.toContain('location.search')
    // `DEV_FLAG_KEY` may be declared outside, but must be USED only inside.
    expect(outside).not.toContain('DEV_FLAG_KEY')
  })

  it('reads a namespaced key and survives storage being unavailable', () => {
    expect(src).toContain("const DEV_FLAG_KEY = 'loamy.dev.flags'")
    expect(fn, 'private mode and blocked storage must not crash auth').toContain('catch')
    // Both the read and the write, since the URL path now persists.
    expect(fn.match(/catch/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('accepts only flags the platform already declares', () => {
    // A typo in the address bar must not invent a flag, and an arbitrary
    // query parameter must not be written into storage.
    expect(fn).toContain('Object.keys(DEFAULT_FLAGS)')
  })

  it('falls through to the real flag when no override is set', () => {
    // An override of `undefined` must not read as `false` and silently hide a
    // surface the environment has genuinely enabled.
    expect(src).toContain("typeof override === 'boolean' ? override : flags[key] === true")
  })
})

describe('streaming cannot become a path around the guard', () => {
  const orchestrator = read('src/lib/loam/orchestrator.ts')

  it('the orchestrator never passes onToken', async () => {
    /**
     * `GenerateRequest.onToken` exists to prove the seam fits a future
     * streaming host. It is NOT a render path. `guardStructured` drops
     * ungrounded statements and `guardGeneral` withholds a whole answer that
     * states a price or a platform fact -- both need the complete response.
     * A token displayed as it arrives is a token displayed before either
     * check has run, and retracting a sentence already on screen is worse
     * than waiting for it.
     */
    expect(orchestrator, 'no call site may supply a token callback')
      .not.toContain('onToken')
  })

  it('what the model actually receives carries no callback', async () => {
    const { runLoam } = await import('@/lib/loam/orchestrator')
    const { MockAdapter } = await import('@/lib/loam/model/adapter')
    const model = new MockAdapter('Rice is a cereal grain.')
    const client = {
      from: () => {
        const chain: Record<string, unknown> = {}
        const self = () => chain
        for (const m of ['eq', 'in', 'ilike', 'order', 'gte', 'lte', 'or']) chain[m] = self
        chain.select = () => chain
        chain.limit = () => Promise.resolve({ data: [], count: 0, error: null })
        chain.then = (r: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], count: 0, error: null }).then(r)
        return chain
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    }
    await runLoam(
      { message: 'What is rice?', language: 'en' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { model, client: client as any, userId: 'u1' },
    )
    expect(model.lastRequest).not.toBeNull()
    expect(model.lastRequest!.onToken, 'the guard must see the whole answer first')
      .toBeUndefined()
  })

  it('the local adapter never streams', () => {
    const adapter = read('src/lib/loam/model/adapter.ts')
    expect(adapter).toContain('stream: false')
    expect(adapter).not.toContain('stream: true')
  })

  it('the hosted adapter streams only when BOTH conditions are met', () => {
    /**
     * This assertion used to read `expect(hosted).toContain('stream: false')`
     * and broke when streaming was implemented, because the literal became
     * `stream: streaming`. The STRING changed; the property did not, and the
     * property is what matters:
     *
     *   streaming requires cfg.streaming AND req.onToken
     *
     * Loam's orchestrator passes no `onToken` -- asserted above -- so no
     * provider setting can start streaming into the guarded pipeline. And
     * `streaming` is opt-in, so an operator must also assert that the
     * provider supports it.
     */
    const hosted = read('src/lib/loam/model/hosted.ts')
    expect(hosted).toContain('return Boolean(this.cfg.streaming && req.onToken)')
    expect(hosted, 'the request body follows willStream, never a literal true')
      .toContain('stream: streaming')
    /**
     * Checked on the REQUEST BODY only. `hosted.ts` does contain
     * `{ stream: true }` -- it is TextDecoder's option for decoding across
     * chunk boundaries, which has nothing to do with the request. A blunt
     * `not.toContain('stream: true')` flagged it, which is a false positive
     * worth remembering: the thing being guarded is what we send upstream.
     */
    const bodyStart = hosted.indexOf('body: JSON.stringify({')
    const body = hosted.slice(bodyStart, hosted.indexOf('}),', bodyStart))
    expect(body).not.toContain('stream: true')
    expect(body).toContain('stream: streaming')
    // Default off: capabilities only claim streaming when configured.
    expect(hosted).toContain("cfg.streaming ? ['text', 'streaming'] : ['text']")
  })

  it('a stream that ends early is never returned as an answer', () => {
    // A truncated agricultural instruction is worse than no instruction.
    const hosted = read('src/lib/loam/model/hosted.ts')
    expect(hosted).toContain('if (!done)')
    expect(hosted).toContain('ended the stream before finishing')
  })
})
