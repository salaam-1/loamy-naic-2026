/**
 * WAV header inspection, because a MIME type is a claim and not a fact.
 *
 * WHY THIS EXISTS AT ALL
 *   `STT_ACCEPTED_MIME` lists six formats a browser's MediaRecorder can
 *   produce. The decoder actually installed behind the local Yoruba worker is
 *   `soundfile`, which does not read WebM or MP4 at all. Accepting a request
 *   because its `mimeType` string says `audio/wav` would mean handing arbitrary
 *   bytes to a decoder and reporting whatever came back.
 *
 *   So the bytes are parsed. A file is WAV when its header says RIFF/WAVE and
 *   its format chunk describes something the worker can actually transcribe --
 *   not when someone labelled it so.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   It does not convert, resample or downmix. Silently resampling changes the
 *   input the model is measured on, and silently downmixing stereo hides a
 *   recorder that is misconfigured. Unsupported input is refused with a reason
 *   a caller can act on.
 */

/** The only container the first implementation accepts. */
export const STT_WAV_MIME = ['audio/wav', 'audio/x-wav'] as const

/** What the Whisper feature extractor expects. Not negotiable, not resampled. */
export const STT_REQUIRED_SAMPLE_RATE = 16_000

/**
 * A ceiling on DURATION, separate from the ceiling on bytes.
 *
 * 2,000,000 bytes of 16 kHz mono 16-bit PCM is about 62 seconds, and CPU
 * inference runs slower than realtime (the proof of concept measured 5.23s of
 * audio in about 13.75s). A minute of audio would therefore occupy the single
 * inference slot for minutes. This is the bound that keeps one request from
 * becoming a denial of service.
 */
export const STT_MAX_AUDIO_SECONDS = 30

export interface WavFacts {
  /** 1 = PCM integer, 3 = IEEE float. Anything else is refused. */
  readonly encoding: number
  readonly sampleRate: number
  readonly channels: number
  readonly bitsPerSample: number
  readonly dataBytes: number
  readonly durationSeconds: number
}

export type WavInspection =
  | { readonly ok: true; readonly facts: WavFacts }
  | { readonly ok: false; readonly reason: string }

const MIN_HEADER_BYTES = 44

function ascii(b: Uint8Array, at: number, len: number): string {
  let s = ''
  for (let i = at; i < at + len && i < b.length; i += 1) s += String.fromCharCode(b[i]!)
  return s
}

/**
 * Parse just enough of a RIFF/WAVE file to decide whether the worker can
 * transcribe it, and to know how long it is before spending a slot on it.
 *
 * Chunks are walked rather than assumed at fixed offsets: a WAV written by
 * ffmpeg or a browser may carry LIST/fact/cue chunks before `data`, and
 * reading the size from offset 40 unconditionally is the classic way to
 * mis-measure one.
 */
export function inspectWav(bytes: Uint8Array): WavInspection {
  if (bytes.byteLength === 0) return { ok: false, reason: 'The recording is empty.' }
  if (bytes.byteLength < MIN_HEADER_BYTES) {
    return { ok: false, reason: 'The recording is too short to be a WAV file.' }
  }
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') {
    // The single most important check here: this is what stops a WebM blob
    // relabelled `audio/wav` from reaching the decoder.
    return { ok: false, reason: 'That file is not a WAV recording.' }
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 12
  let fmt: { encoding: number; channels: number; sampleRate: number; bits: number } | null = null
  let dataBytes = -1

  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(bytes, offset, 4)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8

    if (id === 'fmt ') {
      if (size < 16 || body + 16 > bytes.byteLength) {
        return { ok: false, reason: 'That WAV file has a malformed format header.' }
      }
      fmt = {
        encoding: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      }
    } else if (id === 'data') {
      // A streamed WAV can declare size 0 or 0xFFFFFFFF; trust what is
      // actually present rather than the declaration.
      const remaining = bytes.byteLength - body
      dataBytes = size === 0 || size > remaining ? remaining : size
      break
    }

    // Chunks are word-aligned: an odd size is followed by a pad byte.
    offset = body + size + (size % 2)
  }

  if (!fmt) return { ok: false, reason: 'That WAV file has no format header.' }
  if (dataBytes <= 0) return { ok: false, reason: 'That WAV file contains no audio.' }

  // 1 = PCM, 3 = IEEE float. 0xFFFE (extensible) is refused rather than
  // guessed at, because its real format lives in a sub-chunk this does not read.
  if (fmt.encoding !== 1 && fmt.encoding !== 3) {
    return { ok: false, reason: 'That WAV file uses an audio encoding we cannot read.' }
  }
  if (fmt.channels !== 1) {
    return { ok: false, reason: 'Record in mono. This recording has more than one channel.' }
  }
  if (fmt.sampleRate !== STT_REQUIRED_SAMPLE_RATE) {
    return {
      ok: false,
      reason: `Record at ${STT_REQUIRED_SAMPLE_RATE / 1000} kHz. This recording is `
        + `${Math.round(fmt.sampleRate / 1000)} kHz.`,
    }
  }
  if (fmt.bits !== 8 && fmt.bits !== 16 && fmt.bits !== 24 && fmt.bits !== 32) {
    return { ok: false, reason: 'That WAV file uses an unsupported bit depth.' }
  }

  const bytesPerFrame = (fmt.bits / 8) * fmt.channels
  const durationSeconds = dataBytes / (fmt.sampleRate * bytesPerFrame)
  if (durationSeconds <= 0) return { ok: false, reason: 'That WAV file contains no audio.' }
  if (durationSeconds > STT_MAX_AUDIO_SECONDS) {
    return {
      ok: false,
      reason: `Keep recordings under ${STT_MAX_AUDIO_SECONDS} seconds.`,
    }
  }

  return {
    ok: true,
    facts: {
      encoding: fmt.encoding,
      sampleRate: fmt.sampleRate,
      channels: fmt.channels,
      bitsPerSample: fmt.bits,
      dataBytes,
      durationSeconds,
    },
  }
}
