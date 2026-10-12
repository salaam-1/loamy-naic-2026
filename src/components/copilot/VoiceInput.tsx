/**
 * Voice input for the Loam composer. Language support depends on the active provider.
 *
 * WHAT IT DOES NOT DO
 *   It never submits. The transcript is written into the EXISTING composer
 *   textarea and the member reads, edits and sends it themselves. An
 *   assistant that acted on an unreviewed transcription would be acting on a
 *   guess about what somebody said, and speech recognition in a second
 *   language over a phone microphone is exactly where that guess goes wrong.
 *
 *   It never opens the microphone on mount, on panel open, or speculatively
 *   to "warm up". Recording starts on a tap and on nothing else.
 *
 *   It never keeps audio. Bytes exist for one request and are released when
 *   the recording stops or is discarded.
 *
 * LANGUAGE IS CHOSEN, NOT DETECTED
 *   Each language is a SEPARATE model, so a wrong guess is not a slightly
 *   worse transcript -- it is the wrong model returning fluent text that
 *   transcribes nothing. None of the five models detects language, so the
 *   member picks, and the picker defaults to the language they are already
 *   using Loam in.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Mic, Square, Trash2, TriangleAlert } from 'lucide-react'
import {
  VOICE_LANGUAGES, VOICE_LANGUAGE_LABEL, narrowsLanguage, type VoiceLanguage,
} from '@/lib/loam/voice'
import {
  RECORDER_MAX_SECONDS, RecorderError, startRecording, type ActiveRecording,
} from '@/lib/loam/voice-recorder'
import { speechToTextProvider } from '@/lib/providers/stt'

type Phase = 'idle' | 'starting' | 'recording' | 'transcribing'

export interface VoiceInputProps {
  /** The language the member is using Loam in; seeds the picker. */
  chatLanguage: VoiceLanguage
  /** Called with the transcript. The caller puts it in the composer. */
  onTranscript: (text: string, language: VoiceLanguage) => void
  /** True while Loam is answering, or offline. */
  disabled?: boolean
}

export function VoiceInput({ chatLanguage, onTranscript, disabled }: VoiceInputProps) {
  const [language, setLanguage] = useState<VoiceLanguage>(chatLanguage)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [seconds, setSeconds] = useState(0)
  const recording = useRef<ActiveRecording | null>(null)

  /**
   * Release the microphone if this unmounts mid-recording -- a member closing
   * the panel must not leave the recording indicator on.
   */
  useEffect(() => () => { recording.current?.cancel() }, [])

  // A live counter, so "is it listening?" is answered on screen.
  useEffect(() => {
    if (phase !== 'recording') return
    const id = window.setInterval(() => {
      const at = recording.current?.elapsed() ?? 0
      setSeconds(Math.floor(at))
      // Stop at the ceiling rather than letting the recorder reject it after
      // the member has finished speaking.
      if (at >= RECORDER_MAX_SECONDS) void finish()
    }, 250)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const begin = useCallback(async () => {
    setError(null)
    const provider = speechToTextProvider()
    if (!provider.supports(language)) {
      setError(
        provider.info.mode === 'disabled'
          ? 'Voice input is not switched on for this session.'
          : `${VOICE_LANGUAGE_LABEL[language]} voice input is not set up yet. Type instead.`,
      )
      return
    }
    setPhase('starting')
    try {
      recording.current = await startRecording()
      setSeconds(0)
      setPhase('recording')
    } catch (e) {
      setPhase('idle')
      setError(e instanceof RecorderError ? e.message : 'The microphone could not be started.')
    }
  }, [language])

  const finish = useCallback(async () => {
    const active = recording.current
    if (!active) return
    recording.current = null
    setPhase('transcribing')
    setError(null)
    try {
      const { wav } = await active.stop()
      const result = await speechToTextProvider().transcribe({
        audio: wav,
        mimeType: 'audio/wav',
        language,
      })
      setPhase('idle')
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      // Straight into the composer. Not sent, not translated, not normalised.
      onTranscript(result.value.text, language)
    } catch (e) {
      setPhase('idle')
      setError(e instanceof RecorderError ? e.message : 'That recording could not be transcribed.')
    }
  }, [language, onTranscript])

  const discard = useCallback(() => {
    recording.current?.cancel()
    recording.current = null
    setPhase('idle')
    setSeconds(0)
    setError(null)
  }, [])

  const busy = disabled || phase === 'starting' || phase === 'transcribing'

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {/* Language. A select rather than a cycle: five options cannot be
          cycled, and each one is a different model. */}
      <label className="sr-only" htmlFor="loam-voice-language">
        Voice input language
      </label>
      <select
        id="loam-voice-language"
        value={language}
        onChange={(e) => setLanguage(e.target.value as VoiceLanguage)}
        disabled={phase === 'recording' || busy}
        className="min-h-touch rounded border border-line bg-surface px-1.5 py-1 text-[11px] text-emerald-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50"
        title="Voice input language"
      >
        {VOICE_LANGUAGES.map((l) => (
          <option key={l} value={l}>{VOICE_LANGUAGE_LABEL[l]}</option>
        ))}
      </select>

      {phase === 'recording' ? (
        <>
          <button
            type="button"
            onClick={() => void finish()}
            className="flex min-h-touch items-center gap-1 rounded bg-red-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-600"
            aria-label="Stop recording and transcribe"
          >
            <Square className="h-3 w-3" aria-hidden /> Stop
          </button>
          <button
            type="button"
            onClick={discard}
            className="flex min-h-touch min-w-touch items-center justify-center rounded border border-line px-2 py-1 text-[11px] text-emerald-900/70 hover:bg-surface"
            aria-label="Discard recording"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
          {/* aria-live so a screen reader is told it is listening, and for
              how long, without the member watching the counter. */}
          <span
            className="flex items-center gap-1 text-[11px] font-medium text-red-700"
            role="status"
            aria-live="polite"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" aria-hidden />
            Listening {seconds}s
          </span>
        </>
      ) : (
        <button
          type="button"
          onClick={() => void begin()}
          disabled={busy}
          className="flex min-h-touch min-w-touch items-center gap-1 rounded border border-line px-2 py-1 text-[11px] font-medium text-emerald-800 hover:bg-surface disabled:opacity-40"
          aria-label={`Record a question in ${VOICE_LANGUAGE_LABEL[language]}`}
        >
          {phase === 'transcribing' || phase === 'starting' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Mic className="h-3.5 w-3.5" aria-hidden />
          )}
          {phase === 'transcribing' ? 'Transcribing...' : phase === 'starting' ? 'Starting...' : 'Speak'}
        </button>
      )}

      {phase === 'transcribing' && (
        <span className="text-[11px] text-emerald-900/55" role="status" aria-live="polite">
          {speechToTextProvider().info.key === 'loam-modal-yoruba-stt'
            ? 'Your recording is sent to Loam’s server for Yoruba transcription.'
            : 'This runs on your machine and can take a few seconds.'}
        </span>
      )}

      {/* Said before recording, not after: a member choosing Pidgin should
          know the answer comes back in English before they speak. */}
      {narrowsLanguage(language) && phase === 'idle' && !error && (
        <span className="text-[10px] text-emerald-900/50">
          Loam answers in English.
        </span>
      )}

      {error && (
        <span
          className="flex items-start gap-1 text-[11px] text-red-700"
          role="alert"
        >
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </span>
      )}
    </div>
  )
}
