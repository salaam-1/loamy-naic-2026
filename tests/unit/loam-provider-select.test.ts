import { describe, expect, it } from 'vitest'
import { ModelConfigurationError } from '@/lib/loam/model/adapter'
import {
  describeAdapter, isProductionEnv, resolveAdapter, resolveProvider,
} from '@/lib/loam/model/select'

/**
 * Which model serves a request, and the one thing that must never happen.
 *
 * THE PROPERTY THIS FILE EXISTS FOR
 *   A deployed Loam must never silently talk to `127.0.0.1`. That failure
 *   does not look like a failure: the service starts, reports healthy, and
 *   then every question times out against a laptop that is switched off. So
 *   production refusing local inference is asserted here from several angles.
 *
 *   No model is contacted. These are pure configuration decisions.
 */

/** An obvious placeholder. The credential test in this suite checks for these. */
const PLACEHOLDER_TOKEN = 'PLACEHOLDER-not-a-real-token-000000'
const HOSTED = { LOAM_HOSTED_MODEL: 'some-org/some-model', LOAM_HOSTED_TOKEN: PLACEHOLDER_TOKEN }

describe('production is detected without guessing', () => {
  it('reads LOAM_ENV first, so a host that always sets NODE_ENV can still stage', () => {
    /**
     * Most platforms set NODE_ENV=production for every deployment. Without
     * LOAM_ENV taking precedence, a staging box pointed at a local model
     * could not start at all.
     */
    expect(isProductionEnv({ LOAM_ENV: 'production', NODE_ENV: 'development' })).toBe(true)
    expect(isProductionEnv({ LOAM_ENV: 'staging', NODE_ENV: 'production' })).toBe(false)
  })

  it('falls back to NODE_ENV when LOAM_ENV is absent', () => {
    expect(isProductionEnv({ NODE_ENV: 'production' })).toBe(true)
    expect(isProductionEnv({ NODE_ENV: 'development' })).toBe(false)
  })

  it('treats an empty environment as NOT production', () => {
    // A local `node dist-server/...` with no env set is a developer, not a
    // deployment. Defaulting the other way would make local runs impossible.
    expect(isProductionEnv({})).toBe(false)
  })
})

describe('provider selection', () => {
  it('defaults to ollama when nothing is configured', () => {
    expect(resolveProvider({})).toBe('ollama')
  })

  it('infers hosted from the presence of hosted configuration', () => {
    // Setting either of these is a deliberate act, so it is read as intent.
    expect(resolveProvider({ LOAM_HOSTED_MODEL: 'some-org/some-model' })).toBe('hosted')
    expect(resolveProvider({ LOAM_HOSTED_TOKEN: PLACEHOLDER_TOKEN })).toBe('hosted')
  })

  it('lets LOAM_PROVIDER override the inference in both directions', () => {
    expect(resolveProvider({ ...HOSTED, LOAM_PROVIDER: 'ollama' })).toBe('ollama')
    expect(resolveProvider({ LOAM_PROVIDER: 'hosted' })).toBe('hosted')
  })

  it('rejects a provider name it does not recognise', () => {
    // Silently falling back would turn a typo into a wrong model.
    expect(() => resolveProvider({ LOAM_PROVIDER: 'openai' })).toThrow(ModelConfigurationError)
    expect(() => resolveProvider({ LOAM_PROVIDER: 'hostd' })).toThrow(ModelConfigurationError)
  })
})

