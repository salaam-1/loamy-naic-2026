# Loam voice input — local speech-to-text worker

Five languages, five models, all running on this machine's CPU. No hosted
inference, no audio leaving the machine.

| Language | Model | Decoding | State |
|---|---|---|---|
| Yoruba `yo` | `NCAIR1/Yoruba-ASR` | `language="yo"` | **verified** on a real recording |
| Hausa `ha` | `NCAIR1/Hausa-ASR` | `language="ha"` | **verified** on a real recording |
| Igbo `ig` | `NCAIR1/Igbo-ASR` | **no language argument** | **verified** on a real recording |
| English `en` | `NCAIR1/NigerianAccentedEnglish` | `language="en"` | **verified** on a real recording |
| Pidgin `pcm` | *configurable, not installed* | no language argument | **not installed, unverified** |

Routing is by the language the member explicitly selects. There is no
detection and no fallback. Each language is a **different model**, so a wrong
route is not a slightly worse transcript — it is fluent text that transcribes
nothing.

## Igbo: do not "fix" the decoding

`transformers` rejects `language="ig"` because Whisper's vocabulary has no
`<|ig|>` token — Igbo is not one of its 100 languages. `NCAIR1/Igbo-ASR`
reaches Igbo through the checkpoint's own `forced_decoder_ids`, so the worker
passes **no** `language` argument for it. That is the tested setting, it
produces correct Igbo (`afọ ọhụrụ ga-adị mma`), and a later tidy-up to `"ig"`
would break it. The registry states the value per language so it cannot be
mistaken for an omission.

## Nigerian Pidgin: the one gap

**NCAIR publishes no Pidgin ASR model.** Its collection is the four above plus
the N-ATLaS text model — verified against the Hub API, not assumed. So Pidgin
is wired to a configurable third-party whisper-small fine-tune:

```
LOAM_STT_PIDGIN_MODEL=ocansey/whisper-small-nigerian-pidgin   # the default
```

It is **not installed** and its **licence is undeclared**, so it was not
downloaded automatically. Pidgin stays in the selector rather than being
hidden, because the gap is a missing model and a missing recording, not a
missing feature. Choosing it returns a specific error.

Pidgin is **not** routed to the English model. Nigerian Pidgin is its own
language (ISO 639-3 `pcm`), not accented English, and substituting would
return English-shaped text that quietly rewrites what was said.

To enable it:

```powershell
.venv-stt\Scripts\hf.exe download ocansey/whisper-small-nigerian-pidgin
```

Then supply a real Pidgin recording and check the transcript before treating
the language as verified.

## It is off, three times over

1. The Python worker is started by hand. It does not start with Vite.
2. `LOAM_STT_ENABLED=1` must be set, or the dev server registers no route.
3. `enableLocalYorubaStt()` must be called, or the provider stays
   `noSpeechToTextProvider`. **Nothing in the application calls it.**

## Running it

Generate a secret. It is shared between the worker and the dev server, and must
never be committed, never go in a `VITE_` variable, and never be pasted into a
chat:

```powershell
python -c "import secrets;print(secrets.token_urlsafe(32))"
```

**Terminal 1 — the worker.** It loads one model at startup:

```powershell
$env:LOAM_STT_WORKER_PORT   = '8111'
$env:LOAM_STT_WORKER_SECRET = 'REPLACE-with-the-value-you-generated'
.venv-stt\Scripts\python.exe scripts\stt-worker\natlas_stt_worker.py
```

**Terminal 2 — the dev server.** Put the same values in `.env.local`, already
git-ignored by the `.env.*` rule:

```
LOAM_STT_ENABLED=1
LOAM_STT_WORKER_PORT=8111
LOAM_STT_WORKER_SECRET=the-same-value
```

```powershell
npm run dev
```

Then open Loam, pick a language beside the composer, and tap **Speak**.

### Environment

| Variable | Default | Meaning |
|---|---|---|
| `LOAM_STT_WORKER_PORT` | *required* | loopback port; the host is always `127.0.0.1` |
| `LOAM_STT_WORKER_SECRET` | *required, 32+ chars* | shared with the dev server only |
| `LOAM_STT_ENABLED` | off | registers the Vite route |
| `LOAM_STT_PRELOAD_LANGUAGE` | `yo` | which model to warm at startup |
| `LOAM_STT_RESIDENT_MODELS` | `1` | see **Memory** |
| `LOAM_STT_MIN_FREE_GB` | `4.0` | refuses to load below this |
| `LOAM_STT_PIDGIN_MODEL` | `ocansey/whisper-small-nigerian-pidgin` | the Pidgin route |

None of these is a `VITE_` variable, so none reaches the browser bundle.

