import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

const telegramKeys = createRemoteJWKSet(
  URL.parse("https://oauth.telegram.org/.well-known/jwks.json")!
);
const random = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
export const hashToken = async (token: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
    ),
    (b) => b.toString(16).padStart(2, "0")
  ).join("");
export interface WebAccount {
  id: string;
  role: "admin" | "supervisor" | "sales_force";
  salesForceId: string | null;
  name: string;
}
export type WebEnv = {
  Bindings: ApiBindings;
  Variables: { account: WebAccount };
};
export function configured(env: ApiBindings) {
  return (
    /^[1-9][0-9]*$/.test(env.TELEGRAM_CLIENT_ID ?? "") &&
    Number.isSafeInteger(Number(env.TELEGRAM_CLIENT_ID)) &&
    typeof env.AUTH_IP_LIMITER?.limit === "function" &&
    typeof env.AUTH_GLOBAL_LIMITER?.limit === "function"
  );
}

// profile scope returns `id` at the top level, not `sub` (nor callback.user).
export async function verifyTelegram(
  token: string,
  clientId: string,
  keys: JWTVerifyGetKey = telegramKeys
) {
  const { payload } = await jwtVerify(token, keys, {
    issuer: "https://oauth.telegram.org",
    audience: clientId,
    algorithms: ["RS256"],
    requiredClaims: ["exp", "iat", "nonce", "id"],
    clockTolerance: 30,
    maxTokenAge: "5m",
  });
  if (
    typeof payload.iat !== "number" ||
    payload.iat > Date.now() / 1000 + 30 ||
    typeof payload.id !== "number" ||
    !Number.isSafeInteger(payload.id) ||
    payload.id <= 0 ||
    typeof payload.nonce !== "string" ||
    !/^[a-f0-9]{64}$/.test(payload.nonce)
  )
    throw new Error("Invalid proof");
  return { telegramId: String(payload.id), nonce: payload.nonce };
}

