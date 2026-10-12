"""
Local speech-to-text worker for Loam. DEVELOPMENT PROOF OF CONCEPT.

TWO MODELS, ROUTED BY EXPLICIT LANGUAGE
  NCAIR1/Yoruba-ASR   -> yo          (verified: a real recording was transcribed)
  openai/whisper-small -> en, ha     (loads, but NOT verified on real audio)
  Igbo                 -> NOTHING    (see IGBO below)

  Routing is by the language the caller explicitly asked for. There is no
  detection, no "closest match" and no fallback to another model. If a
  language has no route, the request is refused -- because substituting a
  different model would return fluent text in the wrong language, which is
  worse than an error.

IGBO IS NOT AVAILABLE, AND THIS IS NOT A CONFIGURATION PROBLEM
  Whisper knows 100 languages and Igbo is not one of them. Its tokenizer has
  no `<|ig|>` token at all, so there is nothing to condition the decoder on:
  asking whisper-small for Igbo does not produce poor Igbo, it produces
  confident output in some other language. NCAIR publishes an Igbo-ASR model
  which would be the right answer, and it is not in the local cache.

  So Igbo is refused with that reason. It is not quietly routed elsewhere.

VERIFIED IS NOT THE SAME AS AVAILABLE
  `verified` means somebody listened to real audio and confirmed the
  transcript. Only Yoruba has been. English and Hausa are `available`: the
  weights load and inference runs, but no recording has been checked, and
  Whisper's Hausa in particular is known to be weak. The two states are
  reported separately everywhere -- the health endpoint, the logs and the
  TypeScript provider.

MEMORY: ONE MODEL RESIDENT AT A TIME
  Each model is ~922 MiB on disk and ~1.2 GiB resident as fp32. This machine
  had 5.7 GiB available while a dev server and a browser were running, so
  holding both would leave very little headroom. The pool therefore keeps ONE
  model in RAM and evicts before loading another. Switching language costs a
  reload (~15-20s); running the machine out of memory costs more.
  `LOAM_STT_RESIDENT_MODELS=2` opts into keeping both, after a RAM check.

WHAT IT WILL NOT DO
  - Download anything. HF_HUB_OFFLINE is set before transformers is imported,
    every load passes `local_files_only=True`, and missing files are reported
    as unavailable rather than fetched.
  - Touch Ollama. It does not read, start, warm, stop or configure it.
  - Write audio or transcripts to disk, or log either.
  - Bind anywhere but 127.0.0.1.
  - Return a stack trace, a path or a secret to a client.
  - Claim a transcription happened when the transcript is blank.

LICENSING, UNRESOLVED
  NCAIR1/Yoruba-ASR and openai/whisper-small carry SEPARATE terms, neither
  reviewed. openai/whisper-small is published under Apache-2.0 on its model
  card; the NCAIR model's terms have not been established. Treat this as a
  local proof of concept. Nothing here is cleared for commercial use.

USAGE (PowerShell)
  $env:LOAM_STT_WORKER_PORT   = '8111'
  $env:LOAM_STT_WORKER_SECRET = '<32+ random chars>'
  .venv-stt\\Scripts\\python.exe scripts\\stt-worker\\natlas_stt_worker.py
"""

import ctypes
import gc
import hmac
import io
import json
import os
import signal
import struct
import sys
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor, TimeoutError as FutureTimeout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Set before any huggingface_hub / transformers import or they have no effect.
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
# Progress bars are written to this process's stdout, which is the same stream
# the audit-able log lines go to. Noise there makes a leakage review harder.
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")

# Mirrors STT_MAX_AUDIO_BYTES in src/lib/providers/stt.ts.
MAX_AUDIO_BYTES = 2_000_000

# Mirrors src/lib/providers/wav.ts.
REQUIRED_SAMPLE_RATE = 16_000
MAX_AUDIO_SECONDS = 30.0

MIN_SECRET_CHARS = 32

# A floor, not a measurement. One model is ~1.4 GiB resident, so 4 GiB leaves
# room for the dev server and a browser. It is configurable because a
# developer on a busy machine needs to be able to lower it deliberately --
# and because a hard-coded limit gets commented out instead of adjusted.
try:
    MIN_FREE_GB = float(os.environ.get("LOAM_STT_MIN_FREE_GB", "4.0"))
except ValueError:
    MIN_FREE_GB = 4.0
MAX_NEW_TOKENS = 200

