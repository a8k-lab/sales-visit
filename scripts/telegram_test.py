import contextlib
import importlib.util
import io
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("operator_bot", Path(__file__).with_name("telegram-test-bot.py"))
assert spec is not None and spec.loader is not None
bot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bot)
URL = "https://sales-visit-bot.example.workers.dev/"


class OperatorTests(unittest.TestCase):
    def test_urls(self):
        self.assertEqual(bot.worker_url(URL.rstrip("/")), URL)
        for url in ["http://sales-visit-bot.example.workers.dev", "https://example.com",
                    URL + "?token=secret", URL + "webhook", "https://user@" + URL[8:]]:
            with self.assertRaises(bot.OperatorError):
                bot.worker_url(url)

    def run_operator(self, action, webhook, upload_success=True):
        calls = []

        def api(_token, method, payload=None):
            calls.append((method, payload))
            if method == "getMe":
                return {"is_bot": True, "id": 123, "username": "separate_test_bot"}
            if method == "getWebhookInfo":
                return {"url": webhook}
            return True

        with patch.object(bot.sys.stdin, "isatty", return_value=True), \
                patch.object(bot.getpass, "getpass", return_value="123:synthetic"), \
                patch("builtins.input", side_effect=["TEST separate_test_bot", "DELETE TEST WEBHOOK"]), \
                patch.object(bot, "api", side_effect=api), \
                patch.object(bot.subprocess, "run") as upload, \
                contextlib.redirect_stdout(io.StringIO()) as output:
            if webhook and not bot.same_webhook(webhook, URL):
                with self.assertRaises(bot.OperatorError):
                    bot.operate(action, URL)
                upload.assert_not_called()
            else:
                upload.return_value.returncode = 0 if upload_success else 1
                if upload_success:
                    bot.operate(action, URL)
                else:
                    with self.assertRaises(bot.OperatorError):
                        bot.operate(action, URL)
                if action == "configure":
                    payload = upload.call_args.kwargs["input"]
                    self.assertNotIn("synthetic", str(upload.call_args.args))
                    self.assertIn("TELEGRAM_WEBHOOK_SECRET", payload)
            self.assertNotIn("synthetic", output.getvalue())
        return calls

    def test_refuses_unrelated_webhook(self):
        for action in ["configure", "delete", "info"]:
            calls = self.run_operator(action, "https://unrelated.example/")
            self.assertEqual([method for method, _ in calls], ["getMe", "getWebhookInfo"])

    def test_configure(self):
        calls = self.run_operator("configure", "")
        payload = next(payload for method, payload in calls if method == "setWebhook")
        self.assertEqual(payload["url"], URL)
        self.assertEqual(payload["allowed_updates"], ["message"])
        self.assertFalse(payload["drop_pending_updates"])
        self.assertGreaterEqual(len(payload["secret_token"]), 32)

    def test_delete_only_verified_test_webhook(self):
        calls = self.run_operator("delete", URL)
        self.assertIn(("deleteWebhook", {"drop_pending_updates": False}), calls)

    def test_failed_secret_upload_does_not_set_webhook(self):
        calls = self.run_operator("configure", "", upload_success=False)
        self.assertNotIn("setWebhook", [method for method, _ in calls])

    def test_info_is_read_only(self):
        self.assertEqual([method for method, _ in self.run_operator("info", URL)],
                         ["getMe", "getWebhookInfo", "getWebhookInfo"])


if __name__ == "__main__":
    unittest.main()