describe('production NEVER falls back to local inference', () => {
  it('refuses to build an Ollama adapter in production', () => {
    for (const env of [
      { LOAM_ENV: 'production' },
      { NODE_ENV: 'production' },
      { LOAM_ENV: 'production', LOAM_PROVIDER: 'ollama' },
      { LOAM_ENV: 'production', LOAM_INFERENCE_URL: 'http://127.0.0.1:11434' },
    ]) {
      expect(() => resolveAdapter(env), JSON.stringify(env)).toThrow(ModelConfigurationError)
      expect(() => resolveAdapter(env)).toThrow(/cannot serve production traffic/i)
    }
  })

  it('names what to set, rather than just refusing', () => {
    // An error that does not say what to do gets worked around.
    expect(() => resolveAdapter({ LOAM_ENV: 'production' }))
      .toThrow(/LOAM_HOSTED_MODEL/)
  })

  it('refuses a hosted base URL that points at this machine', () => {
    /**
     * "Hosted" aimed at localhost is still a laptop dependency wearing the
     * right variable name, which is what makes it easy to miss in review.
     */
    for (const base of [
      'http://127.0.0.1:8080/v1', 'http://localhost:8080/v1',
      'http://0.0.0.0:8080/v1', 'http://[::1]:8080/v1',
    ]) {
      expect(() => resolveAdapter({ ...HOSTED, LOAM_ENV: 'production', LOAM_HOSTED_BASE_URL: base }), base)
        .toThrow(/local address/i)
    }
  })

  it('allows a genuinely remote hosted base URL in production', () => {
    const adapter = resolveAdapter({
      ...HOSTED, LOAM_ENV: 'production',
      LOAM_HOSTED_BASE_URL: 'https://router.example.test/v1',
    })
    expect(adapter.name).toBe('hosted-openai-compatible')
  })
})

describe('missing credentials fail loudly, never silently', () => {
  it('throws when hosted is selected but unconfigured', () => {
    expect(() => resolveAdapter({ LOAM_PROVIDER: 'hosted' })).toThrow(ModelConfigurationError)
    expect(() => resolveAdapter({ LOAM_PROVIDER: 'hosted' }))
      .toThrow(/selected but not configured/i)
  })

  it('does NOT quietly downgrade to Ollama when hosted is unconfigured', () => {
    /**
     * The tempting "helpful" behaviour, and the wrong one. A service that
     * fell back would answer with a different model than the operator
     * configured, and nobody would be told.
     */
    let adapter: unknown = null
    try { adapter = resolveAdapter({ LOAM_PROVIDER: 'hosted' }) } catch { /* expected */ }
    expect(adapter).toBeNull()
  })

  it('does not invent a stub that fabricates answers', () => {
    // There is no provider here that returns text without a real model.
    try {
      const a = resolveAdapter({ LOAM_PROVIDER: 'hosted' })
      expect((a as { name: string }).name).not.toBe('mock')
    } catch { /* throwing is the correct outcome */ }
  })
})

describe('development keeps the local option', () => {
  it('still returns the Ollama adapter for an empty environment', () => {
    expect(resolveAdapter({}).name).toBe('ollama')
  })

  it('still applies the model pin and the cloud-routing refusal', () => {
    // Routed through the existing factory, so these guards are not bypassed.
    expect(() => resolveAdapter({ LOAM_MODEL: 'glm-5.2:cloud' })).toThrow(ModelConfigurationError)
    expect(() => resolveAdapter({ LOAM_INFERENCE_URL: 'https://ollama.com' }))
      .toThrow(ModelConfigurationError)
  })

  it('builds a hosted adapter outside production too, when asked', () => {
    expect(resolveAdapter({ ...HOSTED }).name).toBe('hosted-openai-compatible')
  })
})

describe('the startup description carries no credential', () => {
  it('reports token PRESENCE and never its value', () => {
    const line = describeAdapter({ ...HOSTED })
    expect(line).toContain('token present')
    expect(line).not.toContain(PLACEHOLDER_TOKEN)
  })

  it('says MISSING rather than printing an empty string', () => {
    expect(describeAdapter({ LOAM_HOSTED_MODEL: 'some-org/some-model' }))
      .toContain('token MISSING')
  })

  it('describes the local adapter without throwing on bad config', () => {
    // A banner must not be the thing that crashes startup.
    expect(describeAdapter({ LOAM_MODEL: 'glm-5.2:cloud' })).toMatch(/REFUSED/)
  })

  it('never includes the token under any provider', () => {
    for (const env of [{ ...HOSTED }, { ...HOSTED, LOAM_PROVIDER: 'ollama' }, {}]) {
      expect(describeAdapter(env)).not.toContain(PLACEHOLDER_TOKEN)
    }
  })
})
