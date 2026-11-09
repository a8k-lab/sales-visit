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

- Fifteen application tables through migration 0008: `sales_force`, `outlets`,
  `products`, `visits`, `stock_reports`, `stock_report_items`, `users`,
  `telegram_identities`, `access_audit`, `visit_schedules`, `telegram_visit_drafts`,
  `web_login_challenges`, `web_sessions`, `sales_force_supervisors`, and
  `supervisor_assignment_audit`. Sales Force staff and Outlet business records
  are not application accounts. See [identity invariants](IDENTITY.md) and the
  [assignment model, migration prerequisites and rollout](../../docs/supervisor-assignments.md).
- Additive migration `0008_demonic_princess_powerful.sql` adds current Supervisor
  responsibility (one optional Supervisor per Sales Force) and restricted
  assignment-change history. Existing records remain untouched and initially
  unassigned. Restrictive FKs/PK enforce identity/cardinality; active role/status,
  audit-gated D1 mutations and query scoping are API responsibilities. No group,
  geographic inference, or SF identifier changes are introduced.
- Internal record IDs are opaque primary/FK keys; API Outlet creation generates
  UUIDs. They are never replaced by business identifiers. Names are nonunique.
- New `0006_windy_black_crow.sql` adds nullable TEXT `outlets.business_id` and
  `no_rs`, plus BINARY/case-sensitive unique index `outlets_business_id_unique`.
  Multiple null business IDs and duplicate No. RS values are valid. Existing rows
  receive no invented metadata; leading zeros remain text. API creation requires
  business ID, No. RS and name, bounds and validates identifiers without case
  normalization. No. RS is opaque registration/reference data, not a telephone.
  Update/delete retain internal IDs and all references. No previous migration
  was edited. 0005 is already deployed; only genuinely pending 0006 is applied
  manually after review/backup. See [release checklist](../../docs/design/telegram-bot-parity.md#manual-release-checklist).
  Migration tests cover populated 0005 Visit/Stock Report/Schedule/draft references,
  nullable legacy metadata, binary uniqueness and foreign keys.
- Recurring `visit_schedules` link SF → Outlet with ISO weekday 1–7, integer
  millisecond timestamps, restrictive FKs and unique `(sales_force_id, outlet_id,
  weekday)`. Plans never create actual Visits. `outlets.updated_at` is nullable
  for unknown legacy modification times. See [the foundation guide](../../docs/design/outlet-schedule-foundation.md)
  for migration `0003_greedy_spot.sql`, permissions, identifier assumptions and
  synthetic fixture provisioning.
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
- User IDs default to generated internal random text. Telegram IDs are canonical
  positive decimal strings, unique across identities; each User has at most one
  Telegram identity. User status/role combinations and identity timestamps have
  SQL CHECK constraints. The optional User→SF FK is intentionally non-unique.
  Identity tables are never exposed through public HTTP reads; internal Bot RPC
  contracts live in `@sales-visit/contracts`. Application lifecycle changes and
  access-audit events commit atomically through the API.
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
or account authorization policies are defined by this package. Registration/
approval/rejection policies are enforced by API operations, not schema CHECKs.

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

The API Worker now binds `DB` in `apps/api/wrangler.jsonc` with an initially local-only
sentinel ID and `migrations_dir: "../../packages/db/migrations"` (relative to
that config). From the root, use `pnpm db:migrate:local` and
`pnpm db:seed:local` for the **API-local database** used by `pnpm dev:api`.
The package sandbox command above and API-local database are separate local
state locations. No schema or migration is duplicated. For remote creation and
explicit guarded `pnpm db:migrate:remote` / `pnpm db:verify:remote` commands, see
[the test deployment runbook](../../docs/deployment.md). Local scripts never
apply remote migrations.

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
records against the existing shared contracts. Identity tests also cover every
role/status combination, lifecycle-compatible updates, decimal canonicalization,
both directions of identity uniqueness, FK protection, the documented bootstrap
SQL (retry/conflict behavior), and a populated pre-identity schema upgrade.
Node may report its built-in
SQLite module as experimental. Local Wrangler application additionally checks
D1 compatibility.