export async function liveAccount(
  db: D1Database,
  userId: string
): Promise<WebAccount | null> {
  const row = await db
    .prepare(`SELECT u.id, u.role, u.sales_force_id AS salesForceId,
    coalesce(t.first_name, 'Akun Telegram') AS name FROM users u
    JOIN telegram_identities t ON t.user_id = u.id
    WHERE u.id = ? AND u.status = 'active' AND u.role IN ('admin','supervisor','sales_force')`)
    .bind(userId)
    .first<WebAccount>();
  if (!row) return null;
  if (row.role === "sales_force") {
    const link = await db
      .prepare(`SELECT s.id FROM sales_force s WHERE s.id = ?
      AND (SELECT count(*) FROM users WHERE sales_force_id = s.id) = 1`)
      .bind(row.salesForceId)
      .first();
    if (!link) return null;
  }
  return row;
}
export async function sessionAccount(request: Request, db: D1Database) {
  const match = /^Bearer ([a-f0-9]{64})$/.exec(
    request.headers.get("Authorization") ?? ""
  );
  if (!match) return null;
  const hash = await hashToken(match[1]!);
  const session = await db
    .prepare(`SELECT user_id AS userId FROM web_sessions
    WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`)
    .bind(hash, Date.now())
    .first<{ userId: string }>();
  return session ? liveAccount(db, session.userId) : null;
}
export function authRoutes(keys: JWTVerifyGetKey = telegramKeys) {
  const app = new Hono<WebEnv>();
  app.on("POST", ["/challenge", "/telegram"], async (c, next) => {
    if (!configured(c.env)) return c.json({ error: "Login unavailable" }, 503);
    // Cloudflare overwrites this header for incoming Internet traffic. Never use
    // forwarded headers, unverified profile IDs, challenge references or tokens.
    const ip = c.req.header("CF-Connecting-IP");
    if (!ip || !/^[0-9a-f:.]{3,45}$/i.test(ip))
      return c.json({ error: "Login unavailable" }, 503);
    try {
      const ipDecision = await c.env.AUTH_IP_LIMITER.limit({
        key: `web-auth:ip:${await hashToken(ip)}`,
      });
      if (typeof ipDecision?.success !== "boolean")
        throw new Error("Unavailable limiter");
      if (!ipDecision.success) {
        c.header("Retry-After", "60");
        return c.json({ error: "Too many requests" }, 429);
      }
      const globalDecision = await c.env.AUTH_GLOBAL_LIMITER.limit({
        key: "web-auth:all",
      });
      if (typeof globalDecision?.success !== "boolean")
        throw new Error("Unavailable limiter");
      if (!globalDecision.success) {
        c.header("Retry-After", "60");
        return c.json({ error: "Too many requests" }, 429);
      }
    } catch {
      return c.json({ error: "Login unavailable" }, 503);
    }
    await next();
  });
  app.use(
    "*",
    bodyLimit({
      maxSize: 16384,
      onError: (c) => c.json({ error: "Invalid request" }, 400),
    })
  );
  app.get("/config", (c) =>
    configured(c.env)
      ? c.json({
          clientId: Number(c.env.TELEGRAM_CLIENT_ID),
          scope: ["profile"],
        })
      : c.json({ error: "Login unavailable" }, 503)
  );
  app.post("/challenge", async (c) => {
    if (!configured(c.env)) return c.json({ error: "Login unavailable" }, 503);
    const id = random(),
      nonce = random(),
      now = Date.now(),
      expiresAt = now + 180000;
    // Bounded retention cleanup after the shared auth abuse budgets permit work.
    await c.env.DB.batch([
      c.env.DB.prepare(
        "DELETE FROM web_login_challenges WHERE id IN (SELECT id FROM web_login_challenges WHERE expires_at < ? LIMIT 100)"
      ).bind(now - 3600000),
      c.env.DB.prepare(
        "INSERT INTO web_login_challenges (id, nonce, created_at, expires_at) VALUES (?, ?, ?, ?)"
      ).bind(id, nonce, now, expiresAt),
    ]);
    return c.json({ challenge: id, nonce, expiresAt });
  });
  app.post("/telegram", async (c) => {
    if (!configured(c.env)) return c.json({ error: "Login unavailable" }, 503);
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: "Invalid request" }, 400);
    }
    if (
      !input ||
      typeof input !== "object" ||
      !("idToken" in input) ||
      !("challenge" in input) ||
      typeof input.idToken !== "string" ||
      input.idToken.length > 14000 ||
      typeof input.challenge !== "string" ||
      !/^[a-f0-9]{64}$/.test(input.challenge) ||
      Object.keys(input).some((k) => !["idToken", "challenge"].includes(k))
    )
      return c.json({ error: "Invalid request" }, 400);
    let proof;
    try {
      proof = await verifyTelegram(
        input.idToken,
        c.env.TELEGRAM_CLIENT_ID,
        keys
      );
    } catch {
      return c.json({ error: "Login failed" }, 401);
    }
    const now = Date.now();
    // Conditional UPDATE RETURNING is the sole winner even for concurrent callbacks.
    const consumed =
      await c.env.DB.prepare(`UPDATE web_login_challenges SET consumed_at = ?
      WHERE id = ? AND nonce = ? AND consumed_at IS NULL AND expires_at > ? RETURNING id`)
        .bind(now, input.challenge, proof.nonce, now)
        .first();
    if (!consumed) return c.json({ error: "Login failed" }, 401);
    const identity = await c.env.DB.prepare(
      "SELECT user_id AS userId FROM telegram_identities WHERE telegram_user_id = ?"
    )
      .bind(proof.telegramId)
      .first<{ userId: string }>();
    const account = identity && (await liveAccount(c.env.DB, identity.userId));
    if (!account) return c.json({ error: "Login failed" }, 401);
    const token = random(),
      expiresAt = now + 3600000;
    await c.env.DB.prepare(
      "INSERT INTO web_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
    )
      .bind(await hashToken(token), account.id, now, expiresAt)
      .run();
    return c.json({ token, expiresAt, account });
  });
  // A disabled account may still destroy its own credential, never read data.
  app.post("/logout", async (c) => {
    const match = /^Bearer ([a-f0-9]{64})$/.exec(
      c.req.header("Authorization") ?? ""
    );
    if (!match) return c.json({ error: "Unauthorized" }, 401);
    const now = Date.now();
    const revoked = await c.env.DB.prepare(
      "UPDATE web_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? RETURNING token_hash"
    )
      .bind(now, await hashToken(match[1]!), now)
      .first();
    if (!revoked) return c.json({ error: "Unauthorized" }, 401);
    return c.json({ ok: true });
  });
  app.use("*", async (c, next) => {
    const account = await sessionAccount(c.req.raw, c.env.DB);
    if (!account) return c.json({ error: "Unauthorized" }, 401);
    c.set("account", account);
    await next();
  });
  app.get("/me", (c) => c.json({ account: c.get("account") }));
  return app;
}
