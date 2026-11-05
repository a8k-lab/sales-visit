"""Operator-only test-bot setup. No credentials in arguments, files, or output."""
import argparse
import getpass
import http.client
import json
import re
import secrets
import subprocess
import sys
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


def operate(action, url):
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
    if action == "configure":
        secret = secrets.token_urlsafe(32)
        result = subprocess.run(
            ["pnpm", "--filter", "@sales-visit/bot", "exec", "wrangler", "secret", "bulk",
             "--name", "sales-visit-bot"],
            input=json.dumps({"TELEGRAM_BOT_TOKEN": token, "TELEGRAM_WEBHOOK_SECRET": secret}),
            text=True, capture_output=True,
            cwd=Path(__file__).resolve().parents[1],
        )
        if result.returncode:
            raise OperatorError("Worker secret upload failed; output suppressed. Verify Cloudflare login/target.")
        api(token, "setWebhook", {"url": url, "secret_token": secret,
                                 "allowed_updates": ["message"], "drop_pending_updates": False})
        print("Secrets uploaded and test webhook registered; pending updates retained.")
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["configure", "info", "delete"])
    parser.add_argument("url", help="Deployed sales-visit-bot workers.dev URL (not a secret)")
    args = parser.parse_args()
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
    return 0


if __name__ == "__main__":
    sys.exit(main())
