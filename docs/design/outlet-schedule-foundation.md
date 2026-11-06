# Outlet & Schedule backend foundation

Implemented backend scope, now consumed by the Telegram integration described in
[Bot commands and grammar](../../apps/bot/README.md#outlet--schedule-command-grammar).
No dashboard integration yet.
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
  Migration 0006 adds nullable `business_id` (unique BINARY index) and `no_rs`
  (nonunique), both opaque strings. Creation requires both plus name; updates
  change name/No. RS, never either ID. Null metadata on legacy records remains
  valid. No contact, phone, territory or active flag is inferred. No. RS is not
  assumed to be a telephone. See [parity handoff](telegram-bot-parity.md).
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
  No weekday filter means all days, not implicitly today. The `/jadwal`
  handler computes today's name using `Intl.DateTimeFormat("id-ID",
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

| Method           | Input (besides actor)                                    | Active Admin    | Active Supervisor | Active SF          |
| ---------------- | -------------------------------------------------------- | --------------- | ----------------- | ------------------ |
| `listOutlets`    | `{ after? }`                                             | Yes             | Yes               | No                 |
| `getOutlet`      | `{ id }` or `{ businessId }`                             | Yes             | Yes               | No                 |
| `createOutlet`   | `{ businessId, noRs, name }`                             | Yes             | No                | No                 |
| `updateOutlet`   | key + `{ name, noRs }`                                   | Yes             | No                | No                 |
| `deleteOutlet`   | `{ id }` or `{ businessId }`                             | If unreferenced | No                | No                 |
| `listSchedules`  | `{ weekday?, salesForceId? OR telegramUserId?, after? }` | Yes             | Yes               | No                 |
| `ownSchedule`    | `{ weekday?, after? }`                                   | No              | No                | Own linked SF only |
| `createSchedule` | `{ salesForceId, outletId, weekday }`                    | Yes             | No                | No                 |

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
change the enforced SF scope. No identity profiles appear in planning results;
a nullable Telegram ID is included only for a unique current active SF link,
visible to its own SF or authorized monitoring roles. Telegram filters resolve
through identities → users → SF in the same authorized batch. All accounts
reserving that SF count towards ambiguity, including disabled/role-changed users.
Unlinked, disabled, missing or ambiguous targets return `association_unavailable`.
Plans are SF-owned; this cannot prove historical Telegram-user ownership. Role
changes never reassign plans; no historical crosswalk is guessed.

Permission reads, guarded operations and diagnostic reads share a serialized
D1 `batch`. Mutations also carry the authorization predicate in the actual SQL,
not a stale preflight check. Concurrent changes serialize: an operation committed
before a disable/demotion can succeed; one ordered after it is denied. No role
cache or permission snapshot survives a call. SQL is parameterized and follows
the existing identity batch pattern; Drizzle owns schema/migrations/relations.

### Results and bounded reads

Use `PlanningResult<T>`: `{ ok: true, data }` or `{ ok: false, code }`.
Codes: `invalid`, `forbidden`, `not_found` (Outlet), `referenced` (Outlet deletion),
`duplicate` (assignment or Outlet business ID), `reference_not_found` (assignment SF/Outlet),
`association_unavailable` (Telegram target lacks a unique active SF link),
`unavailable` (sanitized database failure). Unauthorized callers do not receive
record-existence diagnostics. No SQL details or profile payloads are returned.
Validation occurs before database access; malformed input returns `invalid`
regardless of actor permission.

Outlet update/delete also check timestamp types and the signed JavaScript safe
integer range inside the mutation SQL, in the same authorized D1 batch as the
existence diagnostics. If either stored timestamp cannot satisfy the numeric
read contract, authorized mutations return `unavailable` without modifying the
row (including no implicit repair of `updated_at` during update). D1's wider
signed 64-bit values are preserved for explicit operator review, never rounded
into response values. Safe negative timestamps and nullable `updated_at` remain
supported. The numeric read contract does not represent integers beyond that
safe range.

Lists return `{ items, next }`, at most **50** rows ordered by opaque internal
ID ascending (SQLite BINARY). Pass `next` as `after`, retaining the same filters;
null ends traversal. Each call is a consistent snapshot, not a multi-page frozen
snapshot: concurrent insertions may precede an already consumed cursor. Cursors
are not credentials. Details include signed safe-integer epoch-millisecond storage
timestamps, preserving pre-1970 legacy values (Outlet `updatedAt` nullable);
schedules additionally include business SF/Outlet names, Outlet business ID/No. RS
and nullable verified Telegram ID, never full User profiles. Private Outlet details
include nullable business ID/No. RS. Existing public `Outlet` remains `{ id, name }`.

Inputs are strict; names are trimmed, nonblank and bounded to 256 characters.
Operation IDs and cursors are nonblank and bounded to 256 characters, but are
**never trimmed or normalized**: surrounding whitespace is part of an opaque
key. C0 controls, DEL and C1 controls (U+0080–U+009F) are rejected in inputs;
normal Unicode names remain supported. Planning read-model IDs and
SF/Outlet references also preserve exact stored values; read models do not impose
the input length limit. No shared Visit/Stock Report identifier behavior or
stored rows are changed. IDs longer than 256 characters require a reviewed
operation-limit change before management or use as a page cursor through RPC.

## Bot use and synthetic provisioning

After trusted private-chat handling, command code calls the existing RPCs:

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

The Bot handles all result codes, opaque token round-tripping, filter-preserving
pages and bounded plain-text Telegram messages. See its README for exact grammar
and limitations. Migration 0006 must precede the updated API, then dependent Bot.
Do not expose this capability through a public HTTP proxy/test-auth bypass.
Telegram handlers now exist; no operational provisioning CLI is introduced. `createSchedule` has
no retry receipt: an identical retry returns `duplicate`, not a second row.
Outlet create has no retry receipt; the unique business ID prevents duplicate
business records. Reconcile list/detail results after an ambiguous transport failure
before retrying; a retry returns `duplicate`, not the first creation receipt. Updates are last-write-wins; no revision
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
names or other business data while these reads are public. Web/OIDC, Visit wizard, real-data import, remote migrations/deployment and bot
cutover remain outside this foundation and its Telegram integration.
