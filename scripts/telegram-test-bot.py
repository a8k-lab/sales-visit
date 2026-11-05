"""Operator-only test-bot setup. No credentials in arguments or output."""
import argparse
import getpass
import http.client
import json
import os
import re
import secrets
import signal
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit


class OperatorError(Exception):
    pass


def api(token, method, payload=None):
    connection = http.client.HTTPSConnection("api.telegram.org", timeout=30)
    # Fixed HTTPS host; never follow redirects or propagate transport errors.
    try:
        connection.request(
            "POST", f"/bot{token}/{method}",
            body=json.dumps(payload or {}),
            headers={"Content-Type": "application/json"},
        )
        response = connection.getresponse()
        result = json.load(response)
        if not result.get("ok"):
            raise OperatorError("Telegram rejected the request.")
        return result["result"]
    except Exception:
        raise OperatorError("Telegram request failed; sensitive details suppressed.") from None
    finally:
        connection.close()


def worker_url(value):
    url = urlsplit(value)
    if (url.scheme != "https" or not url.hostname
            or not re.fullmatch(r"sales-visit-bot\.[a-z0-9-]+\.workers\.dev", url.hostname)
            or url.netloc != url.hostname or url.path not in ("", "/")
            or url.query or url.fragment):
        raise OperatorError("Use the sales-visit-bot workers.dev root URL only.")
    return f"https://{url.hostname}/"


def same_webhook(current, intended):
    return current.rstrip("/") == intended.rstrip("/")


def verify_worker(url):
    connection = http.client.HTTPSConnection(urlsplit(url).hostname, timeout=30)
    try:
        connection.request("GET", "/health")
        response = connection.getresponse()
        if response.status != 200 or json.load(response) != {
            "status": "ok", "service": "sales-visit-bot"}:
            raise OperatorError("Unexpected Worker health response.")
    except Exception:
        raise OperatorError("Bot Worker health check failed; webhook not changed.") from None
    finally:
        connection.close()


@contextmanager
def private_secrets_file(values):
    # Do not honor a TMPDIR inside this checkout. No secret is written there.
    root = Path(__file__).resolve().parents[1]
    temporary_root = Path(tempfile.gettempdir()).resolve()
    if temporary_root == root or root in temporary_root.parents:
        raise OperatorError("Temporary directory must be outside the repository.")
    # TemporaryDirectory is 0700; mkstemp creates its file as 0600, atomically.
    # Both context managers clean up on failures and KeyboardInterrupt as well.
    with tempfile.TemporaryDirectory(prefix="sales-visit-secrets-", dir=temporary_root) as directory:
        descriptor, path = tempfile.mkstemp(suffix=".json", dir=directory)
        with os.fdopen(descriptor, "w") as output:
            json.dump(values, output)
        yield path


def confirm_cloudflare_target(url):
    account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
    if not re.fullmatch(r"[0-9a-fA-F]{32}", account_id):
        raise OperatorError("Set CLOUDFLARE_ACCOUNT_ID to the verified account ID before deployment.")
    hostname = urlsplit(url).hostname
    print(f"Cloudflare target: account {account_id}, Worker URL {url}")
    print("Verify this account owns the URL's workers.dev subdomain in the Cloudflare dashboard.")
    print("Also verify Wrangler access and the deployed API in that account. Health alone is not ownership proof.")
    confirmation = f"ACCOUNT {account_id} {hostname}"
    if input(f"Confirm ownership by typing {confirmation}: ") != confirmation:
        raise OperatorError("Cloudflare account/URL ownership not confirmed; nothing changed.")
    return account_id


def run_wrangler(arguments, account_id):
    result = subprocess.run(
        ["pnpm", "--filter", "@sales-visit/bot", "exec", "wrangler", *arguments],
        stdin=subprocess.DEVNULL,
        text=True, capture_output=True,
        # Suppress persistent debug logs as well as captured console output.
        env={**os.environ, "CLOUDFLARE_ACCOUNT_ID": account_id,
             "WRANGLER_LOG": "error", "WRANGLER_WRITE_LOGS": "false"},
        cwd=Path(__file__).resolve().parents[1],
    )
    if result.returncode:
        raise OperatorError("Wrangler operation failed; output suppressed. Verify Cloudflare login/target.")


