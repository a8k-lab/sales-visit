import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

import { hashToken } from "../src/web-auth.ts";

async function bundle(path, banner = "") {
  return (
    await build({
      entryPoints: [new URL(path, import.meta.url).pathname],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2022",
      external: ["cloudflare:workers"],
      banner: { js: banner },
    })
  ).outputFiles[0].text;
}
const clock = `const RealDate = Date; globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ['2026-06-07T18:00:00Z'])); } static now() { return new RealDate('2026-06-07T18:00:00Z').getTime(); } };`;
const apiScript = await bundle("../src/worker.ts", clock);
const botScript = await bundle("../../bot/src/index.ts", clock);
const guardScript = await bundle("./visit-guard-worker.ts", clock);
const time = await import(
  "data:text/javascript;base64," +
    Buffer.from(await bundle("../src/visits/time.ts")).toString("base64")
);

test("Jakarta actual-time policy rejects rollover, future and excessively old dates", () => {
  const now = Date.parse("2026-06-07T18:00:00Z");
  assert.equal(
    time.parseJakartaVisitTime("sekarang", now),
    "2026-06-07T18:00:00.000Z"
  );
  assert.equal(
    time.parseJakartaVisitTime("08-06-2026 00:30", now),
    "2026-06-07T17:30:00.000Z"
  );
  for (const value of [
    "31-02-2026 10:00",
    "08-06-2026 01:01",
    "01-01-2020 00:00",
    "08-06-2026 24:00",
    "2026-06-07",
    "tomorrow",
  ])
    assert.equal(time.parseJakartaVisitTime(value, now), undefined);
});