INFERENCE_SLOTS = 1
SLOT_WAIT_SECONDS = 0.5
INFERENCE_TIMEOUT_SECONDS = 150.0

# A model switch loads ~1.2 GiB, so a caller may wait for a reload as well as
# for inference. Separate from the slot wait, which is only for a busy signal.
LOAD_TIMEOUT_SECONDS = 120.0


class ModelSpec:
    """
    One local model, the languages it serves, and HOW EACH ONE IS DECODED.

    `decoding` maps a language to the value passed as `language=` to
    `generate()`. A value of None means "pass nothing and let the checkpoint's
    own configuration decide" -- which is not a missing setting, it is the
    tested setting for Igbo. Whisper's vocabulary has no `<|ig|>` token, so
    forcing a language there fails; the fine-tune reaches Igbo through its own
    forced_decoder_ids instead. Keeping the value explicit per language stops
    anyone "tidying" it into a default that breaks Igbo.

    `verified` is a SUBSET of `languages`: the ones somebody has listened to
    and confirmed. The distinction is the point of this class.
    """

    def __init__(self, key, model_id, languages, verified, license_note,
                 decoding=None, max_new_tokens=200):
        self.key = key
        self.model_id = model_id
        self.languages = tuple(languages)
        self.verified = tuple(verified)
        self.license_note = license_note
        self.max_new_tokens = max_new_tokens
        # Default: force the language code itself. Igbo overrides this to None.
        self.decoding = dict(decoding or {l: l for l in languages})
        for lang in self.languages:
            if lang not in self.decoding:
                raise SystemExit(
                    "{}: no decoding entry for {!r}; it must be explicit".format(key, lang))

    def forced_language(self, language):
        """The `language=` argument for this language, possibly None."""
        return self.decoding.get(language)

    @property
    def unverified(self):
        return tuple(l for l in self.languages if l not in self.verified)


# The Nigerian Pidgin model is configurable because NCAIR DOES NOT PUBLISH
# ONE. Its collection is four ASR models (Hausa, Igbo, NigerianAccentedEnglish,
# Yoruba) plus the N-ATLaS text model -- verified against the Hub API. The
# default below is a third-party whisper-small fine-tune, chosen because it
# shares the architecture of the other four so one inference path serves all
# five. Override it if a better one appears.
PIDGIN_MODEL_ID = os.environ.get(
    "LOAM_STT_PIDGIN_MODEL", "ocansey/whisper-small-nigerian-pidgin").strip()


MODEL_SPECS = (
    ModelSpec(
        key="ncair-yoruba",
        model_id="NCAIR1/Yoruba-ASR",
        languages=("yo",),
        decoding={"yo": "yo"},
        # A real recording was transcribed and the transcript confirmed.
        verified=("yo",),
        license_note="NCAIR1/Yoruba-ASR: license 'other', terms NOT established",
    ),
    ModelSpec(
        key="ncair-hausa",
        model_id="NCAIR1/Hausa-ASR",
        languages=("ha",),
        # <|ha|> exists in Whisper's vocabulary (token 50354), and the tested
        # script passes language="ha", task="transcribe".
        decoding={"ha": "ha"},
        verified=("ha",),
        license_note="NCAIR1/Hausa-ASR: license 'other', terms NOT established",
    ),
    ModelSpec(
        key="ncair-igbo",
        model_id="NCAIR1/Igbo-ASR",
        # None, DELIBERATELY. transformers rejects language="ig" because
        # Whisper has no <|ig|> token; the tested script passes no language at
        # all and the model produced correct Igbo. Do not "fix" this to "ig".
        decoding={"ig": None},
        languages=("ig",),
        verified=("ig",),
        license_note="NCAIR1/Igbo-ASR: license 'other', terms NOT established",
    ),
    ModelSpec(
        key="ncair-english-ng",
        model_id="NCAIR1/NigerianAccentedEnglish",
        languages=("en",),
        decoding={"en": "en"},
        verified=("en",),
        license_note="NCAIR1/NigerianAccentedEnglish: license 'other', terms NOT established",
    ),
    ModelSpec(
        key="pidgin",
        model_id=PIDGIN_MODEL_ID,
        languages=("pcm",),
        # The base tokenizer has no <|pcm|> token either -- Nigerian Pidgin is
        # not one of Whisper's 100 languages. So, as with Igbo, nothing is
        # forced and the checkpoint's own configuration decides.
        decoding={"pcm": None},
        # NOT verified: no Pidgin recording exists in this repository and the
        # weights are not cached. The route exists and will work once both are
        # supplied; until then it reports itself unavailable.
        verified=(),
        license_note="{}: license UNDECLARED on its model card".format(PIDGIN_MODEL_ID),
    ),
)

