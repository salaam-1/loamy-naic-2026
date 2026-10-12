/**
 * Which inference adapter serves a request, decided from the environment.
 *
 * WHY THIS IS A SEPARATE MODULE AND NOT PART OF `adapterFromEnv`
 *   `hosted.ts` already imports `adapter.ts` for `ModelAdapter`. Teaching
 *   `adapter.ts` to construct a `HostedChatAdapter` would make that import
 *   circular. So selection lives one level up, importing both, and the two
 *   factories below stay what they are: `adapterFromEnv` builds Ollama,
 *   `hostedAdapterFromEnv` builds hosted, and this file chooses.
 *
 * THE RULE THAT MATTERS MOST
 *   PRODUCTION NEVER FALLS BACK TO LOCALHOST. A deployed service that
 *   silently used `http://127.0.0.1:11434` would not fail -- it would answer
 *   nothing, slowly, while reporting a configuration that looks fine. So in
 *   production a missing or local provider is a startup error, not a default.
 *
 *   Development keeps Ollama as the default, deliberately: that is the whole
 *   point of the local setup, and `resolveAdapter({})` still returns it.
 *
 * MISSING CREDENTIALS FAIL LOUDLY
 *   Asking for the hosted provider without configuring it throws. It does not
 *   quietly return Ollama, and it does not return a stub that fabricates an
 *   answer. "The model is not configured" is a true thing a caller can
 *   surface; a fake answer is not.
 */
import {
  ModelConfigurationError, adapterFromEnv, resolveInferenceUrl, resolveModel,
  type ModelAdapter,
} from '@/lib/loam/model/adapter'
import { hostedAdapterFromEnv } from '@/lib/loam/model/hosted'

export type InferenceProvider = 'ollama' | 'hosted'

type Env = Record<string, string | undefined>

/**
 * Whether this process is serving production traffic.
 *
 * `LOAM_ENV` is checked first so a host that sets `NODE_ENV=production` for
 * every deployment (most of them do) can still run a staging instance that
 * points at a local model, without this guard refusing to start.
 */
export function isProductionEnv(env: Env): boolean {
  const explicit = (env.LOAM_ENV ?? '').trim().toLowerCase()
  if (explicit) return explicit === 'production'
  return (env.NODE_ENV ?? '').trim().toLowerCase() === 'production'
}

/**
 * Which provider the environment asks for.
 *
 * `LOAM_PROVIDER` is authoritative when set, so an operator can force Ollama
 * in a staging box that happens to have hosted credentials lying around, or
 * force hosted to prove the credentials work. Otherwise the presence of
 * hosted configuration is taken as the intent to use it.
 */
export function resolveProvider(env: Env): InferenceProvider {
  const explicit = (env.LOAM_PROVIDER ?? '').trim().toLowerCase()
  if (explicit === 'hosted' || explicit === 'ollama') return explicit
  if (explicit) {
    throw new ModelConfigurationError(
      `LOAM_PROVIDER "${explicit}" is not recognised. Use "hosted" or "ollama".`,
    )
  }
  // Inferred from configuration, not guessed: either of these being set is a
  // deliberate act.
  const hosted = (env.LOAM_HOSTED_MODEL ?? '').trim() || (env.LOAM_HOSTED_TOKEN ?? '').trim()
  return hosted ? 'hosted' : 'ollama'
}

/** True when an inference URL points at this machine. */
function isLoopback(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
      || hostname === '::1' || hostname === '0.0.0.0'
  } catch {
    return false
  }
}

/**
 * Build the adapter this environment should use.
 *
 * Throws `ModelConfigurationError` rather than returning something that
 * cannot work. Callers surface that at startup, where a human sees it,
 * instead of inside the first member's question.
 */
export function resolveAdapter(env: Env): ModelAdapter {
  const provider = resolveProvider(env)
  const production = isProductionEnv(env)

  if (provider === 'hosted') {
    const base = (env.LOAM_HOSTED_BASE_URL ?? '').trim()
    if (production && base && isLoopback(base)) {
      /**
       * "Hosted" pointing at this machine is still a laptop dependency, just
       * wearing the right label. Caught here because the variable name makes
       * it look configured.
       */
      throw new ModelConfigurationError(
        `LOAM_HOSTED_BASE_URL "${base}" is a local address and cannot serve `
        + 'production traffic.',
      )
    }
    const adapter = hostedAdapterFromEnv(env)
    if (!adapter) {
      // Asked for, not configured. Never downgraded to Ollama: a production
      // service quietly talking to a laptop is the failure this guards.
      throw new ModelConfigurationError(
        'The hosted provider is selected but not configured. Set LOAM_HOSTED_MODEL '
        + 'and LOAM_HOSTED_TOKEN in the server environment.',
      )
    }
    return adapter
  }

  if (production) {
    /**
     * The whole reason this module exists. In production, Ollama means a
     * local inference URL, and a deployed service cannot reach the
     * developer's laptop. Refusing at startup is the only honest behaviour:
     * the alternative is a service that reports healthy and answers nothing.
     */
    throw new ModelConfigurationError(
      'Local inference (Ollama) cannot serve production traffic. Configure the '
      + 'hosted provider with LOAM_HOSTED_MODEL and LOAM_HOSTED_TOKEN, or set '
      + 'LOAM_ENV to something other than "production" for a development instance.',
    )
  }

  // Development. Resolved through the existing factory so the model pin and
  // the cloud-routing refusal still apply here too.
  return adapterFromEnv(env)
}

/**
 * A one-line, credential-free description for a startup banner or a log.
 *
 * NEVER includes the token. The hosted adapter's config holds one, and a
 * startup line is exactly the kind of place a secret gets copied into a
 * screenshot or an issue.
 */
export function describeAdapter(env: Env): string {
  const provider = resolveProvider(env)
  if (provider === 'hosted') {
    const model = (env.LOAM_HOSTED_MODEL ?? '').trim() || '<unset>'
    const base = (env.LOAM_HOSTED_BASE_URL ?? '').trim() || 'default router'
    const token = (env.LOAM_HOSTED_TOKEN ?? '').trim()
    return `hosted ${model} @ ${base} (token ${token ? 'present' : 'MISSING'})`
  }
  try {
    return `ollama ${resolveModel(env)} @ ${resolveInferenceUrl(env)}`
  } catch (e) {
    return `ollama REFUSED - ${(e as Error).message}`
  }
}