## Memory: one model resident at a time

Each model is ~922 MiB on disk and **~1.4 GiB resident**, measured. Five would
need ~7 GiB, which this 16 GiB machine does not have free alongside a dev
server and a browser.

The pool keeps **one** model in RAM and evicts before loading another.
Switching language costs a reload of ~1-3 s warm. RAM is re-checked
immediately before every load, not just at startup.
`LOAM_STT_RESIDENT_MODELS=2` opts into keeping two and is downgraded back to 1
if the headroom is not clearly there.

Measured on this machine, CPU only: **1-4x realtime**, so a 4-second question
takes roughly 10-16 s.

## Shape

```
microphone -> WAV (hardware rate) -> POST /loam/stt/transcribe  [Supabase JWT]
           -> 127.0.0.1:PORT/transcribe                         [worker secret]
           -> selected model -> transcript
           -> the EXISTING Loam composer, for the member to read and edit
           -> the EXISTING send button -> askLoam -> orchestrator -> N-ATLaS
```

Speech recognition is an input method. It does not answer anything: N-ATLaS
remains the conversational engine, reached through the same `/loam/chat` path a
typed question uses, with the same authentication, evidence retrieval and
guard. **A transcript is never submitted automatically.**

The browser never holds the worker secret and never learns the worker's
address. The two credentials never meet: the browser presents a JWT, the dev
server presents the worker secret.

## Audio handling

The browser captures raw PCM through the Web Audio API and writes a WAV header
around it — **not** `MediaRecorder`, which emits WebM/Opus that `soundfile`
cannot read.

An `AudioContext` runs at hardware rate (usually 48 kHz) and ignores a request
for 16 kHz, so the recorder declares the real rate and the worker resamples
with `librosa` and downmixes to mono. Every conversion is reported in the
response, so a poor transcript can be attributed to the resampler rather than
to the model. Limits: 2,000,000 bytes and 30 s server-side, 20 s in the
recorder.

## What it will not do

- Download weights. `HF_HUB_OFFLINE` is set before transformers is imported and
  every load passes `local_files_only=True`; a model whose files are missing is
  reported unavailable rather than fetched.
- Open the microphone on page load, on panel open, or to "warm up".
- Persist audio or transcripts, or log either. Logs carry byte counts,
  durations, character counts and the model key.
- Touch Ollama. It does not read, start, warm, stop or configure it.
- Translate a transcript. The member's own words and diacritics reach the
  composer unchanged.
- Run two inferences at once. A second caller gets a retryable 503.

## Tests

```powershell
npx vitest run tests/unit/loam-voice.test.ts tests/unit/stt-local.test.ts `
               tests/unit/loam-stt-route.test.ts `
               tests/components/voice-input.test.tsx `
               tests/components/loam-voice-composer.test.tsx
.venv-stt\Scripts\python.exe scripts\stt-worker\test_wav_validation.py
.venv-stt\Scripts\python.exe scripts\stt-worker\test_routing.py
```

All of these are deterministic and load no model. **They prove routing,
refusal and wiring — not transcription accuracy**, which needs real audio per
language and a reference transcript.

## Hosting this for online users — not done

This is **local only**. The route is registered from a Vite plugin with
`apply: 'serve'` and exists in no deployed build, so nothing here is reachable
from a Vercel deployment.

Making it available online needs, at minimum:

- **A host for the models.** ~4.6 GiB of weights for five, and ~1.4 GiB RAM per
  resident model. A static frontend host cannot run them. Realistic options: one
  GPU instance holding all five warm; per-language workers behind a router; or
  on-device inference, which pushes the licensing question further since
  shipping weights to handsets is redistribution.
- **A real server boundary** in place of the Vite middleware — a Supabase Edge
  Function or small service that verifies the JWT and forwards to the worker
  over a private network, never the public internet.
- **A plan for low connectivity.** Uploading a few hundred KB of WAV over a
  weak mobile connection is the slowest step in the chain; Opus upload with
  server-side decoding would cut it by roughly 10x, and needs a decoder the
  worker does not currently have.
- **Capacity planning.** CPU inference at 1-4x realtime means one core serves
  very few concurrent speakers.

## Licensing — not cleared

- `NCAIR1/Yoruba-ASR`, `Hausa-ASR`, `Igbo-ASR`, `NigerianAccentedEnglish` — all
  four declare **`license: other`** with **no licence name and no licence link**
  in their Hub metadata. The terms sit behind the same access gate as the
  weights and have **not** been reviewed.
- The Pidgin candidate declares **no licence at all**.

Commercial and large-scale production use are **not** cleared for any of the
five. Read each model's terms on its Hugging Face page before deploying.
