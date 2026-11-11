# Sales Visit

Sales Visit records field-sales Visits and Outlet Stock Reports for a Telkomsel
distribution workflow with partner Citra Indah. The Web Dashboard provides
role-based monitoring and administration; the Telegram Bot supports guided Visit
submission. Web report submission is not yet available.

## Tech stack and workspace

pnpm workspaces and TypeScript, with independently deployed applications:

| Path                 | Purpose                                           | Stack                                                 |
| -------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| `apps/api`           | Shared backend; owns database access              | Hono, Cloudflare Workers, D1                          |
| `apps/bot`           | Telegram interface; calls API via Service Binding | grammY, Cloudflare Workers                            |
| `apps/web`           | Dashboard                                         | React, Vite, TanStack Router, Tailwind CSS, shadcn/ui |
| `packages/contracts` | Shared types and validation                       | TypeScript, Zod                                       |
| `packages/db`        | Schema and migrations                             | Drizzle ORM, D1                                       |
| `docs`               | Feature guides, references and ADRs               | Markdown                                              |

## Local Development

All commands below run from the repository root. API, migrations, seed and Bot
use **local D1** in `apps/api/.wrangler/state`. No Cloudflare account or deployment
is required. Use synthetic data only; do not use remote D1, production bot tokens
or production webhooks.

### 1. Install dependencies

Install **Node.js 24.x** and **pnpm 10.30.1** (the version pinned in
`package.json`). With Node 24 active, install pnpm if needed:

```sh
npm install --global pnpm@10.30.1
node --version  # v24.x
pnpm --version # 10.30.1

git clone https://github.com/a8k-lab/sales-visit.git
cd sales-visit
pnpm install
```

### 2. Configure local applications

```sh
cp apps/api/.dev.vars.example apps/api/.dev.vars
cp apps/web/.env.example apps/web/.env
cp apps/bot/.dev.vars.example apps/bot/.dev.vars
```

Skip the Bot copy if you only need API/Web. Do not overwrite existing local
configuration. Edit these files privately; actual env files are ignored by Git.

- **API:** the example allows only `http://localhost:5173` for local CORS.
  This overrides local vars without editing production `wrangler.jsonc`.
- **Web:** `VITE_API_URL=http://localhost:8787`. All `VITE_*` values are public;
  never put secrets there.
- **Bot:** create a separate BotFather test bot and fill in its token and a fresh
  webhook secret. Follow the [Bot setup](apps/bot/README.md) for the tunnel and
  safe webhook registration.

The Web login page can run locally, but protected data requires real Telegram
OIDC, an approved local account, and the test Client ID in the API vars. There is
no demo login or authentication bypass. See [Web setup](apps/web/README.md) for
login prerequisites and local rate-limit limitations. Bot webhook testing does
not require Web login or OIDC configuration.

### 3. Prepare local D1

```sh
pnpm db:migrate:local
pnpm db:seed:local
```

The seed is synthetic and repeatable; it does not reset existing data or create
application accounts. For local Admin bootstrap and Sales Force approval, see
[Bot account setup](apps/bot/README.md#local-accounts).

### 4. Start each application

Use a separate terminal for each command, from the repository root:

```sh
pnpm dev:api # http://localhost:8787
```

```sh
pnpm dev:web # http://localhost:5173
```

```sh
pnpm dev:bot # http://localhost:8788; requires Bot secrets
```

Start API before Bot and wait for Wrangler's `IDENTITY` Service Binding to show
as connected. Web and Bot can be run independently of each other; both use API.
Keep port 5173 free so Vite's origin matches the local CORS configuration.

### 5. Verify

```sh
curl --fail http://localhost:8787/health
curl --fail http://localhost:8788/health # if Bot is running
curl --fail -o /dev/null http://localhost:5173/ # if Web is running
```

Health endpoints return `status: "ok"`; they check liveness, not D1 or Service
Binding connectivity. Open `http://localhost:5173` for Web. API business endpoints
return 401 without a valid Web session. To verify the Bot-to-D1 path, follow the
[Telegram message test](apps/bot/README.md#test-messages-and-clean-up).

## Common commands

| Command                                     | Purpose                                             |
| ------------------------------------------- | --------------------------------------------------- |
| `pnpm typecheck`                            | Generate Worker types and check all workspaces      |
| `pnpm check`                                | Lint and formatting checks                          |
| `pnpm --filter @sales-visit/api test`       | API/Bot integration tests with disposable local D1  |
| `pnpm --filter @sales-visit/db test`        | Database tests                                      |
| `pnpm --filter @sales-visit/contracts test` | Shared validation tests                             |
| `pnpm test:deployment`                      | Offline deployment-tool tests; no remote operations |
| `pnpm build:web`                            | Build the dashboard                                 |
| `pnpm preview:web`                          | Build and preview locally with Wrangler             |

## Documentation

- Application setup: [API](apps/api/README.md), [Bot](apps/bot/README.md), [Web](apps/web/README.md).
- Domain language and open business questions: [CONTEXT.md](CONTEXT.md).
- Architecture decisions: [ADRs](docs/adr/).
- Detailed references: [API](docs/api-reference.md), [Bot commands and security](docs/telegram-bot-reference.md).
- Feature guides: [dashboard](docs/live-dashboard.md), [Web authentication](docs/web-auth.md),
  [user management](docs/admin-user-management.md), [Sales Force management](docs/sales-force-management.md),
  [Supervisor assignments](docs/supervisor-assignments.md), [Visit wizard](docs/design/telegram-visit-wizard.md).
- Operator-only releases: [CI/CD](docs/ci-cd.md), [deployment runbook](docs/deployment.md).
- Research and initial workflow sketches: [team FigJam](https://www.figma.com/board/xYjjlXsulf3fGKFFyNhd0W/Sales-Visit?node-id=0-1)
  (historical sketches are not current requirements).
