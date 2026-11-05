// Operator-only test-bot setup. Never put credentials in arguments or output.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  mkdtempSync,
  openSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
export class OperatorError extends Error {}
const cancelled = () => new OperatorError("Cancelled.");
// Telegram Update fields: https://core.telegram.org/bots/api/types/update.md
// Keep status output to known enum values, never arbitrary response strings.
const updateTypes = new Set([
  "message",
  "edited_message",
  "channel_post",
  "edited_channel_post",
  "business_connection",
  "business_message",
  "edited_business_message",
  "deleted_business_messages",
  "guest_message",
  "message_reaction",
  "message_reaction_count",
  "inline_query",
  "chosen_inline_result",
  "callback_query",
  "shipping_query",
  "pre_checkout_query",
  "purchased_paid_media",
  "poll",
  "poll_answer",
  "my_chat_member",
  "chat_member",
  "chat_join_request",
  "chat_boost",
  "removed_chat_boost",
  "managed_bot",
  "subscription",
  "stopped_message_generation",
]);

export function workerUrl(value) {
  // Validate the original spelling too: URL parsing normalizes ports, paths and case.
  if (!/^https:\/\/sales-visit-bot\.[a-z0-9-]+\.workers\.dev\/?$/.test(value)) {
    throw new OperatorError(
      "Use the sales-visit-bot workers.dev root URL only."
    );
  }
  return `${value.replace(/\/$/, "")}/`;
}
export const sameWebhook = (current, intended) =>
  current.replace(/\/+$/, "") === intended.replace(/\/+$/, "");

export async function api(
  token,
  method,
  payload = {},
  { signal, fetcher = fetch } = {}
) {
  try {
    const response = await fetcher(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.any([
          AbortSignal.timeout(30_000),
          ...(signal ? [signal] : []),
        ]),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await response.json();
    if (!response.ok || data?.ok !== true || data.result === undefined)
      throw new Error();
    return data.result;
  } catch {
    throw new OperatorError(
      "Telegram request failed; sensitive details suppressed."
    );
  }
}

export async function verifyWorker(url, { signal, fetcher = fetch } = {}) {
  try {
    const response = await fetcher(new URL("health", url), {
      redirect: "error",
      signal: AbortSignal.any([
        AbortSignal.timeout(30_000),
        ...(signal ? [signal] : []),
      ]),
    });
    const body = await response.json();
    if (
      response.status !== 200 ||
      body?.status !== "ok" ||
      body?.service !== "sales-visit-bot" ||
      Object.keys(body).length !== 2
    )
      throw new Error();
  } catch {
    throw new OperatorError(
      "Bot Worker health check failed; webhook not changed."
    );
  }
}

export async function privateSecretsFile(
  values,
  use,
  { temporaryRoot = tmpdir(), write = writeFileSync } = {}
) {
  const base = realpathSync(temporaryRoot);
  const location = relative(realpathSync(root), base);
  if (
    !location ||
    (!isAbsolute(location) &&
      location !== ".." &&
      !location.startsWith(`..${sep}`))
  ) {
    throw new OperatorError(
      "Temporary directory must be outside the repository."
    );
  }
  // mkdtemp creates 0700 atomically; exclusive open creates 0600 (or stricter umask).
  const directory = mkdtempSync(join(base, "sales-visit-secrets-"));
  try {
    const path = join(directory, "credentials.json");
    const descriptor = openSync(path, "wx", 0o600);
    try {
      write(descriptor, JSON.stringify(values));
    } finally {
      closeSync(descriptor);
    }
    return await use(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// Raw mode prevents terminal echo even for pasted input. No readline history or
// masking output; restore the terminal and listeners on every exit path.
export function terminalInput(
  prompt,
  hidden,
  { input = process.stdin, output = process.stdout, signal } = {}
) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    return Promise.reject(
      new OperatorError(
        "Run interactively in a private terminal (no recording or shell tracing)."
      )
    );
  }
  return new Promise((resolve, reject) => {
    let value = "";
    let finished = false;
    const wasRaw = input.isRaw;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      input.removeListener("keypress", keypress);
      input.removeListener("end", end);
      input.removeListener("error", end);
      output.removeListener("error", end);
      signal?.removeEventListener("abort", abort);
      try {
        // A resumed stdin keeps the CLI alive, regardless of its initial state.
        // Pause first so even a raw-mode restoration failure cannot leave it active.
        input.pause();
        input.setRawMode(Boolean(wasRaw));
        output.write("\n");
      } catch {
        error = cancelled();
      }
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => finish(cancelled());
    const end = () => finish(cancelled());
    const keypress = (text, key = {}) => {
      if (key.ctrl && ["c", "d", "z"].includes(key.name)) return abort();
      if (key.name === "return" || key.name === "enter") return finish();
      if (key.name === "backspace") {
        if (value) {
          value = value.slice(0, -1);
          if (!hidden) output.write("\b \b");
        }
      } else if (
        text &&
        !key.ctrl &&
        !key.meta &&
        [...text].every(
          (character) =>
            character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127
        )
      ) {
        value += text;
        if (!hidden) output.write(text);
      }
    };
    if (signal?.aborted) return finish(cancelled());
    try {
      emitKeypressEvents(input);
      input.setRawMode(true);
      input.on("keypress", keypress);
      input.once("end", end);
      input.once("error", end);
      output.once("error", end);
      signal?.addEventListener("abort", abort, { once: true });
      output.write(prompt);
      input.resume();
    } catch {
      finish(cancelled());
    }
  });
}

export function runWrangler(
  arguments_,
  accountId,
  { signal, spawnProcess = spawn } = {}
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled());
    let child;
    try {
      child = spawnProcess(
        "pnpm",
        ["--filter", "@sales-visit/bot", "exec", "wrangler", ...arguments_],
        {
          cwd: root,
          stdio: "ignore",
          detached: true,
          env: {
            ...process.env,
            CLOUDFLARE_ACCOUNT_ID: accountId,
            WRANGLER_LOG: "error",
            WRANGLER_WRITE_LOGS: "false",
          },
        }
      );
    } catch {
      return reject(
        new OperatorError(
          "Wrangler operation failed; output suppressed. Verify Cloudflare login/target."
        )
      );
    }
    let timer;
    const killGroup = (name) => {
      try {
        if (child.pid) process.kill(-child.pid, name);
      } catch {
        /* Already exited. */
      }
    };
    const abort = () => {
      killGroup("SIGTERM");
      timer = setTimeout(() => killGroup("SIGKILL"), 1000);
    };
    signal?.addEventListener("abort", abort, { once: true });
    child.once("error", () => {
      /* close follows error; never expose spawn details. */
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) {
        // Also kill descendants if the pnpm parent exited before them.
        killGroup("SIGKILL");
        reject(cancelled());
      } else if (code !== 0) {
        killGroup("SIGKILL");
        reject(
          new OperatorError(
            "Wrangler operation failed; output suppressed. Verify Cloudflare login/target."
          )
        );
      } else resolve();
    });
    if (signal?.aborted) abort();
  });
}

