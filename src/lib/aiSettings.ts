import { supabase } from '@/lib/supabase'
import { PINNED_MODEL } from '@/lib/loam/model/adapter'
import { HF_ROUTER_BASE_URL } from '@/lib/loam/model/hosted'

/**
 * Administrator-facing AI configuration.
 *
 * WHERE THIS LIVES, AND THE ONE RULE THAT DECIDES IT
 *   `platform_config.settings` is a jsonb column that already holds
 *   platform-wide tunables, UPDATE-restricted to `loamy_is_admin()`. Its
 *   SELECT policy is `to authenticated using (true)`.
 *
 *   Read that again: EVERY SIGNED-IN MEMBER CAN READ THIS ROW. So nothing
 *   here may be secret, not now and not later. A credential belongs in a
 *   Supabase Function secret read with `Deno.env.get`, exactly as
 *   `PAYSTACK_SECRET_KEY` already is -- server-side, never returned to a
 *   browser, never in this column. `assertNoSecrets` below enforces that at
 *   the write path rather than trusting a future editor to remember.
 *
 * WHY STATUS IS NOT A BOOLEAN
 *   "Has a model id been typed in" and "does inference work" are different
 *   questions, and conflating them is how a settings page shows a green
 *   Connected badge for a service that has never answered a request. Four
 *   states are tracked separately -- configured, credential, availability,
 *   inference-verified -- because for hosted N-ATLaS today the honest answer
 *   is: configurable, no credential, not served by any provider, never
 *   verified. A single boolean cannot say that.
 */

export type InferenceProviderKind = 'ollama' | 'hosted'

export interface AiInferenceSettings {
  /** Which adapter serves chat. `ollama` is the only one that works today. */
  provider: InferenceProviderKind
  /** Local host, for the Ollama path. */
  localBaseUrl: string
  /** The pinned local model. Changing this is deliberate, never implicit. */
  localModel: string
  /** OpenAI-compatible base, for the hosted path. */
  hostedBaseUrl: string
  /**
   * EXACT hosted model identifier. Empty means unconfigured; there is no
   * default, because defaulting one would answer agricultural questions with
   * a model nobody chose. `meta-llama/Llama-3.1-8B-Instruct` is Llama 3.1 and
   * is NOT N-ATLaS.
   */
  hostedModel: string
  /** Hosted inference is off until explicitly activated after validation. */
  hostedEnabled: boolean
  requestTimeoutMs: number
  maxOutputTokens: number
  temperature: number
}

export interface AiSpeechSettings {
  /** Provider key, or '' for none. No provider has been selected. */
  provider: string
  enabled: boolean
}

export interface AiSettings {
  inference: AiInferenceSettings
  stt: AiSpeechSettings
  tts: AiSpeechSettings
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  inference: {
    provider: 'ollama',
    localBaseUrl: 'http://127.0.0.1:11434',
    localModel: PINNED_MODEL,
    hostedBaseUrl: HF_ROUTER_BASE_URL,
    hostedModel: '',
    hostedEnabled: false,
    requestTimeoutMs: 220_000,
    maxOutputTokens: 220,
    temperature: 0.3,
  },
  stt: { provider: '', enabled: false },
  tts: { provider: '', enabled: false },
}

/* ------------------------------------------------------------------ guard */

/**
 * Key names that must never reach a browser-readable column.
 *
 * Checked by NAME and by VALUE SHAPE. A future editor adding
 * `hostedToken: '...'` to this type would fail the write, not discover the
 * leak when a member reads `platform_config`.
 */
/**
 * Exact names a credential hides under. A DENY LIST, not a substring match.
 *
 * The first version used `/token|secret|.../i` and rejected
 * `maxOutputTokens` -- a token COUNT, not a credential. A guard that blocks
 * valid configuration gets disabled by the next person who hits it, so
 * precision matters more than reach here. Reach is covered separately by
 * SECRET_VALUE, which catches a real credential under any name at all.
 */
const SECRET_KEYS = new Set([
  'token', 'apitoken', 'accesstoken', 'authtoken', 'bearertoken', 'hostedtoken',
  'refreshtoken', 'idtoken', 'secret', 'clientsecret', 'apisecret',
  'apikey', 'api_key', 'key', 'privatekey', 'secretkey', 'publickey',
  'password', 'passwd', 'pass', 'credential', 'credentials',
  'authorization', 'auth', 'servicerole', 'service_role',
])

/**
 * A camelCase suffix that means "a credential", in the SINGULAR.
 *
 * `hostedToken` is a credential; `maxOutputTokens` is a number. The plural is
 * what separates them, which is a small distinction doing a lot of work --
 * so it is spelled out rather than left for someone to rediscover.
 */
const SECRET_SUFFIX = /(?:Token|Secret|Password|Credential|ApiKey|PrivateKey|Authorization)$/

