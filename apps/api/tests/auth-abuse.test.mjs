import assert from "node:assert/strict";
import test from "node:test";

import { getPlatformProxy } from "wrangler";

import { createApp } from "../src/index.ts";

test("Wrangler exposes usable native local rate bindings without remote resources", async (t) => {
  const proxy = await getPlatformProxy({
    configPath: new URL("../wrangler.jsonc", import.meta.url).pathname,
    persist: false,
  });
  t.after(() => proxy.dispose());
  for (const name of ["AUTH_IP_LIMITER", "AUTH_GLOBAL_LIMITER"]) {
    const limiter = proxy.env[name];
    const key = `local-binding-check:${crypto.randomUUID()}`;
    assert.equal((await limiter.limit({ key })).success, true);
    // Native counters are approximate/asynchronous, especially under parallel
    // workerd tests. Exact refusal behavior is tested deterministically below,
    // not by asserting a strict native request-count threshold.
    assert.equal(typeof (await limiter.limit({ key })).success, "boolean");
  }
});

const ip = "203.0.113.7";
const app = createApp();
function fixture() {
  const calls = [];
  const env = {
    TELEGRAM_CLIENT_ID: "123456",
    WEB_ORIGINS: "https://web.example",
    AUTH_IP_LIMITER: {
      limit: async (input) => {
        calls.push(["ip", input.key]);
        return { success: true };
      },
    },
    AUTH_GLOBAL_LIMITER: {
      limit: async (input) => {
        calls.push(["global", input.key]);
        return { success: true };
      },
    },
    DB: {
      batch: async () => {
        calls.push(["db"]);
        return [];
      },
      prepare: () => ({ bind: () => ({}) }),
    },
  };
  const request = (path, headers = {}, bindings = env) =>
    app.request(
      path,
      {
        method: "POST",
        headers: {
          "CF-Connecting-IP": ip,
          Origin: "https://web.example",
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          idToken: "sensitive-proof",
          challenge: "a".repeat(64),
        }),
      },
      bindings
    );
  return { env, calls, request };
}
test("auth endpoints consume shared IP and aggregate budgets before sensitive work", async () => {
  const { request, calls } = fixture();
  assert.equal((await request("/auth/challenge")).status, 200);
  assert.deepEqual(
    calls.map((call) => call[0]),
    ["ip", "global", "db"]
  );
  calls.length = 0;
  assert.equal((await request("/auth/telegram")).status, 401);
  assert.deepEqual(
    calls.map((call) => call[0]),
    ["ip", "global"]
  );
});
test("IP or aggregate limits return safe no-store CORS-compatible 429s without D1/JWKS", async () => {
  for (const name of ["AUTH_IP_LIMITER", "AUTH_GLOBAL_LIMITER"])
    for (const path of ["/auth/challenge", "/auth/telegram"]) {
      const { env, request, calls } = fixture();
      env[name] = { limit: async () => ({ success: false }) };
      const response = await request(path);
      assert.equal(response.status, 429);
      assert.deepEqual(await response.json(), { error: "Too many requests" });
      assert.equal(response.headers.get("Retry-After"), "60");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(
        response.headers.get("Access-Control-Allow-Origin"),
        "https://web.example"
      );
      assert.ok(!calls.some((call) => call[0] === "db"));
    }
});
test("missing/failing/malformed limiter configuration fails closed and sanitized", async () => {
  for (const name of ["AUTH_IP_LIMITER", "AUTH_GLOBAL_LIMITER"])
    for (const limiter of [
      undefined,
      null,
      {},
      {
        limit: async () => {
          throw new Error("sensitive-internal-value");
        },
      },
      { limit: async () => null },
      { limit: async () => ({ success: "true" }) },
    ]) {
      const { env, request, calls } = fixture();
      env[name] = limiter;
      if (!limiter || typeof limiter.limit !== "function") {
        assert.equal((await app.request("/auth/config", {}, env)).status, 503);
      }
      for (const path of ["/auth/challenge", "/auth/telegram"]) {
        const response = await request(path);
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { error: "Login unavailable" });
        assert.ok(!calls.some((call) => call[0] === "db"));
      }
    }
});
test("shared hashed IP keys cannot be rotated by endpoint, proof, forwarded header or challenge", async () => {
  const { request, calls } = fixture();
  await request("/auth/challenge", { "X-Forwarded-For": "1.2.3.4" });
  await request("/auth/telegram", { "X-Forwarded-For": "5.6.7.8" });
  const keys = calls.filter((call) => call[0] === "ip").map((call) => call[1]);
  assert.equal(keys[0], keys[1]);
  assert.doesNotMatch(keys[0], /203\.0\.113|sensitive|aaaa/);
  await request("/auth/challenge", { "CF-Connecting-IP": "203.0.113.8" });
  assert.notEqual(keys[0], calls.filter((call) => call[0] === "ip").at(-1)[1]);
  const missing = await request("/auth/challenge", { "CF-Connecting-IP": "" });
  assert.equal(missing.status, 503);
});
test("configured deterministic budget permits requests then refuses both endpoints", async () => {
  const { env, request } = fixture();
  let remaining = 2;
  env.AUTH_IP_LIMITER = { limit: async () => ({ success: remaining-- > 0 }) };
  assert.equal((await request("/auth/challenge")).status, 200);
  assert.equal((await request("/auth/telegram")).status, 401);
  assert.equal((await request("/auth/challenge")).status, 429);
  assert.equal((await request("/auth/telegram")).status, 429);
});