export async function operate(action, url, dependencies = {}) {
  if (action === "configure")
    throw new OperatorError(
      "In-place rotation is disabled: remove only the verified test webhook with delete, then use initial-deploy during a planned interruption. See docs/deployment.md."
    );
  url = workerUrl(url);
  const {
    signal,
    interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY),
    ask = (prompt, hidden = false) => terminalInput(prompt, hidden, { signal }),
    telegram = (token, method, payload) =>
      api(token, method, payload, { signal }),
    health = (target) => verifyWorker(target, { signal }),
    wrangler = (args, account) => runWrangler(args, account, { signal }),
    secretsFile = privateSecretsFile,
    accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    log = console.log,
  } = dependencies;
  const check = () => {
    if (signal?.aborted) throw cancelled();
  };
  if (!interactive)
    throw new OperatorError(
      "Run interactively in a private terminal (no recording or shell tracing)."
    );
  check();
  const token = await ask("Separate TEST bot token (hidden): ", true);
  if (!/^[0-9]+:[A-Za-z0-9_-]+$/.test(token))
    throw new OperatorError("Invalid token format.");
  check();
  const bot = await telegram(token, "getMe");
  const username = bot?.username;
  if (
    bot?.is_bot !== true ||
    typeof username !== "string" ||
    !/^[A-Za-z0-9_]+$/.test(username) ||
    !Number.isSafeInteger(bot.id) ||
    bot.id <= 0
  )
    throw new OperatorError("Unexpected bot identity.");
  log(`Bot identity: @${username}, bot ID ${bot.id}`);
  log(
    "STOP unless this is your separate BotFather TEST bot, not the teammate's bot."
  );
  if (
    (await ask(`Confirm by typing TEST ${username}: `)) !== `TEST ${username}`
  )
    throw new OperatorError("Identity not confirmed; nothing changed.");
  check();
  let info = await telegram(token, "getWebhookInfo");
  const current = info.url ?? "";
  if (typeof current !== "string" || (current && !sameWebhook(current, url)))
    throw new OperatorError(
      "A different webhook exists. Refusing to replace or delete it."
    );
  if (action === "initial-deploy") {
    if (current)
      throw new OperatorError(
        "A test webhook is active. Delete it explicitly before changing Worker credentials."
      );
    if (!/^[0-9a-fA-F]{32}$/.test(accountId))
      throw new OperatorError(
        "Set CLOUDFLARE_ACCOUNT_ID to the verified account ID before deployment."
      );
    log(`Cloudflare target: account ${accountId}, Worker URL ${url}`);
    log(
      "Verify this account owns the URL's workers.dev subdomain in the Cloudflare dashboard."
    );
    log(
      "Also verify Wrangler access and the deployed API in that account. Health alone is not ownership proof."
    );
    log(
      "Independently verify this Worker is not used by another bot. This helper can inspect only the supplied bot's webhook."
    );
    const confirmation = `ACCOUNT ${accountId} ${url.slice(8, -1)}`;
    if (
      (await ask(`Confirm ownership by typing ${confirmation}: `)) !==
      confirmation
    )
      throw new OperatorError(
        "Cloudflare account/URL ownership not confirmed; nothing changed."
      );
    check();
    const secret = randomBytes(32).toString("base64url");
    await secretsFile(
      { TELEGRAM_BOT_TOKEN: token, TELEGRAM_WEBHOOK_SECRET: secret },
      async (path) => {
        check();
        await wrangler(
          ["deploy", "--name", "sales-visit-bot", "--secrets-file", path],
          accountId
        );
      }
    );
    check();
    await health(url);
    check();
    // Telegram has no conditional webhook writes. Recheck as late as possible;
    // this narrows, but cannot eliminate, concurrent-modification races.
    const latest = await telegram(token, "getWebhookInfo");
    check();
    if (latest?.url !== "")
      throw new OperatorError(
        "Webhook state changed; refusing to register over an active or unverified webhook."
      );
    await telegram(token, "setWebhook", {
      url,
      secret_token: secret,
      allowed_updates: ["message"],
      drop_pending_updates: false,
    });
    log(
      "Worker credentials configured, health verified and test webhook registered; pending updates retained."
    );
  } else if (action === "delete") {
    if (!current) {
      log("No webhook configured; nothing changed.");
      return;
    }
    if ((await ask("Type DELETE TEST WEBHOOK: ")) !== "DELETE TEST WEBHOOK")
      throw new OperatorError("Deletion cancelled.");
    check();
    const latest = await telegram(token, "getWebhookInfo");
    check();
    if (typeof latest?.url !== "string" || !sameWebhook(latest.url, url))
      throw new OperatorError(
        "Webhook state changed; refusing to delete an absent, conflicting or unverified webhook."
      );
    await telegram(token, "deleteWebhook", { drop_pending_updates: false });
    log("Test webhook removed; pending updates retained.");
  }
  check();
  info = await telegram(token, "getWebhookInfo");
  // Only typed status fields, never Telegram error text or arbitrary response data.
  log(
    JSON.stringify(
      {
        webhook_matches:
          typeof info.url === "string" && sameWebhook(info.url, url),
        pending_update_count: Number.isSafeInteger(info.pending_update_count)
          ? info.pending_update_count
          : 0,
        last_error_date: Number.isSafeInteger(info.last_error_date)
          ? info.last_error_date
          : null,
        last_error_present: Boolean(info.last_error_message),
        allowed_updates: Array.isArray(info.allowed_updates)
          ? info.allowed_updates.filter(
              (item) => typeof item === "string" && updateTypes.has(item)
            )
          : [],
      },
      null,
      2
    )
  );
  log(
    "Webhook status is not delivery proof. Send real Telegram commands and verify replies/D1 privately."
  );
}

