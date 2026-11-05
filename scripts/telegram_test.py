import contextlib
import importlib.util
import io
import json
import stat
import subprocess
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("operator_bot", Path(__file__).with_name("telegram-test-bot.py"))
assert spec is not None and spec.loader is not None
bot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bot)
URL = "https://sales-visit-bot.example.workers.dev/"
TOKEN = "123:synthetic"  # noqa: S105 - synthetic test fixture, not a credential
ACCOUNT_ID = "a" * 32  # synthetic account fixture


class OperatorTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.files = []
        self.current = ""
        self.failure = None
        self.health_count = 0
        self.confirmation = "TEST separate_test_bot"
        self.account_confirmation = f"ACCOUNT {ACCOUNT_ID} sales-visit-bot.example.workers.dev"
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(bot.sys.stdin, "isatty", return_value=True))
        self.token_prompt = self.stack.enter_context(patch.object(bot.getpass, "getpass", return_value=TOKEN))
        self.stack.enter_context(patch.dict(bot.os.environ, {"CLOUDFLARE_ACCOUNT_ID": ACCOUNT_ID}))
        self.stack.enter_context(patch("builtins.input", side_effect=self.confirm))
        self.stack.enter_context(patch.object(bot, "api", side_effect=self.api))
        self.stack.enter_context(patch.object(bot, "verify_worker", side_effect=self.health))
        self.upload = self.stack.enter_context(patch.object(bot.subprocess, "run", side_effect=self.wrangler))
        self.output = self.stack.enter_context(contextlib.redirect_stdout(io.StringIO()))

    def tearDown(self):
        for path in self.files:
            self.assertFalse(path.exists())
            self.assertFalse(path.parent.exists())
        self.assertNotIn(TOKEN, self.output.getvalue())

    def confirm(self, prompt):
        if "Confirm ownership" in prompt:
            self.events.append("confirm-account")
            return self.account_confirmation
        self.events.append("confirm")
        return "DELETE TEST WEBHOOK" if "DELETE" in prompt else self.confirmation

    def api(self, _token, method, payload=None):
        self.events.append(method)
        if method == "getMe":
            return {"is_bot": True, "id": 123, "username": "separate_test_bot"}
        if method == "getWebhookInfo":
            return {"url": self.current}
        if method == "setWebhook":
            assert payload is not None
            self.assertEqual(payload["url"], URL)
            self.assertEqual(payload["allowed_updates"], ["message"])
            self.assertFalse(payload["drop_pending_updates"])
            self.assertEqual(payload["secret_token"], self.uploaded["TELEGRAM_WEBHOOK_SECRET"])
            if self.failure == "webhook":
                raise bot.OperatorError("Telegram request failed; sensitive details suppressed.")
            self.current = URL
        if method == "deleteWebhook":
            assert payload is not None
            self.assertFalse(payload["drop_pending_updates"])
            self.current = ""
        return True

    def health(self, url):
        self.assertEqual(url, URL)
        self.events.append("health")
        self.health_count += 1
        if self.failure == f"health-{self.health_count}":
            raise bot.OperatorError("Bot Worker health check failed; webhook not changed.")

    def wrangler(self, arguments, **kwargs):
        self.assertNotIn(TOKEN, str(arguments))
        self.assertTrue(kwargs["capture_output"])
        self.assertEqual(kwargs["env"]["WRANGLER_WRITE_LOGS"], "false")
        self.assertEqual(kwargs["env"]["WRANGLER_LOG"], "error")
        self.assertEqual(kwargs["env"]["CLOUDFLARE_ACCOUNT_ID"], ACCOUNT_ID)
        if "deploy" in arguments:
            self.events.append("deploy")
            self.assertNotIn("bulk", arguments)
            path = Path(arguments[arguments.index("--secrets-file") + 1])
            self.files.append(path)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(path.parent.stat().st_mode), 0o700)
            root = Path(__file__).resolve().parents[1]
            self.assertNotIn(root, path.resolve().parents)
            self.uploaded = json.loads(path.read_text())
            self.assertNotIn("input", kwargs)
            self.assertEqual(kwargs["stdin"], subprocess.DEVNULL)
        else:
            self.fail("Only deploy --secrets-file may write Worker credentials")
        self.assertEqual(set(self.uploaded), {"TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"})
        self.assertEqual(self.uploaded["TELEGRAM_BOT_TOKEN"], TOKEN)
        self.assertGreaterEqual(len(self.uploaded["TELEGRAM_WEBHOOK_SECRET"]), 32)
        if self.failure == "interrupt":
            raise KeyboardInterrupt()
        if self.failure == "terminate":
            bot.signal.raise_signal(bot.signal.SIGTERM)
        if self.failure == "spawn":
            raise OSError("synthetic spawn failure")
        return Mock(returncode=1 if self.failure == "wrangler" else 0)

    def test_urls(self):
        self.assertEqual(bot.worker_url(URL.rstrip("/")), URL)
        for url in ["http://sales-visit-bot.example.workers.dev", "https://example.com",
                    URL + "?token=secret", URL + "webhook", "https://user@" + URL[8:]]:
            with self.assertRaises(bot.OperatorError):
                bot.worker_url(url)

    def test_initial_deploy_supplies_required_secrets_before_health_and_webhook(self):
        bot.operate("initial-deploy", URL)
        self.assertEqual(self.events, ["getMe", "confirm", "getWebhookInfo", "confirm-account", "deploy",
                                       "health", "setWebhook", "getWebhookInfo"])

    def test_initial_deploy_failures_clean_file_and_never_set_webhook(self):
        for failure, error in [("wrangler", bot.OperatorError), ("spawn", OSError),
                               ("interrupt", KeyboardInterrupt), ("health-1", bot.OperatorError)]:
            with self.subTest(failure=failure):
                self.events.clear()
                self.health_count = 0
                self.failure = failure
                with self.assertRaises(error):
                    bot.operate("initial-deploy", URL)
                self.assertNotIn("setWebhook", self.events)
                for path in self.files:
                    self.assertFalse(path.exists())
                    self.assertFalse(path.parent.exists())

    def test_sigterm_unwinds_secret_file_and_restores_handler(self):
        self.failure = "terminate"
        previous_handler = bot.signal.getsignal(bot.signal.SIGTERM)
        with patch.object(bot.sys, "argv", ["telegram-test-bot.py", "initial-deploy", URL]), \
                contextlib.redirect_stderr(io.StringIO()) as errors:
            self.assertEqual(bot.main(), 1)
        self.assertEqual(bot.signal.getsignal(bot.signal.SIGTERM), previous_handler)
        self.assertNotIn("setWebhook", self.events)
        self.assertNotIn(TOKEN, errors.getvalue())

    def test_initial_webhook_failure_still_removes_file(self):
        self.failure = "webhook"
        with self.assertRaises(bot.OperatorError):
            bot.operate("initial-deploy", URL)
        self.assertIn("health", self.events)

    def test_in_place_rotation_is_disabled_without_reading_credentials_or_remote_calls(self):
        self.current = URL
        with self.assertRaisesRegex(bot.OperatorError, "rotation is disabled"):
            bot.operate("configure", URL)
        self.assertEqual(self.events, [])
        self.token_prompt.assert_not_called()
        self.upload.assert_not_called()

    def test_initial_deploy_cannot_be_used_to_rotate_active_webhook(self):
        self.current = URL
        with self.assertRaisesRegex(bot.OperatorError, "webhook is active"):
            bot.operate("initial-deploy", URL)
        self.assertEqual(self.events, ["getMe", "confirm", "getWebhookInfo"])
        self.upload.assert_not_called()

    def test_account_id_must_be_explicit_and_valid_before_any_upload(self):
        for value in ["", "wrong-account", "a" * 31]:
            with self.subTest(value=value), \
                    patch.dict(bot.os.environ, {"CLOUDFLARE_ACCOUNT_ID": value}), \
                    self.assertRaisesRegex(bot.OperatorError, "verified account ID"):
                bot.operate("initial-deploy", URL)
        self.upload.assert_not_called()
        self.assertNotIn("setWebhook", self.events)
        self.assertEqual(self.files, [])

    def test_account_url_mismatch_refuses_upload(self):
        self.account_confirmation = f"ACCOUNT {ACCOUNT_ID} sales-visit-bot.other.workers.dev"
        with self.assertRaisesRegex(bot.OperatorError, "ownership not confirmed"):
            bot.operate("initial-deploy", URL)
        self.upload.assert_not_called()
        self.assertNotIn("setWebhook", self.events)
        self.assertEqual(self.files, [])

    def test_stopped_webhook_can_be_redeployed_without_in_place_rotation(self):
        self.current = URL
        bot.operate("delete", URL)
        self.assertEqual(self.current, "")
        bot.operate("initial-deploy", URL)
        self.assertLess(self.events.index("deleteWebhook"), self.events.index("deploy"))
        self.assertEqual(self.current, URL)

    def test_refuses_unrelated_webhook_before_remote_change(self):
        self.current = "https://unrelated.example/"
        for action in ["initial-deploy", "configure", "delete", "info"]:
            with self.assertRaises(bot.OperatorError):
                bot.operate(action, URL)
        self.upload.assert_not_called()
        self.assertNotIn("setWebhook", self.events)
        self.assertNotIn("deleteWebhook", self.events)

    def test_identity_confirmation_required_before_remote_change(self):
        self.confirmation = "wrong bot"
        with self.assertRaises(bot.OperatorError):
            bot.operate("initial-deploy", URL)
        self.assertEqual(self.events, ["getMe", "confirm"])
        self.upload.assert_not_called()

    def test_secret_write_failure_removes_directory(self):
        real_mkstemp = bot.tempfile.mkstemp

        def track_file(*args, **kwargs):
            descriptor, path = real_mkstemp(*args, **kwargs)
            self.files.append(Path(path))
            return descriptor, path

        with patch.object(bot.tempfile, "mkstemp", side_effect=track_file), \
                patch.object(bot.json, "dump", side_effect=OSError("synthetic write failure")), \
                self.assertRaises(OSError):
            bot.operate("initial-deploy", URL)
        self.upload.assert_not_called()

    def test_refuses_repository_temp_directory_before_writing(self):
        root = Path(__file__).resolve().parents[1]
        with patch.object(bot.tempfile, "gettempdir", return_value=str(root)), \
                patch.object(bot.tempfile, "TemporaryDirectory") as directory:
            with self.assertRaises(bot.OperatorError):
                bot.operate("initial-deploy", URL)
            directory.assert_not_called()
        self.upload.assert_not_called()

    def test_delete_only_verified_test_webhook(self):
        self.current = URL
        bot.operate("delete", URL)
        self.assertIn("deleteWebhook", self.events)
        self.upload.assert_not_called()

    def test_info_is_read_only(self):
        self.current = URL
        bot.operate("info", URL)
        self.assertEqual(self.events, ["getMe", "confirm", "getWebhookInfo", "getWebhookInfo"])
        self.upload.assert_not_called()


