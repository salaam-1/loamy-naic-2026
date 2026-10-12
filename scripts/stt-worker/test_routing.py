"""
Tests for language routing, model availability, the memory pool and the
worker's credential handling. NO MODEL IS LOADED.

`ModelPool._load` is monkeypatched throughout, so eviction and routing are
exercised against stand-ins. Nothing here needs the 1.8 GiB of weights, and
nothing here reaches a network.

RUN
  .venv-stt\\Scripts\\python.exe scripts\\stt-worker\\test_routing.py
"""

import os
import sys
import threading
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import natlas_stt_worker as w  # noqa: E402


class Routing(unittest.TestCase):
    def test_each_language_routes_to_its_own_official_model(self):
        """Five languages, five distinct model routes. No sharing, no stand-ins."""
        self.assertEqual(w.ROUTES["yo"], "ncair-yoruba")
        self.assertEqual(w.ROUTES["ha"], "ncair-hausa")
        self.assertEqual(w.ROUTES["ig"], "ncair-igbo")
        self.assertEqual(w.ROUTES["en"], "ncair-english-ng")
        self.assertEqual(w.ROUTES["pcm"], "pidgin")
        self.assertEqual(len(w.ROUTES), 5)

    def test_the_official_ncair_model_ids_are_used(self):
        ids = {spec.key: spec.model_id for spec in w.MODEL_SPECS}
        self.assertEqual(ids["ncair-yoruba"], "NCAIR1/Yoruba-ASR")
        self.assertEqual(ids["ncair-hausa"], "NCAIR1/Hausa-ASR")
        self.assertEqual(ids["ncair-igbo"], "NCAIR1/Igbo-ASR")
        self.assertEqual(ids["ncair-english-ng"], "NCAIR1/NigerianAccentedEnglish")

    def test_generic_whisper_small_is_not_a_route(self):
        """
        openai/whisper-small was the stand-in before the official checkpoints
        were installed. It must not serve any language now: it has no Igbo
        token at all, and it is not what any of these results came from.
        """
        for spec in w.MODEL_SPECS:
            self.assertNotEqual(spec.model_id, "openai/whisper-small", spec.key)

    def test_igbo_forces_no_language_which_is_the_tested_setting(self):
        """
        transformers rejects language="ig" because Whisper has no Igbo token.
        The tested script passes no language at all and the model produced
        correct Igbo. A later tidy-up to "ig" would break it.
        """
        self.assertIsNone(w.SPEC_BY_KEY["ncair-igbo"].forced_language("ig"))

    def test_the_languages_with_a_token_do_force_it(self):
        self.assertEqual(w.SPEC_BY_KEY["ncair-yoruba"].forced_language("yo"), "yo")
        self.assertEqual(w.SPEC_BY_KEY["ncair-hausa"].forced_language("ha"), "ha")
        self.assertEqual(w.SPEC_BY_KEY["ncair-english-ng"].forced_language("en"), "en")

    def test_pidgin_forces_no_language_either(self):
        self.assertIsNone(w.SPEC_BY_KEY["pidgin"].forced_language("pcm"))

    def test_a_decoding_entry_is_required_for_every_language(self):
        with self.assertRaises(SystemExit):
            w.ModelSpec(key="bad", model_id="x/y", languages=("yo", "ha"),
                        verified=(), license_note="n/a", decoding={"yo": "yo"})

    def test_max_new_tokens_matches_the_tested_scripts(self):
        for spec in w.MODEL_SPECS:
            self.assertEqual(spec.max_new_tokens, 200, spec.key)

    def test_no_language_is_claimed_by_two_models(self):
        """
        Routing must be unambiguous. If two specs claimed the same language,
        which model answered would depend on declaration order, and a silent
        model substitution is the exact failure this design exists to prevent.
        """
        seen = []
        for spec in w.MODEL_SPECS:
            seen.extend(spec.languages)
        self.assertEqual(len(seen), len(set(seen)))

    def test_igbo_is_now_routable_through_its_own_model(self):
        self.assertIn("ig", w.ROUTES)
        self.assertNotIn("ig", w.UNROUTABLE)

    def test_four_languages_are_verified_and_pidgin_is_not(self):
        for key, lang in (("ncair-yoruba", "yo"), ("ncair-hausa", "ha"),
                          ("ncair-igbo", "ig"), ("ncair-english-ng", "en")):
            self.assertEqual(w.SPEC_BY_KEY[key].verified, (lang,), key)
        # No Pidgin recording exists and the weights are not installed.
        self.assertEqual(w.SPEC_BY_KEY["pidgin"].verified, ())
        self.assertEqual(w.SPEC_BY_KEY["pidgin"].unverified, ("pcm",))

    def test_pidgin_uses_a_dedicated_model_not_the_english_one(self):
        """
        Nigerian Pidgin is its own language, not accented English. Routing it
        to NigerianAccentedEnglish would return English-shaped text that
        quietly rewrites what was said.
        """
        pidgin = w.SPEC_BY_KEY["pidgin"]
        english = w.SPEC_BY_KEY["ncair-english-ng"]
        self.assertNotEqual(pidgin.model_id, english.model_id)
        self.assertNotIn("pcm", english.languages)

    def test_verified_is_always_a_subset_of_languages(self):
        for spec in w.MODEL_SPECS:
            for lang in spec.verified:
                self.assertIn(lang, spec.languages, spec.key)

    def test_all_five_languages_are_accounted_for(self):
        """No language may be silently absent from both lists."""
        self.assertEqual(tuple(sorted(w.ALL_LANGUAGES)), ("en", "ha", "ig", "pcm", "yo"))
        for lang in w.ALL_LANGUAGES:
            self.assertTrue(
                lang in w.ROUTES or lang in w.UNROUTABLE,
                "{} is neither routable nor explicitly unroutable".format(lang))