function isSecretKey(key: string): boolean {
  const flat = key.toLowerCase().replace(/[^a-z_]/g, '')
  return SECRET_KEYS.has(flat) || SECRET_SUFFIX.test(key)
}

/** Values that look like a credential regardless of the key they sit under. */
const SECRET_VALUE = [
  /^hf_[A-Za-z0-9]{10,}/,          // Hugging Face
  /^sk-[A-Za-z0-9]{10,}/,          // OpenAI-style
  /^eyJ[A-Za-z0-9_-]{10,}\./,      // a JWT
  /^Bearer\s+\S+/i,
]

export class AiSettingsSecretError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiSettingsSecretError'
  }
}

/**
 * Refuse to persist anything secret-shaped.
 *
 * Throws rather than stripping: silently dropping a field an admin typed
 * would leave them believing a credential was saved.
 */
export function assertNoSecrets(value: unknown, path = 'settings.ai'): void {
  if (value === null || value === undefined) return
  if (typeof value === 'string') {
    for (const re of SECRET_VALUE) {
      if (re.test(value.trim())) {
        throw new AiSettingsSecretError(
          `${path} looks like a credential. Credentials belong in a server-side `
          + 'secret, never in platform_config, which every signed-in member can read.',
        )
      }
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoSecrets(v, `${path}[${i}]`))
    return
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKey(k)) {
        throw new AiSettingsSecretError(
          `${path}.${k} is a credential-shaped field name. platform_config is `
          + 'readable by every signed-in member; use a server-side secret.',
        )
      }
      assertNoSecrets(v, `${path}.${k}`)
    }
  }
}

/* ----------------------------------------------------------- read / write */

type Db = Pick<typeof supabase, 'from'>

/** Coerce a stored blob into settings, filling gaps from the defaults. */
export function normalizeAiSettings(raw: unknown): AiSettings {
  const r = (raw ?? {}) as Partial<AiSettings>
  const d = DEFAULT_AI_SETTINGS
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback
  const str = (v: unknown, fallback: string) =>
    typeof v === 'string' && v.trim() ? v : fallback
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
  const inf = (r.inference ?? {}) as Partial<AiInferenceSettings>

  return {
    inference: {
      provider: inf.provider === 'hosted' ? 'hosted' : 'ollama',
      localBaseUrl: str(inf.localBaseUrl, d.inference.localBaseUrl),
      localModel: str(inf.localModel, d.inference.localModel),
      hostedBaseUrl: str(inf.hostedBaseUrl, d.inference.hostedBaseUrl),
      // NOT defaulted to anything. Empty means unconfigured.
      hostedModel: typeof inf.hostedModel === 'string' ? inf.hostedModel.trim() : '',
      hostedEnabled: bool(inf.hostedEnabled, false),
      requestTimeoutMs: num(inf.requestTimeoutMs, d.inference.requestTimeoutMs),
      maxOutputTokens: num(inf.maxOutputTokens, d.inference.maxOutputTokens),
      temperature: num(inf.temperature, d.inference.temperature),
    },
    stt: {
      provider: typeof r.stt?.provider === 'string' ? r.stt.provider : '',
      enabled: bool(r.stt?.enabled, false),
    },
    tts: {
      provider: typeof r.tts?.provider === 'string' ? r.tts.provider : '',
      enabled: bool(r.tts?.enabled, false),
    },
  }
}

export async function readAiSettings(client: Db = supabase): Promise<AiSettings> {
  const { data } = await client
    .from('platform_config')
    .select('settings')
    .eq('id', 1)
    .maybeSingle()
  const settings = (data?.settings ?? {}) as Record<string, unknown>
  return normalizeAiSettings(settings.ai)
}

/**
 * Persist, preserving every other key under `settings`.
 *
 * A whole-column write would destroy `eligibility_weights`,
 * `wallet_min_withdrawal_ngn` and the verification thresholds that live
 * beside this. Read-merge-write is not politeness here, it is the difference
 * between saving a model name and silently resetting the financing engine.
 */
export async function saveAiSettings(
  next: AiSettings,
  client: Db = supabase,
): Promise<{ ok: true } | { ok: false; error: string }> {
  assertNoSecrets(next)

  const { data, error: readError } = await client
    .from('platform_config')
    .select('settings')
    .eq('id', 1)
    .maybeSingle()
  if (readError) return { ok: false, error: 'Could not read the current configuration.' }

  const current = (data?.settings ?? {}) as Record<string, unknown>
  const merged = { ...current, ai: next }

  const { error } = await client
    .from('platform_config')
    .update({ settings: merged })
    .eq('id', 1)
  if (error) {
    /**
     * The most likely cause is RLS: UPDATE requires `loamy_is_admin()`. The
     * message says what to do without echoing a database error.
     */
    return { ok: false, error: 'Could not save. Administrator access is required.' }
  }
  return { ok: true }
}

/* ---------------------------------------------------------------- status */

