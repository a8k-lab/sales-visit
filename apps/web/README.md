# Sales Visit Web Dashboard

React + Vite dashboard with TanStack Router and shadcn/ui. Provides authenticated,
role-based monitoring and administration. Web report submission is not enabled.

## Local development

Complete the root [Local Development guide](../../README.md#local-development).
All commands here run from the repository root:

```sh
cp apps/web/.env.example apps/web/.env # first setup only
pnpm dev:web
```

Open `http://localhost:5173` and keep API running at `http://localhost:8787`.
The example sets `VITE_API_URL` to that local API. Use the API's
[local vars example](../api/.dev.vars.example) to allow exactly
`http://localhost:5173`; do not change production CORS. Keep port 5173 free and
restart Vite after env changes. `VITE_*` values are public, never secrets.

### Telegram login

There is no fake login or demo account. Protected data requires:

- A separate test bot configured for Telegram OIDC, with its BotFather Client ID
  set as `TELEGRAM_CLIENT_ID` in `apps/api/.dev.vars`.
- Approved login origins/redirect URLs for that test bot, following the
  [OIDC setup](../../docs/web-auth.md#botfather).
- An active, approved account in **local D1**; see
  [local accounts](../bot/README.md#local-accounts).

Login origins are separate from Bot webhook delivery. The API also enforces
native rate limits and requires `CF-Connecting-IP` on authentication POSTs.
If your local Wrangler/browser setup does not supply it, login returns 503;
see [local rate-limit requirements](../../docs/web-auth.md#native-auth-abuse-protection).
A manual local HTTP auth request may use a synthetic header, but ordinary browser
requests do not add it. Do not disable the checks or use a production API as a
workaround. You can run the login page and test the Bot locally without completing
browser login.

## Common commands

```sh
pnpm --filter @sales-visit/web typecheck
pnpm build:web
pnpm preview:web # builds, then previews locally with Wrangler
pnpm check
```

For UI components (this command explicitly runs from `apps/web`):

```sh
cd apps/web
pnpm dlx shadcn@latest add <component>
```

Follow [frontend conventions](AGENTS.md); do not add frontend test frameworks
or dependencies during the prototype phase.

## Documentation

- [Dashboard behavior, permissions and verification](../../docs/live-dashboard.md).
- [Web authentication and security](../../docs/web-auth.md).
- [User management](../../docs/admin-user-management.md),
  [Supervisor assignments](../../docs/supervisor-assignments.md).
- [Operator-only release procedure](../../docs/ci-cd.md) and
  [API-first activation checklist](../../docs/live-dashboard.md#operator-controlled-activation-and-smoke-test).
