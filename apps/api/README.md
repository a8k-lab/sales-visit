# Sales Visit API

Hono Worker backed by Cloudflare D1 through `@sales-visit/db`.
Reads and protected Visit/Stock Report business operations use shared Zod
contracts. Internal Telegram registration/approval uses a named Worker RPC
entrypoint and the additive `access_audit` migration. See the
[Cloudflare test deployment runbook](../../docs/deployment.md) for provisioning
status, guarded deployment commands and verification.

## Run locally

From the repository root with Node.js 24 and pnpm 10.30.1:

```sh
pnpm install
pnpm db:migrate:local
pnpm db:seed:local
pnpm dev:api
```

Wrangler serves at `http://localhost:8787`. Use `--local` for development
operations; the configured test `DB` binding is not permission to run remote
migrations or deploy.
Migrations reuse `packages/db/migrations`. Dev, root migration, and seed commands
all use `apps/api/.wrangler/state`, independently of the database package sandbox.
Stop the API before removing that directory if you need a fresh local database,
then rerun migrations and seed. Generated `worker-configuration.d.ts` is ignored;
`pnpm --filter @sales-visit/api typecheck` regenerates it before checking types.

## Operational dashboard reads

See [Live Operational Dashboard](../../docs/live-dashboard.md) for the new
`GET /dashboard/overview` contract, 14-day WIB window, permissions and API-first
activation. Existing arrays and Visit detail remain compatible by default.
Opt-in `view=page` lists add `{ items, total }` with server-side filtering and
named references; Visit detail uses `include=references`. `GET /outlets/:id`
projects stored master identifiers only. No new migration or HTTP report-write
authorization is introduced. Unknown/duplicate/unsupported query parameters are
rejected; bounded exact reference filters preserve legacy IDs.

## Endpoints

See [Web authentication and release setup](../../docs/web-auth.md) for Telegram
OIDC, challenge/session contracts, CORS, role scoping and migration 0007.
Only `/health` is public among the business GETs below. All others require a
valid Web Bearer session; public HTTP writes remain denied even with a session.
Admin can monitor all operational data; Supervisor sees only currently assigned
Sales Force members' records (Stock Reports scoped independently by reporter).
Sales Force cannot list Sales Force and can read only their own Visits/Stock Reports
plus limited Outlet/Product references. Authorization is applied within SQL before
pagination. See [Supervisor assignments](../../docs/supervisor-assignments.md) for
migration 0008, lifecycle policy, assignment API, permission matrix and rollout order.

Admin-only Web routes: `GET /supervisors`, `GET /supervisor-assignments`, and
`PUT /supervisor-assignments` with `{ salesForceId: string, supervisorUserId: string | null }`.
Sales Force IDs are sent exactly in JSON (not normalized URL path segments);
legacy stored references and list cursors remain usable within bounded requests.
They use the existing Bearer session; report POST endpoints remain denied.

| GET path         | JSON response                                            |
| ---------------- | -------------------------------------------------------- |
| `/health`        | `{ "status": "ok" }` (liveness only; no database query)  |
| `/sales-force`   | `SalesForce[]`                                           |
| `/outlets`       | `Outlet[]`                                               |
| `/products`      | `Product[]`                                              |
| `/visits`        | `Visit[]`                                                |
| `/visits/:id`    | `Visit & { stockReports: StockReport[] }`                |
| `/stock-reports` | `StockReport[]`, including items and independent reports |

Authorized lists are bare arrays (empty database: `[]`), bounded by `limit`
(1–100, default 100) and `offset` (0–100000, default 0). Master records sort by ID;
visits/reports sort newest event first, then ID ascending. Items sort by Product
ID in UTF-8 byte order (SQLite BINARY collation), consistently across POST,
retries, and GET. Timestamps serialize as UTC ISO strings; nullable optional
properties are omitted, and storage-only fields such as `createdAt` are not exposed.
Visit details contain at most 100 authorized linked reports, or `stockReports: []`
when none exist. Sales Force detail includes only their own reported stock.
Unknown Visit IDs return 404 with `{ "error": "Visit not found" }`.
Unknown routes and unsupported methods return 404 with
`{ "error": "Not found" }`. Read handler/database failures return 503 with
`{ "error": "Service unavailable" }`, never SQL or internal exception details.

```sh
curl http://localhost:8787/health
# Business examples below return 401 without a valid Web session.
curl http://localhost:8787/sales-force
curl http://localhost:8787/outlets
curl http://localhost:8787/products
curl http://localhost:8787/visits
curl http://localhost:8787/visits/VST-0012
curl http://localhost:8787/stock-reports
curl -i http://localhost:8787/visits/unknown # 401 without session; 404 if authorized
```

## Write contracts

No `/api` or version prefix. Both POST endpoints require an `Idempotency-Key`
header containing a UUID generated once per logical submission. These requests
are executable only through an explicitly injected trusted identity for now;
ordinary local/production HTTP requests receive 401.

