# Sales Visit API

Read-only Hono Worker backed by local Cloudflare D1 through `@sales-visit/db`.
Shared contracts and database schema are unchanged. No remote resources have
been created and this API has not been deployed.

## Run locally

From the repository root with Node.js 24 and pnpm 10.30.1:

```sh
pnpm install
pnpm db:migrate:local
pnpm db:seed:local
pnpm dev:api
```

Wrangler serves at `http://localhost:8787`. The `DB` binding uses a local-only
placeholder ID; do not deploy this configuration or use `--remote`.
Migrations reuse `packages/db/migrations`. Dev, root migration, and seed commands
all use `apps/api/.wrangler/state`, independently of the database package sandbox.
Stop the API before removing that directory if you need a fresh local database,
then rerun migrations and seed. Generated `worker-configuration.d.ts` is ignored;
`pnpm --filter @sales-visit/api typecheck` regenerates it before checking types.

## Endpoints

| GET path         | JSON response                                            |
| ---------------- | -------------------------------------------------------- |
| `/health`        | `{ "status": "ok" }` (liveness only; no database query)  |
| `/sales-force`   | `SalesForce[]`                                           |
| `/outlets`       | `Outlet[]`                                               |
| `/products`      | `Product[]`                                              |
| `/visits`        | `Visit[]`                                                |
| `/visits/:id`    | `Visit & { stockReports: StockReport[] }`                |
| `/stock-reports` | `StockReport[]`, including items and independent reports |

Lists are bare arrays (empty database: `[]`). Master records sort by ID;
visits/reports sort newest event first, then ID ascending. Items sort by Product
ID. Timestamps serialize as UTC ISO strings; nullable optional properties are
omitted, and storage-only fields such as `createdAt` are not exposed.
Visit details contain all linked reports, or `stockReports: []` when none exist.
Unknown Visit IDs return 404 with `{ "error": "Visit not found" }`.
Unknown routes and unsupported write methods return 404 with
`{ "error": "Not found" }`. Handler/database failures return 503 with
`{ "error": "Service unavailable" }`, never SQL or internal exception details.

```sh
curl http://localhost:8787/health
curl http://localhost:8787/sales-force
curl http://localhost:8787/outlets
curl http://localhost:8787/products
curl http://localhost:8787/visits
curl http://localhost:8787/visits/VST-0012
curl http://localhost:8787/stock-reports
curl -i http://localhost:8787/visits/unknown # 404
```

## Synthetic seed

`seeds/local.sql` is a standalone subset of the Web mock data, not an import
from the frontend: 3 Sales Force, 5 Outlets, 4 Products, 3 Visits (`VST-0010`
through `VST-0012`), 4 Stock Reports, and 7 items. It preserves the corresponding
IDs, names, event times, notes, quantities, and relationships, without prototype
contact/category fields. It includes both channels, a Visit without stock,
two reports for one Visit, an independent Sales Force report, and zero quantity.

Explicit timestamps and primary-key `ON CONFLICT DO NOTHING` clauses make
repeated seeding idempotent. Existing rows are not overwritten or deleted;
a modified local database is not reset to the fixture by seeding. Run migrations
first. These are development fixtures, not a production migration.

## Verification

```sh
pnpm --filter @sales-visit/api test
pnpm --filter @sales-visit/api exec hono routes
pnpm --filter @sales-visit/api exec hono request /visits/VST-0012
pnpm typecheck
pnpm check
```

Tests use Wrangler's local D1 binding in a disposable directory, apply the real
migrations, seed twice, and verify contracts, relationships, empty lists, 404s,
write-method rejection, and sanitized database failures. They do not require
Cloudflare credentials or change your dev database.

## Remaining scope

No write endpoints, authentication/authorization, CORS/frontend integration,
Telegram reporting, pagination/filtering, KPIs, or remote deployment. Lists are
unpaginated for this local milestone. Keep the unauthenticated API local and use
synthetic data only; the Web continues to use its mocks/browser-local storage.