def operate(action, url):
    if action == "configure":
        raise OperatorError(
            "In-place rotation is disabled: remove only the verified test webhook with delete, "
            "then use initial-deploy during a planned interruption. See docs/deployment.md."
        )
    if not sys.stdin.isatty():
        raise OperatorError("Run interactively in a private terminal (no recording or shell tracing).")
    token = getpass.getpass("Separate TEST bot token (hidden): ")
    if not re.fullmatch(r"[0-9]+:[A-Za-z0-9_-]+", token):
        raise OperatorError("Invalid token format.")
    bot = api(token, "getMe")
    username = bot.get("username", "")
    if not bot.get("is_bot") or not re.fullmatch(r"[A-Za-z0-9_]+", username):
        raise OperatorError("Unexpected bot identity.")
    print(f"Bot identity: @{username}, bot ID {bot['id']}")
    print("STOP unless this is your separate BotFather TEST bot, not the teammate's bot.")
    if input(f"Confirm by typing TEST {username}: ") != f"TEST {username}":
        raise OperatorError("Identity not confirmed; nothing changed.")
    info = api(token, "getWebhookInfo")
    current = info.get("url", "")
    if current and not same_webhook(current, url):
        raise OperatorError("A different webhook exists. Refusing to replace or delete it.")
    if action == "initial-deploy":
        if current:
            raise OperatorError("A test webhook is active. Delete it explicitly before changing Worker credentials.")
        account_id = confirm_cloudflare_target(url)
        secret = secrets.token_urlsafe(32)
        values = {"TELEGRAM_BOT_TOKEN": token, "TELEGRAM_WEBHOOK_SECRET": secret}
        with private_secrets_file(values) as path:
            run_wrangler(["deploy", "--name", "sales-visit-bot", "--secrets-file", path], account_id)
        # Never register a webhook after a failed deploy/upload/health check.
        verify_worker(url)
        api(token, "setWebhook", {"url": url, "secret_token": secret,
                                 "allowed_updates": ["message"], "drop_pending_updates": False})
        print("Worker credentials configured, health verified and test webhook registered; pending updates retained.")
    elif action == "delete":
        if not current:
            print("No webhook configured; nothing changed.")
            return
        if input("Type DELETE TEST WEBHOOK: ") != "DELETE TEST WEBHOOK":
            raise OperatorError("Deletion cancelled.")
        api(token, "deleteWebhook", {"drop_pending_updates": False})
        print("Test webhook removed; pending updates retained.")
    info = api(token, "getWebhookInfo")
    print(json.dumps({
        "webhook_matches": same_webhook(info.get("url", ""), url),
        "pending_update_count": info.get("pending_update_count", 0),
        "last_error_date": info.get("last_error_date"),
        "last_error_present": bool(info.get("last_error_message")),
        "allowed_updates": info.get("allowed_updates", []),
    }, indent=2))
    print("Webhook status is not delivery proof. Send real Telegram commands and verify replies/D1 privately.")


def cancel_operation(_signum, _frame):
    # Unwind temporary-file contexts on terminal closure or termination.
    raise KeyboardInterrupt()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["initial-deploy", "configure", "info", "delete"])
    parser.add_argument("url", help="Verified account's sales-visit-bot workers.dev URL (not a secret)")
    args = parser.parse_args()
    previous_handlers = {number: signal.signal(number, cancel_operation)
                         for number in (signal.SIGTERM, signal.SIGHUP)}
    try:
        operate(args.action, worker_url(args.url))
    except (KeyboardInterrupt, EOFError):
        print("Cancelled.", file=sys.stderr)
        return 1
    except OperatorError as error:
        # Only our fixed, credential-free messages may reach the terminal.
        print(str(error), file=sys.stderr)
        return 1
    except Exception:
        # No traceback, server response, or transport exception text can leak a token.
        print("Operation failed. Check prerequisites privately; sensitive details suppressed.", file=sys.stderr)
        return 1
    finally:
        for number, handler in previous_handlers.items():
            signal.signal(number, handler)
    return 0


if __name__ == "__main__":
    sys.exit(main())
