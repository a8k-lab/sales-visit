# @sales-visit/db

Private ESM workspace package owning Drizzle schemas, relations, and versioned
SQLite migrations for Cloudflare D1. Domain: [`CONTEXT.md`](../../CONTEXT.md)
and ADRs 0002–0005. No API, auth, frontend, or Telegram dependencies.

## Consumption

The API declares `"@sales-visit/db": "workspace:*"` and uses this package for
local D1-backed read endpoints. See [API instructions](../../apps/api/README.md).
Like `@sales-visit/contracts`, exports point to TypeScript source for Wrangler
and other TypeScript-aware tooling; no build step is required.

```ts
import { createDb, visits } from "@sales-visit/db";
// Tables and relations are also available from "@sales-visit/db/schema".

// Inside a Worker request, with env.DB supplied by the Worker:
const db = createDb(env.DB);
const records = await db.select().from(visits);
```

`createDb(binding)` receives an existing D1 binding and enables relational
queries (`db.query.stockReports`, etc.). Importing the package never creates a
connection or accesses an environment. The root also exports the `Database`
type. Only the API should access persistence; Web and Bot use the shared API.

## Schema decisions

- Six tables: `sales_force`, `outlets`, `products`, `visits`, `stock_reports`,
  and `stock_report_items`. Sales Force identities and Outlet business records
  are not application accounts. No account or Telegram-identity fields exist.
- IDs are caller-supplied opaque nonblank strings; `crypto.randomUUID()` is a
  reasonable generator, but UUID syntax is not required by storage or contracts.
  Names are required/nonblank, not unique: no business uniqueness rule is agreed.
- Both Visit and Stock Report record a required `web`/`telegram` submission
  channel with SQL CHECK constraints. Reporter identity is a separate required
  Sales Force reference. Independent reports still require a Sales Force
  reporter in the MVP; Outlet self-reporting will require an explicit migration.
- A Visit needs no report. A Stock Report has a nullable Visit reference, and
  multiple reports may reference one Visit. A composite FK ensures any linked
  Visit belongs to the report's Outlet. The reporter need not be the visitor.
- `visitedAt`/`reportedAt` describe the business event; `createdAt` records
  database receipt (default UTC epoch time, second precision). All timestamps
  are stored as integer epoch milliseconds and exposed by Drizzle as `Date`.
  Event timestamps are supplied explicitly. At the API boundary, convert
  contract ISO timestamps with `new Date(value)` and serialize with
  `.toISOString()`. Convert nullable database fields to omitted/`undefined`
  contract properties; assemble report `items` from child rows. Persistence
  rows are deliberately not identical to transport records.
- Each report/product pair is unique (composite item primary key). Quantity is
  a required nonnegative JavaScript-safe whole number, including zero; it is
  only a reported observation, not live inventory or a sales calculation.
- All FKs restrict deletion/key updates to protect referenced history; there
  are no cascading deletes, latest-value upserts, or uniqueness rules on
  outlet/time or Visit that would overwrite previous observations. Submitted
  observations should be append-only through the future API. SQL does not
  prohibit direct administrative UPDATE/DELETE of otherwise unreferenced rows.
- Indexes support Outlet and Sales Force timelines, linked-Visit lookup, and
  Product item lookup. The item primary key covers report-item lookup.

### Future API responsibilities

Use the existing Zod contracts, permissions, and idempotency handling at the
business boundary, not duplicated validation schemas here. Validate complete
reports with **at least one item** and no repeated products before inserting the
report and items atomically with D1 `db.batch(...)`. A parent-to-child minimum
count cannot be expressed by an ordinary SQLite FK/CHECK; the database allows
an empty parent while the batch is assembled. Do not submit only the parent.

No Sales In, Sales Out, Total Belanja, Active Outlet, restock, verification,
or account workflows/calculations are defined by this package.

## Migrations

Run from the repository root (Node 24, pnpm 10.30.1):

```sh
pnpm install
# After editing src/schema.ts:
pnpm --filter @sales-visit/db db:generate --name describe_change
pnpm --filter @sales-visit/db db:check
pnpm --filter @sales-visit/db test
# Apply only to the package's local D1 sandbox:
pnpm --filter @sales-visit/db db:migrate:local
```

Drizzle Kit uses the SQLite dialect and requires no Cloudflare credentials for
SQL generation. Review and commit both `migrations/*.sql` and
`migrations/meta/*` (snapshots/journal). Do not edit generated snapshots or use
schema push in place of migrations. Wrangler applies the generated SQL and
tracks it in D1's `d1_migrations` table; there is no second migration runner.

`wrangler.local.jsonc` is an isolated local-only sandbox with a placeholder ID,
not a deployable Worker. Local state is ignored under `.wrangler/`. It creates
no remote database. To inspect local tables:

```sh
pnpm --filter @sales-visit/db exec wrangler d1 execute DB --local \
  --config wrangler.local.jsonc \
  --command "SELECT name FROM sqlite_master WHERE type = 'table';"
```

The API Worker now binds `DB` in `apps/api/wrangler.jsonc` with a local-only
placeholder ID and `migrations_dir: "../../packages/db/migrations"` (relative to
that config). From the root, use `pnpm db:migrate:local` and
`pnpm db:seed:local` for the **API-local database** used by `pnpm dev:api`.
The package sandbox command above and API-local database are separate local
state locations. No schema or migration is duplicated. Remote creation/application
is intentionally not configured or performed by these scripts.

## Checks

```sh
pnpm --filter @sales-visit/db typecheck
pnpm --filter @sales-visit/db test
pnpm typecheck
pnpm check
```

Tests apply the generated migrations to Node's in-memory SQLite with foreign
keys enabled, exercise constraints and ORM-generated inserts, compile every
relational query, verify package exports/lazy binding use, and validate mapped
records against the existing shared contracts. Node may report its built-in
SQLite module as experimental. Local Wrangler application additionally checks
D1 compatibility.
