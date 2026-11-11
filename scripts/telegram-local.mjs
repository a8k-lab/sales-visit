// Local test bots only. Never log credentials or raw Telegram responses.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const varsFile = new URL("../apps/bot/.dev.vars", import.meta.url);
const stateFile = (id) =>
  fileURLToPath(
    new URL(`../apps/bot/.wrangler/telegram-local-${id}.json`, import.meta.url)
  );
const usage = `Local test bots only (credentials: apps/bot/.dev.vars).
  pnpm telegram:local webhook:set https://YOUR-TUNNEL.trycloudflare.com
  pnpm telegram:local webhook:delete
  pnpm telegram:local user-id <unique-message-marker>`;

export class LocalError extends Error {}

export function tunnelUrl(value) {
  // Check original spelling: do not accept normalized paths, ports or credentials.
  if (
    typeof value !== "string" ||
    !/^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com\/?$/.test(value)
  )
    throw new LocalError(
      "Use an HTTPS trycloudflare.com tunnel root URL only."
    );
  return `${value.replace(/\/$/, "")}/`;
}

function readState(id) {
  try {
    return JSON.parse(readFileSync(stateFile(id), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new LocalError(
      "Cannot read local webhook ownership state; refusing changes."
    );
  }
}

function writeState(id, urls) {
  const path = stateFile(id);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(urls), { mode: 0o600 });
}

export async function run(args, dependencies = {}) {
  const [command, value] = args;
  if (args.length === 1 && ["--help", "-h"].includes(command)) return usage;
  if (
    !(
      (command === "webhook:set" && args.length === 2) ||
      (command === "webhook:delete" && args.length === 1) ||
      (command === "user-id" && args.length === 2)
    )
  )
    throw new LocalError(
      "Invalid arguments. Use --help; never pass credentials as arguments."
    );
  const target = command === "webhook:set" ? tunnelUrl(value) : null;
  if (command === "user-id" && !/^[A-Za-z0-9_-]{8,128}$/.test(value))
    throw new LocalError(
      "Use a unique 8–128 character marker (letters, digits, _ or -)."
    );

  const vars = (
    dependencies.readVars ?? (() => parseEnv(readFileSync(varsFile, "utf8")))
  )();
  const token = vars.TELEGRAM_BOT_TOKEN;
  const username = vars.TELEGRAM_LOCAL_TEST_BOT_USERNAME;
  if (
    !/^[1-9][0-9]*:[A-Za-z0-9_-]+$/.test(token ?? "") ||
    !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username ?? "")
  )
    throw new LocalError(
      "Set the test token and TELEGRAM_LOCAL_TEST_BOT_USERNAME (without @) in apps/bot/.dev.vars."
    );
  if (
    command === "webhook:set" &&
    !/^[A-Za-z0-9_-]{1,256}$/.test(vars.TELEGRAM_WEBHOOK_SECRET ?? "")
  )
    throw new LocalError(
      "Set TELEGRAM_WEBHOOK_SECRET: 1–256 letters, digits, _ or -."
    );

  const fetcher = dependencies.fetcher ?? fetch;
  const telegram = async (method, payload = {}) => {
    try {
      const response = await fetcher(
        `https://api.telegram.org/bot${token}/${method}`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await response.json();
      if (!response.ok || data?.ok !== true || data.result === undefined)
        throw new Error();
      return data.result;
    } catch {
      throw new LocalError(
        "Telegram request failed; check test configuration privately. Details suppressed."
      );
    }
  };
  const bot = await telegram("getMe");
  if (
    bot?.is_bot !== true ||
    !Number.isSafeInteger(bot.id) ||
    bot.id <= 0 ||
    typeof bot.username !== "string" ||
    bot.username.toLowerCase() !== username.toLowerCase()
  )
    throw new LocalError(
      "Token does not match the configured test bot; refusing operation."
    );
  const info = await telegram("getWebhookInfo");
  if (typeof info?.url !== "string")
    throw new LocalError("Unexpected webhook response; refusing operation.");

  if (command === "user-id") {
    if (info.url !== "")
      throw new LocalError(
        "User ID lookup requires an unset webhook. Remove your owned test webhook first."
      );
    // One snapshot, not a polling loop; no offset, so no pending updates are acknowledged.
    const updates = await telegram("getUpdates", {
      allowed_updates: ["message"],
      timeout: 0,
    });
    if (!Array.isArray(updates))
      throw new LocalError("Unexpected updates response.");
    const messages = updates
      .map((update) => update?.message)
      .filter(
        (message) =>
          message?.chat?.type === "private" &&
          message.text === value &&
          !message.forward_origin &&
          message.from?.is_bot === false &&
          message.chat.id === message.from.id
      );
    if (
      messages.length !== 1 ||
      !Number.isSafeInteger(messages[0].from.id) ||
      messages[0].from.id <= 0
    )
      throw new LocalError(
        "No unique private message matched. Send a fresh marker from your own account and retry."
      );
    return `Telegram User ID: ${messages[0].from.id} (keep private).`;
  }

  const owned = (dependencies.readState ?? readState)(bot.id);
  if (
    !Array.isArray(owned) ||
    owned.length > 2 ||
    owned.some((url) => tunnelUrl(url) !== url)
  )
    throw new LocalError(
      "Invalid local webhook ownership state; refusing changes."
    );
  if (
    info.url !== "" &&
    (!owned.includes(info.url) ||
      info.has_custom_certificate !== false ||
      !Array.isArray(info.allowed_updates) ||
      info.allowed_updates.length !== 1 ||
      info.allowed_updates[0] !== "message")
  )
    throw new LocalError(
      "Unexpected existing webhook; refusing changes. Use a separate test bot with an unset webhook."
    );
  const save = dependencies.writeState ?? writeState;
  if (command === "webhook:delete") {
    if (info.url === "") return "Test webhook is already unset.";
    if (
      (await telegram("deleteWebhook", { drop_pending_updates: true })) !== true
    )
      throw new LocalError("Telegram did not confirm webhook removal.");
    save(bot.id, []);
    return "Test webhook removed; pending test updates discarded.";
  }

  // Record both URLs before mutation so an ambiguous network failure can be retried safely.
  save(bot.id, [...new Set([info.url, target].filter(Boolean))]);
  if (
    (await telegram("setWebhook", {
      url: target,
      secret_token: vars.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ["message"],
      drop_pending_updates: false,
    })) !== true
  )
    throw new LocalError("Telegram did not confirm webhook registration.");
  save(bot.id, [target]);
  return "Test webhook registered.";
}

export async function main(args = process.argv.slice(2), dependencies = {}) {
  try {
    (dependencies.log ?? console.log)(await run(args, dependencies));
    return 0;
  } catch (error) {
    (dependencies.error ?? console.error)(
      error instanceof LocalError
        ? error.message
        : "Local operation failed; check ignored vars and state files privately. Details suppressed."
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = await main();