SPEC_BY_KEY = {s.key: s for s in MODEL_SPECS}

# The routing table, built from the specs so it cannot disagree with them.
ROUTES = {}
for _spec in MODEL_SPECS:
    for _lang in _spec.languages:
        if _lang in ROUTES:
            raise SystemExit("two models claim '{}'; routing must be unambiguous".format(_lang))
        ROUTES[_lang] = _spec.key

# Languages Loam knows about that this worker cannot serve, with the reason.
# Present so the refusal can be specific instead of a bare 400.
# Nothing is unroutable any more: every one of the five has a model entry.
# A language whose WEIGHTS are absent is reported unavailable by
# `availability()` instead, which is a different and recoverable state.
UNROUTABLE = {}

ALL_LANGUAGES = ("en", "ha", "ig", "pcm", "yo")


def log(msg):
    """Single logging path, so there is one place to audit for leakage."""
    print("[stt-worker] {}".format(msg), flush=True)


# ---------------------------------------------------------------------------
# Memory
# ---------------------------------------------------------------------------

class _MemStatus(ctypes.Structure):
    _fields_ = [
        ("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
        ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
        ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
    ]


def memory_gb():
    """(available, total) physical RAM in GiB, or (None, None) off Windows."""
    if not hasattr(ctypes, "windll"):
        return None, None
    s = _MemStatus()
    s.dwLength = ctypes.sizeof(s)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(s)):
        return None, None
    return s.ullAvailPhys / (1024 ** 3), s.ullTotalPhys / (1024 ** 3)


# ---------------------------------------------------------------------------
# WAV validation. Mirrors src/lib/providers/wav.ts: the dev server checks
# before forwarding and this checks again, because a validator that only runs
# on the other side of a network hop is not a validator.
# ---------------------------------------------------------------------------

class AudioRejected(Exception):
    """A client-safe rejection reason. Never carries internal detail."""


