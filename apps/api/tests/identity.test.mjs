import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const actor = (id) => ({
  telegramUserId: String(id),
  firstName: "Pengguna sintetis",
});
const bundle = async (file) =>
  (
    await build({
      entryPoints: [new URL(file, import.meta.url).pathname],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2022",
      external: ["cloudflare:workers"],
    })
  ).outputFiles[0].text;

// Test-only caller holding the same named RPC capability as the Bot. Never part
// of either deployed Worker; it lets tests exercise validation beyond bot parsing.
const probe = `export default { async fetch(req, env) {
  const { method, args } = await req.json();
  return Response.json(await env.IDENTITY[method](...args));
}}`;

test("registration, authorization and verified webhook across real Worker RPC + migrated D1", async (t) => {
  const sent = [];
  let telegramRequests = 0;
  let failNotification = false;
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "probe",
          modules: true,
          script: probe,
          compatibilityDate: "2026-11-02",
          serviceBindings: {
            IDENTITY: { name: "api", entrypoint: "BotIdentity" },
          },
        },
        {
          name: "api",
          modules: true,
          script: await bundle("../src/worker.ts"),
          compatibilityDate: "2026-11-02",
          d1Databases: { DB: "identity-test" },
        },
        {
          name: "bot",
          modules: true,
          script: await bundle("../../bot/src/index.ts"),
          compatibilityDate: "2026-11-02",
          bindings: {
            TELEGRAM_BOT_TOKEN: "123456:synthetic-test-token",
            TELEGRAM_WEBHOOK_SECRET: "synthetic-test-secret",
          },
          serviceBindings: {
            IDENTITY: { name: "api", entrypoint: "BotIdentity" },
          },
          outboundService: async (req) => {
            telegramRequests++;
            assert.equal(new URL(req.url).hostname, "api.telegram.org");
            if (req.url.endsWith("/getMe"))
              return Response.json({
                ok: true,
                result: {
                  id: 123456,
                  is_bot: true,
                  first_name: "Test Bot",
                  username: "sales_visit_test_bot",
                },
              });
            assert.ok(req.url.endsWith("/sendMessage"));
            const body = await req.json();
            sent.push(body);
            if (failNotification && String(body.chat_id) === "130")
              return Response.json(
                { ok: false, error_code: 403, description: "Forbidden" },
                { status: 403 }
              );
            return Response.json({
              ok: true,
              result: {
                message_id: sent.length,
                date: 1,
                chat: { id: Number(body.chat_id), type: "private" },
                text: body.text,
              },
            });
          },
        },
      ],
    })
  );
  try {
    const db = await mf.getD1Database("DB", "api");
    const migrations = new URL(
      "../../../packages/db/migrations/",
      import.meta.url
    );
    for (const file of readdirSync(migrations)
      .filter((f) => f.endsWith(".sql"))
      .toSorted()) {
      const sql = readFileSync(new URL(file, migrations), "utf8").replace(
        /^\s*--.*$/gm,
        ""
      );
      await db.batch(
        sql
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => db.prepare(s))
      );
    }
    const rpcWorker = await mf.getWorker("probe");
    const api = await mf.getWorker("api");
    const bot = await mf.getWorker("bot");
    const rpc = async (method, ...args) => {
      const response = await rpcWorker.fetch("https://test/", {
        method: "POST",
        body: JSON.stringify({ method, args }),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    const count = async (table) =>
      (await db.prepare("SELECT count(*) AS n FROM " + table).first()).n;
    const register = (id) => rpc("register", actor(id));
    const approve = (by, id, role = "supervisor", salesForceId) =>
      rpc("approve", actor(by), {
        telegramUserId: String(id),
        role,
        ...(salesForceId ? { salesForceId } : {}),
      });
    const reject = (by, id) =>
      rpc("reject", actor(by), { telegramUserId: String(id) });
    let updateId = 1;
    const webhook = async (id, text, options = {}) => {
      const update = {
        update_id: updateId++,
        message: {
          message_id: updateId,
          date: 1,
          chat: {
            id: options.chatId ?? id,
            type: options.chatType ?? "private",
          },
          from: {
            id,
            is_bot: false,
            first_name: "Pengguna sintetis",
            ...options.from,
          },
          text,
          entities: text.startsWith("/")
            ? [
                {
                  type: "bot_command",
                  offset: 0,
                  length: text.split(" ")[0].length,
                },
              ]
            : [],
        },
      };
      if (options.forwarded)
        update.message.forward_origin = {
          type: "user",
          date: 1,
          sender_user: { id: 900, is_bot: false, first_name: "Admin" },
        };
      if (options.missingSender) delete update.message.from;
      const response = await bot.fetch("https://bot/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token":
            options.secret ?? "synthetic-test-secret",
        },
        body: JSON.stringify(options.update ?? update),
      });
      return response;
    };

    await t.test(
      "atomic first registration and concurrent/profile retries",
      async () => {
        const registrations = await Promise.all(
          Array.from({ length: 5 }, () => register(100))
        );
        assert.ok(
          registrations.every(
            (r) =>
              r.ok &&
              r.data.status === "pending" &&
              r.data.role === null &&
              r.data.salesForceId === null
          )
        );
        assert.equal(new Set(registrations.map((r) => r.data.id)).size, 1);
        await rpc("register", {
          ...actor(100),
          username: "new_name",
          firstName: "Changed",
        });
        assert.equal(await count("users"), 1);
        assert.equal(await count("telegram_identities"), 1);
        assert.equal(await count("access_audit"), 1);
        assert.notEqual(registrations[0].data.id, "100");
        assert.equal(
          (await rpc("register", { ...actor(101), role: "admin" })).code,
          "invalid"
        );
        for (const telegramUserId of ["01", "1e3", "-1", 100])
          assert.equal(
            (await rpc("register", { telegramUserId })).code,
            "invalid"
          );
      }
    );

    // Synthetic operator bootstrap using the documented template (not an RPC bypass).
    let bootstrap = readFileSync(
      new URL("../../../packages/db/IDENTITY.md", import.meta.url),
      "utf8"
    )
      .split("```sql\n")[1]
      .split("```")[0];
    bootstrap = bootstrap
      .replaceAll("<internal-user-id>", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
      .replaceAll("<telegram-bot-user-id>", "900");
    await db.batch(
      bootstrap
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => db.prepare(s))
    );
    await db
      .prepare(
        "INSERT INTO sales_force (id, name) VALUES ('sf-test', 'Sales Force sintetis'), ('sf-other', 'Sales Force lain')"
      )
      .run();

    await t.test("only active Admin can list or decide", async () => {
      for (const [id, status, role] of [
        [901, "active", "supervisor"],
        [902, "active", "sales_force"],
        [903, "disabled", "admin"],
        [904, "pending", null],
        [905, "rejected", null],
      ]) {
        await register(id);
        await db
          .prepare(
            "UPDATE users SET status = ?, role = ? WHERE id = (SELECT user_id FROM telegram_identities WHERE telegram_user_id = ?)"
          )
          .bind(status, role, String(id))
          .run();
        for (const response of [
          await rpc("pending", actor(id)),
          await approve(id, 100),
          await reject(id, 100),
        ])
          assert.equal(response.code, "forbidden");
      }
      assert.equal((await rpc("pending", actor(999))).code, "forbidden");
      assert.equal((await approve(900, 999)).code, "not_found");
      assert.equal(
        (await rpc("pending", actor(900))).data.accounts.some(
          (a) => a.telegramUserId === "100"
        ),
        true
      );
      assert.equal((await approve(900, 100)).data.role, "supervisor");
      assert.equal((await reject(900, 100)).code, "not_pending");
      assert.equal((await register(100)).data.status, "active");
      for (const id of [903, 905]) {
        const before = (await rpc("me", actor(id))).data;
        assert.deepEqual((await register(id)).data, before);
        assert.equal((await approve(900, id)).code, "not_pending");
      }
      await register(110);
      assert.equal((await reject(900, 110)).data.status, "rejected");
      assert.equal((await register(110)).data.status, "rejected");
    });

    await t.test(
      "explicit Sales Force mapping, claims and concurrent decisions",
      async () => {
        await register(120);
        await register(121);
        assert.equal((await approve(900, 120, "owner")).code, "invalid");
        assert.equal((await approve(900, 120, "sales")).code, "invalid");
        assert.equal(
          (await approve(900, 120, "sales", "missing")).code,
          "sales_force_unavailable"
        );
        assert.equal(
          (await approve(900, 120, "admin", "sf-test")).code,
          "invalid"
        );
        const decisions = await Promise.all([
          approve(900, 120, "sales", "sf-test"),
          approve(900, 121, "sales", "sf-test"),
        ]);
        assert.equal(decisions.filter((r) => r.ok).length, 1);
        const winner = decisions.find((r) => r.ok).data;
        assert.equal(winner.role, "sales_force");
        assert.equal(winner.salesForceId, "sf-test");
        assert.equal(
          decisions.find((r) => !r.ok).code,
          "sales_force_unavailable"
        );
        const repeated = await Promise.all([
          approve(900, winner.telegramUserId, "admin"),
          reject(900, winner.telegramUserId),
        ]);
        assert.ok(repeated.every((r) => r.code === "not_pending"));
        await register(122);
        const same = await Promise.all([approve(900, 122), reject(900, 122)]);
        assert.equal(same.filter((r) => r.ok).length, 1);
        assert.equal(same.find((r) => !r.ok).code, "not_pending");
        // Even disabled accounts retain their claims; no reassignment policy exists.
        await db
          .prepare("UPDATE users SET status = 'disabled' WHERE id = ?")
          .bind(winner.id)
          .run();
        await register(123);
        assert.equal(
          (await approve(900, 123, "sales", "sf-test")).code,
          "sales_force_unavailable"
        );
      }
    );

    await t.test(
      "audit correctness and rollback on failed lifecycle/audit writes",
      async () => {
        const events = (await db.prepare("SELECT * FROM access_audit").all())
          .results;
        for (const event of events) {
          assert.equal(typeof event.created_at, "number");
          assert.ok(!event.before_state.includes("firstName"));
          if (event.action === "register") {
            assert.equal(event.actor_user_id, event.target_user_id);
            assert.equal(JSON.parse(event.before_state), null);
          } else {
            assert.equal(
              event.actor_user_id,
              "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
            );
            assert.equal(JSON.parse(event.before_state).status, "pending");
            assert.ok(
              ["active", "rejected"].includes(
                JSON.parse(event.after_state).status
              )
            );
          }
        }
        await register(124);
        // Fail UPDATE after audit INSERT: D1 must roll both back.
        await db
          .prepare(
            "CREATE TRIGGER fail_decision BEFORE UPDATE ON users BEGIN SELECT RAISE(ABORT, 'test failure'); END"
          )
          .run();
        const n = await count("access_audit");
        await assert.rejects(() => approve(900, 124));
        assert.equal(await count("access_audit"), n);
        assert.equal((await rpc("me", actor(124))).data.status, "pending");
        await db.prepare("DROP TRIGGER fail_decision").run();
        // Fail audit after User + identity INSERT: neither may survive.
        await db
          .prepare(
            "CREATE TRIGGER fail_audit BEFORE INSERT ON access_audit BEGIN SELECT RAISE(ABORT, 'test failure'); END"
          )
          .run();
        const users = await count("users");
        await assert.rejects(() => register(125));
        assert.equal(await count("users"), users);
        assert.equal((await rpc("me", actor(125))).data, null);
        await db.prepare("DROP TRIGGER fail_audit").run();
      }
    );

    await t.test(
      "public HTTP cannot reach named operations or spoof write identity",
      async () => {
        for (const path of [
          "/register",
          "/me",
          "/pending",
          "/approve",
          "/reject",
          "/internal/approve",
          "/users",
          "/telegram-identities",
          "/access-audit",
        ]) {
          for (const method of ["GET", "POST"])
            assert.equal(
              (
                await api.fetch("https://api" + path, {
                  method,
                  headers: {
                    "X-Telegram-User-ID": "900",
                    Authorization: "Bearer synthetic-test-secret",
                  },
                })
              ).status,
              404
            );
        }
        for (const path of ["/visits", "/stock-reports"])
          assert.equal(
            (
              await api.fetch("https://api" + path, {
                method: "POST",
                headers: { "X-Telegram-User-ID": "900" },
                body: "{}",
              })
            ).status,
            401
          );
        const sf = await (await api.fetch("https://api/sales-force")).json();
        assert.deepEqual(Object.keys(sf[0]).toSorted(), ["id", "name"]);
      }
    );

    await t.test(
      "webhook authentication, private chat, actual sender and supported updates",
      async () => {
        const before = telegramRequests;
        assert.equal(
          (await webhook(900, "/approve 123 admin", { secret: "spoofed" }))
            .status,
          401
        );
        assert.equal(telegramRequests, before);
        const audits = await count("access_audit");
        for (const chatType of ["group", "supergroup"]) {
          assert.equal(
            (await webhook(900, "/approve 123 admin", { chatType })).status,
            200
          );
          assert.match(sent.at(-1).text, /chat pribadi/);
        }
        const ignoredRequests = telegramRequests;
        for (const options of [
          { missingSender: true },
          { from: { is_bot: true } },
          { from: { id: 0 } },
          {
            update: {
              update_id: updateId++,
              callback_query: {
                id: "x",
                from: { id: 900, is_bot: false, first_name: "Test" },
                data: "/approve 123 admin",
              },
            },
          },
        ])
          assert.equal(
            (await webhook(900, "/approve 123 admin", options)).status,
            200
          );
        assert.equal(telegramRequests, ignoredRequests);
        assert.equal(await count("access_audit"), audits);
        assert.equal(
          (
            await webhook(904, "/approve 123 admin", {
              chatId: 900,
              from: { username: "admin" },
              forwarded: true,
            })
          ).status,
          200
        );
        assert.match(sent.at(-1).text, /Akses ditolak/);
        // Text and forwarded identity are not registration authority.
        assert.equal((await webhook(130, "/register 900 admin")).status, 200);
        assert.equal((await rpc("me", actor(130))).data.status, "pending");
        assert.equal((await rpc("me", actor(130))).data.role, null);
        for (const command of ["/start", "/help", "/me", "/pending"]) {
          assert.equal((await webhook(900, command)).status, 200);
        }
        await webhook(900, "/approve 130 sales");
        assert.match(sent.at(-1).text, /Format:/);
        failNotification = true;
        await webhook(900, "/approve 130 sales sf-other");
        assert.match(sent.at(-1).text, /Keputusan tersimpan/);
        assert.equal(
          (await rpc("me", actor(130))).data.salesForceId,
          "sf-other"
        );
        failNotification = false;
        await webhook(900, "/reject 123");
        assert.equal((await rpc("me", actor(123))).data.status, "rejected");
        await webhook(123, "/register");
        assert.match(sent.at(-1).text, /ditolak/);
        for (const [body, status] of [
          ["{", 400],
          [" ".repeat(128 * 1024 + 1), 413],
        ]) {
          const response = await bot.fetch("https://bot/", {
            method: "POST",
            headers: {
              "X-Telegram-Bot-Api-Secret-Token": "synthetic-test-secret",
            },
            body,
          });
          assert.equal(response.status, status);
        }
      }
    );

    await t.test(
      "permissions are current for every call, not cached in the Bot",
      async () => {
        await webhook(140, "/register");
        await webhook(900, "/approve 140 admin");
        assert.equal((await rpc("me", actor(140))).data.role, "admin");
        assert.equal((await rpc("me", actor(140))).data.salesForceId, null);
        assert.equal((await rpc("pending", actor(140))).ok, true);
        await db
          .prepare(
            "UPDATE users SET status = 'disabled' WHERE id = (SELECT user_id FROM telegram_identities WHERE telegram_user_id = '140')"
          )
          .run();
        assert.equal((await rpc("pending", actor(140))).code, "forbidden");
        assert.equal((await approve(140, 124)).code, "forbidden");
        assert.equal((await reject(140, 124)).code, "forbidden");
        await webhook(140, "/help");
        assert.doesNotMatch(sent.at(-1).text, /\/pending/);
        await webhook(140, "/start");
        assert.match(sent.at(-1).text, /dinonaktifkan/);
      }
    );

    await t.test(
      "pending keyset pages remain bounded and complete",
      async () => {
        for (let id = 200; id < 223; id++) await register(id);
        const ids = [];
        let after;
        do {
          const page = (await rpc("pending", actor(900), after ?? "")).data;
          assert.ok(page.accounts.length <= 10);
          ids.push(...page.accounts.map((a) => a.id));
          after = page.next;
        } while (after);
        assert.equal(ids.length, new Set(ids).size);
        const pending = (
          await db
            .prepare("SELECT count(*) AS n FROM users WHERE status = 'pending'")
            .first()
        ).n;
        assert.equal(ids.length, pending);
        assert.deepEqual(
          (await db.prepare("PRAGMA foreign_key_check").all()).results,
          []
        );
      }
    );
  } finally {
    await mf.dispose();
  }
});
