import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  api,
  main,
  operate,
  OperatorError,
  privateSecretsFile,
  runWrangler,
  terminalInput,
  verifyWorker,
  workerUrl,
} from "./telegram-test-bot.mjs";

const URL = "https://sales-visit-bot.example.workers.dev/";
const TOKEN = "123:synthetic";
const ACCOUNT = "a".repeat(32);
const moduleUrl = new globalThis.URL("./telegram-test-bot.mjs", import.meta.url)
  .href;
const root = fileURLToPath(new globalThis.URL("../", import.meta.url));

function fixture(t, options = {}) {
  const state = { events: [], files: [], output: [], current: "", ...options };
  const dependencies = {
    interactive: true,
    accountId: ACCOUNT,
    log: (message) => state.output.push(message),
    ask: async (prompt, hidden) => {
      if (hidden) {
        state.events.push("token");
        return state.token ?? TOKEN;
      }
      if (prompt.includes("ownership")) {
        state.events.push("account");
        return (
          state.accountConfirmation ??
          `ACCOUNT ${ACCOUNT} sales-visit-bot.example.workers.dev`
        );
      }
      state.events.push("confirm");
      return prompt.includes("DELETE")
        ? (state.deletion ?? "DELETE TEST WEBHOOK")
        : (state.confirmation ?? "TEST separate_test_bot");
    },
    telegram: async (token, method, payload) => {
      assert.equal(token, TOKEN);
      state.events.push(method);
      if (state.failure === method)
        throw new OperatorError(
          "Telegram request failed; sensitive details suppressed."
        );
      if (method === "getMe")
        return (
          state.bot ?? { is_bot: true, id: 123, username: "separate_test_bot" }
        );
      if (method === "getWebhookInfo") return { url: state.current };
      if (method === "setWebhook") {
        assert.deepEqual(payload, {
          url: URL,
          secret_token: state.uploaded.TELEGRAM_WEBHOOK_SECRET,
          allowed_updates: ["message"],
          drop_pending_updates: false,
        });
        state.current = URL;
      }
      if (method === "deleteWebhook") {
        assert.deepEqual(payload, { drop_pending_updates: false });
        state.current = "";
      }
      return true;
    },
    health: async (url) => {
      assert.equal(url, URL);
      state.events.push("health");
      if (state.failure === "health")
        throw new OperatorError(
          "Bot Worker health check failed; webhook not changed."
        );
    },
    wrangler: async (args, account) => {
      state.events.push("deploy");
      assert.equal(account, ACCOUNT);
      assert.deepEqual(args.slice(0, -1), [
        "deploy",
        "--name",
        "sales-visit-bot",
        "--secrets-file",
      ]);
      assert.ok(!args.join(" ").includes(TOKEN));
      const path = args.at(-1);
      state.files.push(path);
      assert.equal(statSync(path).mode & 0o777, 0o600);
      assert.equal(statSync(dirname(path)).mode & 0o777, 0o700);
      assert.ok(
        relative(realpathSync(root), realpathSync(path)).startsWith("../")
      );
      state.uploaded = JSON.parse(readFileSync(path, "utf8"));
      assert.deepEqual(Object.keys(state.uploaded).toSorted(), [
        "TELEGRAM_BOT_TOKEN",
        "TELEGRAM_WEBHOOK_SECRET",
      ]);
      assert.equal(state.uploaded.TELEGRAM_BOT_TOKEN, TOKEN);
      assert.match(
        state.uploaded.TELEGRAM_WEBHOOK_SECRET,
        /^[A-Za-z0-9_-]{43}$/
      );
      if (state.failure === "deploy")
        throw new OperatorError(
          "Wrangler operation failed; output suppressed."
        );
      if (state.failure === "spawn") throw new Error(TOKEN);
      if (state.failure === "interrupt") {
        state.controller.abort();
        throw new OperatorError("Cancelled.");
      }
    },
  };
  state.run = (action, overrides = {}) =>
    operate(action, URL, { ...dependencies, ...overrides });
  t.after(() => {
    for (const path of state.files) {
      assert.ok(!existsSync(path));
      assert.ok(!existsSync(dirname(path)));
    }
    assert.ok(!state.output.join(" ").includes(TOKEN));
    if (state.uploaded)
      assert.ok(
        !state.output.join(" ").includes(state.uploaded.TELEGRAM_WEBHOOK_SECRET)
      );
  });
  return state;
}