def inspect_wav(data):
    """Return (sample_rate, channels, bits, duration_seconds) or raise AudioRejected."""
    if len(data) == 0:
        raise AudioRejected("The recording is empty.")
    if len(data) < 44:
        raise AudioRejected("The recording is too short to be a WAV file.")
    if data[0:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise AudioRejected("That file is not a WAV recording.")

    offset, fmt, data_bytes = 12, None, -1
    while offset + 8 <= len(data):
        chunk_id = data[offset:offset + 4]
        (size,) = struct.unpack_from("<I", data, offset + 4)
        body = offset + 8
        if chunk_id == b"fmt ":
            if size < 16 or body + 16 > len(data):
                raise AudioRejected("That WAV file has a malformed format header.")
            encoding, channels, rate = struct.unpack_from("<HHI", data, body)
            (bits,) = struct.unpack_from("<H", data, body + 14)
            fmt = (encoding, channels, rate, bits)
        elif chunk_id == b"data":
            remaining = len(data) - body
            data_bytes = remaining if size == 0 or size > remaining else size
            break
        offset = body + size + (size % 2)

    if fmt is None:
        raise AudioRejected("That WAV file has no format header.")
    if data_bytes <= 0:
        raise AudioRejected("That WAV file contains no audio.")

    encoding, channels, rate, bits = fmt
    if encoding not in (1, 3):
        raise AudioRejected("That WAV file uses an audio encoding we cannot read.")
    # Rate and channel count are NOT refused: the decoder below resamples to
    # 16 kHz and downmixes to mono, because a phone browser cannot be relied
    # on to record at the model's rate. The conversion is reported in the
    # response so a poor transcript can be attributed if need be.
    if rate <= 0 or rate > 192_000:
        raise AudioRejected("That WAV file declares an implausible sample rate.")
    if channels < 1 or channels > 8:
        raise AudioRejected("That WAV file declares an implausible channel count.")
    if bits not in (8, 16, 24, 32):
        raise AudioRejected("That WAV file uses an unsupported bit depth.")

    duration = data_bytes / float(rate * (bits // 8) * channels)
    if duration <= 0:
        raise AudioRejected("That WAV file contains no audio.")
    if duration > MAX_AUDIO_SECONDS:
        raise AudioRejected("Keep recordings under {} seconds.".format(int(MAX_AUDIO_SECONDS)))
    return rate, channels, bits, duration


# ---------------------------------------------------------------------------
# Availability: what is cached, checked WITHOUT loading
# ---------------------------------------------------------------------------

# Files every Whisper checkpoint needs to build a processor and a model. Both
# cached models carry all three; a model missing any is reported unavailable
# rather than loaded with something improvised in place of it.
REQUIRED_FILES = ("config.json", "tokenizer_config.json", "preprocessor_config.json")
WEIGHT_FILES = ("model.safetensors", "pytorch_model.bin")


def cached_path(model_id, filename):
    """A file's path in the local cache, or None. Never reaches the network."""
    from huggingface_hub import try_to_load_from_cache
    try:
        r = try_to_load_from_cache(model_id, filename)
    except Exception:
        return None
    return r if isinstance(r, str) and os.path.isfile(r) else None


def availability(spec):
    """
    Whether this model COULD load, decided from the cache alone.

    Deliberately not `snapshot_download(local_files_only=True)`: that raises
    IncompleteSnapshotError when only the inference files were fetched, which
    is exactly how the Yoruba model was downloaded. It would report a present,
    working model as absent.
    """
    missing = [f for f in REQUIRED_FILES if cached_path(spec.model_id, f) is None]
    weights = [f for f in WEIGHT_FILES if cached_path(spec.model_id, f) is not None]
    ok = not missing and bool(weights)
    return {
        "key": spec.key,
        "model": spec.model_id,
        "available": ok,
        "missingFiles": missing,
        "weightFiles": weights,
        "languages": list(spec.languages),
        "verifiedLanguages": list(spec.verified),
        "unverifiedLanguages": list(spec.unverified),
        "license": spec.license_note,
    }


# ---------------------------------------------------------------------------
# The model pool
# ---------------------------------------------------------------------------

class ModelUnavailable(Exception):
    """Required files are not cached. Client-safe message, no paths."""


class Busy(Exception):
    pass


class Timeout(Exception):
    pass


class ModelPool:
    """
    Lazily loads models and keeps at most `max_resident` in RAM.

    Loading happens while the single inference slot is HELD, so a load can
    never race an inference or another load. That makes the eviction below
    safe without a second lock: nothing else is using the model being dropped.
    """

    def __init__(self, max_resident=1):
        self.max_resident = max(1, max_resident)
        self._loaded = {}        # key -> (processor, model)
        self._order = []         # keys, least-recently-used first
        self._meta = {}          # key -> {"loadSeconds", "parameters"}
        self._slots = threading.BoundedSemaphore(INFERENCE_SLOTS)
        self._pool = ThreadPoolExecutor(max_workers=INFERENCE_SLOTS,
                                        thread_name_prefix="stt-infer")
        self.last_language_forced = None
        self.last_conversions = []

    # -- loading ---------------------------------------------------------

    def _evict_to(self, limit):
        while len(self._order) > limit:
            victim = self._order.pop(0)
            self._loaded.pop(victim, None)
            self._meta.pop(victim, None)
            gc.collect()
            log("evicted {} to free memory".format(victim))

    def _load(self, spec):
        from transformers import WhisperForConditionalGeneration, WhisperProcessor

        # Re-checked immediately before the ~1.2 GiB allocation, not just at
        # startup: the figure goes stale as the dev server and a browser grow.
        avail, _total = memory_gb()
        if avail is not None and avail < MIN_FREE_GB:
            raise ModelUnavailable("Not enough memory to load the transcriber.")

        started = time.time()
        processor = WhisperProcessor.from_pretrained(spec.model_id, local_files_only=True)
        model = WhisperForConditionalGeneration.from_pretrained(
            spec.model_id, local_files_only=True)
        model.eval()
        elapsed = time.time() - started

        params = sum(p.numel() for p in model.parameters())
        self._meta[spec.key] = {"loadSeconds": round(elapsed, 2), "parameters": params}
        log("loaded {} in {:.1f}s, {:,} parameters".format(spec.key, elapsed, params))
        return processor, model

    def _ensure(self, spec):
        if spec.key in self._loaded:
            self._order.remove(spec.key)
            self._order.append(spec.key)
            return self._loaded[spec.key]

        info = availability(spec)
        if not info["available"]:
            # Named, so an operator can see WHICH file to deal with, while the
            # client only ever receives the generic message below.
            log("{} unavailable; missing {}".format(spec.key, ",".join(info["missingFiles"]) or "weights"))
            raise ModelUnavailable("That language's transcriber is not installed.")

        # Evict BEFORE loading, so peak memory is one model and not two.
        self._evict_to(self.max_resident - 1)
        try:
            loaded = self._load(spec)
        except ModelUnavailable:
            raise
        except Exception as e:
            log("load of {} failed: {}".format(spec.key, type(e).__name__))
            raise ModelUnavailable("That language's transcriber could not be loaded.")

        self._loaded[spec.key] = loaded
        self._order.append(spec.key)
        return loaded

    # -- status ----------------------------------------------------------

    def status(self):
        return {
            "maxResident": self.max_resident,
            "resident": list(self._order),
            "models": [
                dict(availability(s), loaded=s.key in self._loaded, **(self._meta.get(s.key) or {}))
                for s in MODEL_SPECS
            ],
        }

    def preload(self, language):
        """Warm one model at startup, holding the slot like any other use."""
        spec = SPEC_BY_KEY[ROUTES[language]]
        with_slot = self._slots.acquire(timeout=LOAD_TIMEOUT_SECONDS)
        if not with_slot:
            return False
        try:
            self._ensure(spec)
            return True
        finally:
            self._slots.release()

    # -- inference -------------------------------------------------------

    def _run(self, spec, audio_bytes, language):
        import numpy as np
        import soundfile as sf
        import torch

        processor, model = self._ensure(spec)

        # Decoded from memory. The bytes never reach the filesystem.
        audio, rate = sf.read(io.BytesIO(audio_bytes), dtype="float32", always_2d=True)
        self.last_conversions = []

        # Stereo -> mono by averaging, matching the tested scripts.
        if audio.shape[1] > 1:
            self.last_conversions.append("downmixed {}ch to mono".format(audio.shape[1]))
            waveform = audio.mean(axis=1)
        else:
            waveform = audio[:, 0]
        if waveform.size == 0:
            raise AudioRejected("That recording contains no audio.")

        # Resample with librosa, which is what the tested scripts use. The
        # feature extractor expects 16 kHz and a browser will not supply it.
        if rate != REQUIRED_SAMPLE_RATE:
            import librosa
            waveform = librosa.resample(
                np.asarray(waveform, dtype="float32"),
                orig_sr=rate, target_sr=REQUIRED_SAMPLE_RATE)
            self.last_conversions.append(
                "resampled {} Hz -> {} Hz".format(rate, REQUIRED_SAMPLE_RATE))

        features = processor(
            np.asarray(waveform, dtype="float32"),
            sampling_rate=REQUIRED_SAMPLE_RATE,
            return_tensors="pt",
        ).input_features

        # The decoding for THIS language, from the registry. None means the
        # checkpoint's own configuration decides, which is the tested setting
        # for Igbo and Pidgin -- not an omission.
        forced = spec.forced_language(language)
        with torch.no_grad():
            if forced is None:
                ids = model.generate(features, max_new_tokens=spec.max_new_tokens)
                self.last_language_forced = None
            else:
                try:
                    ids = model.generate(
                        features, max_new_tokens=spec.max_new_tokens,
                        language=forced, task="transcribe")
                    self.last_language_forced = forced
                except (TypeError, ValueError) as e:
                    # transformers rejects a language its vocabulary lacks.
                    # Falling back means the model's own default, NOT the
                    # requested language, so it is logged rather than hidden.
                    log("language forcing rejected for {} ({}); using the "
                        "checkpoint's own config".format(spec.key, type(e).__name__))
                    ids = model.generate(features, max_new_tokens=spec.max_new_tokens)
                    self.last_language_forced = None

        return processor.batch_decode(ids, skip_special_tokens=True)[0]

    def transcribe(self, audio_bytes, language):
        """
        Bounded three ways: one slot, a wait limit on acquiring it, and a
        wall-clock ceiling that covers a model load as well as inference.
        """
        spec = SPEC_BY_KEY[ROUTES[language]]

        if not self._slots.acquire(timeout=SLOT_WAIT_SECONDS):
            raise Busy()

        def task():
            try:
                return self._run(spec, audio_bytes, language)
            finally:
                # Released by the task, not the caller: on a timeout the
                # caller gives up while the work continues, and the slot must
                # stay held until the CPU is genuinely free again.
                self._slots.release()

        future: Future = self._pool.submit(task)
        try:
            # A cold model adds a load to the budget.
            budget = INFERENCE_TIMEOUT_SECONDS
            if spec.key not in self._loaded:
                budget += LOAD_TIMEOUT_SECONDS
            return future.result(timeout=budget)
        except FutureTimeout:
            raise Timeout()


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "LoamSttWorker"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    secret = ""
    pool = None

    def log_message(self, fmt, *args):
        """
        Silence the default access log. It prints the request line, and a
        request line is one refactor away from carrying a query parameter
        nobody meant to write down.
        """
        return

    def _send(self, status, payload):
        """
        Send a JSON response.

        ON AN ERROR, CLOSE THE CONNECTION. This is not tidiness -- it is a bug
        fix found by testing. The cheap rejections above (wrong content type,
        oversized, unknown language, model not installed) answer BEFORE
        reading the request body, which is the whole point of them being
        cheap. But under HTTP/1.1 keep-alive the client is still writing that
        body, and a connection left open with an undrained body desynchronises:
        the client blocks and eventually times out, so a prompt, correct 503
        reaches it as a mysterious TimeoutError.

        Draining the body instead would mean reading up to 2 MB we have
        already decided to reject. Closing is correct and costs nothing.
        """
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        if status >= 400:
            self.close_connection = True
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # No CORS headers at all. A browser cannot read this response, which
        # is the intent: the browser talks to the dev server, never here.
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if status >= 400:
            self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def _reject_browser(self):
        """
        Loopback plus a secret is NOT enough on its own.

        Any page in the browser can POST to 127.0.0.1. It cannot read the
        response without CORS, and cannot set `X-Loam-Worker-Secret` without a
        preflight this server never answers -- but a request that reaches the
        handler has still spent a slot. These headers are attached by the
        browser and cannot be forged by page script, so their presence is
        positive evidence the caller is a browser, and a browser is never a
        legitimate client of this worker.
        """
        for header in ("Origin", "Sec-Fetch-Mode", "Sec-Fetch-Site", "Referer"):
            if self.headers.get(header):
                return True
        return False

    def _authorized(self):
        presented = self.headers.get("X-Loam-Worker-Secret") or ""
        # Constant-time: a length-or-prefix comparison leaks the secret to
        # anything that can time a loopback request.
        return hmac.compare_digest(presented.encode("utf-8"), self.secret.encode("utf-8"))

    def do_GET(self):
        if self._reject_browser():
            return self._send(403, {"error": "forbidden"})
        if not self._authorized():
            return self._send(401, {"error": "unauthorized"})
        route = self.path.split("?")[0]
        if route == "/ready":
            status = self.pool.status()
            installed = [s2.key for s2 in MODEL_SPECS if availability(s2)["available"]]
            resident = status["resident"]
            # Ready when at least one model is installed AND one is loaded:
            # a process with nothing resident can still serve, but the first
            # caller pays a ~15s load, which a readiness probe should reveal.
            ready = bool(installed) and bool(resident)
            return self._send(200 if ready else 503, {
                "ready": ready,
                "installed": installed,
                "resident": resident,
                "notInstalled": [s2.key for s2 in MODEL_SPECS
                                 if not availability(s2)["available"]],
            })
        if route != "/health":
            return self._send(404, {"error": "not found"})

        status = self.pool.status()
        verified, unverified = [], []
        for spec in MODEL_SPECS:
            if availability(spec)["available"]:
                verified.extend(spec.verified)
                unverified.extend(spec.unverified)
        return self._send(200, dict(status, **{
            "ok": True,
            # Three separate lists. Collapsing them into one "languages" field
            # is how an untested language starts being described as working.
            "verifiedLanguages": sorted(set(verified)),
            "unverifiedLanguages": sorted(set(unverified)),
            "unroutableLanguages": {k: v for k, v in UNROUTABLE.items()},
            "maxAudioBytes": MAX_AUDIO_BYTES,
            "maxAudioSeconds": MAX_AUDIO_SECONDS,
            "sampleRate": REQUIRED_SAMPLE_RATE,
        }))

    def do_POST(self):
        if self._reject_browser():
            return self._send(403, {"error": "forbidden"})
        if not self._authorized():
            return self._send(401, {"error": "unauthorized"})
        if self.path.split("?")[0] != "/transcribe":
            return self._send(404, {"error": "not found"})

        # Cheap checks before reading a single byte of body.
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype != "application/octet-stream":
            return self._send(415, {"error": "Send raw WAV bytes as application/octet-stream."})

        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            return self._send(411, {"error": "Content-Length is required."})
        try:
            length = int(raw_length)
        except ValueError:
            return self._send(400, {"error": "Invalid Content-Length."})
        if length <= 0:
            return self._send(400, {"error": "The recording is empty."})
        if length > MAX_AUDIO_BYTES:
            return self._send(413, {"error": "That recording is too large."})

        language = (self.headers.get("X-Loam-Language") or "").strip().lower()

        # THE BODY IS READ BEFORE THE LANGUAGE AND MODEL CHECKS, DELIBERATELY.
        #
        # It is tempting to refuse an unknown language without reading the
        # upload -- and the first version did. But under HTTP/1.1 the client
        # is still writing that body, and answering early leaves it writing
        # into a socket nobody is draining: it blocks and reports a
        # TimeoutError instead of the prompt, correct 503 it was sent. Testing
        # the Pidgin route, whose model is deliberately absent, is what found
        # this.
        #
        # Reading first costs at most 2 MB over loopback from our own dev
        # server, which already enforced the same limit before forwarding. The
        # header checks above still reject the genuinely cheap cases -- wrong
        # content type, absent or oversized Content-Length -- without reading
        # anything, and those set `Connection: close` so the same desync
        # cannot bite there either.
        try:
            audio = self.rfile.read(length)
        except Exception:
            return self._send(400, {"error": "The recording could not be read."})
        if len(audio) != length:
            return self._send(400, {"error": "The recording was incomplete."})

        if language in UNROUTABLE:
            return self._send(400, {
                "error": "That language is not available for transcription.",
                "reason": UNROUTABLE[language],
                "languages": sorted(ROUTES),
            })
        if language not in ROUTES:
            return self._send(400, {
                "error": "That language is not supported for transcription.",
                "languages": sorted(ROUTES),
            })

        spec = SPEC_BY_KEY[ROUTES[language]]
        info = availability(spec)
        if not info["available"]:
            # Setup state, not a caller error: the route is correct and the
            # weights are missing. Named so an operator knows what to fetch,
            # while the client is told only which language is affected.
            log("{} requested but {} is not installed (missing {})".format(
                language, spec.model_id, ",".join(info["missingFiles"]) or "weights"))
            return self._send(503, {
                "error": "The {} transcriber is not installed on this machine.".format(language),
                "language": language,
                "retryable": False,
            })

        try:
            _rate, _channels, _bits, duration = inspect_wav(audio)
        except AudioRejected as e:
            return self._send(415, {"error": str(e)})

        started = time.time()
        try:
            text = self.pool.transcribe(audio, language)
        except Busy:
            return self._send(503, {"error": "The transcriber is busy. Try again in a moment.",
                                    "retryable": True})
        except Timeout:
            log("inference exceeded its budget for {:.2f}s of audio".format(duration))
            return self._send(504, {"error": "Transcription took too long.", "retryable": True})
        except ModelUnavailable as e:
            return self._send(503, {"error": str(e), "retryable": False})
        except AudioRejected as e:
            return self._send(415, {"error": str(e)})
        except Exception as e:
            # Type only. No message, no path, no traceback: a decoder error
            # can quote a temp path and a torch error can quote shapes that
            # describe the input.
            log("inference failed: {}".format(type(e).__name__))
            return self._send(500, {"error": "Transcription failed."})

        elapsed = time.time() - started
        text = (text or "").strip()
        if not text:
            log("empty transcript for {:.2f}s of audio in {:.1f}s".format(duration, elapsed))
            return self._send(422, {"error": "Nothing could be transcribed from that recording."})

        # Metadata only. Never the transcript, never the audio.
        log("{} [{}] {:.2f}s audio ({} bytes) in {:.1f}s -> {} chars{}".format(
            spec.key, language, duration, len(audio), elapsed, len(text),
            "" if language in spec.verified else "  (UNVERIFIED language)"))

        return self._send(200, {
            "text": text,
            "language": language,
            "languageForced": self.pool.last_language_forced,
            # So a caller can tell a checked language from an unchecked one.
            "verified": language in spec.verified,
            "provider": "loam-local-stt",
            "modelKey": spec.key,
            "model": spec.model_id,
            "audioSeconds": round(duration, 2),
            "inferenceMs": int(elapsed * 1000),
            # What was done to the audio before the model saw it. Present so a
            # bad transcript can be blamed on the resampler if that is the cause.
            "conversions": list(getattr(self.pool, "last_conversions", []) or []),
        })


def main():
    port_raw = os.environ.get("LOAM_STT_WORKER_PORT", "").strip()
    secret = os.environ.get("LOAM_STT_WORKER_SECRET", "").strip()
    resident_raw = os.environ.get("LOAM_STT_RESIDENT_MODELS", "1").strip()
    preload_lang = os.environ.get("LOAM_STT_PRELOAD_LANGUAGE", "yo").strip().lower()

    if not port_raw:
        raise SystemExit(
            "LOAM_STT_WORKER_PORT is not set. The port is configured explicitly so "
            "this worker never binds somewhere by default.")
    try:
        port = int(port_raw)
    except ValueError:
        raise SystemExit("LOAM_STT_WORKER_PORT is not a number.")
    if not 1024 <= port <= 65535:
        raise SystemExit("LOAM_STT_WORKER_PORT must be between 1024 and 65535.")

    if len(secret) < MIN_SECRET_CHARS:
        raise SystemExit(
            "LOAM_STT_WORKER_SECRET must be at least {} characters of random data. "
            "Generate one with:\n"
            "  python -c \"import secrets;print(secrets.token_urlsafe(32))\"\n"
            "Set the SAME value for the Vite dev server. Never commit it, never put "
            "it in a VITE_ variable.".format(MIN_SECRET_CHARS))

    try:
        resident = int(resident_raw)
    except ValueError:
        raise SystemExit("LOAM_STT_RESIDENT_MODELS is not a number.")

    avail, total = memory_gb()
    if avail is not None:
        log("RAM {:.1f} GiB available of {:.1f} GiB".format(avail, total))
        if avail < MIN_FREE_GB:
            raise SystemExit("refusing to start: {:.1f} GiB available is below the "
                             "{:.1f} GiB floor".format(avail, MIN_FREE_GB))
        # Two models is ~2.4 GiB of weights plus torch and activations. Refused
        # rather than attempted when the headroom is not clearly there.
        if resident > 1 and avail < 2 * MIN_FREE_GB:
            log("LOAM_STT_RESIDENT_MODELS={} requested but only {:.1f} GiB is free; "
                "keeping 1 model resident".format(resident, avail))
            resident = 1

    import torch
    threads = max(1, min(4, (os.cpu_count() or 4) // 2))
    torch.set_num_threads(threads)
    log("torch {} on CPU, {} threads".format(torch.__version__, threads))

    pool = ModelPool(max_resident=resident)

    log("models (availability checked from the cache, nothing downloaded):")
    for spec in MODEL_SPECS:
        info = availability(spec)
        log("  {:<14} {:<24} {}  verified={} unverified={}{}".format(
            spec.key, spec.model_id,
            "AVAILABLE" if info["available"] else "MISSING",
            ",".join(spec.verified) or "-",
            ",".join(spec.unverified) or "-",
            "" if info["available"] else "  missing: " + ",".join(info["missingFiles"] or ["weights"])))
    for lang, reason in UNROUTABLE.items():
        log("  {:<14} UNROUTABLE  {}".format(lang, reason))

    if preload_lang in ROUTES:
        log("preloading the {} model (one resident at a time)".format(preload_lang))
        try:
            pool.preload(preload_lang)
        except ModelUnavailable as e:
            log("preload skipped: {}".format(e))
    else:
        log("no preload (LOAM_STT_PRELOAD_LANGUAGE={} is not routable)".format(preload_lang))

    Handler.secret = secret
    Handler.pool = pool

    # 127.0.0.1 explicitly. Never 0.0.0.0, and never a configurable host:
    # there is no legitimate remote client for this process.
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    httpd.daemon_threads = True

    def shutdown(_signum, _frame):
        log("shutting down")
        threading.Thread(target=httpd.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, shutdown)
    try:
        signal.signal(signal.SIGTERM, shutdown)
    except (AttributeError, ValueError):
        pass  # not available on every Windows configuration

    log("listening on http://127.0.0.1:{} (loopback only)".format(port))
    log("POST /transcribe   GET /health   both require X-Loam-Worker-Secret")
    log("routable: {} | max {} bytes | max {}s".format(
        ", ".join(sorted(ROUTES)), MAX_AUDIO_BYTES, int(MAX_AUDIO_SECONDS)))
    try:
        httpd.serve_forever()
    finally:
        httpd.server_close()
        log("stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
