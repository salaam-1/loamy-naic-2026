import { describe, expect, it, vi } from 'vitest'
import {
  AiSettingsSecretError, DEFAULT_AI_SETTINGS, aiServiceStatuses, assertNoSecrets,
  normalizeAiSettings, readAiSettings, saveAiSettings, testAiConnection,
  type AiSettings,
} from '@/lib/aiSettings'
import { PINNED_MODEL } from '@/lib/loam/model/adapter'

/**
 * Administrator AI configuration.
 *
 * THE CONSTRAINT EVERYTHING HERE FOLLOWS FROM
 *   `platform_config` has `for select to authenticated using (true)` -- every
 *   signed-in member can read the row. UPDATE is `loamy_is_admin()` on both
 *   `using` and `with check`. So authorization for WRITING is sound and
 *   enforced by the database, and the risk is not an unauthorized write: it
 *   is a secret being stored somewhere every member can read.
 *
 *   These tests therefore spend most of their effort on (a) refusing
 *   secret-shaped data at the write path, (b) not destroying the neighbouring
 *   settings, and (c) refusing to report a service as working when nothing
 *   has been verified.
 */

/** A Supabase double that records what it was asked to do. */
function fakeDb(settings: Record<string, unknown> = {}, opts: { updateError?: boolean } = {}) {
  const updates: unknown[] = []
  const from = (table: string) => {
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.maybeSingle = async () => ({ data: { settings }, error: null })
    chain.update = (patch: unknown) => {
      updates.push({ table, patch })
      return { eq: async () => ({ error: opts.updateError ? { message: 'denied' } : null }) }
    }
    return chain
  }
  return { db: { from } as unknown as Parameters<typeof readAiSettings>[0], updates }
}

/* ----------------------------------------------------------- defaults */

describe('defaults are safe and nothing is activated', () => {
  it('local Ollama is the default provider', () => {
    expect(DEFAULT_AI_SETTINGS.inference.provider).toBe('ollama')
    expect(DEFAULT_AI_SETTINGS.inference.localModel).toBe(PINNED_MODEL)
    expect(DEFAULT_AI_SETTINGS.inference.localBaseUrl).toBe('http://127.0.0.1:11434')
  })

  it('hosted inference has NO default model and is off', () => {
    /**
     * The safeguard that matters most. A default would answer agricultural
     * questions with a model nobody chose, and
     * `meta-llama/Llama-3.1-8B-Instruct` is Llama 3.1, not N-ATLaS.
     */
    expect(DEFAULT_AI_SETTINGS.inference.hostedModel).toBe('')
    expect(DEFAULT_AI_SETTINGS.inference.hostedEnabled).toBe(false)
  })

  it('both speech services are off with no provider', () => {
    expect(DEFAULT_AI_SETTINGS.stt).toEqual({ provider: '', enabled: false })
    expect(DEFAULT_AI_SETTINGS.tts).toEqual({ provider: '', enabled: false })
  })

  it('an absent configuration reads as the defaults', async () => {
    const { db } = fakeDb({})
    await expect(readAiSettings(db)).resolves.toEqual(DEFAULT_AI_SETTINGS)
  })

  it('a partial configuration fills its gaps rather than failing', () => {
    const s = normalizeAiSettings({ inference: { hostedModel: 'x/y' } })
    expect(s.inference.hostedModel).toBe('x/y')
    expect(s.inference.localModel).toBe(PINNED_MODEL)
    expect(s.inference.provider).toBe('ollama')
    expect(s.stt.enabled).toBe(false)
  })

  it('rubbish in the column does not crash the admin page', () => {
    for (const junk of [null, undefined, 7, 'nonsense', [], { inference: 'no' }]) {
      expect(() => normalizeAiSettings(junk)).not.toThrow()
    }
    expect(normalizeAiSettings('nonsense').inference.provider).toBe('ollama')
  })

  it('never invents a hosted model from a junk value', () => {
    expect(normalizeAiSettings({ inference: { hostedModel: 42 } }).inference.hostedModel).toBe('')
    expect(normalizeAiSettings({ inference: { hostedModel: '  ' } }).inference.hostedModel).toBe('')
  })
})