test("URL validation rejects alternate hosts, credentials, ports, paths and normalization tricks", () => {
  assert.equal(workerUrl(URL.slice(0, -1)), URL);
  assert.equal(workerUrl(URL), URL);
  for (const value of [
    "http:" + URL.slice(6),
    "https://example.com",
    URL + "?token=secret",
    URL + "#x",
    URL + "webhook",
    URL + "../",
    URL + "?",
    URL + "#",
    "https://user@" + URL.slice(8),
    URL.replace(".dev", ".dev:443"),
    URL.replace("example", "EXAMPLE"),
    URL.replace("https://", "https://\\"),
    URL + "\n",
  ]) {
    assert.throws(() => workerUrl(value), OperatorError);
  }
});

test("initial deploy supplies both secrets before health and webhook registration", async (t) => {
  const state = fixture(t);
  await state.run("initial-deploy");
  assert.deepEqual(state.events, [
    "token",
    "getMe",
    "confirm",
    "getWebhookInfo",
    "account",
    "deploy",
    "health",
    "setWebhook",
    "getWebhookInfo",
  ]);
});

for (const failure of [
  "deploy",
  "spawn",
  "interrupt",
  "health",
  "getMe",
  "getWebhookInfo",
  "setWebhook",
]) {
  test(`${failure} failure cleans credentials and stops subsequent mutations`, async (t) => {
    const state = fixture(t, { failure, controller: new AbortController() });
    await assert.rejects(
      state.run("initial-deploy", { signal: state.controller.signal })
    );
    if (failure !== "setWebhook")
      assert.ok(!state.events.includes("setWebhook"));
    if (["getMe", "getWebhookInfo"].includes(failure))
      assert.ok(!state.events.includes("deploy"));
  });
}

test("configure is disabled before terminal, token or network access", async (t) => {
  const state = fixture(t);
  await assert.rejects(
    state.run("configure", { interactive: false }),
    /rotation is disabled/
  );
  assert.deepEqual(state.events, []);
});

test("private terminal and valid token are mandatory", async (t) => {
  const state = fixture(t);
  await assert.rejects(
    state.run("info", { interactive: false }),
    /private terminal/
  );
  assert.deepEqual(state.events, []);
  for (const token of ["", "secret", "123:bad\n", "123:bad token"]) {
    state.token = token;
    await assert.rejects(state.run("info"), /Invalid token/);
    assert.ok(!state.events.includes("getMe"));
  }
});

test("identity must be a bot with a safe username/ID and explicit confirmation", async (t) => {
  const state = fixture(t);
  for (const bot of [
    {},
    { is_bot: false },
    { is_bot: true, username: "bad\n", id: 123 },
    { is_bot: true, username: "valid", id: TOKEN },
  ]) {
    state.bot = bot;
    await assert.rejects(
      state.run("initial-deploy"),
      /Unexpected bot identity/
    );
  }
  state.bot = undefined;
  state.confirmation = "wrong bot";
  await assert.rejects(state.run("initial-deploy"), /Identity not confirmed/);
  assert.ok(!state.events.includes("getWebhookInfo"));
});