export async function main(
  args = process.argv.slice(2),
  {
    operation = operate,
    log = console.log,
    error = console.error,
    signals = process,
  } = {}
) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    log(
      "Usage: node scripts/telegram-test-bot.mjs <initial-deploy|configure|info|delete> <https://sales-visit-bot.SUBDOMAIN.workers.dev/>\nOperator-only test-bot setup. configure is disabled. Use a private, non-recorded terminal; never pass credentials as arguments."
    );
    return 0;
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const names = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const name of names) signals.on(name, cancel);
  try {
    if (
      args.length !== 2 ||
      !["initial-deploy", "configure", "info", "delete"].includes(args[0])
    )
      throw new OperatorError(
        "Invalid arguments. Use --help; never pass credentials as arguments."
      );
    await operation(args[0], workerUrl(args[1]), { signal: controller.signal });
    return 0;
  } catch (failure) {
    let message =
      "Operation failed. Check prerequisites privately; sensitive details suppressed.";
    if (controller.signal.aborted) message = "Cancelled.";
    else if (failure instanceof OperatorError) message = failure.message;
    error(message);
    return 1;
  } finally {
    for (const name of names) signals.removeListener(name, cancel);
  }
}

function isEntryPoint() {
  try {
    return Boolean(
      process.argv[1] &&
      realpathSync(process.argv[1]) ===
        realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    // An importing process may have a non-file argv[1]; do not run the CLI.
    return false;
  }
}

if (isEntryPoint()) process.exitCode = await main();
