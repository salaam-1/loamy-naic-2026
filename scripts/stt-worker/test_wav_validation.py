"""
Tests for the worker's audio validation. NO MODEL IS LOADED.

Importing `natlas_stt_worker` is safe: torch and transformers are imported
inside `Transcriber.load()`, which only `main()` calls. So these run in under
a second and need none of the 926 MiB of weights.

WHY THIS EXISTS SEPARATELY FROM THE VITEST SUITE
  `npm test` must not depend on a Python interpreter, and these are Python
  functions. The TypeScript side has its own parser tested in
  tests/unit/stt-local.test.ts; this proves the WORKER refuses the same
  things, because a validator that runs only on the far side of a network hop
  is not a validator.

RUN
  .venv-stt\\Scripts\\python.exe scripts\\stt-worker\\test_wav_validation.py
"""

import os
import struct
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from natlas_stt_worker import (  # noqa: E402
    MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS, REQUIRED_SAMPLE_RATE, ROUTES, UNROUTABLE,
    AudioRejected, inspect_wav,
)


def wav(sample_rate=REQUIRED_SAMPLE_RATE, channels=1, bits=16, seconds=1.0, encoding=1):
    """A real RIFF/WAVE file, built byte by byte."""
    bytes_per_frame = (bits // 8) * channels
    data_bytes = int(round(sample_rate * seconds)) * bytes_per_frame
    header = b"RIFF" + struct.pack("<I", 36 + data_bytes) + b"WAVE"
    header += b"fmt " + struct.pack("<I", 16)
    header += struct.pack("<HHIIHH", encoding, channels, sample_rate,
                          sample_rate * bytes_per_frame, bytes_per_frame, bits)
    header += b"data" + struct.pack("<I", data_bytes)
    return header + (b"\x00" * data_bytes)


class AcceptsWhatTheModelExpects(unittest.TestCase):
    def test_16khz_mono_pcm_is_accepted_with_the_right_duration(self):
        rate, channels, bits, duration = inspect_wav(wav(seconds=5.23))
        self.assertEqual(rate, 16_000)
        self.assertEqual(channels, 1)
        self.assertEqual(bits, 16)
        self.assertAlmostEqual(duration, 5.23, places=2)

    def test_chunks_are_walked_not_assumed_at_fixed_offsets(self):
        """A LIST chunk before `data` must not break the parse."""
        base = wav(seconds=1)
        extra = b"LIST" + struct.pack("<I", 4) + b"INFO"
        spliced = base[:36] + extra + base[36:]
        _, _, _, duration = inspect_wav(spliced)
        self.assertAlmostEqual(duration, 1.0, places=3)


class ConvertsRatherThanRefusing(unittest.TestCase):
    """
    What changed when voice input became real.

    A browser records at hardware rate (44.1 or 48 kHz) in whatever channel
    count the device gives, and `AudioContext` ignores a request for 16 kHz.
    Refusing that would mean refusing every real recording, so the worker
    downmixes and resamples with librosa -- the same library the tested
    scripts use -- and reports the conversion in its response so a poor
    transcript can be attributed to it.
    """

    def test_ordinary_rates_and_channels_are_accepted(self):
        for rate in (16_000, 22_050, 44_100, 48_000):
            for channels in (1, 2):
                got_rate, got_ch, _bits, duration = inspect_wav(
                    wav(sample_rate=rate, channels=channels, seconds=1))
                self.assertEqual(got_rate, rate)
                self.assertEqual(got_ch, channels)
                self.assertAlmostEqual(duration, 1.0, places=3)

    def test_the_duration_ceiling_still_applies_at_any_rate(self):
        # The byte limit depends on the rate; this one does not, which is why
        # both exist.
        with self.assertRaises(AudioRejected):
            inspect_wav(wav(sample_rate=48_000, seconds=MAX_AUDIO_SECONDS + 1))


class RefusesRatherThanGuessing(unittest.TestCase):
    def reject(self, data, pattern):
        with self.assertRaises(AudioRejected) as ctx:
            inspect_wav(data)
        self.assertRegex(str(ctx.exception), pattern)

    def test_empty(self):
        self.reject(b"", "empty")

    def test_too_short_to_be_wav(self):
        self.reject(b"RIFF" + b"\x00" * 10, "too short")

    def test_a_webm_blob_is_refused(self):
        # The check that matters: MediaRecorder's default output, which
        # soundfile cannot read, must never reach the decoder.
        self.reject(b"\x1a\x45\xdf\xa3" + b"\x00" * 300, "not a WAV")

    def test_an_implausible_sample_rate_is_refused(self):
        """
        A rate the header could not honestly describe. Ordinary rates are
        ACCEPTED now and resampled with librosa, because a phone browser
        records at hardware rate and cannot be told otherwise -- see
        test_ordinary_rates_and_channels_are_accepted below.
        """
        self.reject(wav(sample_rate=400_000), "implausible sample rate")

    def test_an_implausible_channel_count_is_refused(self):
        data = bytearray(wav(channels=2))
        # Overwrite the channel count with something no recorder produces.
        data[22:24] = (99).to_bytes(2, "little")
        self.reject(bytes(data), "implausible channel count")

    def test_duration_ceiling(self):
        self.reject(wav(seconds=MAX_AUDIO_SECONDS + 1), "under 30 seconds")

    def test_unreadable_encoding(self):
        self.reject(wav(encoding=0xFFFE), "encoding")

    def test_no_data_chunk(self):
        self.reject(wav(seconds=0), "no audio")

    def test_missing_fmt_chunk(self):
        data = wav(seconds=1)
        broken = data[:12] + b"junk" + data[16:]
        self.reject(broken, "format header")


class LimitsMatchTheTypeScriptSide(unittest.TestCase):
    """
    These constants are duplicated across a language boundary. If they drift,
    one side rejects what the other accepted, which is the confusing kind of
    bug. See STT_MAX_AUDIO_BYTES in src/lib/providers/stt.ts and
    STT_REQUIRED_SAMPLE_RATE / STT_MAX_AUDIO_SECONDS in wav.ts.
    """

    def test_byte_limit(self):
        self.assertEqual(MAX_AUDIO_BYTES, 2_000_000)

    def test_sample_rate(self):
        self.assertEqual(REQUIRED_SAMPLE_RATE, 16_000)

    def test_duration_limit(self):
        self.assertEqual(MAX_AUDIO_SECONDS, 30.0)

    def test_routable_languages(self):
        # All five route somewhere, each to its own model. Nothing is
        # unroutable any more. See test_routing.py for the detail.
        self.assertEqual(sorted(ROUTES), ["en", "ha", "ig", "pcm", "yo"])
        self.assertEqual(dict(UNROUTABLE), {})


class OfflineByConstruction(unittest.TestCase):
    def test_hub_offline_is_set_at_import_time(self):
        # Set before transformers is imported, or it has no effect.
        self.assertEqual(os.environ.get("HF_HUB_OFFLINE"), "1")
        self.assertEqual(os.environ.get("TRANSFORMERS_OFFLINE"), "1")

    def test_importing_the_worker_loads_no_model(self):
        # torch is imported inside load(); merely importing must not pull it in.
        self.assertNotIn("torch", sys.modules)


if __name__ == "__main__":
    unittest.main(verbosity=2)
