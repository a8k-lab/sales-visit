# Sales Visit API

Hono API on Cloudflare Workers, backed by D1 through `@sales-visit/db`.
The Web uses authenticated HTTP endpoints; the Bot uses the private `BotIdentity`
Service Binding. Only this Worker owns D1.

## Local development

Follow the root [Local Development guide](../../README.md#local-development)
for Node/pnpm, dependencies and local migrations/seed. From the repository root:

```sh
cp apps/api/.dev.vars.example apps/api/.dev.vars # first setup only
pnpm dev:api
curl --fail http://localhost:8787/health
```

The example sets `WEB_ORIGINS=http://localhost:5173` for local Web CORS only.
Set `TELEGRAM_CLIENT_ID` to your separate test bot's BotFather OIDC Client ID if
testing Web login; otherwise leave it empty (Web login fails closed). Restart
Wrangler after changing local vars. Do not edit production `wrangler.jsonc` for
local setup or broaden the allowlist to `*`.

Dev, root migration/seed commands and local Admin bootstrap all use
`apps/api/.wrangler/state`. The database package's own sandbox is separate.
Seeding is idempotent and does not reset data. To start fresh, stop the Workers,
remove only `apps/api/.wrangler/state`, then rerun local migrations and seed.
Never add `--remote` to local commands.

`/health` is liveness only. Business reads require a valid Web session; public
HTTP Visit/Stock Report writes remain denied. Local development does not bypass
authentication. See [local Admin setup](../bot/README.md#local-accounts).

## Common commands

```sh
pnpm db:migrate:local
pnpm db:seed:local
pnpm --filter @sales-visit/api test
pnpm --filter @sales-visit/api typecheck # regenerates ignored Worker types
```

## Documentation

- [API contracts and implementation reference](../../docs/api-reference.md).
- [Web authentication, CORS and rate limits](../../docs/web-auth.md).
- [Dashboard contracts and permissions](../../docs/live-dashboard.md).
- [Bot setup and local Service Binding](../bot/README.md).
- [Identity invariants and Admin bootstrap](../../packages/db/IDENTITY.md).
- [Outlet/Schedule RPC](../../docs/design/outlet-schedule-foundation.md),
  [Visit wizard](../../docs/design/telegram-visit-wizard.md).
- [Operator-only deployment runbook](../../docs/deployment.md).