test("account ID and exact account/URL ownership confirmation are required before upload", async (t) => {
  const state = fixture(t);
  for (const accountId of [
    "",
    "wrong-account",
    "a".repeat(31),
    "a".repeat(32) + "\n",
  ]) {
    await assert.rejects(
      state.run("initial-deploy", { accountId }),
      /verified account ID/
    );
  }
  state.accountConfirmation = `ACCOUNT ${ACCOUNT} sales-visit-bot.other.workers.dev`;
  await assert.rejects(state.run("initial-deploy"), /ownership not confirmed/);
  assert.ok(!state.events.includes("deploy"));
  assert.equal(state.files.length, 0);
});

test("active webhook cannot be rotated, even at the intended URL", async (t) => {
  const state = fixture(t, { current: URL });
  await assert.rejects(state.run("initial-deploy"), /webhook is active/);
  assert.ok(!state.events.includes("deploy"));
});

test("conflicting webhooks are never replaced or deleted", async (t) => {
  const state = fixture(t, { current: "https://unrelated.example/" });
  for (const action of ["initial-deploy", "info", "delete"])
    await assert.rejects(state.run(action), /different webhook/);
  assert.ok(!state.events.includes("deploy"));
  assert.ok(!state.events.includes("deleteWebhook"));
});

test("planned deletion retains updates and permits explicit redeployment", async (t) => {
  const state = fixture(t, { current: URL });
  await state.run("delete");
  assert.equal(state.current, "");
  await state.run("initial-deploy");
  assert.ok(
    state.events.indexOf("deleteWebhook") < state.events.indexOf("deploy")
  );
  assert.equal(state.current, URL);
});

test("deletion requires confirmation; absent webhook is a no-op", async (t) => {
  const state = fixture(t, { current: URL, deletion: "no" });
  await assert.rejects(state.run("delete"), /Deletion cancelled/);
  assert.ok(!state.events.includes("deleteWebhook"));
  state.current = "";
  await state.run("delete");
  assert.ok(!state.events.includes("deleteWebhook"));
});

test("info is read-only and does not print arbitrary Telegram fields", async (t) => {
  const state = fixture(t, { current: URL });
  await state.run("info");
  assert.deepEqual(state.events, [
    "token",
    "getMe",
    "confirm",
    "getWebhookInfo",
    "getWebhookInfo",
  ]);
  const responses = [
    { is_bot: true, username: "test", id: 123 },
    { url: "" },
    {
      url: "",
      pending_update_count: TOKEN,
      last_error_date: TOKEN,
      last_error_message: TOKEN,
      allowed_updates: [TOKEN, "message"],
    },
  ];
  await state.run("info", {
    ask: async (_, hidden) => (hidden ? TOKEN : "TEST test"),
    telegram: async () => responses.shift(),
  });
});

