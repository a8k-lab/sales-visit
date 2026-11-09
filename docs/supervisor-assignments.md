# Supervisor Assignment & API Scoping

## Architecture and MVP policy

This milestone advances assignment administration beyond ADR-0006's initial static-first phase; it does **not** convert the mock reporting dashboard or browser-local submission form to live data. It preserves ADR-0002's two-channel roadmap and ADR-0003's independent Visit/Stock Report reporters.

An active Admin manages explicit **current Supervisor assignments**. A Supervisor can monitor many Sales Force members; each Sales Force has zero or one Supervisor. No assignment is inferred from a Sales Force code, location, username, Outlet, or shared schedule. There are no formal Sales Groups, territories, spreadsheet imports, or production seeds.

Migration `0008_demonic_princess_powerful.sql` is additive after 0000–0007:

- `sales_force_supervisors`: Sales Force PK/FK, Supervisor User FK, created/updated integer milliseconds. Supervisor lookup index supports scoped reads. It is separate from `users.sales_force_id` (an account's own Sales Force identity association), avoiding circular FKs.
- `supervisor_assignment_audit`: event ID, actor User, target Sales Force, previous/new Supervisor Users, `assign`/`reassign`/`unassign`, timestamp. Restrictive FKs retain referenced history; a CHECK validates action/transition shape and an SF index supports operator inspection. Audit records are not exposed through Web/Bot reads.
- Drizzle relations model the current assignment and history. Existing tables/records, mappings, reports, drafts, sessions, and schedules are untouched; no backfill is performed. Existing Sales Force records start unassigned. Expected application-table count becomes **15**.

The assignment PK enforces cardinality. Server operations enforce current role/status; a FK alone cannot establish that a User is an active Supervisor.

## Authorization and lifecycle

| Surface                        | Active Admin           | Active Supervisor                 | Active Sales Force           |
| ------------------------------ | ---------------------- | --------------------------------- | ---------------------------- |
| Assignment options/list/update | Allowed                | 403                               | 403                          |
| Web `/sales-force`             | All ID/name references | Currently assigned members only   | Existing 403 policy retained |
| Web `/visits`, `/visits/:id`   | All                    | Current assignment of Visit owner | Own only                     |
| Web `/stock-reports`           | All                    | Current assignment of reporter    | Own reporter only            |
| Nested Visit Stock Reports     | All                    | Independently scoped by reporter  | Own reporter only            |
| Web `/outlets`, `/products`    | ID/name catalog        | Same catalog                      | Same catalog                 |
| Bot `/jadwalsales`             | Global                 | Current assignments only          | Denied                       |
| Bot `/jadwal`                  | Denied                 | Denied                            | Own schedule, unchanged      |

Web uses the existing verified Telegram OIDC-backed opaque Bearer session. Missing, invalid, expired, revoked, inactive or unavailable-role accounts receive 401. Authenticated non-Admins receive 403 from assignment routes; request bodies cannot provide actor/role. No public bypass, new credentials, or dev switch exists.

Operational SQL predicates resolve the live active User and current assignment, before pagination and in direct detail lookups. Filters are additional intersections, never replacements for scope. An inaccessible Visit returns exactly the same 404 as a nonexistent Visit. Reporter scope is enforced independently inside the nested SQL query: another team's Stock Report cannot be disclosed just because it references an accessible Visit. Reference catalogs remain unchanged.

Bot `ScheduleOperations` resolves User ID and current role from the Telegram identity delivered through the existing private `BotIdentity` binding. Selected Sales Force/Telegram filters, weekday and cursor all intersect assignment scope. A selected Telegram ID is a target filter, never the actor. No RPC contract, Bot command UX, webhook, secret, or Service Binding configuration changes are needed; all Bot-facing changes are in the API Worker.

### Edge cases

- **Reassigned:** all historical Visits, reports and schedules follow the **current assignment**, not the assignment at recording time. The old Supervisor loses access and the new one gains it on the next request, even using previously issued sessions.
- **Unassigned:** Admin and the member's own Sales Force account retain their normal access. No Supervisor sees that member's records. A Supervisor without assignments gets empty collections, never global fallback.
- **Disabled Supervisor:** assignment rows survive, but cannot confer access while inactive. Assignment selection rejects the account. Admin can explicitly reassign/unassign. Re-enabling restores current-role access (including existing unexpired/unrevoked sessions), following existing identity policy.
- **Role changed:** retained rows confer no Supervisor permission to an Admin or Sales Force role. Admin independently has global access by role; Sales Force has only its verified own-record scope. Rows can be removed/reassigned. Changing back to an active Supervisor restores retained assignments. No lifecycle cleanup or unaudited reassignment is introduced.
- **Concurrent Admins:** D1 batches serialize writes; **last committed valid request wins**, intentionally no optimistic-lock token. Each audit event records the actual predecessor in that same transaction. The UI confirms the intended target but is not a locking mechanism; reload to inspect other Admins' changes. Duplicate desired-state requests produce no audit event or timestamp churn.

Each mutation batch checks the live session/active Admin, Sales Force existence, and active Supervisor eligibility, inserts the conditional audit event, then mutates only if that invocation's random audit ID exists. The response is read in the same batch. Either history and assignment both commit or neither does. No-op repeats add no events; rejected requests do not mutate. Direct privileged SQL remains an operator trust boundary, not a supported assignment API.

## HTTP routes

No `/api` prefix; JSON responses; `Cache-Control: no-store`. All three routes require an active Admin Web session. PUT bodies are bounded to 2 KiB and strictly contain only `supervisorUserId`.

- `GET /supervisors?after=<user-id>`: active Supervisor options, `{ items: [{ id, name }], next: string | null }`. Up to 100 per page, ordered by User ID. The UI consumes all pages; identity display snapshots are labels, never credentials.
- `GET /supervisor-assignments?limit=50&after=<sales-force-id>`: `{ items, next }`, 1–100 rows (default 50), ordered by SF ID. Each row: `salesForceId`, `salesForceName`, nullable `supervisorUserId`, `supervisorName`, `supervisorStatus`, `supervisorRole`. Includes unassigned members and retained inactive/non-Supervisor rows so Admin can fix them.
- `PUT /sales-force/:id/supervisor`: `{ "supervisorUserId": "<internal-user-id>" }` assigns/reassigns; `null` unassigns. Returns the updated assignment row, 200 including no-ops. Invalid input or unknown/inactive/non-Supervisor target: 400. Unknown Sales Force: 404. Store IDs exactly; URL-encode path/cursor IDs (nonblank, at most 256 UTF-16 units, no ASCII controls). Role/status/actor/Telegram IDs in the body are rejected.

D1 failures return sanitized 503, never SQL or bindings. Existing CORS exact-origin policy now permits PUT preflights with Authorization/Content-Type; no-Origin is not an authentication bypass.

Operational list contracts remain bare arrays with existing bounded `limit`/`offset`. `/visits?salesForceId=...` and `/stock-reports?reporterSalesForceId=...` (also `salesForceId`) intersect authenticated scope. Sales Force filters targeting another member retain 403. Cursor pages/options may change between requests as accounts/assignments change; no stable export snapshot is promised.

## Admin Web page

`/supervisor-assignments` (menu **Penugasan Supervisor**) is Admin-only in navigation and renders denial for other roles; the API independently enforces authorization. Uses existing shadcn/ui components and a feature directory. Lists current assignments with active options, null/unassign selection, confirmation, Indonesian loading/empty/success/error states, reload and bounded pagination. Retained unavailable assignments are labeled without granting access. Dashboard reports remain synthetic; this page alone is labeled operational and persists to D1. API errors hide stale rows until reload. A transport failure can be an uncertain commit; reload before retrying (a satisfied retry is a no-op).

## Local verification evidence

`apps/api/tests/supervisor-assignments.test.mjs` uses disposable local Miniflare D1, the real private Worker RPC entrypoint and production Web route/auth logic with synthetic hashed sessions. It seeds a populated pre-0008 database, snapshots existing records, applies 0008, compares every row and verifies foreign keys. Fixtures include two Admins for races, two assigned Supervisors, an unassigned Supervisor, active/disabled/pending users, multiple team members and an unassigned member, Visits, cross-owner Stock Reports/items and schedules.

Tests cover 401/403, strict body/ID validation, eligibility, paginated administration, scope before limit/offset and cursor filtering, cross-team details/nested reporters, unassignment/reassignment with old sessions, lifecycle disable/role changes, invalid RPC actors, Bot filters/own behavior, concurrent writers/no-ops, actual-predecessor audit integrity, transaction-time authorization/session revocation, rollback on injected batch failure, preserved populated data and FK constraints. Existing Bot wizard, webhook, planning, auth and reporting tests remain; legacy monitoring tests now explicitly assign their synthetic members.

Required local checks: `pnpm -r --if-present test`, `pnpm typecheck`, `pnpm check`, `pnpm --filter @sales-visit/db db:check`, `pnpm build:web`, `pnpm test:deployment`. No frontend testing framework added. Browser usability and real Telegram/operator acceptance remain manual checks, not claimed by these tests.

## Operator-controlled rollout checklist

**Nothing below is executed by this PR. Do not merge, migrate, deploy, change webhooks or enable CD automatically.** Use existing [CI/CD guards](ci-cd.md), approved current-main revision, target verification and restricted operator change record.

1. Review/approve the PR and local/CI evidence. Keep `ENABLE_AUTO_DEPLOY=false`, disable competing deployment writers, verify existing Worker names/D1 UUID, API vars/OIDC origins/rate limiters and `BotIdentity` binding. Record current API/Web revisions. Arrange a maintenance window or restrict Supervisor use until the scoped API is verified: old API code still has global Supervisor access.
2. Confirm remote history 0000–0007 is present exactly once, and **0008 is the sole pending migration**. If earlier migrations are missing, stop and reconcile through their own approved procedures; do not replay/edit historical migrations or load local seeds.
3. **Backup/recovery checkpoint:** privately capture and verify a usable D1 Time Travel bookmark or approved backup plus restore procedure/retention, selected account/database, current schema/counts and empty FK check. Record assignment/audit table baseline and code revisions. Stop if recovery evidence is unavailable. Never log sessions, tokens or Telegram profiles.
4. After separate operator approval, run the existing guarded `pnpm db:migrate:remote` on verified main. Apply only pending 0008. Use `pnpm db:verify:remote` and guarded history inspection; expect 0000–0008 once, 15 application tables, both new tables/indexes, all prior counts preserved, empty assignment/history initially, and `PRAGMA foreign_key_check` empty. No new remote seeds/backfill.
5. Dispatch manual deployment **target `api`**, validation-only first, actual release only after approval. All existing migration/resource/revision/rate-limiter/health guards remain mandatory. Do not select `all`: current orchestration starts Web before API. Verify unauthenticated denial, non-Admin assignment denial, unassigned-Supervisor empty Web/Bot results, Admin global access and unchanged Sales Force `/jadwal`/reporting. `/health` alone is insufficient.
6. **Bot deployment is not required:** RPC contracts and Bot source are unchanged; existing Bot receives scoped schedules from the newly deployed API. If a dependent Bot change is later approved, deploy it separately only after API compatibility verification, preserving webhook/secret behavior.
7. Deploy **target `web`** separately (validation-only, then approved actual release). Check direct SPA route, Admin-only menu/denial, loading/error/empty states, active options, confirmation/cancel, assign/reassign/unassign and refresh; verify old Supervisor session loses historical access and new one gains it. Use only approved operator-managed records for acceptance, not production seeds. Confirm all other dashboard reports remain clearly synthetic. Verify Bot monitoring filters/pagination using verified actors without exposing credentials.
8. Inspect restricted assignment audit/FK integrity and sanitized error rates. Sign off and end the maintenance window. Keep automatic CD off unless separately authorized. On failure stop; do not fall back to old globally permissive Supervisor code as a security-safe rollback. Prefer a reviewed forward fix or restrict access during recovery. Worker rollback does not undo assignments/audit or restore old authorization semantics safely. Restore D1 only with explicit approval and reconciliation of all intervening visits, reports, schedules and identity writes; never drop audit/tables as a shortcut.

## Limitations / deferred work

Current-assignment visibility is intentionally not historical team snapshots. Audit is restricted operator-readable history, not tamper-proof against database operators; retention/backup policy needs operational ownership. No optimistic conflict warning or live multi-admin refresh; last valid commit wins with a complete audit chain. Retained inactive-role rows can regain effect after approved lifecycle reactivation. Large Supervisor option sets are loaded in pages but not virtualized. No live dashboard reporting, Web Visit/Stock Report submission, approvals, formal groups/geography, imports, new infrastructure, session administration UI, or automatic deployment is included.