class Availability(unittest.TestCase):
    def test_a_model_with_no_cached_files_is_reported_unavailable(self):
        spec = w.ModelSpec(key="absent", model_id="nonexistent-org/nonexistent-model",
                           languages=("sw",), verified=(), license_note="n/a")
        info = w.availability(spec)
        self.assertFalse(info["available"])
        self.assertIn("config.json", info["missingFiles"])
        self.assertEqual(info["weightFiles"], [])

    def test_availability_names_the_missing_files_for_an_operator(self):
        spec = w.ModelSpec(key="absent", model_id="nonexistent-org/nonexistent-model",
                           languages=("sw",), verified=(), license_note="n/a")
        info = w.availability(spec)
        for required in w.REQUIRED_FILES:
            self.assertIn(required, info["missingFiles"])

    def test_availability_does_not_import_torch(self):
        for spec in w.MODEL_SPECS:
            w.availability(spec)
        self.assertNotIn("torch", sys.modules)

    def test_the_four_official_ncair_models_are_cached(self):
        """
        An environment check rather than a logic check: it documents what is
        installed on the machine the tests ran on, and fails loudly if a cache
        is cleared. Pidgin is deliberately excluded -- no NCAIR Pidgin model
        exists and the third-party candidate is not installed.
        """
        for spec in w.MODEL_SPECS:
            if spec.key == "pidgin":
                continue
            info = w.availability(spec)
            self.assertTrue(info["available"],
                            "{} missing {}".format(spec.key, info["missingFiles"]))

    def test_pidgin_is_reported_unavailable_rather_than_substituted(self):
        info = w.availability(w.SPEC_BY_KEY["pidgin"])
        self.assertFalse(info["available"])
        self.assertTrue(info["missingFiles"])


class FakePool(w.ModelPool):
    """A pool whose loads are free, so eviction can be tested deterministically."""

    def __init__(self, max_resident=1):
        super().__init__(max_resident=max_resident)
        self.loads = []

    def _load(self, spec):
        self.loads.append(spec.key)
        self._meta[spec.key] = {"loadSeconds": 0.0, "parameters": 0}
        return ("processor-for-" + spec.key, "model-for-" + spec.key)