class HealthTests(unittest.TestCase):
    def test_worker_health_requires_success_status_and_exact_body(self):
        for status, body, success in [
            (200, {"status": "ok", "service": "sales-visit-bot"}, True),
            (503, {"status": "ok", "service": "sales-visit-bot"}, False),
            (302, {}, False), (200, {"status": "ok"}, False),
        ]:
            with self.subTest(status=status, body=body), \
                    patch.object(bot.http.client, "HTTPSConnection") as connection:
                response = connection.return_value.getresponse.return_value
                response.status = status
                response.read.return_value = json.dumps(body).encode()
                if success:
                    bot.verify_worker(URL)
                else:
                    with self.assertRaises(bot.OperatorError):
                        bot.verify_worker(URL)
                connection.assert_called_once_with("sales-visit-bot.example.workers.dev", timeout=30)
                connection.return_value.request.assert_called_once_with("GET", "/health")
                connection.return_value.close.assert_called_once()

    def test_transport_failure_is_sanitized(self):
        with patch.object(bot.http.client, "HTTPSConnection") as connection:
            connection.return_value.request.side_effect = OSError("sensitive transport detail")
            with self.assertRaises(bot.OperatorError) as raised:
                bot.verify_worker(URL)
            self.assertNotIn("sensitive transport detail", str(raised.exception))
            connection.return_value.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