/* ------------------------------------------------------- secret refusal */

describe('a secret cannot be stored in a member-readable column', () => {
  it('refuses a credential-shaped FIELD NAME', () => {
    for (const key of [
      'token', 'hostedToken', 'apiKey', 'api_key', 'secret', 'password',
      'credential', 'authorization', 'bearerToken', 'privateKey',
    ]) {
      expect(() => assertNoSecrets({ [key]: 'anything' }), key)
        .toThrow(AiSettingsSecretError)
    }
  })

  it('refuses a credential-shaped VALUE whatever key it hides under', () => {
    for (const value of [
      'hf_abcdefghijklmnopqrst',
      'sk-abcdefghijklmnopqrst',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6.payload',
      'Bearer something-long',
    ]) {
      expect(() => assertNoSecrets({ harmlessLookingField: value }), value)
        .toThrow(AiSettingsSecretError)
    }
  })

  it('finds one nested deep in the object', () => {
    expect(() => assertNoSecrets({ a: { b: { c: { token: 'x' } } } }))
      .toThrow(AiSettingsSecretError)
    expect(() => assertNoSecrets({ list: [{ ok: 1 }, { apiKey: 'x' }] }))
      .toThrow(AiSettingsSecretError)
  })

  it('names the offending path so an admin can find it', () => {
    try {
      assertNoSecrets({ inference: { hostedToken: 'x' } })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as Error).message).toContain('inference.hostedToken')
      expect((e as Error).message).toMatch(/readable by every signed-in member/i)
    }
  })

  it('does NOT reject legitimate fields that merely contain a secret word', () => {
    /**
     * REGRESSION. The first guard used a substring match and rejected
     * `maxOutputTokens` -- a token COUNT, not a credential. A guard that
     * blocks valid configuration gets disabled by the next person who hits
     * it, so the rule discriminates on the singular suffix: `hostedToken` is
     * a credential, `maxOutputTokens` is a number.
     */
    for (const key of [
      'maxOutputTokens', 'requestTimeoutMs', 'temperature', 'hostedModel',
      'localModel', 'localBaseUrl', 'hostedBaseUrl', 'provider', 'enabled',
    ]) {
      expect(() => assertNoSecrets({ [key]: 'value' }), key).not.toThrow()
    }
  })

  it('allows the real settings through', () => {
    expect(() => assertNoSecrets(DEFAULT_AI_SETTINGS)).not.toThrow()
    expect(() => assertNoSecrets({
      ...DEFAULT_AI_SETTINGS,
      inference: { ...DEFAULT_AI_SETTINGS.inference, hostedModel: 'NCAIR1/N-ATLaS' },
    })).not.toThrow()
  })

  it('throws rather than silently stripping, so nobody thinks it saved', async () => {
    const { db, updates } = fakeDb({})
    const poisoned = {
      ...DEFAULT_AI_SETTINGS,
      inference: { ...DEFAULT_AI_SETTINGS.inference, hostedModel: 'hf_aaaaaaaaaaaaaaaaaaaa' },
    } as AiSettings
    await expect(saveAiSettings(poisoned, db)).rejects.toThrow(AiSettingsSecretError)
    expect(updates, 'nothing may be written').toHaveLength(0)
  })

  it('the settings TYPE has no credential field at all', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('src/lib/aiSettings.ts', 'utf8')
    const iface = src.slice(src.indexOf('export interface AiInferenceSettings'),
      src.indexOf('export interface AiSpeechSettings'))
    for (const bad of ['token', 'secret', 'apiKey', 'password', 'credential']) {
      expect(iface.toLowerCase(), `no ${bad} field`).not.toMatch(new RegExp(`\\n\\s+${bad}`, 'i'))
    }
  })
})

/* -------------------------------------------------------- persistence */