class MemoryPool(unittest.TestCase):
    def test_one_resident_model_by_default(self):
        pool = FakePool(max_resident=1)
        pool._ensure(w.SPEC_BY_KEY["ncair-yoruba"])
        pool._ensure(w.SPEC_BY_KEY["ncair-hausa"])
        # The first was evicted BEFORE the second loaded, so peak memory is
        # one model and not two.
        self.assertEqual(pool.status()["resident"], ["ncair-hausa"])
        self.assertEqual(pool.loads, ["ncair-yoruba", "ncair-hausa"])

    def test_switching_back_reloads(self):
        pool = FakePool(max_resident=1)
        pool._ensure(w.SPEC_BY_KEY["ncair-yoruba"])
        pool._ensure(w.SPEC_BY_KEY["ncair-hausa"])
        pool._ensure(w.SPEC_BY_KEY["ncair-yoruba"])
        self.assertEqual(pool.loads, ["ncair-yoruba", "ncair-hausa", "ncair-yoruba"])
        self.assertEqual(pool.status()["resident"], ["ncair-yoruba"])

    def test_a_cached_model_is_not_reloaded(self):
        pool = FakePool(max_resident=1)
        for _ in range(3):
            pool._ensure(w.SPEC_BY_KEY["ncair-yoruba"])
        self.assertEqual(pool.loads, ["ncair-yoruba"])

    def test_two_resident_keeps_both(self):
        pool = FakePool(max_resident=2)
        pool._ensure(w.SPEC_BY_KEY["ncair-yoruba"])
        pool._ensure(w.SPEC_BY_KEY["ncair-hausa"])
        self.assertEqual(sorted(pool.status()["resident"]),
                         ["ncair-hausa", "ncair-yoruba"])

    def test_an_unavailable_model_raises_before_loading(self):
        pool = FakePool(max_resident=1)
        spec = w.ModelSpec(key="absent", model_id="nonexistent-org/nonexistent-model",
                           languages=("sw",), verified=(), license_note="n/a")
        with self.assertRaises(w.ModelUnavailable):
            pool._ensure(spec)
        self.assertEqual(pool.loads, [])

    def test_the_client_message_for_a_missing_model_names_no_path(self):
        pool = FakePool(max_resident=1)
        spec = w.ModelSpec(key="absent", model_id="nonexistent-org/nonexistent-model",
                           languages=("sw",), verified=(), license_note="n/a")
        try:
            pool._ensure(spec)
            self.fail("expected ModelUnavailable")
        except w.ModelUnavailable as e:
            msg = str(e)
            self.assertNotIn(os.sep + "Users", msg)
            self.assertNotIn("huggingface", msg.lower())
            self.assertNotIn("nonexistent-org", msg)

    def test_a_load_failure_becomes_model_unavailable_not_a_raw_error(self):
        class Broken(FakePool):
            def _load(self, spec):
                raise RuntimeError("some torch internal detail C:\\\\Users\\\\HP\\\\x")

        pool = Broken(max_resident=1)
        with self.assertRaises(w.ModelUnavailable) as ctx:
            pool._ensure(w.SPEC_BY_KEY["ncair-yoruba"])
        # The internal message must not escape to the caller.
        self.assertNotIn("torch internal", str(ctx.exception))
        self.assertNotIn("Users", str(ctx.exception))

    def test_a_second_caller_gets_busy_rather_than_queueing_forever(self):
        pool = FakePool(max_resident=1)
        held = pool._slots.acquire(timeout=1)
        self.assertTrue(held)
        try:
            with self.assertRaises(w.Busy):
                pool.transcribe(b"ignored", "yo")
        finally:
            pool._slots.release()

    def test_the_slot_is_released_after_inference_fails(self):
        class Failing(FakePool):
            def _run(self, spec, audio_bytes, language):
                raise RuntimeError("inference blew up")

        pool = Failing(max_resident=1)
        with self.assertRaises(RuntimeError):
            pool.transcribe(b"ignored", "yo")
        # If the slot leaked, the next caller would get Busy forever.
        self.assertTrue(pool._slots.acquire(timeout=1))
        pool._slots.release()

    def test_inference_runs_for_the_routed_model_only(self):
        seen = {}

        class Recording(FakePool):
            def _run(self, spec, audio_bytes, language):
                seen["key"] = spec.key
                seen["language"] = language
                return "transcript"

        pool = Recording(max_resident=1)
        self.assertEqual(pool.transcribe(b"x", "ha"), "transcript")
        self.assertEqual(seen, {"key": "ncair-hausa", "language": "ha"})