test("Visit wizard through real Workers, private RPC and persistent disposable D1", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "sales-visit-wizard-"));
  let mf;
  const sent = [];
  let failSend = false;
  async function boot() {
    mf = new Miniflare(
      convertV4MiniflareOptions({
        resourcePersistencePath: dir,
        workers: [
          {
            name: "api",
            modules: true,
            compatibilityDate: "2026-11-02",
            script: apiScript,
            d1Databases: { DB: "visit-wizard" },
          },
          {
            name: "guard",
            modules: true,
            compatibilityDate: "2026-11-02",
            script: guardScript,
            d1Databases: { DB: "visit-wizard" },
          },
          {
            name: "caller",
            modules: true,
            compatibilityDate: "2026-11-02",
            script: `export default { async fetch(r,e) { const {actor,input} = await r.json(); return Response.json(await e.IDENTITY.visitWizard(actor,input)); } };`,
            serviceBindings: {
              IDENTITY: { name: "api", entrypoint: "BotIdentity" },
            },
          },
          {
            name: "bot",
            modules: true,
            compatibilityDate: "2026-11-02",
            script: botScript,
            bindings: {
              TELEGRAM_BOT_TOKEN: "123:synthetic",
              TELEGRAM_WEBHOOK_SECRET: "synthetic",
            },
            serviceBindings: {
              IDENTITY: { name: "api", entrypoint: "BotIdentity" },
            },
            outboundService: async (req) => {
              assert.equal(new URL(req.url).hostname, "api.telegram.org");
              if (req.url.endsWith("/getMe"))
                return Response.json({
                  ok: true,
                  result: {
                    id: 123,
                    is_bot: true,
                    first_name: "Test",
                    username: "test_bot",
                  },
                });
              assert.ok(req.url.endsWith("/sendMessage"));
              const body = await req.json();
              assert.equal(body.parse_mode, undefined);
              assert.ok(body.text.length <= 4096);
              sent.push(body);
              if (failSend)
                return Response.json(
                  {
                    ok: false,
                    error_code: 403,
                    description: "Synthetic failure",
                  },
                  { status: 403 }
                );
              return Response.json({
                ok: true,
                result: {
                  message_id: sent.length,
                  date: 1,
                  chat: { id: body.chat_id, type: "private" },
                  text: body.text,
                },
              });
            },
          },
        ],
      })
    );
  }
  t.after(async () => {
    await mf?.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  await boot();
  let db = await mf.getD1Database("DB", "api");
  const migrations = new URL(
    "../../../packages/db/migrations/",
    import.meta.url
  );
  for (const file of readdirSync(migrations)
    .filter((entry) => entry.endsWith(".sql"))
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
  await db
    .prepare(
      "INSERT INTO sales_force (id,name) VALUES ('sf','SF'),('other','Other')"
    )
    .run();
  const exact = " out 日本 + ";
  await db
    .prepare(
      "INSERT INTO outlets (id,name) VALUES (?, 'Outlet <b>asli</b>'), ('out 日本 +','Alias'), ('plain','Plain')"
    )
    .bind(exact)
    .run();
  const token = "~" + Buffer.from(exact).toString("base64url");
  for (const [id, status, role, sf] of [
    [1, "active", "admin", null],
    [2, "active", "supervisor", null],
    [3, "active", "sales_force", "sf"],
    [4, "pending", null, null],
    [5, "rejected", null, null],
    [6, "disabled", "sales_force", "sf"],
    [7, "active", "sales_force", null],
    [8, "active", "sales_force", "other"],
  ])
    await db.batch([
      db
        .prepare(
          "INSERT INTO users (id,status,role,sales_force_id) VALUES (?,?,?,?)"
        )
        .bind(`u${id}`, status, role, sf),
      db
        .prepare(
          "INSERT INTO telegram_identities (user_id,telegram_user_id) VALUES (?,?)"
        )
        .bind(`u${id}`, String(id)),
    ]);
  let seq = 0;
  const update = (id, text, n = ++seq) => ({
    update_id: n,
    message: {
      message_id: n,
      date: 1,
      chat: { id, type: "private" },
      from: { id, is_bot: false, first_name: "Synthetic" },
      text,
      ...(text.startsWith("/")
        ? {
            entities: [
              {
                type: "bot_command",
                offset: 0,
                length: text.split(" ")[0].length,
              },
            ],
          }
        : {}),
    },
  });
  async function deliver(body) {
    const bot = await mf.getWorker("bot");
    return bot.fetch("https://bot/", {
      method: "POST",
      headers: {
        "X-Telegram-Bot-Api-Secret-Token": "synthetic",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }
  async function command(id, text) {
    sent.length = 0;
    const r = await deliver(update(id, text));
    assert.equal(r.status, 200, text);
    return sent.map((s) => s.text).join("\n\n");
  }
  const count = async () =>
    (await db.prepare("SELECT count(*) AS n FROM visits").first()).n;
  const draft = async (id = 3) =>
    db
      .prepare("SELECT * FROM telegram_visit_drafts WHERE user_id = ?")
      .bind(`u${id}`)
      .first();
  async function review(
    id = 3,
    outlet = token,
    notes = "catatan lewati",
    follow = "tindaklanjut lewati"
  ) {
    await command(id, "/salesvisit");
    await command(id, `outlet ${outlet}`);
    await command(id, "waktu 08-06-2026 00:30");
    await command(id, notes);
    return command(id, follow);
  }

  await t.test(
    "roles/status/link denied; ordinary text and schedules never create Visits",
    async () => {
      for (const id of [1, 2, 4, 5, 6, 7, 99]) {
        assert.match(await command(id, "/salesvisit"), /Akses ditolak/);
        assert.match(await command(id, "/konfirmasi"), /Akses ditolak/);
        assert.equal(await draft(id), null);
      }
      await command(3, "hello ordinary message");
      await command(3, "/jadwal semua");
      await command(3, "/konfirmasi");
      assert.equal(await draft(), null);
      assert.equal(await count(), 0);
    }
  );
  await t.test(
    "validated steps, exact IDs, duplicate updates, restart, preview and optional skipping",
    async () => {
      const start = update(3, "/salesvisit");
      await deliver(start);
      const key = (await draft()).submission_key;
      await deliver(start);
      assert.equal((await draft()).submission_key, key);
      assert.match(await command(3, "/salesvisit"), /1\/5/);
      assert.equal((await draft()).submission_key, key);
      assert.match(await command(3, "outlet unknown"), /tidak ditemukan/);
      assert.equal((await draft()).step, "outlet");
      const answer = update(3, `outlet ${token}`);
      await Promise.all([deliver(answer), deliver(answer)]);
      assert.equal((await draft()).step, "time");
      assert.equal(JSON.parse((await draft()).payload).outletId, exact);
      await mf.dispose();
      await boot();
      db = await mf.getD1Database("DB", "api");
      assert.equal((await draft()).submission_key, key);
      assert.match(await command(3, "/salesvisit"), /2\/5/);
      for (const value of [
        "31-02-2026 00:00",
        "08-06-2026 02:00",
        "01-01-2020 00:00",
      ]) {
        assert.match(await command(3, `waktu ${value}`), /belum sesuai/);
        assert.equal((await draft()).step, "time");
      }
      await command(3, "waktu 08-06-2026 00:30");
      const revision = (await draft()).revision;
      await deliver(answer); // out-of-order old step answer
      assert.equal((await draft()).revision, revision);
      const note = update(3, "catatan lewati");
      await Promise.all([deliver(note), deliver(note)]);
      assert.equal((await draft()).step, "followUp");
      assert.match(
        await command(3, "catatan stale second note"),
        /belum sesuai/
      );
      assert.match(await command(3, "tindaklanjut lewati"), /5\/5/);
      assert.equal(
        JSON.parse((await draft()).payload).visitedAt,
        "2026-06-07T17:30:00.000Z"
      );
      assert.equal(await count(), 0);
      assert.match(await command(3, "/help"), /salesvisit/);
      assert.match(await command(3, "/me"), /sales_force/);
      assert.equal((await draft()).step, "review");
      const confirmations = [
        update(3, "/konfirmasi"),
        update(3, "/konfirmasi"),
      ];
      assert.deepEqual(
        (await Promise.all(confirmations.map(deliver))).map((r) => r.status),
        [200, 200]
      );
      assert.equal(await count(), 1);
      const saved = await db.prepare("SELECT * FROM visits").first();
      assert.equal(saved.outlet_id, exact);
      assert.equal(saved.sales_force_id, "sf");
      assert.equal(saved.submission_channel, "telegram");
      assert.equal(saved.notes, null);
      assert.equal(saved.follow_up, null);
      // A real webhook -> Bot RPC -> D1 Visit is visible through the deployed
      // HTTP read handler, not through fixtures or a browser-local adapter.
      const api = await mf.getWorker("api");
      for (const [id, credential] of [
        ["u1", "a".repeat(64)],
        ["u2", "b".repeat(64)],
      ]) {
        await db
          .prepare(
            "INSERT INTO web_sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)"
          )
          .bind(
            await hashToken(credential),
            id,
            Date.parse("2026-06-07T17:00:00Z"),
            Date.parse("2026-06-08T17:00:00Z")
          )
          .run();
      }
      const overview = async (credential) => {
        const response = await api.fetch("https://api/dashboard/overview", {
          headers: { Authorization: `Bearer ${credential}` },
        });
        assert.equal(response.status, 200);
        return response.json();
      };
      assert.equal((await overview("b".repeat(64))).metrics.visits, 0);
      await db
        .prepare(
          "INSERT INTO sales_force_supervisors (sales_force_id,supervisor_user_id) VALUES ('sf','u2')"
        )
        .run();
      for (const credential of ["a".repeat(64), "b".repeat(64)]) {
        const data = await overview(credential);
        assert.equal(data.metrics.visits, 1);
        assert.equal(data.metrics.stockReports, 0);
        assert.equal(data.recentVisits[0].id, saved.id);
        assert.equal(data.recentVisits[0].submissionChannel, "telegram");
        assert.equal(data.dailyVisits.at(-1).count, 1);
      }
      assert.match(await command(3, "/konfirmasi"), /berhasil tersimpan/);
      assert.match(await command(3, "/batal"), /berhasil tersimpan/);
      assert.equal(await count(), 1);
    }
  );
  await t.test(
    "Visit commit then Telegram failure; same update and later confirmation replay receipt",
    async () => {
      assert.match(
        await review(
          3,
          "plain",
          "catatan <script> & catatan",
          "tindaklanjut Hubungi besok"
        ),
        /<script>/
      );
      const confirm = update(3, "/konfirmasi");
      failSend = true;
      assert.equal((await deliver(confirm)).status, 500);
      failSend = false;
      assert.equal(await count(), 2);
      assert.equal((await draft()).step, "submitted");
      assert.equal((await deliver(confirm)).status, 200);
      await command(3, "/konfirmasi");
      assert.equal(await count(), 2);
      await db
        .prepare("UPDATE users SET status = 'disabled' WHERE id = 'u3'")
        .run();
      assert.match(await command(3, "/konfirmasi"), /Akses ditolak/);
      assert.equal(await count(), 2);
      await db
        .prepare("UPDATE users SET status = 'active' WHERE id = 'u3'")
        .run();
      assert.match(await command(3, "/konfirmasi"), /berhasil tersimpan/);
    }
  );
  await t.test(
    "Visit commit then failed draft finalization; restart and original update recover",
    async () => {
      await review();
      await db
        .prepare(
          "CREATE TRIGGER fail_receipt BEFORE UPDATE OF step ON telegram_visit_drafts WHEN NEW.step = 'submitted' BEGIN SELECT RAISE(ABORT, 'synthetic finalize fault'); END"
        )
        .run();
      const confirm = update(3, "/konfirmasi");
      assert.equal((await deliver(confirm)).status, 500);
      assert.equal(await count(), 3);
      assert.equal((await draft()).step, "submitting");
      await db.prepare("DROP TRIGGER fail_receipt").run();
      await mf.dispose();
      await boot();
      db = await mf.getD1Database("DB", "api");
      assert.equal((await deliver(confirm)).status, 200);
      assert.equal((await draft()).step, "submitted");
      assert.equal(await count(), 3);
    }
  );
  await t.test(
    "revocation, reassignment and disabled replay never attribute a Visit to a new SF",
    async () => {
      await review();
      await db
        .prepare("UPDATE users SET sales_force_id = 'other' WHERE id = 'u3'")
        .run();
      assert.match(
        await command(3, "/konfirmasi"),
        /Tautan Sales Force berubah/
      );
      assert.equal(await count(), 3);
      await command(3, "/batal");
      assert.equal((await draft()).step, "cancelled");
      await db
        .prepare("UPDATE users SET sales_force_id = 'sf' WHERE id = 'u3'")
        .run();
      await review();
      for (const sql of [
        "UPDATE users SET status = 'disabled' WHERE id = 'u3'",
        "UPDATE users SET status = 'active', sales_force_id = NULL WHERE id = 'u3'",
        "UPDATE users SET sales_force_id = 'sf', role = 'supervisor' WHERE id = 'u3'",
      ]) {
        await db.prepare(sql).run();
        assert.match(await command(3, "/konfirmasi"), /Akses ditolak/);
        assert.equal(await count(), 3);
      }
      await db
        .prepare("UPDATE users SET role = 'sales_force' WHERE id = 'u3'")
        .run();
      await command(3, "/batal");
    }
  );
  await t.test(
    "cancel at every editable step, expiry, unknown/deleted Outlet, limits and privacy",
    async () => {
      const answers = [
        `outlet ${token}`,
        "waktu sekarang",
        "catatan lewati",
        "tindaklanjut lewati",
      ];
      for (let step = 0; step <= answers.length; step++) {
        await command(3, "/salesvisit");
        for (const answer of answers.slice(0, step)) await command(3, answer);
        assert.match(await command(3, "/batal"), /Draf dibatalkan/);
        assert.equal((await draft()).step, "cancelled");
        assert.equal(await count(), 3);
      }
      await command(3, "/salesvisit");
      await db
        .prepare(
          "UPDATE telegram_visit_drafts SET expires_at = 1 WHERE user_id = 'u3'"
        )
        .run();
      assert.match(await command(3, `outlet ${token}`), /kedaluwarsa/);
      await command(3, "/salesvisit");
      await command(3, `outlet ${token}`);
      await command(3, "waktu sekarang");
      assert.match(
        await command(3, "catatan " + "x".repeat(1001)),
        /belum sesuai/
      );
      assert.equal((await draft()).step, "notes");
      await command(3, "/batal");
      await db
        .prepare("INSERT INTO outlets (id,name) VALUES ('deletable','Deleted')")
        .run();
      await review(3, "deletable");
      await db.prepare("DELETE FROM outlets WHERE id = 'deletable'").run();
      assert.match(await command(3, "/konfirmasi"), /tidak ditemukan/);
      assert.equal((await draft()).step, "submitting");
      assert.match(await command(3, "/batal"), /Draf dibatalkan/);
      await review();
      const snapshot = await draft();
      assert.match(await command(8, "/konfirmasi"), /Tidak ada draf/);
      await command(8, "/salesvisit");
      await command(8, "/batal");
      assert.deepEqual(await draft(), snapshot);
      const caller = await mf.getWorker("caller");
      const rpc = async (input) =>
        (
          await caller.fetch("https://caller/", {
            method: "POST",
            body: JSON.stringify({ actor: { telegramUserId: "8" }, input }),
          })
        ).json();
      assert.equal(
        (await rpc({ action: "confirm", messageId: ++seq, userId: "u3" })).code,
        "invalid"
      );
      assert.equal(
        (await rpc({ action: "confirm", messageId: ++seq, salesForceId: "sf" }))
          .code,
        "invalid"
      );
      assert.equal(await count(), 3);
      await command(3, "/batal");
    }
  );
  await t.test(
    "database guard defeats a stale active identity between preflight and insertion",
    async () => {
      await review();
      await db
        .prepare(
          "UPDATE telegram_visit_drafts SET step = 'submitting' WHERE user_id = 'u3'"
        )
        .run();
      const guard = await mf.getWorker("guard");
      assert.equal((await guard.fetch("https://guard/")).status, 401);
      assert.equal(await count(), 3);
      assert.equal((await draft()).step, "submitting");
      assert.match(await command(3, "/konfirmasi"), /Akses ditolak/);
      await db
        .prepare("UPDATE users SET status = 'active' WHERE id = 'u3'")
        .run();
      await command(3, "/batal");
      assert.equal((await draft()).step, "cancelled");
    }
  );
  await t.test(
    "public writes stay denied, registration and planning commands preserved",
    async () => {
      const api = await mf.getWorker("api");
      for (const path of ["/visits", "/stock-reports"])
        assert.equal(
          (
            await api.fetch(`https://api${path}`, {
              method: "POST",
              headers: { "X-Telegram-User-Id": "3", "X-Sales-Force-Id": "sf" },
              body: "{}",
            })
          ).status,
          401
        );
      assert.equal(
        (await api.fetch("https://api/visitWizard", { method: "POST" })).status,
        404
      );
      assert.match(await command(99, "/register"), /pending/);
      assert.match(await command(1, "/outlets"), /Outlet/);
      assert.match(
        await command(1, "/jadwalsales"),
        /[Jj]adwal|rencana|penugasan/
      );
      assert.equal(await count(), 3);
      assert.deepEqual(
        (await db.prepare("PRAGMA foreign_key_check").all()).results,
        []
      );
    }
  );
  await t.test(
    "concurrent distinct answers cannot cross steps; confirmation/cancel races serialize",
    async () => {
      await command(3, "/salesvisit");
      await command(3, "outlet plain");
      await command(3, "waktu sekarang");
      const answers = [
        update(3, "catatan Pertama"),
        update(3, "catatan Kedua"),
      ];
      await Promise.all(answers.map(deliver));
      assert.equal((await draft()).step, "followUp");
      assert.ok(
        ["Pertama", "Kedua"].includes(JSON.parse((await draft()).payload).notes)
      );
      assert.equal(JSON.parse((await draft()).payload).followUp, undefined);
      await command(3, "tindaklanjut lewati");
      const before = await count();
      await Promise.all([
        deliver(update(3, "/konfirmasi")),
        deliver(update(3, "/batal")),
      ]);
      const state = (await draft()).step;
      assert.ok(["cancelled", "submitted", "submitting"].includes(state));
      await command(3, "/konfirmasi");
      const after = await count();
      assert.ok(after === before || after === before + 1);
      await command(3, "/konfirmasi");
      assert.equal(await count(), after);
      await db
        .prepare("UPDATE users SET status = 'disabled' WHERE id = 'u3'")
        .run();
      assert.match(await command(3, "/konfirmasi"), /Akses ditolak/);
      assert.equal(await count(), after);
      await db
        .prepare("UPDATE users SET status = 'active' WHERE id = 'u3'")
        .run();
    }
  );
});
