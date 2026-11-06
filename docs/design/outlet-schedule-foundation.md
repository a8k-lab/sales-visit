# Outlet & Schedule backend foundation

Implemented backend scope; no Telegram commands or dashboard integration yet.
Behavioral reference: [rtrivaldo/telegram_bot](https://github.com/rtrivaldo/telegram_bot/tree/e7de4a9965b2a815160bd389a89be5fa6b1b73a7),
particularly `src/services/{outlet,schedule}.service.ts` and
`src/repositories/schedule.repository.ts`. Credit to its original contributors
for the Indonesian weekday vocabulary, own/monitoring schedule distinction and
referenced-Outlet deletion behavior. This is an independent D1/RPC implementation;
no source, seed identities or business data were copied. See the broader
[alignment review](telegram-bot-integration-alignment.md) for deferred parity.

## Data and assumptions

- Reuse `outlets.id` (opaque internal FK target) and `name` (non-unique label).
  The API generates a UUID on creation; callers cannot select/change IDs.
  Only name is editable in this milestone. No business ID, `no_rs`, contact,
  phone, territory or active flag is inferred. Business ID and `no_rs` remain
  explicitly deferred until partner validation; they are distinct from each
  other and the internal ID. This deliberately limits legacy command parity.
- Add nullable `outlets.updated_at`: null means the legacy row's last change
  time is unknown. API create/update sets integer epoch milliseconds at D1
  receipt (second precision). No fabricated migration-time backfill.
- `visit_schedules`: opaque ID, required SF/Outlet FKs, `weekday`, integer
  millisecond `created_at`/`updated_at`. Each row is a weekly recurring plan,
  **not an actual Visit**, and never creates Visits or Stock Reports.
- Canonical ISO weekdays: **1 senin, 2 selasa, 3 rabu, 4 kamis, 5 jumat,
  6 sabtu, 7 minggu**. This differs from JS `Date.getDay()` (Sunday=0).
  `indonesianWeekdaySchema` trims/lowercases Indonesian names into this numeric
  representation. RPC inputs accept only canonical integers, not strings.
  No weekday filter means all days, not implicitly today. A future `/jadwal`
  handler should compute today's name using `Intl.DateTimeFormat("id-ID",
  { weekday: "long", timeZone: "Asia/Jakarta" })`, then use that schema.
- Unique `(sales_force_id, outlet_id, weekday)` prevents identical assignments.
  Multiple Outlets per SF, multiple SF per Outlet, and different weekdays for
  the same pair are allowed. Plans belong to business SF records, not Users
  or Telegram accounts. Indexes cover SF lookups (unique index prefix), Outlet
  reference checks and weekday filtering.
- All schedule FKs restrict key updates/deletes. Outlet deletion is blocked by
  any Schedule, Visit or Stock Report, including independent reports. Historical
  report rows are never cascaded or deleted by these operations.

No effective dates, exceptions, history, automated schedule enforcement, or
assignment update/delete operation is introduced. Creating a plan does not
require an active User linked to that SF; it requires an existing business SF.
A later lifecycle/history policy must define reassignment and archival.

## Trusted operations and permissions

All methods extend the existing **named `BotIdentity` WorkerEntrypoint** and
`BotIdentityService` interface. The existing Bot `IDENTITY` Service Binding is
the capability; no additional binding/configuration or HTTP route is needed.
The name is retained for deployment compatibility despite the broader scope.

| Method           | Input (besides actor)                 | Active Admin    | Active Supervisor | Active SF          |
| ---------------- | ------------------------------------- | --------------- | ----------------- | ------------------ |
| `listOutlets`    | `{ after? }`                          | Yes             | Yes               | No                 |
| `getOutlet`      | `{ id }`                              | Yes             | Yes               | No                 |
| `createOutlet`   | `{ name }`                            | Yes             | No                | No                 |
| `updateOutlet`   | `{ id, name }`                        | Yes             | No                | No                 |
| `deleteOutlet`   | `{ id }`                              | If unreferenced | No                | No                 |
| `listSchedules`  | `{ weekday?, salesForceId?, after? }` | Yes             | Yes               | No                 |
| `ownSchedule`    | `{ weekday?, after? }`                | No              | No                | Own linked SF only |
| `createSchedule` | `{ salesForceId, outletId, weekday }` | Yes             | No                | No                 |

Pending/rejected/disabled/unregistered actors get no protected access. SF with
no valid SF association is also denied. Roles are exclusive: an Admin or
Supervisor with an SF link does not become SF. Supervisor monitoring is across
all SF for now; territorial/team scope is deferred.

The Bot must verify the webhook and private chat and construct `BotActor` from
actual `from.id`, never a command argument, forwarded contact or chat ID. The
API independently validates the actor, resolves Telegram identity → User in D1,
and checks **current** active status, role and (for own queries) existing SF link.
Caller-supplied role/status/SF fields in actor envelopes are rejected. Selected
SF in monitoring/provisioning inputs is a target/filter, never authorization.
Own filters reject selected identities entirely; arbitrary page cursors cannot
change the enforced SF scope. No identity profiles appear in planning results.

Permission reads, guarded operations and diagnostic reads share a serialized
D1 `batch`. Mutations also carry the authorization predicate in the actual SQL,
not a stale preflight check. Concurrent changes serialize: an operation committed
before a disable/demotion can succeed; one ordered after it is denied. No role
cache or permission snapshot survives a call. SQL is parameterized and follows
the existing identity batch pattern; Drizzle owns schema/migrations/relations.

### Results and bounded reads

Use `PlanningResult<T>`: `{ ok: true, data }` or `{ ok: false, code }`.
Codes: `invalid`, `forbidden`, `not_found` (Outlet), `referenced` (Outlet deletion),
`duplicate` (assignment), `reference_not_found` (assignment SF/Outlet),
`unavailable` (sanitized database failure). Unauthorized callers do not receive
record-existence diagnostics. No SQL details or profile payloads are returned.
Validation occurs before database access; malformed input returns `invalid`
regardless of actor permission.

Lists return `{ items, next }`, at most **50** rows ordered by opaque internal
ID ascending (SQLite BINARY). Pass `next` as `after`, retaining the same filters;
null ends traversal. Each call is a consistent snapshot, not a multi-page frozen
snapshot: concurrent insertions may precede an already consumed cursor. Cursors
are not credentials. Details include epoch-millisecond storage timestamps (Outlet
`updatedAt` nullable); schedules additionally include business SF/Outlet names,
not Telegram/User profile data. Existing public `Outlet` remains `{ id, name }`.

Inputs are strict; operation IDs and names are trimmed, nonblank, bounded to 256
characters, with control characters rejected. Existing stored IDs remain opaque;
no schema rewrite or new uniqueness rule is imposed on legacy Outlets. Previously
out-of-contract IDs longer than 256 characters would require a reviewed repair
or changed operation limit before management through RPC.

## Future Bot use and synthetic provisioning

After trusted private-chat handling, future command code can call:

```ts
// actor is derived from the authenticated update, never command arguments.
const result = await env.IDENTITY.ownSchedule(actor, { weekday: 1 });
// An independently verified active Admin can provision a synthetic assignment:
const created = await env.IDENTITY.createSchedule(adminActor, {
  salesForceId: "sf-01",
  outletId: "out-01",
  weekday: 1,
});
```

Handle result codes, bounded pages and Telegram message limits in the next PR.
Do not expose this capability through a public HTTP proxy/test-auth bypass.
No such handlers or operational CLI are implemented here. `createSchedule` has
no retry receipt: an identical retry returns `duplicate`, not a second row.
Outlet create has no idempotency key; reconcile list results after an ambiguous
transport failure before retrying. Updates are last-write-wins; no revision
locking or master-data audit trail is claimed. Access lifecycle audit remains
unchanged. Production audit/retention and assignment management remain follow-up
requirements before real operational use.

For **local synthetic development only**, an optional repeatable SQL fixture
uses the existing `seeds/local.sql` SF/Outlet records. From the repository root:

```sh
pnpm db:migrate:local
pnpm db:seed:local
pnpm --filter @sales-visit/api exec wrangler d1 execute DB --local --file seeds/schedules-local.sql
```

This adds four plans demonstrating multiple Outlets, shared Outlets and Sunday.
It never provisions Users or grants access, and never creates reports. Do not
use it against real data or add `--remote`. Existing assignments are not changed;
conflicting synthetic IDs fail rather than overwrite unrelated rows. Authorized
RPC provisioning is preferred when exercising an actual trusted actor. Automated
`apps/api/tests/planning.test.mjs` creates disposable Miniflare identities and
assignments, checks this exact seed twice, and disposes everything afterward;
no production bootstrap values are required.

## Migration and release boundary

Apply earlier migrations through `0002_open_lucky_pierre.sql` before the additive
`0003_greedy_spot.sql`. It creates `visit_schedules`/constraints/indexes and adds
nullable `outlets.updated_at`; no applied migration is edited, no table rebuilt,
no database reset or record backfill is needed. Run `pnpm --filter @sales-visit/db
db:check` and tests; local migration commands above target only the API-local
sandbox. The database package sandbox is separate. Review target/backups and
follow the deployment runbook under separate approval before any remote change.
Deploying API code before applying the migration would make new operations
unavailable; migration must precede future API release.

Existing public business GETs remain backward-compatible, unauthenticated and
**synthetic-only**; they expose neither schedules nor private identity fields.
Visit/Stock Report HTTP writes remain deny-by-default. Do not load real Outlet
names or other business data while these reads are public. Web/OIDC, Telegram
commands, Visit wizard, real-data import, remote migrations/deployment and bot
cutover are outside this change.
