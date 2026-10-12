/**
 * External provider boundaries.
 *
 * Every dependency Loamy has on somebody else's service lives behind one of
 * these. The domain calls an interface; an adapter speaks the vendor's
 * dialect; nothing in `src/pages` or the database model knows a vendor's name.
 *
 * | Seam        | Ships today                  | Mode     |
 * |-------------|------------------------------|----------|
 * | Financing   | none                         | disabled |
 * | Payment     | none (interface only)        | disabled |
 * | KYC         | none (interface only)        | disabled |
 * | Weather     | Open-Meteo                   | live     |
 * | Geo/Maps    | OpenStreetMap tiles          | live     |
 * | Messaging   | none                         | disabled |
 * | Speech-to-text | local Yoruba ASR, OPT-IN  | disabled |
 * | Text-to-speech | none                      | disabled |
 * | LLM         | deterministic template       | n/a      |
 *
 * WHAT "SANDBOX" MEANS HERE, AND WHAT IT DOES NOT
 *   A sandbox adapter simulates TRANSPORT — that a request was accepted, that
 *   a reference was issued. It never simulates JUDGEMENT. There is no sandbox
 *   that approves financing, confirms a payment or settles a seller, because
 *   each of those would be a fabricated external event, and the whole point
 *   of these boundaries is that Loamy can never be the source of one.
 *
 *   Every sandbox reference is prefixed `SANDBOX-`, so a simulated value
 *   cannot be mistaken for a real one in a row, a log or a support thread.
 *
 * REGISTRATION
 *   Adapters are registered once at startup, never per request, so a request
 *   cannot choose its own provider. Nothing registers a live adapter today.
 */
export * from '@/lib/providers/types'

export {
  type FinancingProvider, type FinancingSubmission, type FinancingStatusResult,
  type FinancingProviderDecision, type FinancingProviderStatus,
  type DocumentRequirement, type SettlementInstruction, type SettlementAcknowledgement,
  type AccountVerificationRequest, type AccountVerificationResult,
  type SupplierVerificationRequest, type SupplierVerificationResult,
  noFinancingProvider, sandboxFinancingProvider,
  setFinancingProvider, financingProvider, financingProviderMode,
} from '@/lib/providers/financing'

export {
  type WeatherProvider, type DailyForecast, type ForecastRequest,
  openMeteoProvider, noWeatherProvider, setWeatherProvider, weatherProvider,
} from '@/lib/providers/weather'

export {
  type GeoProvider, type LatLng, type PlaceMatch, type TileConfig,
  haversineMetres, plausiblyNigeria,
  openStreetMapProvider, noGeoProvider, setGeoProvider, geoProvider, geocode,
} from '@/lib/providers/geo'

export {
  type MessagingProvider, type OutboundMessage, type DeliveryReceipt,
  type MessageChannel, type MessagePurpose,
  noMessagingProvider, sandboxMessagingProvider,
  setMessagingProvider, messagingProvider,
} from '@/lib/providers/messaging'

/**
 * Voice is TWO seams, not one, and neither is the model.
 *
 * N-ATLaS does not transcribe or synthesize: no audio capability, no
 * projector, no declared task. NCAIR publishes four separate ASR models (none
 * with hosted inference) and no TTS model at all. So the shape is
 * `ASR -> Loam -> N-ATLaS -> TTS`, and both ends live here rather than behind
 * ModelAdapter, where they would imply the model can do something it cannot.
 */
export {
  type SpeechToTextProvider, type SttRequest, type SpeechTranscript,
  STT_ACCEPTED_MIME, STT_MAX_AUDIO_BYTES, validateSttRequest,
  noSpeechToTextProvider, setSpeechToTextProvider, speechToTextProvider,
} from '@/lib/providers/stt'

export {
  type WavFacts, type WavInspection,
  STT_WAV_MIME, STT_REQUIRED_SAMPLE_RATE, STT_MAX_AUDIO_SECONDS, inspectWav,
} from '@/lib/providers/wav'

/**
 * A concrete STT adapter EXISTS but is NOT registered.
 *
 * `createLocalYorubaStt` talks to five local model routes over the
 * authenticated dev-server route. Four are official NCAIR checkpoints, each
 * verified against a real recording in its own language: Yoruba-ASR,
 * Hausa-ASR, Igbo-ASR and NigerianAccentedEnglish. The fifth, Nigerian
 * Pidgin, has a route but no installed model -- NCAIR publishes none -- and
 * is refused with that reason rather than substituted.
 *
 * It becomes active only when `enableLocalYorubaStt()` is called, which
 * nothing here does -- the default stays `noSpeechToTextProvider`, and
 * `providerStatus()` below reports that.
 */
export {
  type LocalSttOptions,
  LOAM_STT_ENDPOINT,
  LOCAL_STT_VERIFIED_LANGUAGES, LOCAL_STT_UNVERIFIED_LANGUAGES,
  createLocalYorubaStt, enableLocalYorubaStt,
} from '@/lib/providers/stt-local'

export {
  type TextToSpeechProvider, type TtsRequest, type SynthesizedSpeech,
  TTS_MAX_TEXT_LENGTH, validateTtsRequest,
  noTextToSpeechProvider, setTextToSpeechProvider, textToSpeechProvider,
} from '@/lib/providers/tts'

import { financingProvider } from '@/lib/providers/financing'
import { weatherProvider } from '@/lib/providers/weather'
import { geoProvider } from '@/lib/providers/geo'
import { messagingProvider } from '@/lib/providers/messaging'
import { speechToTextProvider } from '@/lib/providers/stt'
import { textToSpeechProvider } from '@/lib/providers/tts'
import type { ProviderInfo } from '@/lib/providers/types'

/**
 * What is actually connected right now.
 *
 * Used by the admin integration view and by tests that assert no live
 * provider was registered by accident. It reports what IS, never what is
 * intended.
 */
export function providerStatus(): Record<string, ProviderInfo> {
  return {
    financing: financingProvider().info,
    weather: weatherProvider().info,
    geo: geoProvider().info,
    messaging: messagingProvider().info,
    stt: speechToTextProvider().info,
    tts: textToSpeechProvider().info,
  }
}

/** True when any registered adapter is in sandbox mode. */
export function anySandboxActive(): boolean {
  return Object.values(providerStatus()).some((p) => p.mode === 'sandbox')
}

/** Hosted Yoruba ASR via the authenticated Loam backend; opt-in only. */
export {
  type ModalSttOptions,
  MODAL_STT_ENDPOINT,
  createModalYorubaStt,
  enableModalYorubaStt,
} from '@/lib/providers/stt-modal'
