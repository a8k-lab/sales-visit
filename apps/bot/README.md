# Sales Visit Telegram Bot

A grammY Worker for registration, account administration, Outlets, schedules and
guided Visit reporting. It calls the API through the `IDENTITY` Service Binding;
only API accesses D1. No Telegraf setup is needed.

## Quick Start

Already have a token? Use it only if it belongs to a **separate, dedicated test
bot**, not a production or shared bot. Its webhook must initially be unset. Stop
any Telegraf instance or polling client using that token; do not run competing
consumers. If needed, create a new test bot with the verified **@BotFather**.

All commands run from the repository root. Use Node.js 24.x, pnpm 10.30.1 and
[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
(macOS: `brew install cloudflared`). See the root
[Local Development guide](../../README.md#local-development) for general prerequisites.

### One-time setup

```sh
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars # only if absent
cp apps/bot/.dev.vars.example apps/bot/.dev.vars # only if absent
```

Edit `apps/bot/.dev.vars` privately:

- `TELEGRAM_BOT_TOKEN`: your dedicated test bot's token.
- `TELEGRAM_LOCAL_TEST_BOT_USERNAME`: that bot's username, without `@`. The helper
  checks it against the token before every operation; this is a safety check,
  not permission to use a production bot.
- `TELEGRAM_WEBHOOK_SECRET`: a fresh test-only secret, e.g. 32 random bytes encoded
  as hex from a password manager. Allowed: `A-Z`, `a-z`, `0-9`, `_`, `-` (1–256 characters).

Never put credentials in CLI arguments, logs, screenshots or Git. The helper
reads only the ignored `.dev.vars`, not exported credentials. Web/OIDC is optional.

```sh
pnpm db:migrate:local
pnpm db:seed:local
```

These commands use API-local D1 in `apps/api/.wrangler/state`, not a remote DB.
Seed records are synthetic; they do not create approved Telegram accounts.
**Admin setup is optional for basic testing.** If you want this Telegram account
to be the first Admin, complete [First-time Admin Setup](#first-time-admin-setup)
**before** using `/register`. Otherwise, continue below.

### Daily development

1. Start API, then Bot, each in its own terminal:

   ```sh
   pnpm dev:api # http://localhost:8787
   ```

   ```sh
   pnpm dev:bot # http://localhost:8788
   ```

   Wait for Wrangler's `IDENTITY` binding to connect to local `sales-visit-api`.
   Restart Bot after changing `.dev.vars`. Do not use `--remote`.

2. In another terminal, expose Bot:

   ```sh
   cloudflared tunnel --url http://localhost:8788
   ```

   This account-free **Quick Tunnel** forwards public HTTPS requests to the local
   Worker. Telegram cannot deliver webhooks to your computer's `localhost`.
   Keep the tunnel running; no Cloudflare login or dashboard is needed. BotFather
   Web/OIDC login origins are unrelated to webhook delivery.

3. Copy the printed tunnel URL and register it:

   ```sh
   pnpm telegram:local webhook:set https://YOUR-TUNNEL.trycloudflare.com
   ```

   A restarted tunnel gets a new URL: run the command again. The helper preserves
   webhook-secret validation and accepts only HTTPS Quick Tunnel root URLs.
   It checks the current webhook and refuses unrecognized URLs, custom certificates
   or unexpected update types. It replaces only webhooks it previously recorded
   for this test bot in ignored `apps/bot/.wrangler/telegram-local-*.json` files.
   Keep those files until cleanup; do not run helper commands concurrently.
   An existing webhook from another tool is deliberately **not** taken over—use
   a separate test bot with an unset webhook instead. `pnpm telegram:test-bot`
   remains an operator-only deployment helper, not part of this workflow.

### Test messages and clean up

In a **private chat** with your test bot, send `/start`, `/help` and `/me`.
No Admin is needed for those commands. To exercise registration against local D1,
send `/register`, then `/me`; the account stays pending until approved. Do not
register an account you intend to provision as the first Admin.

For protected flows after [Admin setup](#first-time-admin-setup), use a consenting
second test account: `/register`, then Admin `/pending` and
`/approve SECOND_TELEGRAM_ID sales sf-01` after verifying the account and synthetic
SF link. The second account can use `/me` and `/salesvisit`, selecting seeded
Outlet `out-01`, then `/konfirmasi` or `/batal`. See the
[Visit wizard guide](../../docs/design/telegram-visit-wizard.md) for the exact flow.

When finished:

```sh
pnpm telegram:local webhook:delete
```

This removes only an owned test webhook and **discards pending test updates**.
Then stop the tunnel and Workers with Ctrl-C. Never alter production webhooks.

## First-time Admin Setup

**Optional for basic testing; required for approvals and protected commands.**

### Local accounts

Before starting the Workers or registering a webhook, obtain your own verified
Telegram **User ID**. If you already know it from a trusted authenticated Telegram
interaction, skip the lookup. Otherwise, send a fresh unique plain-text marker
(e.g. `local-admin-` plus random text) from your intended Admin account to the
new test bot's private chat, then run:

```sh
pnpm telegram:local user-id YOUR-EXACT-MARKER
```

Replace `YOUR-EXACT-MARKER` with the exact text you sent. Use 8–128 letters,
digits, `_` or `-`; do not forward the message. This performs one read of pending
messages, not a polling loop, and requires an unset webhook.
It reports only a unique matching private human sender. No application account
or Admin is needed. Keep the ID/output private; do not trust arbitrary third-party
lookup bots, usernames or display names as identity evidence.

The returned **human User ID**, as positive decimal text, goes in
`<telegram-bot-user-id>` in the
[controlled bootstrap procedure](../../packages/db/IDENTITY.md#controlled-first-admin-provisioning).
It is **not** the Bot ID or BotFather OIDC Client ID (`TELEGRAM_CLIENT_ID` for Web
login). Use a fresh application UUID for `<internal-user-id>`.

Follow that complete procedure, keeping its SQL in a private file outside Git.
Bootstrap before this account uses `/register`; never use it to promote an
existing account. Apply the SQL to the **API** sandbox, not the database package's
separate sandbox:

```sh
pnpm --filter @sales-visit/api exec wrangler d1 execute DB --local --file /absolute/private/bootstrap.sql
pnpm --filter @sales-visit/api exec wrangler d1 execute DB --local --command 'PRAGMA foreign_key_check;'
```

Verify the intended active Admin, Telegram binding, null SF link, one active Admin
and no foreign-key errors, as required by the procedure. Later accounts use
`/register` and Admin approval; there is no development permission bypass.

## Common commands and documentation

```sh
pnpm --filter @sales-visit/api test # offline Bot/API integration tests
node --test scripts/telegram-local.test.mjs # offline helper tests
pnpm typecheck
pnpm check
```

- [Bot command grammar, security, test coverage and attribution](../../docs/telegram-bot-reference.md).
- [Outlet/Schedule contracts](../../docs/design/outlet-schedule-foundation.md),
  [command parity](../../docs/design/telegram-bot-parity.md).
- [Identity invariants and bootstrap](../../packages/db/IDENTITY.md).
- [Operator-only deployment and recovery](../../docs/deployment.md) (not needed locally).