class FakeHandler:
    """Enough of the handler to exercise its guards without a socket."""

    def __init__(self, headers, secret):
        self.headers = headers
        self.secret = secret

    _authorized = w.Handler._authorized
    _reject_browser = w.Handler._reject_browser


class Credentials(unittest.TestCase):
    SECRET = "s" * 40

    def test_the_right_secret_is_accepted(self):
        h = FakeHandler({"X-Loam-Worker-Secret": self.SECRET}, self.SECRET)
        self.assertTrue(h._authorized())

    def test_a_wrong_or_missing_secret_is_rejected(self):
        for presented in ("", "wrong", self.SECRET[:-1], self.SECRET + "x", None):
            headers = {} if presented is None else {"X-Loam-Worker-Secret": presented}
            h = FakeHandler(headers, self.SECRET)
            self.assertFalse(h._authorized(), repr(presented))

    def test_a_prefix_of_the_secret_is_rejected(self):
        # A prefix comparison would leak the secret to anything that can time
        # a loopback request; compare_digest is why this fails.
        h = FakeHandler({"X-Loam-Worker-Secret": "s"}, self.SECRET)
        self.assertFalse(h._authorized())

    def test_browser_headers_are_refused_outright(self):
        """
        Loopback plus a secret is not enough. These headers are attached by
        the browser and cannot be forged by page script, so their presence is
        positive evidence the caller is a browser -- never a legitimate client.
        """
        for header in ("Origin", "Sec-Fetch-Mode", "Sec-Fetch-Site", "Referer"):
            h = FakeHandler({header: "http://evil.example"}, self.SECRET)
            self.assertTrue(h._reject_browser(), header)

    def test_a_server_side_caller_is_not_mistaken_for_a_browser(self):
        h = FakeHandler({"X-Loam-Worker-Secret": self.SECRET}, self.SECRET)
        self.assertFalse(h._reject_browser())

    def test_the_default_access_log_is_silenced(self):
        # It prints the request line, which is one refactor away from carrying
        # a query parameter nobody meant to write down.
        self.assertIsNone(w.Handler.log_message(None, "%s", "anything"))


class OfflineByConstruction(unittest.TestCase):
    def test_offline_flags_are_set_at_import_time(self):
        self.assertEqual(os.environ.get("HF_HUB_OFFLINE"), "1")
        self.assertEqual(os.environ.get("TRANSFORMERS_OFFLINE"), "1")

    def test_every_load_path_passes_local_files_only(self):
        import inspect
        src = inspect.getsource(w.ModelPool._load)
        self.assertEqual(src.count("from_pretrained"), src.count("local_files_only=True"))
        self.assertGreaterEqual(src.count("local_files_only=True"), 2)

    def test_the_source_never_downloads(self):
        """
        Checked against the PARSE TREE, not the text.

        `snapshot_download` appears once in a comment explaining why it is not
        used -- it raises IncompleteSnapshotError against a cache holding only
        the inference files. A substring test would fail on that comment,
        which teaches people to delete the explanation. So this looks for
        actual calls and actual imports.
        """
        import ast
        import inspect

        forbidden = {"snapshot_download", "hf_hub_download", "load_dataset"}
        tree = ast.parse(inspect.getsource(w))
        called, imported = set(), set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                fn = node.func
                name = getattr(fn, "id", None) or getattr(fn, "attr", None)
                if name:
                    called.add(name)
            elif isinstance(node, ast.ImportFrom):
                for alias in node.names:
                    imported.add(alias.name)
            # A download forced by keyword is a download.
            if isinstance(node, ast.keyword) and node.arg in ("force_download",):
                self.fail("force_download is passed somewhere")

        self.assertEqual(forbidden & called, set(), "forbidden call present")
        self.assertEqual(forbidden & imported, set(), "forbidden import present")
        # And the one mechanism it IS allowed to use for cache lookups.
        self.assertIn("try_to_load_from_cache", imported)


if __name__ == "__main__":
    unittest.main(verbosity=2)