test("write failure removes even a partially written private file", async () => {
  let path;
  await assert.rejects(
    privateSecretsFile({}, () => assert.fail("must not deploy"), {
      write: (descriptor) => {
        path = `/dev/fd/${descriptor}`;
        throw new Error("synthetic write failure");
      },
    }),
    /synthetic write failure/
  );
  assert.ok(!existsSync(path));
  // Independently capture the directory from the writer to prove directory cleanup.
  const base = mkdtempSync(join(tmpdir(), "sales-visit-test-"));
  try {
    await assert.rejects(
      privateSecretsFile({}, () => {}, {
        temporaryRoot: base,
        write: () => {
          throw new Error();
        },
      })
    );
    const { readdirSync } = await import("node:fs");
    assert.deepEqual(readdirSync(base), []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("repository-local temporary roots, including symlinks, are refused before writing", async () => {
  await assert.rejects(
    privateSecretsFile({}, () => assert.fail(), { temporaryRoot: root }),
    /outside the repository/
  );
  const base = mkdtempSync(join(tmpdir(), "sales-visit-test-"));
  try {
    const link = join(base, "checkout");
    symlinkSync(root, link);
    await assert.rejects(
      privateSecretsFile({}, () => assert.fail(), { temporaryRoot: link }),
      /outside the repository/
    );
    await assert.rejects(
      privateSecretsFile({}, () => assert.fail(), {
        temporaryRoot: join(root, "scripts"),
      }),
      /outside the repository/
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("Telegram HTTP, JSON, API and transport failures are sanitized; requests never follow redirects", async () => {
  for (const fetcher of [
    async () => {
      throw new Error(TOKEN);
    },
    async () => ({ ok: false, json: async () => ({ ok: true, result: {} }) }),
    async () => ({
      ok: true,
      json: async () => ({ ok: false, description: TOKEN }),
    }),
    async () => ({
      ok: true,
      json: async () => {
        throw new Error(TOKEN);
      },
    }),
    async () => ({ ok: true, json: async () => ({ ok: true }) }),
  ]) {
    await assert.rejects(
      api(TOKEN, "getMe", {}, { fetcher }),
      (error) =>
        error instanceof OperatorError &&
        !String(error).includes(TOKEN) &&
        !error.cause
    );
  }
  assert.deepEqual(
    await api(
      TOKEN,
      "getMe",
      {},
      {
        fetcher: async (url, options) => {
          assert.equal(url, `https://api.telegram.org/bot${TOKEN}/getMe`);
          assert.equal(options.redirect, "error");
          assert.equal(options.method, "POST");
          assert.ok(options.signal instanceof AbortSignal);
          return {
            ok: true,
            json: async () => ({ ok: true, result: { id: 123 } }),
          };
        },
      }
    ),
    { id: 123 }
  );
});

test("Worker health requires 200 and exact body, suppresses transport/JSON failures", async () => {
  for (const [status, body, success] of [
    [200, { status: "ok", service: "sales-visit-bot" }, true],
    [503, { status: "ok", service: "sales-visit-bot" }, false],
    [302, {}, false],
    [200, { status: "ok" }, false],
    [200, { status: "ok", service: "sales-visit-bot", extra: true }, false],
  ]) {
    const call = verifyWorker(URL, {
      fetcher: async (url, options) => {
        assert.equal(String(url), URL + "health");
        assert.equal(options.redirect, "error");
        return { status, json: async () => body };
      },
    });
    if (success) await call;
    else await assert.rejects(call, /health check failed/);
  }
  for (const fetcher of [
    async () => {
      throw new Error(TOKEN);
    },
    async () => ({
      status: 200,
      json: async () => {
        throw new Error(TOKEN);
      },
    }),
  ])
    await assert.rejects(
      verifyWorker(URL, { fetcher }),
      (error) => !String(error).includes(TOKEN)
    );
});

function terminal() {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (raw) => {
    input.isRaw = raw;
  };
  input.pause();
  const output = new PassThrough();
  output.isTTY = true;
  let text = "";
  output.on("data", (chunk) => {
    text += chunk;
  });
  return { input, output, text: () => text };
}

test("hidden raw input never echoes token, handles backspace and restores terminal state", async () => {
  const tty = terminal();
  const result = terminalInput("Token: ", true, tty);
  assert.equal(tty.input.isRaw, true);
  tty.input.write(TOKEN + "x\x7f\r");
  assert.equal(await result, TOKEN);
  assert.equal(tty.text(), "Token: \n");
  assert.equal(tty.input.isRaw, false);
  assert.equal(tty.input.isPaused(), true);
  assert.equal(tty.input.listenerCount("keypress"), 0);
});

for (const interruption of ["\x03", "\x04", "\x1a", "abort", "end", "error"]) {
  test(`terminal ${JSON.stringify(interruption)} cancels without echo and restores state`, async () => {
    const tty = terminal();
    const controller = new AbortController();
    const result = terminalInput("Token: ", true, {
      ...tty,
      signal: controller.signal,
    });
    tty.input.write(TOKEN);
    if (interruption === "abort") controller.abort();
    else if (interruption === "end" || interruption === "error")
      tty.input.emit(interruption);
    else tty.input.write(interruption);
    await assert.rejects(result, /Cancelled/);
    assert.ok(!tty.text().includes(TOKEN));
    assert.equal(tty.input.isRaw, false);
    assert.equal(tty.input.listenerCount("keypress"), 0);
  });
}

test("terminal refuses redirected input or output and an already aborted read", async () => {
  const tty = terminal();
  tty.output.isTTY = false;
  await assert.rejects(terminalInput("", true, tty), /private terminal/);
  tty.output.isTTY = true;
  tty.input.isTTY = false;
  await assert.rejects(terminalInput("", true, tty), /private terminal/);
  tty.input.isTTY = true;
  await assert.rejects(
    terminalInput("", true, { ...tty, signal: AbortSignal.abort() }),
    /Cancelled/
  );
  assert.equal(tty.input.isRaw, false);
});

test("terminal setup and restoration failures reject safely without lingering listeners", async () => {
  for (const failOn of [true, false]) {
    const tty = terminal();
    tty.input.setRawMode = (raw) => {
      if (raw === failOn) throw new Error(TOKEN);
      tty.input.isRaw = raw;
    };
    const result = terminalInput("Token: ", true, tty);
    if (!failOn) tty.input.write(TOKEN + "\r");
    await assert.rejects(
      result,
      (error) =>
        error instanceof OperatorError && !String(error).includes(TOKEN)
    );
    assert.equal(tty.input.listenerCount("keypress"), 0);
    assert.equal(tty.input.listenerCount("error"), 0);
    assert.equal(tty.output.listenerCount("error"), 0);
  }
});

test("network cancellation reaches fetch and never exposes transport details", async () => {
  for (const call of [
    (options) => api(TOKEN, "getMe", {}, options),
    (options) => verifyWorker(URL, options),
  ]) {
    const controller = new AbortController();
    const result = call({
      signal: controller.signal,
      fetcher: async (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error(TOKEN)), {
            once: true,
          });
        }),
    });
    controller.abort();
    await assert.rejects(
      result,
      (error) =>
        error instanceof OperatorError && !String(error).includes(TOKEN)
    );
  }
});

test("cancellation between deployment and health cannot register a webhook", async (t) => {
  const state = fixture(t);
  const controller = new AbortController();
  await assert.rejects(
    state.run("initial-deploy", {
      signal: controller.signal,
      wrangler: async () => controller.abort(),
    }),
    /Cancelled/
  );
  assert.ok(!state.events.includes("health"));
  assert.ok(!state.events.includes("setWebhook"));
});

test("Wrangler uses only a path in arguments, disables output/logging, and sanitizes failures", async () => {
  for (const mode of ["success", "failure", "error", "throw"]) {
    const call = runWrangler(
      ["deploy", "--secrets-file", "/private/path"],
      ACCOUNT,
      {
        spawnProcess: (command, args, options) => {
          assert.equal(command, "pnpm");
          assert.deepEqual(args, [
            "--filter",
            "@sales-visit/bot",
            "exec",
            "wrangler",
            "deploy",
            "--secrets-file",
            "/private/path",
          ]);
          assert.equal(options.stdio, "ignore");
          assert.equal(options.detached, true);
          assert.equal(options.env.CLOUDFLARE_ACCOUNT_ID, ACCOUNT);
          assert.equal(options.env.WRANGLER_LOG, "error");
          assert.equal(options.env.WRANGLER_WRITE_LOGS, "false");
          if (mode === "throw") throw new Error(TOKEN);
          const child = new EventEmitter();
          queueMicrotask(() => {
            if (mode === "error") child.emit("error", new Error(TOKEN));
            child.emit("close", mode === "success" ? 0 : 1);
          });
          return child;
        },
      }
    );
    if (mode === "success") await call;
    else
      await assert.rejects(
        call,
        (error) =>
          error instanceof OperatorError && !String(error).includes(TOKEN)
      );
  }
});

for (const name of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  test(
    `${name} cancels Wrangler's process group and cleans credentials before CLI exits`,
    { timeout: 10_000 },
    async (t) => {
      // Child harness runs the real main/signal handler, secret-file lifecycle and
      // subprocess runner, replacing only pnpm with a synthetic local process.
      const descendantCode =
        'process.on("SIGTERM", () => process.exit(0)); process.stdout.write("ready"); setInterval(() => {}, 1000);';
      const wranglerCode = `
        import { spawn } from 'node:child_process';
        process.on('SIGTERM', () => {});
        const descendant = spawn(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(descendantCode)}], { stdio: ['ignore', 'pipe', 'ignore'] });
        descendant.stdout.once('data', () => process.stdout.write(JSON.stringify({ descendantPid: descendant.pid })));
        setInterval(() => {}, 1000);
      `;
      const code = `
      import { main, privateSecretsFile, runWrangler } from ${JSON.stringify(moduleUrl)};
      import { spawn } from 'node:child_process';
      const result = await main(['initial-deploy', ${JSON.stringify(URL)}], {
        operation: async (_action, _url, { signal }) => privateSecretsFile({ token: ${JSON.stringify(TOKEN)} }, async path => {
          await runWrangler(['deploy', '--secrets-file', path], ${JSON.stringify(ACCOUNT)}, {
            signal, spawnProcess: (_cmd, _args, options) => {
              const child = spawn(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(wranglerCode)}],
                { ...options, stdio: ['ignore', 'pipe', 'ignore'] });
              child.stdout.once('data', chunk => console.log(JSON.stringify({ path, pid: child.pid, ...JSON.parse(String(chunk)) })));
              return child;
            }
          });
        })
      });
      process.exitCode = result;
    `;
      const child = spawn(
        process.execPath,
        ["--input-type=module", "-e", code],
        { stdio: ["ignore", "pipe", "pipe"] }
      );
      t.after(() => {
        child.kill("SIGKILL");
      });
      let output = "";
      let errors = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        errors += chunk;
      });
      const [chunk] = await once(child.stdout, "data");
      const { path, pid, descendantPid } = JSON.parse(String(chunk));
      t.after(() => {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          /* Exited. */
        }
      });
      assert.ok(existsSync(path));
      child.kill(name);
      const [status] = await once(child, "close");
      assert.equal(status, 1);
      assert.ok(!existsSync(path));
      assert.ok(!existsSync(dirname(path)));
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      assert.throws(() => process.kill(descendantPid, 0), { code: "ESRCH" });
      assert.ok(!output.includes(TOKEN));
      assert.ok(!errors.includes(TOKEN));
      assert.match(errors, /Cancelled/);
    }
  );
}

test("main restores signal listeners, handles help/configure without credentials and suppresses unexpected errors", async () => {
  const signals = new EventEmitter();
  const previous = () => {
    assert.ok(signals);
  };
  signals.on("SIGTERM", previous);
  const messages = [];
  const options = {
    signals,
    log: (text) => messages.push(text),
    error: (text) => messages.push(text),
  };
  assert.equal(await main(["--help"], options), 0);
  assert.equal(await main(["configure", URL], options), 1);
  assert.match(messages.join(" "), /rotation is disabled/);
  assert.equal(
    await main(["info", URL], {
      ...options,
      operation: async () => {
        throw new Error(TOKEN);
      },
    }),
    1
  );
  for (const args of [[TOKEN], ["info", URL, TOKEN], ["info", TOKEN]])
    assert.equal(await main(args, options), 1);
  assert.ok(!messages.join(" ").includes(TOKEN));
  assert.deepEqual(signals.listeners("SIGTERM"), [previous]);
  assert.equal(signals.listenerCount("SIGHUP"), 0);
  assert.equal(signals.listenerCount("SIGINT"), 0);
});
