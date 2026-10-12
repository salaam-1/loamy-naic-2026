/**
 * Microphone capture that produces a WAV file the speech worker can read.
 *
 * WHY NOT MediaRecorder
 *   MediaRecorder is the obvious API and it is the wrong one here. It emits
 *   WebM/Opus (or MP4 on Safari), and the worker decodes with `soundfile`,
 *   which reads neither. Sending its output would mean either shipping
 *   ffmpeg to the browser or adding a decoder to the worker, both to undo a
 *   compression step nobody wanted.
 *
 *   So this captures raw PCM through the Web Audio API and writes a WAV
 *   header around it. The output is uncompressed, which is the point: the
 *   worker opens it directly.
 *
 * SAMPLE RATE IS NOT FORCED HERE
 *   An AudioContext runs at the hardware rate, usually 44.1 or 48 kHz, and
 *   asking for 16 kHz is a request a browser may ignore. Rather than pretend,
 *   this records at whatever rate the context reports and declares it
 *   honestly in the WAV header. The worker resamples with librosa, the same
 *   library the tested scripts use, and reports the conversion in its
 *   response so a poor transcript can be attributed to it.
 *
 * NOTHING IS KEPT
 *   Samples live in memory for the length of one recording. There is no
 *   upload on page load, no recording without an explicit start, and the
 *   tracks are stopped on every exit path so the browser's recording
 *   indicator goes out.
 */

/** Mirrors STT_MAX_AUDIO_BYTES. A WAV is uncompressed, so this binds hard. */
export const RECORDER_MAX_BYTES = 2_000_000

/**
 * A ceiling on seconds as well as bytes.
 *
 * 2,000,000 bytes of 48 kHz 16-bit mono is only ~20s, so in practice the byte
 * limit bites first. Both exist because the byte limit depends on the
 * hardware rate and this one does not.
 */
export const RECORDER_MAX_SECONDS = 20

export type RecorderFailure =
  | 'permission_denied'
  | 'no_microphone'
  | 'unsupported'
  | 'too_long'
  | 'empty'
  | 'failed'

export class RecorderError extends Error {
  readonly kind: RecorderFailure

  constructor(kind: RecorderFailure, message: string) {
    super(message)
    this.name = 'RecorderError'
    this.kind = kind
  }
}

/**
 * Write 16-bit PCM mono WAV bytes.
 *
 * Exported separately from the capture so it can be tested without a
 * microphone, a browser permission prompt or an AudioContext.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(at + i, text.charCodeAt(i))
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)            // PCM
  view.setUint16(22, 1, true)            // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)            // block align
  view.setUint16(34, 16, true)           // bits per sample
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)

  let offset = 44
  for (let i = 0; i < samples.length; i += 1) {
    // Clamp before scaling: a sample above 1.0 would wrap to a loud click.
    const s = Math.max(-1, Math.min(1, samples[i]!))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }
  return new Uint8Array(buffer)
}

export interface ActiveRecording {
  /** Stop, release the microphone, and return WAV bytes. */
  stop(): Promise<{ wav: Uint8Array; sampleRate: number; seconds: number }>
  /** Abandon the recording and release the microphone. Returns nothing. */
  cancel(): void
  /** Seconds captured so far, for a live indicator. */
  elapsed(): number
}

interface RecorderDeps {
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>
  AudioContextImpl?: typeof AudioContext
}

/**
 * Ask for the microphone and start capturing.
 *
 * Called ONLY from an explicit user action. Nothing in this module runs on
 * import or on mount.
 */
export async function startRecording(deps: RecorderDeps = {}): Promise<ActiveRecording> {
  const getUserMedia = deps.getUserMedia
    ?? (typeof navigator !== 'undefined' && navigator.mediaDevices
      ? (c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c)
      : undefined)
  const Ctx = deps.AudioContextImpl
    ?? (typeof window !== 'undefined'
      ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined)

  if (!getUserMedia || !Ctx) {
    throw new RecorderError('unsupported', 'This browser cannot record audio.')
  }

  let stream: MediaStream
  try {
    stream = await getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        // A request, not a guarantee: most browsers ignore it and run the
        // context at hardware rate. The header records what we actually got.
        sampleRate: 16_000,
      },
    })
  } catch (e) {
    const name = (e as Error)?.name
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new RecorderError(
        'permission_denied',
        'Microphone access was blocked. Allow it in your browser settings, or type instead.',
      )
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      throw new RecorderError('no_microphone', 'No microphone was found.')
    }
    throw new RecorderError('failed', 'The microphone could not be started.')
  }

  const context = new Ctx()
  const source = context.createMediaStreamSource(stream)
  // ScriptProcessor is deprecated in favour of AudioWorklet, which needs a
  // separate module file served at a URL. For a dev-only capture path the
  // deprecated node is the smaller, better-supported choice; swapping it is
  // contained to this function.
  const node = context.createScriptProcessor(4096, 1, 1)

  const chunks: Float32Array[] = []
  let total = 0
  let stopped = false
  const startedAt = Date.now()

  node.onaudioprocess = (event: AudioProcessingEvent) => {
    if (stopped) return
    const input = event.inputBuffer.getChannelData(0)
    chunks.push(new Float32Array(input))
    total += input.length
  }

  source.connect(node)
  // Through a zero-gain node: connecting straight to the destination would
  // play the microphone back through the speakers.
  const mute = context.createGain()
  mute.gain.value = 0
  node.connect(mute)
  mute.connect(context.destination)

  const release = () => {
    stopped = true
    node.onaudioprocess = null
    try { source.disconnect() } catch { /* already gone */ }
    try { node.disconnect() } catch { /* already gone */ }
    try { mute.disconnect() } catch { /* already gone */ }
    // Stopping every track is what turns off the browser's recording dot.
    for (const track of stream.getTracks()) {
      try { track.stop() } catch { /* already stopped */ }
    }
    void context.close().catch(() => { /* already closed */ })
  }

  return {
    elapsed: () => (Date.now() - startedAt) / 1000,

    cancel: () => {
      release()
      chunks.length = 0
      total = 0
    },

    stop: async () => {
      const sampleRate = context.sampleRate
      release()

      if (total === 0) {
        throw new RecorderError('empty', 'Nothing was recorded. Try again.')
      }

      const samples = new Float32Array(total)
      let at = 0
      for (const chunk of chunks) {
        samples.set(chunk, at)
        at += chunk.length
      }
      // Free the per-chunk copies before allocating the WAV.
      chunks.length = 0

      const seconds = samples.length / sampleRate
      if (seconds > RECORDER_MAX_SECONDS) {
        throw new RecorderError(
          'too_long',
          `Keep recordings under ${RECORDER_MAX_SECONDS} seconds.`,
        )
      }

      const wav = encodeWav(samples, sampleRate)
      if (wav.byteLength > RECORDER_MAX_BYTES) {
        throw new RecorderError('too_long', 'That recording is too long. Try a shorter question.')
      }
      return { wav, sampleRate, seconds }
    },
  }
}