describe('saving preserves everything that lives beside it', () => {
  const NEIGHBOURS = {
    eligibility_weights: { verified_farm: 1 },
    wallet_min_withdrawal_ngn: 1000,
    verification_max_distance_m: 5000,
  }

  it('merges rather than replacing the settings column', async () => {
    /**
     * A whole-column write would destroy the financing weights and the
     * verification thresholds. Read-merge-write is the difference between
     * saving a model name and silently resetting the financing engine.
     */
    const { db, updates } = fakeDb(NEIGHBOURS)
    const r = await saveAiSettings(DEFAULT_AI_SETTINGS, db)
    expect(r.ok).toBe(true)
    const patch = (updates[0] as { patch: { settings: Record<string, unknown> } }).patch
    expect(patch.settings.eligibility_weights).toEqual(NEIGHBOURS.eligibility_weights)
    expect(patch.settings.wallet_min_withdrawal_ngn).toBe(1000)
    expect(patch.settings.verification_max_distance_m).toBe(5000)
    expect(patch.settings.ai).toEqual(DEFAULT_AI_SETTINGS)
  })

  it('round-trips a changed setting', async () => {
    const next: AiSettings = {
      ...DEFAULT_AI_SETTINGS,
      inference: { ...DEFAULT_AI_SETTINGS.inference, hostedModel: 'NCAIR1/N-ATLaS' },
    }
    const { db, updates } = fakeDb(NEIGHBOURS)
    await saveAiSettings(next, db)
    const stored = (updates[0] as { patch: { settings: { ai: unknown } } }).patch.settings.ai
    const { db: reread } = fakeDb({ ...NEIGHBOURS, ai: stored })
    await expect(readAiSettings(reread)).resolves.toEqual(next)
  })

  it('a denied write reports that admin access is needed, not a database error', async () => {
    /**
     * UPDATE is gated on `loamy_is_admin()` in the database. A non-admin
     * client-side write fails there, and the message says what to do without
     * echoing an RLS error.
     */
    const { db } = fakeDb({}, { updateError: true })
    const r = await saveAiSettings(DEFAULT_AI_SETTINGS, db)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.error).toMatch(/administrator access is required/i)
    expect(r.error).not.toMatch(/denied|rls|policy|postgres/i)
  })

  it('writes to platform_config and nothing else', async () => {
    const { db, updates } = fakeDb({})
    await saveAiSettings(DEFAULT_AI_SETTINGS, db)
    expect(updates).toHaveLength(1)
    expect((updates[0] as { table: string }).table).toBe('platform_config')
  })
})

/* -------------------------------------------------------------- status */

describe('status distinguishes configured from available from verified', () => {
  const statuses = (over: Partial<AiSettings['inference']> = {}) =>
    aiServiceStatuses({
      ...DEFAULT_AI_SETTINGS,
      inference: { ...DEFAULT_AI_SETTINGS.inference, ...over },
    })

  it('reports all four services', () => {
    expect(statuses().map((s) => s.service))
      .toEqual(['inference-local', 'inference-hosted', 'stt', 'tts'])
  })

  it('NOTHING is ever reported as inference-verified', () => {
    /**
     * The whole point. No configuration, however complete, may imply that a
     * call has succeeded -- and for hosted N-ATLaS none ever has.
     */
    const all = statuses({ hostedModel: 'NCAIR1/N-ATLaS', hostedEnabled: true })
    for (const s of all) expect(s.inferenceVerified, s.service).toBe(false)
  })

  it('a typed model id does NOT turn hosted green', () => {
    const hosted = statuses({ hostedModel: 'NCAIR1/N-ATLaS', hostedEnabled: true })
      .find((s) => s.service === 'inference-hosted')!
    expect(hosted.configured).toBe(true)
    expect(hosted.tone, 'never ok on configuration alone').toBe('off')
    expect(hosted.summary).toMatch(/not verified/i)
  })

  it('hosted with no model reads as not configured', () => {
    const hosted = statuses().find((s) => s.service === 'inference-hosted')!
    expect(hosted.configured).toBe(false)
    expect(hosted.summary).toMatch(/nothing is configured/i)
  })

  it('credential presence is UNKNOWN from the browser, which is correct', () => {
    // A browser that could tell would be a browser that can read the secret.
    const hosted = statuses({ hostedModel: 'x/y' }).find((s) => s.service === 'inference-hosted')!
    expect(hosted.credential).toBe('unknown')
  })

  it('local inference reads as serving when selected', () => {
    const local = statuses().find((s) => s.service === 'inference-local')!
    expect(local.tone).toBe('ok')
    expect(local.summary).toContain(PINNED_MODEL)
    // Still not "verified" -- reachability is proven by an answer, not here.
    expect(local.inferenceVerified).toBe(false)
  })

  it('speech services report no verified language', () => {
    for (const s of statuses().filter((x) => x.service === 'stt' || x.service === 'tts')) {
      expect(s.configured).toBe(false)
      expect(s.tone).toBe('off')
      expect(s.summary).toMatch(/no provider has been selected/i)
    }
  })
})

