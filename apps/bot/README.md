# Sales Visit Telegram Bot

A grammY Worker for registration, account administration, Outlets, schedules and
guided Visit reporting. It calls the local API through the `IDENTITY` Service
Binding; only API accesses D1.

## Local setup

Use Node.js 24.x and pnpm 10.30.1. Complete the root
[Local Development guide](../../README.md#local-development) for dependencies,
local D1 migrations and synthetic seed. **All commands here run from the repository root.**

### 1. Create a separate test bot

In Telegram, open the verified **@BotFather**, send `/newbot`, and follow the
prompts. Use this new bot only, never a production bot or production credentials.

```sh
cp apps/bot/.dev.vars.example apps/bot/.dev.vars # first setup only
```

Edit the ignored file privately:

- `TELEGRAM_BOT_TOKEN`: the token BotFather gives your test bot.
- `TELEGRAM_WEBHOOK_SECRET`: a new random test-only secret, e.g. 32 random bytes
  encoded as hex, generated and saved with a password manager. Telegram permits
  1–256 characters from `A-Z`, `a-z`, `0-9`, `_` and `-`.

Do not paste secrets into shell commands, URLs, logs, screenshots or Git. Do not
source the file with shell tracing enabled. The registration example below reads
it directly without printing credentials. Restart Bot after changing the file.

### 2. Run API and Bot

In separate terminals:

```sh
pnpm dev:api # http://localhost:8787; owns local D1
```

```sh
pnpm dev:bot # http://localhost:8788
```

Wait for Wrangler to show `IDENTITY` connected to local `sales-visit-api`.
A disconnected binding is not an authentication fallback. Do not use `--remote`.

```sh
curl --fail http://localhost:8787/health
curl --fail http://localhost:8788/health
```

Both return `status: "ok"`; this checks liveness only, not the binding or D1.

### Local accounts

Seed data includes Sales Force records `sf-01`, `sf-02`, `sf-03`, not approved
Telegram accounts. For the first local Admin, follow the exact
[controlled bootstrap procedure](../../packages/db/IDENTITY.md#controlled-first-admin-provisioning)
using your verified test-account **Bot API user ID**, a fresh internal UUID and a
private SQL file outside Git. Bootstrap before that Admin account uses `/register`;
do not use bootstrap to promote an existing account. Apply the SQL to the API
sandbox (not the database package's separate sandbox):

```sh
pnpm --filter @sales-visit/api exec wrangler d1 execute DB --local --file /absolute/private/bootstrap.sql
pnpm --filter @sales-visit/api exec wrangler d1 execute DB --local --command 'PRAGMA foreign_key_check;'
```

Verify the intended active Admin, Telegram ID, null SF link, one active Admin
and no foreign-key errors, as required by the linked procedure. Keep personal
IDs and bootstrap output private. Later accounts use `/register` and Admin approval;
no development permission bypass is needed.

### 3. Expose Bot with a Quick Tunnel

Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
if needed (on macOS: `brew install cloudflared`), then run:

```sh
cloudflared tunnel --url http://localhost:8788
```

This [Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
needs **no Cloudflare account, login or dashboard**. Keep it running and copy the
printed `https://…trycloudflare.com` URL. If a local `.cloudflared/config.yaml`
prevents Quick Tunnels, temporarily move that config aside and restore it later.

Telegram sends webhooks to a public HTTPS URL; it cannot reach your computer's
`localhost`. The tunnel forwards those requests to the local Bot Worker at `/`.
**BotFather allowed login origins are for Web/OIDC login, not webhook delivery**;
adding localhost there will not deliver messages. Keep webhook-secret validation
enabled: the tunnel makes your local Bot publicly reachable.

### 4. Register only the test bot's webhook

Replace only the public tunnel URL below. Confirm `.dev.vars` contains your
**new test bot's** token. Run this once from the repository root; it reads the
ignored file directly. It sends a matching `secret_token` and handles text-message
updates only. Do not use `curl https://api.telegram.org/bot<TOKEN>/...`, shell
tracing, verbose HTTP logging or raw error logging: those can expose the token.

```sh
node --input-type=module - https://YOUR-TUNNEL.trycloudflare.com <<'NODE'
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
try {
  const vars = parseEnv(readFileSync('apps/bot/.dev.vars', 'utf8'));
  const token = vars.TELEGRAM_BOT_TOKEN;
  const secret = vars.TELEGRAM_WEBHOOK_SECRET;
  const url = new URL(process.argv[2]);
  if (!token || !/^[A-Za-z0-9_-]{1,256}$/.test(secret ?? '') ||
      url.protocol !== 'https:' || !url.hostname.endsWith('.trycloudflare.com') ||
      url.username || url.password || url.port || url.pathname !== '/' ||
      url.search || url.hash) throw new Error();
  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: url.href, secret_token: secret, allowed_updates: ['message'] }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error();
  console.log('Test webhook registered.');
} catch {
  console.error('Webhook registration failed; check test configuration privately.');
  process.exitCode = 1;
}
NODE
```

A restarted Quick Tunnel gets a new URL; register that new URL again. The existing
`pnpm telegram:test-bot` deployment helper deliberately does **not** support local
tunnel URLs; do not change its deployment guards for local testing.

### Test messages and clean up

In a **private chat** with the new test bot:

1. Send `/start`, `/help` and `/me` from the bootstrapped Admin account.
2. From a consenting second test account, send `/register`, then `/me` (pending).
3. Admin: `/pending`, verify the second account's identity and synthetic SF record,
   then `/approve SECOND_TELEGRAM_ID sales sf-01` (replace the placeholder).
4. Second account: `/me` (active), then `/salesvisit`. Use seeded Outlet `out-01`
   when asked, follow the prompts, review and send `/konfirmasi` (or `/batal`).
   This exercises the Bot → API → **local D1** path. See the
   [Visit wizard guide](../../docs/design/telegram-visit-wizard.md) for the exact flow.

When finished, remove **only this test bot's webhook**, still using its ignored
local credentials file:

```sh
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
try {
  const vars = parseEnv(readFileSync('apps/bot/.dev.vars', 'utf8'));
  const token = vars.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error();
  const response = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
    method: 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ drop_pending_updates: true }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error();
  console.log('Test webhook removed; pending test updates discarded.');
} catch {
  console.error('Webhook removal failed; check test configuration privately.');
  process.exitCode = 1;
}
NODE
```

Stop the tunnel and Workers with Ctrl-C and remove local credentials when no
longer needed. Never modify a production webhook or poll with a production token.

## Common commands and documentation

```sh
pnpm --filter @sales-visit/api test # offline Bot/API integration tests
pnpm typecheck
pnpm check
```

- [Bot command grammar, security, test coverage and attribution](../../docs/telegram-bot-reference.md).
- [Outlet/Schedule contracts](../../docs/design/outlet-schedule-foundation.md),
  [command parity](../../docs/design/telegram-bot-parity.md).
- [Identity invariants and bootstrap](../../packages/db/IDENTITY.md).
- [Operator-only deployment and recovery](../../docs/deployment.md) (not needed locally).