### `POST /visits`

```json
{
  "outletId": "out-01",
  "visitedAt": "2026-11-04T09:00:00+07:00",
  "notes": "Met owner",
  "followUp": "Call back",
  "stockReport": {
    "reportedAt": "2026-11-04T09:05:00+07:00",
    "items": [{ "productId": "prd-01", "quantity": 0 }]
  }
}
```

`notes`, `followUp`, and the entire `stockReport` are optional. The nested report
inherits the Outlet, Visit, reporter, and channel. Response: **201** with
`Visit & { stockReports: StockReport[] }`, containing only the optional report
created by this submission (not reports linked later). Visit, optional report,
and all items commit together using a Drizzle D1 atomic batch.

### `POST /stock-reports`

```json
{
  "outletId": "out-01",
  "visitId": "VST-0012",
  "reportedAt": "2026-11-04T09:05:00+07:00",
  "items": [{ "productId": "prd-01", "quantity": 0 }]
}
```

`visitId` is optional. Response: **201** with `StockReport`. A linked Visit must
exist at the same Outlet; multiple reports may link to it. The reporter need
not be the Visit's Sales Force member. Report and items commit together.

Shared `createVisitSchema` and `createStockReportSchema` reject unknown fields,
including client-supplied record IDs, Sales Force attribution, channel, and
creation timestamps. Event timestamps require an explicit offset and normalize
to UTC milliseconds. Notes/follow-up are optional strings, not null. Items must
contain 1–100 distinct Product IDs after trimming, with nonnegative safe-integer
quantities (zero included). The item cap keeps reference checks within D1's
100-parameter statement limit. All references are checked before persistence;
existing database constraints remain the final integrity boundary.

Errors use `{ "error": "Concise message" }`:

| Status | Meaning                                                   |
| ------ | --------------------------------------------------------- |
| 200    | Matching retry; same submission response, no new records  |
| 201    | Created                                                   |
| 400    | Invalid JSON/schema/key or Visit/Outlet mismatch          |
| 401    | Missing trusted identity or unknown Sales Force identity  |
| 404    | Unknown Outlet, Product, or linked Visit                  |
| 409    | Same scoped retry key with a different valid payload      |
| 500    | Unexpected write/storage failure; details are not exposed |

### Identity boundary

`createApp(resolveIdentity)` accepts an explicit in-process resolver with signature
`(request: Request, env: ApiBindings) => Promise<TrustedIdentity | undefined>`.
It receives the current request and Worker bindings and returns
`{ salesForceId, submissionChannel }` from a trusted authentication boundary.
The default resolver still returns no identity; providing bindings does not
enable writes.
Business operations in `src/operations.ts` receive that context separately from
the untrusted input, with no HTTP/authentication dependency. Tests construct a
separate app with a fixed test identity; the resolver is not an HTTP endpoint,
binding, header convention, environment flag, or dev-mode bypass.

The default HTTP Worker calls `createApp()` **without a resolver** and always denies
report writes before parsing a body or using D1. Authorization headers and spoofed
identity headers cannot enable it. There is no fake login or test identity in
the deployed entrypoint. Business reads require a valid Web session and live role/assignment scope.

### Internal Bot identity RPC

`src/worker.ts` exports the default Hono application and the named `BotIdentity`
WorkerEntrypoint. Only the Bot's `IDENTITY` Service Binding is configured to call
that entrypoint; it has no fetch handler or public HTTP routes. Methods are
`register`, `me`, `pending`, `approve`, and `reject`. The API validates envelopes,
resolves actors and enforces permissions independently of Bot handlers. Decision
authorization and state/claim guards are checked inside the atomic D1 batch,
not just at handler entry. Ordinary HTTP headers cannot supply this capability.
No D1 binding is exposed to the Bot. See the [Bot runbook](../bot/README.md) for
command grammar, SF verification/claim policy, local bootstrap and integration
tests. Identity/audit fields are never added to existing public read responses.

### Internal Outlet & Schedule RPC

The same named `BotIdentity` entrypoint now exposes `listOutlets`, `getOutlet`,
`createOutlet`, `updateOutlet`, `deleteOutlet`, `ownSchedule`, `listSchedules`,
and Admin-only `createSchedule`. These operations add no public HTTP routes;
the Bot's existing Outlet/Schedule commands call this private surface.
See [the foundation guide](../../docs/design/outlet-schedule-foundation.md) for
contracts, role permissions, ISO/Indonesian weekdays, safe error codes,
50-row keyset pagination, additive migration prerequisites and optional local
synthetic schedule fixtures. Schedule monitoring now additionally intersects current
Supervisor assignments; Admin remains global. Bot RPC contracts are unchanged.