export type StatusTone = 'ok' | 'warn' | 'off'

export interface ServiceStatus {
  service: 'inference-local' | 'inference-hosted' | 'stt' | 'tts'
  label: string
  /** Has an admin supplied the non-secret configuration? */
  configured: boolean
  /**
   * Is a server-side credential present? Always `unknown` from a browser --
   * and that is the correct answer, because a browser that could tell would
   * be a browser that can read the secret.
   */
  credential: 'present' | 'absent' | 'unknown'
  /** Does the provider actually serve the configured model? */
  availability: 'available' | 'unavailable' | 'unknown'
  /** Has a real call ever succeeded? Never inferred from configuration. */
  inferenceVerified: boolean
  /** One honest sentence for the administrator. */
  summary: string
  tone: StatusTone
}

/**
 * The honest status of each service.
 *
 * Deliberately pure and offline: it reports what the CONFIGURATION says, and
 * never implies a check it did not perform. Nothing here returns a green
 * "Connected" because a model id was typed in.
 */
export function aiServiceStatuses(s: AiSettings): ServiceStatus[] {
  const local: ServiceStatus = {
    service: 'inference-local',
    label: 'Local inference (Ollama)',
    configured: Boolean(s.inference.localModel && s.inference.localBaseUrl),
    credential: 'absent',
    availability: 'unknown',
    inferenceVerified: false,
    summary: s.inference.provider === 'ollama'
      ? `Serving chat with ${s.inference.localModel}. Reachability is checked per request, not here.`
      : `Configured with ${s.inference.localModel} but not currently selected.`,
    tone: s.inference.provider === 'ollama' ? 'ok' : 'off',
  }

  const hosted: ServiceStatus = {
    service: 'inference-hosted',
    label: 'Hosted inference',
    configured: Boolean(s.inference.hostedModel),
    credential: 'unknown',
    availability: 'unknown',
    inferenceVerified: false,
    summary: !s.inference.hostedModel
      ? 'No hosted model identifier set. Nothing is configured.'
      : s.inference.hostedEnabled
        ? `Configured for "${s.inference.hostedModel}". Not verified: no successful call has been made.`
        : `Configured for "${s.inference.hostedModel}" and not activated.`,
    tone: 'off',
  }

  const speech = (
    service: 'stt' | 'tts',
    label: string,
    cfg: AiSpeechSettings,
  ): ServiceStatus => ({
    service,
    label,
    configured: Boolean(cfg.provider),
    credential: 'unknown',
    availability: cfg.provider ? 'unknown' : 'unavailable',
    inferenceVerified: false,
    summary: cfg.provider
      ? `Provider "${cfg.provider}" selected and ${cfg.enabled ? 'enabled' : 'disabled'}. No language has been verified.`
      : 'Disabled. No provider has been selected, and no language is verified.',
    tone: 'off',
  })

  return [
    local,
    hosted,
    speech('stt', 'Speech to text', s.stt),
    speech('tts', 'Text to speech', s.tts),
  ]
}

/* ------------------------------------------------------- test connection */

export interface ConnectionTestResult {
  ok: boolean
  /** WHAT was actually checked. A model list is not an inference test. */
  checked: 'nothing' | 'configuration' | 'model-list' | 'inference'
  message: string
}

/**
 * Check a service as far as a browser honestly can.
 *
 * MAKES NO NETWORK REQUEST. Every hosted or speech check needs a credential,
 * and a credential a browser holds is a leaked credential -- so verification
 * belongs in a server-side function that does not exist yet. Saying so is
 * more useful than a check that cannot mean anything.
 *
 * `checked` records the strength of the result, so a caller cannot present a
 * configuration check as a successful inference.
 */
export function testAiConnection(
  service: ServiceStatus['service'],
  s: AiSettings,
): ConnectionTestResult {
  if (service === 'inference-local') {
    return {
      ok: Boolean(s.inference.localModel),
      checked: 'configuration',
      message: s.inference.localModel
        ? `Configured for ${s.inference.localModel}. Reachability is proven by a real answer in the chat panel, not from here.`
        : 'No local model is set.',
    }
  }

  if (service === 'inference-hosted') {
    if (!s.inference.hostedModel) {
      return {
        ok: false,
        checked: 'nothing',
        message: 'Set a hosted model identifier first. There is no default.',
      }
    }
    return {
      ok: false,
      checked: 'nothing',
      message:
        'Cannot be tested from the browser: it needs a server-side credential, '
        + 'and a credential the browser holds is a leaked credential. A server-side '
        + 'check is not built yet, so this service stays unverified.',
    }
  }

  const cfg = service === 'stt' ? s.stt : s.tts
  return {
    ok: false,
    checked: 'nothing',
    message: cfg.provider
      ? `Provider "${cfg.provider}" cannot be tested yet: no adapter is implemented for it.`
      : 'No provider selected, so there is nothing to test.',
  }
}
