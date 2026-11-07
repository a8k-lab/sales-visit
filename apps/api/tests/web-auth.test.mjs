import assert from "node:assert/strict";
import { readdirSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { getPlatformProxy } from "wrangler";

import { createApp } from "../src/index.ts";
import { hashToken, verifyTelegram } from "../src/web-auth.ts";

const clientId = "123456";
const { privateKey, publicKey } = await generateKeyPair("RS256");
const keys = createLocalJWKSet({
  keys: [
    { ...(await exportJWK(publicKey)), kid: "test", alg: "RS256", use: "sig" },
  ],
});
const invalidIds = [
  undefined,
  null,
  true,
  false,
  {},
  [],
  [1001],
  "",
  "0",
  "00",
  "01001",
  " 1001",
  "1001 ",
  "1001\n",
  "1001\r\n",
  "-1001",
  "+1001",
  "1001.0",
  "1.001e3",
  "1e3",
  "NaN",
  "Infinity",
  "１００１",
  "1001x",
  0,
  -0,
  -1,
  1.5,
  Number.MAX_SAFE_INTEGER + 1,
];
const nonce = "a".repeat(64);
const now = () => Math.floor(Date.now() / 1000);
function sign(claims = {}, key = privateKey, alg = "RS256") {
  return new SignJWT({
    iss: "https://oauth.telegram.org",
    aud: clientId,
    sub: "NOT-THE-TELEGRAM-ID",
    iat: now(),
    exp: now() + 300,
    nonce,
    id: 1001,
    ...claims,
  })
    .setProtectedHeader({ alg, kid: "test" })
    .sign(key);
}

test("Telegram proof validates official claims using local JWKS, never sub", async (t) => {
  assert.deepEqual(await verifyTelegram(await sign(), clientId, keys), {
    telegramId: "1001",
    nonce,
  });
  for (const id of [
    "1001",
    1001,
    "1",
    1,
    Number.MAX_SAFE_INTEGER,
    String(Number.MAX_SAFE_INTEGER),
    "9007199254740993",
  ]) {
    assert.deepEqual(await verifyTelegram(await sign({ id }), clientId, keys), {
      telegramId: String(id),
      nonce,
    });
  }
  for (const id of invalidIds)
    await assert.rejects(verifyTelegram(await sign({ id }), clientId, keys));
  for (const [name, claims] of [
    ["issuer", { iss: "https://attacker.invalid" }],
    ["audience", { aud: "other" }],
    ["expired", { exp: now() - 60 }],
    ["future issued", { iat: now() + 61 }],
    ["old issued", { iat: now() - 400 }],
    ["missing issued", { iat: undefined }],
    ["missing expiry", { exp: undefined }],
    ["missing ID", { id: undefined }],
    ["string issued", { iat: String(now()) }],
    ["string expiry", { exp: String(now() + 300) }],
    ["null issued", { iat: null }],
    ["null expiry", { exp: null }],
    ["not yet valid", { nbf: now() + 61 }],
    ["negative ID", { id: -1 }],
    ["zero ID", { id: 0 }],
    ["fractional ID", { id: 1.5 }],
    ["unsafe ID", { id: Number.MAX_SAFE_INTEGER + 1 }],
    ["missing nonce", { nonce: undefined }],
    ["malformed nonce", { nonce: "x" }],
  ])
    await t.test(name, async () =>
      assert.rejects(
        verifyTelegram(await sign({ id: "1001", ...claims }), clientId, keys)
      )
    );
  const other = await generateKeyPair("RS256");
  await assert.rejects(
    verifyTelegram(await sign({ id: "1001" }, other.privateKey), clientId, keys)
  );
  await assert.rejects(
    verifyTelegram(
      await sign(
        { id: "1001" },
        new TextEncoder().encode("synthetic-test-key"),
        "HS256"
      ),
      clientId,
      keys
    )
  );
});

test("JWT timestamps retain 30s skew and 5m maximum age", async (t) => {
  const fixed = new Date("2026-11-15T12:00:00Z");
  const seconds = fixed.getTime() / 1000;
  t.mock.timers.enable({ apis: ["Date"], now: fixed });
  t.after(() => t.mock.timers.reset());
  for (const claims of [
    { iat: seconds, exp: seconds + 300 },
    { iat: seconds + 30, exp: seconds + 300 },
    { iat: seconds - 330, exp: seconds + 300 },
    { iat: seconds - 60, exp: seconds - 29 },
  ])
    await verifyTelegram(await sign({ id: "1001", ...claims }), clientId, keys);
  for (const claims of [
    { exp: seconds - 30 },
    { exp: seconds - 31 },
    { iat: seconds + 31 },
    { iat: seconds - 331, exp: seconds + 300 },
  ])
    await assert.rejects(
      verifyTelegram(await sign({ id: "1001", ...claims }), clientId, keys)
    );
});

test("Web sessions and authorized reads on disposable local D1", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "web-auth-"));
  const proxy = await getPlatformProxy({
    configPath: new URL("../wrangler.jsonc", import.meta.url).pathname,
    persist: { path: dir },
  });
  t.after(async () => {
    await proxy.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
  const env = {
    ...proxy.env,
    TELEGRAM_CLIENT_ID: clientId,
    WEB_ORIGINS: "https://dashboard.example,http://localhost:5173",
    // Proof/session tests isolate auth from native approximate rate counters.
    AUTH_IP_LIMITER: { limit: async () => ({ success: true }) },
    AUTH_GLOBAL_LIMITER: { limit: async () => ({ success: true }) },
  };
  const db = env.DB;
  const sql = async (text) =>
    db.batch(
      text
        .replace(/^\s*--.*$/gm, "")
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => db.prepare(s))
    );
  const migrations = new URL(
    "../../../packages/db/migrations/",
    import.meta.url
  );
  for (const file of readdirSync(migrations)
    .filter((f) => f.endsWith(".sql"))
    .toSorted())
    await sql(readFileSync(new URL(file, migrations), "utf8"));
  await sql(
    readFileSync(new URL("../seeds/local.sql", import.meta.url), "utf8")
  );
  const app = createApp(undefined, keys);
  const request = (
    path,
    { token, origin, method = "GET", body, headers = {} } = {}
  ) =>
    app.request(
      path,
      {
        method,
        headers: {
          "CF-Connecting-IP": "203.0.113.10",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(origin ? { Origin: origin } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
      env
    );
  const post = (path, body, token) =>
    request(path, { method: "POST", body, token });
  const challenge = async () => (await post("/auth/challenge")).json();
  const login = async (id = 1001, claims = {}) => {
    const ch = await challenge();
    return post("/auth/telegram", {
      challenge: ch.challenge,
      idToken: await sign({ id, nonce: ch.nonce, ...claims }),
    });
  };
  for (const [id, role, status, sf] of [
    [1001, "admin", "active", null],
    [1002, "supervisor", "active", null],
    [1003, "sales_force", "active", "sf-01"],
    [1004, null, "pending", null],
    [1005, null, "rejected", null],
    [1006, "admin", "disabled", null],
    [1007, "sales_force", "active", null],
  ]) {
    await db
      .prepare(
        "INSERT INTO users (id, role, status, sales_force_id) VALUES (?, ?, ?, ?)"
      )
      .bind(`u${id}`, role, status, sf)
      .run();
    await db
      .prepare(
        "INSERT INTO telegram_identities (user_id, telegram_user_id) VALUES (?, ?)"
      )
      .bind(`u${id}`, String(id))
      .run();
  }
  await t.test(
    "public health, config fails closed, sanitized malformed login",
    async () => {
      assert.equal((await request("/health")).status, 200);
      assert.equal(
        (
          await app.request(
            "/auth/config",
            {},
            { ...env, TELEGRAM_CLIENT_ID: "" }
          )
        ).status,
        503
      );
      assert.deepEqual(await (await request("/auth/config")).json(), {
        clientId: Number(clientId),
        scope: ["profile"],
      });
      assert.equal(
        (
          await post("/auth/telegram", {
            idToken: "sensitive",
            challenge: "bad",
          })
        ).status,
        400
      );
      assert.equal(
        (
          await post("/auth/telegram", {
            idToken: "sensitive",
            challenge: nonce,
          })
        ).status,
        401
      );
      assert.equal(
        (
          await post("/auth/telegram", {
            idToken: "sensitive",
            challenge: nonce,
          })
        ).status,
        401
      );
      assert.doesNotMatch(
        await (
          await post("/auth/telegram", {
            idToken: "sensitive",
            challenge: nonce,
          })
        ).text(),
        /sensitive|jwt|signature|SQL/i
      );
    }
  );
  await t.test(
    "fresh signed string ID authenticates the existing Admin",
    async () => {
      const response = await login("1001");
      assert.equal(response.status, 200);
      const session = await response.json();
      assert.equal(session.account.id, "u1001");
      assert.equal(session.account.role, "admin");
      assert.equal(
        (await request("/auth/me", { token: session.token })).status,
        200
      );
    }
  );
  await t.test(
    "signed invalid IDs fail without consuming a challenge or issuing sessions",
    async () => {
      const ch = await challenge();
      const countSessions = () =>
        db.prepare("SELECT count(*) AS count FROM web_sessions").first();
      const before = await countSessions();
      for (const id of invalidIds) {
        const response = await post("/auth/telegram", {
          challenge: ch.challenge,
          idToken: await sign({ id, nonce: ch.nonce }),
        });
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), { error: "Login failed" });
        assert.equal(response.headers.get("Cache-Control"), "no-store");
      }
      assert.deepEqual(await countSessions(), before);
      assert.equal(
        (
          await db
            .prepare(
              "SELECT consumed_at FROM web_login_challenges WHERE id = ?"
            )
            .bind(ch.challenge)
            .first()
        ).consumed_at,
        null
      );
      // Expired and over-age string-ID proofs also leave the challenge usable.
      for (const claims of [{ exp: now() - 60 }, { iat: now() - 400 }]) {
        const response = await post("/auth/telegram", {
          challenge: ch.challenge,
          idToken: await sign({ id: "1001", nonce: ch.nonce, ...claims }),
        });
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), { error: "Login failed" });
      }
      assert.deepEqual(await countSessions(), before);
      assert.equal(
        (
          await post("/auth/telegram", {
            challenge: ch.challenge,
            idToken: await sign({ id: "1001", nonce: ch.nonce }),
          })
        ).status,
        200
      );
    }
  );
  await t.test(
    "all business reads need a session, HTTP writes still denied",
    async () => {
      for (const path of [
        "/sales-force",
        "/outlets",
        "/products",
        "/visits",
        "/visits/VST-0010",
        "/stock-reports",
      ])
        assert.equal((await request(path)).status, 401);
      for (const path of [
        "/sales-force",
        "/outlets",
        "/products",
        "/visits",
        "/visits/VST-0010",
        "/stock-reports",
      ])
        assert.equal((await request(path, { method: "HEAD" })).status, 401);
      for (const path of ["/visits", "/stock-reports"])
        assert.equal((await post(path, {})).status, 401);
    }
  );
  await t.test(
    "no nonexistent or unapproved account authenticates",
    async () => {
      for (const id of [
        9999,
        1004,
        1005,
        1006,
        1007,
        "9999",
        "1004",
        "1005",
        "1006",
        "1007",
      ]) {
        const res = await login(id);
        assert.equal(res.status, 401);
        assert.deepEqual(await res.json(), { error: "Login failed" });
      }
    }
  );
  await t.test(
    "wrong nonce, expired and concurrently replayed challenge",
    async () => {
      let ch = await challenge();
      assert.equal(
        (
          await post("/auth/telegram", {
            challenge: ch.challenge,
            idToken: await sign({ id: "1001" }),
          })
        ).status,
        401
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT consumed_at FROM web_login_challenges WHERE id = ?"
            )
            .bind(ch.challenge)
            .first()
        ).consumed_at,
        null
      );
      await db
        .prepare(
          "UPDATE web_login_challenges SET expires_at = created_at + 1 WHERE id = ?"
        )
        .bind(ch.challenge)
        .run();
      await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(
        (
          await post("/auth/telegram", {
            challenge: ch.challenge,
            idToken: await sign({ nonce: ch.nonce }),
          })
        ).status,
        401
      );
      ch = await challenge();
      const payload = {
        challenge: ch.challenge,
        idToken: await sign({ id: "1001", nonce: ch.nonce }),
      };
      const results = await Promise.all([
        post("/auth/telegram", payload),
        post("/auth/telegram", payload),
      ]);
      assert.deepEqual(results.map((r) => r.status).toSorted(), [200, 401]);
      assert.equal((await post("/auth/telegram", payload)).status, 401);
    }
  );
  const admin = await (await login()).json();
  const supervisor = await (await login(1002)).json();
  const sf = await (await login(1003)).json();
  assert.equal(admin.account.role, "admin");
  assert.equal(supervisor.account.role, "supervisor");
  assert.equal(sf.account.role, "sales_force");
  await t.test(
    "stored session is hashed, expiration revocation and logout",
    async () => {
      const row = await db
        .prepare("SELECT * FROM web_sessions WHERE token_hash = ?")
        .bind(await hashToken(admin.token))
        .first();
      assert.ok(row);
      assert.notEqual(row.token_hash, admin.token);
      assert.equal(row.expires_at - row.created_at, 3600000);
      await assert.rejects(
        db
          .prepare(
            "INSERT INTO web_sessions (token_hash,user_id,created_at,expires_at) VALUES ('raw-token','u1001',1,2)"
          )
          .run()
      );
      await assert.rejects(
        db
          .prepare(
            "INSERT INTO web_sessions (token_hash,user_id,created_at,expires_at) VALUES (?, 'missing-user',1,2)"
          )
          .bind("f".repeat(64))
          .run()
      );
      await assert.rejects(
        db
          .prepare(
            "INSERT INTO web_sessions (token_hash,user_id,created_at,expires_at) VALUES (?, 'u1001',2,1)"
          )
          .bind("f".repeat(64))
          .run()
      );
      const temp = await (await login()).json();
      assert.equal((await post("/auth/logout", {}, temp.token)).status, 200);
      assert.equal(
        (await request("/auth/me", { token: temp.token })).status,
        401
      );
      const expired = await (await login()).json();
      await db
        .prepare(
          "UPDATE web_sessions SET expires_at = created_at + 1 WHERE token_hash = ?"
        )
        .bind(await hashToken(expired.token))
        .run();
      assert.equal(
        (await request("/auth/me", { token: expired.token })).status,
        401
      );
    }
  );
  await t.test(
    "Admin/Supervisor monitoring reads, bounded pages and no sensitive columns",
    async () => {
      for (const token of [admin.token, supervisor.token])
        for (const path of [
          "/sales-force",
          "/outlets",
          "/products",
          "/visits",
          "/visits/VST-0010",
          "/stock-reports",
        ]) {
          const response = await request(path, { token });
          assert.equal(response.status, 200);
          assert.equal(response.headers.get("Cache-Control"), "no-store");
          assert.doesNotMatch(
            await response.text(),
            /telegram_user_id|token_hash|access_audit|consumed_at/
          );
        }
      assert.equal(
        (
          await (
            await request("/visits?limit=1", { token: admin.token })
          ).json()
        ).length,
        1
      );
      for (const query of ["limit=101", "limit=0", "offset=-1", "limit=no"])
        assert.equal(
          (await request(`/visits?${query}`, { token: admin.token })).status,
          400
        );
      for (const path of ["/visits", "/stock-reports"])
        assert.equal((await post(path, {}, admin.token)).status, 401);
    }
  );
  await t.test(
    "Sales Force isolation and detail enumeration fail closed",
    async () => {
      assert.equal(
        (await request("/sales-force", { token: sf.token })).status,
        403
      );
      assert.equal(
        (await request("/visits?salesForceId=sf-02", { token: sf.token }))
          .status,
        403
      );
      assert.equal(
        (
          await request("/stock-reports?reporterSalesForceId=sf-02", {
            token: sf.token,
          })
        ).status,
        403
      );
      const visits = await (
        await request("/visits", { token: sf.token })
      ).json();
      assert.ok(visits.length);
      assert.ok(visits.every((v) => v.salesForceId === "sf-01"));
      const all = await (
        await request("/visits", { token: admin.token })
      ).json();
      for (const visit of all)
        assert.equal(
          (await request(`/visits/${visit.id}`, { token: sf.token })).status,
          visit.salesForceId === "sf-01" ? 200 : 404
        );
      const reports = await (
        await request("/stock-reports", { token: sf.token })
      ).json();
      assert.ok(reports.length);
      assert.ok(reports.every((r) => r.reporterSalesForceId === "sf-01"));
      for (const path of ["/outlets", "/products"])
        assert.equal((await request(path, { token: sf.token })).status, 200);
      // Another reporter may attach a report to this visitor's Visit; do not leak it.
      await db
        .prepare(
          "INSERT INTO stock_reports (id,outlet_id,reporter_sales_force_id,visit_id,reported_at,submission_channel) VALUES ('cross-report', ?, 'sf-02', ?, ?, 'telegram')"
        )
        .bind(visits[0].outletId, visits[0].id, Date.now())
        .run();
      const detail = await (
        await request(`/visits/${visits[0].id}`, { token: sf.token })
      ).json();
      assert.ok(
        detail.stockReports.every((r) => r.reporterSalesForceId === "sf-01")
      );
    }
  );
  await t.test(
    "live disable, role and Sales Force association changes",
    async () => {
      for (const status of ["pending", "rejected", "disabled"]) {
        await db
          .prepare("UPDATE users SET status = ? WHERE id = 'u1001'")
          .bind(status)
          .run();
        assert.equal(
          (await request("/visits", { token: admin.token })).status,
          401
        );
      }
      assert.equal((await post("/auth/logout", {}, admin.token)).status, 200);
      await db
        .prepare("UPDATE users SET status = 'active' WHERE id = 'u1001'")
        .run();
      assert.equal(
        (await request("/visits", { token: admin.token })).status,
        401
      );
      admin.token = (await (await login()).json()).token;
      await db
        .prepare(
          "UPDATE users SET status = 'active', role = 'supervisor' WHERE id = 'u1001'"
        )
        .run();
      assert.equal(
        (await (await request("/auth/me", { token: admin.token })).json())
          .account.role,
        "supervisor"
      );
      await db
        .prepare("UPDATE users SET sales_force_id = 'sf-02' WHERE id = 'u1003'")
        .run();
      assert.ok(
        (await (await request("/visits", { token: sf.token })).json()).every(
          (v) => v.salesForceId === "sf-02"
        )
      );
      await db
        .prepare("UPDATE users SET sales_force_id = NULL WHERE id = 'u1003'")
        .run();
      assert.equal((await request("/visits", { token: sf.token })).status, 401);
      await db
        .prepare(
          "UPDATE users SET sales_force_id = 'sf-02' WHERE id IN ('u1003','u1007')"
        )
        .run();
      assert.equal((await request("/visits", { token: sf.token })).status, 401);
      assert.equal((await login(1003)).status, 401);
      await db
        .prepare(
          "UPDATE users SET sales_force_id = NULL, role = 'admin' WHERE id = 'u1003'"
        )
        .run();
      assert.equal(
        (await request("/sales-force", { token: sf.token })).status,
        200
      );
    }
  );
  await t.test(
    "exact CORS allowlist, preflights and no Origin does not bypass authentication",
    async () => {
      for (const origin of [
        "https://dashboard.example",
        "http://localhost:5173",
      ]) {
        const res = await request("/auth/me", {
          origin,
          method: "OPTIONS",
          headers: {
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization,content-type",
          },
        });
        assert.equal(res.status, 204);
        assert.equal(res.headers.get("Access-Control-Allow-Origin"), origin);
        assert.equal((await request("/visits", { origin })).status, 401);
      }
      for (const origin of [
        "https://evil.example",
        "https://dashboard.example.evil",
        "null",
      ])
        assert.equal((await request("/health", { origin })).status, 403);
      assert.equal((await request("/visits")).status, 401);
      assert.equal(
        (
          await request("/visits", {
            origin: "https://dashboard.example",
            method: "OPTIONS",
            headers: { "Access-Control-Request-Method": "DELETE" },
          })
        ).status,
        403
      );
      assert.equal(
        (
          await request("/visits", {
            origin: "https://dashboard.example",
            method: "OPTIONS",
            headers: {
              "Access-Control-Request-Method": "GET",
              "Access-Control-Request-Headers": "x-unapproved",
            },
          })
        ).status,
        403
      );
    }
  );
});