Outlet creation requires `{ businessId, noRs, name }`; both identifiers are opaque
strings (1–256 UTF-16 units, nonblank, no control/format characters), preserving
leading zeros/case. Business ID is unique and immutable through RPC; No. RS is not
unique and is not a phone number. Keys explicitly select `{ businessId }` or
`{ id }` (internal), never both or automatic fallback. Updates take the selected
key plus name/No. RS; legacy internal updates may omit No. RS to preserve null.
No ID changes/backfill/import operation is exposed. `duplicate` also covers a
business-ID collision, enforced by D1 `ON CONFLICT` even for concurrent creates.

`listSchedules` accepts optional `telegramUserId` **instead of** `salesForceId`.
Canonical decimal strings only, max 256 characters, never JS Numbers. Resolution
and query share the authorized D1 batch. Only a current active SF account with an
existing SF and exactly one account reserving that SF is accepted; otherwise
`association_unavailable`. Scalar subqueries avoid duplicate plans. Named SF
filters still select the business plan; role/status/link changes do not move it.
Private Schedule details add Outlet business ID/No. RS and nullable verified
Telegram ID. Public `/outlets` still projects **only `{ id, name }`**; no other
public response was expanded. No private RPC may be proxied without authorization.

Before separately approved API-before-Bot release, apply only pending
`0006_windy_black_crow.sql` after backing up/verifying D1; 0005 is already deployed.
Follow [the manual checklist](../../docs/design/telegram-bot-parity.md#manual-release-checklist).
No remote migration or deployment is run by this change.

### Idempotency

Record IDs remain opaque strings, not sequential counters. The server derives
an ID from SHA-256 of a versioned tuple: operation, trusted Sales Force ID,
trusted channel, and lowercase UUID retry key. A nested report uses the derived
Visit ID plus `-stock`; independent reports use a separate operation namespace.
Clients must retain their key after timeouts and use a fresh key for a genuinely
new observation. Keys are scoped per identity/channel/operation, not globally.

The persisted immutable records are the business operation's retry receipt;
the Telegram wizard's separate draft table stores conversation progress.
Normalized timestamps, exact Visit Outlet IDs (other reference inputs retain
existing trimming), and Product item order are compared semantically;
notes/follow-up remain exact. A retry
returns 200, while changed valid payloads return 409 without overwriting data.
Concurrent insert races are resolved by primary keys, then rereading and
comparing the winner. Failed atomic batches leave no receipt and can be retried.
Visit retries compare only the original nested report, not reports linked later.

This strategy depends on append-only reporting: future edits, deletions, ID
changes, or identity/channel remapping require an explicit receipt/retention
strategy before those features ship. There is no expiration while records exist.

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
pnpm --filter @sales-visit/db test
pnpm --filter @sales-visit/contracts test
pnpm --filter @sales-visit/api exec hono routes
pnpm --filter @sales-visit/api exec hono request /visits/VST-0012
pnpm typecheck
pnpm check
```

Tests use Wrangler's local D1 binding in a disposable directory, apply the real
migrations, seed twice, and verify reads, write contracts, references, identity
rejection, concurrent retries, conflicts, safe errors, and non-BMP Product ID
ordering across POST/retry/GET. A recording, throwing D1 binding verifies the
default Worker rejects writes without any database operations. A test-only SQL
trigger forces a late item failure after parent/earlier-item insertion, verifying actual
D1 rollback and retry recovery for both operations. No frontend tests,
Cloudflare credentials, or changes to your dev database are required.

## Authenticated Telegram Visit wizard

`BotIdentity.visitWizard(actor, input)` is a private API-owned D1 state machine.
Active, registered Sales Force with a current existing SF association can select
an exact known Outlet, record actual Jakarta visit time, skip or enter notes and
follow-up, review, cancel and confirm. No assignment is required. API derives the
SF/channel; the Bot cannot supply either. `createVisit()` is reused with a frozen
UUID/payload and an atomic current-account/draft guard in the insert. Public HTTP
writes remain denied. Migration `0004_misty_red_skull.sql` must precede API, then
Bot deployment. No remote migration/deployment is performed here.

See the [Visit wizard guide](../../docs/design/telegram-visit-wizard.md) for RPC
semantics, 24-hour lazy expiry, state transitions, cancellation/confirmation races,
recoverable receipts, failure guarantees, offline tests and manual acceptance.
`createVisitSchema.outletId` now preserves exact opaque stored values instead of
trimming; independent Stock Report/Product normalization is unchanged.

## Remaining scope

Web authentication, assignment-scoped reads, operational overview aggregates and
bounded server-filtered Web lists are implemented. Web Visit/Stock Report
submission and a dedicated Sales Force workspace remain deferred; public HTTP
report writes stay denied. Telegram Visit submission checks registered identity,
current role/status and SF association at the private boundary and atomically at
insertion. Monitoring assignment is not a submission eligibility rule. Telegram
Stock Report UX and additional operational logging/rate-limit policy remain future
work. Use disposable synthetic fixtures locally, never seed production to satisfy
dashboard acceptance. Deployment and real Telegram/browser smoke verification are
separate operator-controlled steps in the live dashboard runbook.