/* ----------------------------------------------------- test connection */

describe('Test Connection says what it actually checked', () => {
  it('makes NO network request, for any service', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    for (const svc of ['inference-local', 'inference-hosted', 'stt', 'tts'] as const) {
      testAiConnection(svc, DEFAULT_AI_SETTINGS)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('an unconfigured hosted service is told what to do first', () => {
    const r = testAiConnection('inference-hosted', DEFAULT_AI_SETTINGS)
    expect(r.ok).toBe(false)
    expect(r.checked).toBe('nothing')
    expect(r.message).toMatch(/no default/i)
  })

  it('a configured hosted service is honest that it cannot be tested here', () => {
    const r = testAiConnection('inference-hosted', {
      ...DEFAULT_AI_SETTINGS,
      inference: { ...DEFAULT_AI_SETTINGS.inference, hostedModel: 'x/y' },
    })
    expect(r.ok).toBe(false)
    expect(r.checked).toBe('nothing')
    expect(r.message).toMatch(/server-side credential/i)
  })

  it('never labels a configuration check as an inference test', () => {
    const r = testAiConnection('inference-local', DEFAULT_AI_SETTINGS)
    expect(r.checked, 'a model list is not an inference test, and nor is this')
      .toBe('configuration')
    expect(r.checked).not.toBe('inference')
  })

  it('an unselected speech provider has nothing to test', () => {
    for (const svc of ['stt', 'tts'] as const) {
      const r = testAiConnection(svc, DEFAULT_AI_SETTINGS)
      expect(r.ok).toBe(false)
      expect(r.message).toMatch(/nothing to test/i)
    }
  })

  it('no result leaks a credential or an upstream body', () => {
    for (const svc of ['inference-local', 'inference-hosted', 'stt', 'tts'] as const) {
      const r = testAiConnection(svc, DEFAULT_AI_SETTINGS)
      for (const leak of ['Bearer', 'hf_', 'sk-', 'eyJ', 'service_role']) {
        expect(r.message, `${svc}/${leak}`).not.toContain(leak)
      }
    }
  })
})

/* ------------------------------------------------- nothing got activated */

describe('Phase E activated nothing', () => {
  it('the admin page has no credential input', async () => {
    const fs = await import('node:fs')
    const page = fs.readFileSync('src/pages/admin/AdminConfig.tsx', 'utf8')
    expect(page).not.toMatch(/type="password"/)
    for (const bad of ['hostedToken', 'apiKey', 'api_key', 'LOAM_HOSTED_TOKEN']) {
      expect(page, `no ${bad} field`).not.toContain(bad)
    }
  })

  it('the hosted adapter is still unreferenced by any runtime path', async () => {
    const fs = await import('node:fs')
    for (const f of [
      'src/lib/loam/orchestrator.ts',
      'scripts/loam-dev-server.ts',
      'src/components/copilot/Copilot.tsx',
    ]) {
      expect(fs.readFileSync(f, 'utf8'), f).not.toContain('HostedChatAdapter')
    }
  })

  it('the settings module reaches no network itself', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('src/lib/aiSettings.ts', 'utf8')
    expect(src).not.toContain('fetch(')
    expect(src).not.toContain('XMLHttpRequest')
  })
})
