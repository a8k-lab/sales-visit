# A2 — Kelola Sales Force

Admin master-data management at `/master/sales-force`, based on `main` after
PR #19. Sales Force business records remain separate from Telegram accounts.
No identity creation/linking, assignment redesign, lifecycle status, import,
seeding, new Cloudflare resources, merge, remote D1 write, or deployment is
performed by this milestone.

## Onboarding and boundaries

1. Admin creates a business record in **Kelola Sales Force** with an explicit
   code and name. This creates neither a User nor a Telegram identity.
2. The person registers independently with the existing Telegram Bot.
3. Admin opens **Pengguna & Akses**, approves that pending account with role
   `sales_force`, and selects the existing unclaimed master record.
4. Admin uses **Penugasan Supervisor** to assign monitoring responsibility.
5. Existing permission-scoped catalogs, schedules, Visits, Stock Reports and
   Telegram submission continue to use the stored SF identity, never code parsing.

The management page links to both existing administration workflows. The sidebar
and Sales Force directory management entry are Admin-only. Supervisor directory
behavior and `GET /sales-force` contracts are unchanged. The account dialog's
empty-SF state now links to the master page; its operation recovery stays intact.
New records immediately participate in existing approval options, assignment
lists, and operational catalogs according to the existing permissions. Existing
Outlet prerequisites for scheduling still apply.

## Identity, validation, and history

- New IDs: explicit, 1–128 JavaScript string units, no leading/trailing whitespace
  or Unicode control/format characters (`Cc` / `Cf`). No specific partner naming
  convention is required. Case, punctuation and identity are never normalized.
- New/renamed names: 1–200 string units with the same whitespace/control rules.
  Input is rejected, not silently trimmed or rewritten.
- IDs are immutable. Rename/delete targets and pagination cursors preserve exact
  stored legacy IDs, including whitespace, controls, slash/dot segments and IDs
  that predate the new validation. Targets travel in bounded JSON, not URL paths.
- Rename uses the exact name captured when the dialog opened as a compare-and-set
  precondition. Stale names return 409; close, refresh, and reopen to review the
  latest name. A matching unchanged-name request succeeds without another event.
- Names resolve through the existing SF reference, so **historical reports also
  display a renamed name**. The rename dialog explains this before confirmation.

### Audit migration

Additive migration `0009_certain_supreme_intelligence.sql` creates
`sales_force_master_audit` (16 application tables after migration). It records
an invocation ID, acting User, SF business ID, action (`create`, `rename`,
`delete`), previous/new name and epoch-ms creation timestamp. Transition CHECKs
reject malformed events. The actor has a restrictive FK to `users`; the SF ID
**deliberately has no FK** back to the master, so audit survives allowed deletion.
An SF index supports history inspection; the primary key supports receipt lookup.
No existing table, stored ID, FK, assignment, account, or historical audit is
rewritten. Account `access_audit` is not used for these business events.

Every change and its audit execute in one serialized D1 batch. Audit INSERTs
check live session/revocation/expiry using the database clock and current active
Admin role, then select the actor from that stored session. The mutation is gated
by that invocation's unique audit event. Failures roll back both. No-op renames,
duplicates, stale names, unavailable targets and failed deletes add no events.
Concurrent creates/deletes serialize; renames use compare-and-set rather than
silent last-writer overwrites. Separate Admins/tabs can still make independent
changes. This is not a global administrative lock.

## Deletion restrictions

Only genuinely unreferenced records can be deleted. All existing restrictive
FKs remain the final database protection, even if the page's displayed usage is
stale or another writer creates a reference concurrently:

| Referencing table                            | Protected data                                                  |
| -------------------------------------------- | --------------------------------------------------------------- |
| `users.sales_force_id`                       | Any linked account, including disabled or role-changed accounts |
| `sales_force_supervisors.sales_force_id`     | Current Supervisor assignment                                   |
| `supervisor_assignment_audit.sales_force_id` | Assignment history, including past unassignments                |
| `visit_schedules.sales_force_id`             | Visit schedules                                                 |
| `visits.sales_force_id`                      | Visits                                                          |
| `stock_reports.reporter_sales_force_id`      | Stock Reports, including standalone reports                     |
| `telegram_visit_drafts.sales_force_id`       | Existing drafts/receipts, including cancelled/expired workflows |

The list projects usage reasons and disables referenced-row deletion with a
visible explanation. The destructive modal focuses Cancel initially, identifies
its target, warns about permanence, and restores focus to the trigger or heading.
The server still attempts a guarded DELETE under actual FK enforcement; a
restrictive FK error returns `409 referenced_record` and rolls back its audit.
Nothing is cascade-deleted. A referenced identity cannot be replaced by deleting
and recreating it. No bulk deletion or active/inactive system is introduced.
The new master audit alone does not block deletion of an otherwise unused row.

## API contracts and authorization matrix

All routes require the verified Web `Authorization: Bearer <session>` credential.
Client-supplied actor/role/permission fields are rejected. Bodies are strict JSON,
at most 16 KiB. Responses are `no-store`, subject to the existing CORS rules.

| Method and route                                 | Query/body                                                                                 | Success                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `GET /admin/sales-force`                         | `q` (0–200), `after` (exact ID cursor), `limit` (1–100, default 25); URL bounded to 16 KiB | `{ items, next }`                                          |
| `POST /admin/sales-force/create`                 | `{ operationId, id, name }`                                                                | 201 `{ ok: true, changed: true }`                          |
| `POST /admin/sales-force/rename`                 | `{ operationId, id, expectedName, name }`                                                  | 200 `{ ok: true, changed }`                                |
| `POST /admin/sales-force/delete`                 | `{ operationId, id }`                                                                      | 200 `{ ok: true, changed: true }`                          |
| `GET /admin/sales-force/operations/new`          | None                                                                                       | `{ operationId }` with a 30-second database-clock deadline |
| `GET /admin/sales-force/operations/:operationId` | Strict operation handle                                                                    | `{ status: "pending" \| "committed" \| "not_committed" }`  |

List items contain `id`, `name`, `createdAt`, account status summary (no Telegram
profile/ID), nullable `supervisorUserId`, and usage `references`. Management data
is never exposed to Supervisors. The UI displays association/assignment status,
not Telegram identity details. Search is literal substring across ID/name with
SQLite `lower()` (ASCII case folding), ordered by exact ID with keyset pagination.
An absent/deleted cursor can still advance lexically. There is no full-text index
or total-count scan; pages are capped and search can still scan the catalog.

| Caller/result                                                                 | HTTP                                          |
| ----------------------------------------------------------------------------- | --------------------------------------------- |
| Missing/malformed/revoked/expired session; unusable/disabled account          | 401                                           |
| Authenticated active non-Admin (including write-time demotion)                | 403                                           |
| Active Admin, valid request                                                   | As above                                      |
| Invalid JSON/schema/identifier/name/query/transport bounds                    | 400                                           |
| Unknown rename/delete target                                                  | 404                                           |
| Duplicate ID, stale expected name, referenced row, expired/replayed operation | 409                                           |
| D1/service failure                                                            | Sanitized 503, no SQL/token/exception details |

Lists and receipt endpoints also recheck authorization while querying D1, even
when no business rows match. Only allowlisted constant SQL fragments are composed;
all request-derived values are parameterized.

### Uncertain responses: separate, tested master-data fencing

PR #19's account protocol is unchanged: it still resolves only `access_audit`.
A2 has **dedicated endpoints, SQL guards, master-audit lookup, and browser storage
key** (`sales-visit.pending-master-operation`). It uses the existing strict
operation-ID shape, but does not call the account receipt/guard implementation.
Tests explicitly establish that a master receipt is not an account receipt.

1. Obtain a database-clock operation handle from the dedicated endpoint.
2. Persist the credential-free handle in tab `sessionStorage` **before** one POST.
   Storage failure prevents submission. While unresolved, other master mutations
   in that tab are blocked across navigation, row removal, reload and re-login.
3. The audit INSERT requires execution before that handle's deadline (no more
   than 30 seconds ahead) and absence of any master-audit event with that prefix.
   Each invocation has a fresh event suffix; concurrent reuse cannot commit twice.
4. Dedicated lookup uses `withSession("first-primary")` and reads the audit range
   and database clock in one statement: `committed` proves an atomic change;
   `not_committed` proves no change and fences late writes after cutoff; `pending`
   remains unresolved. It does not claim the record's current value.
5. A 2xx response or known application rejection (400/401/403/404/409) completes
   that request. Transport/JSON/unknown HTTP/5xx errors retain the handle and offer
   only explicit GET verification. Lookup failure or malformed outcome does not
   unlock writes. A failed list refresh is not treated as a failed POST.

**No administrative mutation is automatically retried.** A current-record GET or
elapsed browser time is not completion evidence. No-op/rejected lost responses
may require waiting for cutoff because they intentionally have no audit event.
Audit history must not be deleted/rewritten during normal operation or recovery.
Storage corruption/unavailability fails closed; operator-assisted browser storage
recovery is outside the normal UI. This is a tab-scoped safety mechanism, not a
general retry API or an exact-result receipt for every rejected request.

## Local verification

`apps/api/tests/sales-force-management.test.mjs` uses disposable Miniflare D1.
It applies 0009 to a populated pre-A2 database and verifies old rows and FK
integrity; tests also introspect every schema FK to ensure the usage list cannot
quietly omit a newly added relationship. Coverage includes authorization,
validation, duplicate/legacy IDs, pagination/search, rename CAS/no-op/history,
all seven independent deletion restrictions (plus direct SQL rejection), safe
delete/audit retention, atomic rollback before/during/after mutation, concurrent
creates/renames/deletes/new references, live session revocation/disable/demotion/
expiry, operation cutoff/replay/lost-response fencing, and the acceptance
onboarding flow without direct D1 editing or Telegram Admin commands.
The explicit CI API test list includes this file. Existing Bot, account timeout/
recovery, authentication, role scopes and reporting suites remain unchanged.

Required commands passed locally:

```sh
pnpm -r --if-present test
pnpm typecheck
pnpm check
pnpm --filter @sales-visit/db db:check
pnpm build:web
pnpm test:deployment
```

Results: contracts **18/18**, DB **16/16**, API/Bot integration **174/174**,
deployment safeguards **154/154**. Hono CLI smoke batch **9/9** (unauthenticated
management denials, existing account/catalog denials, and health). Typecheck,
lint/format, migration check and Web build passed. Web retains the existing
non-blocking >500 kB bundle warning. No frontend tests/frameworks/dependencies
were added, per `apps/web/AGENTS.md`. These results do not establish real OIDC,
authenticated browser behavior, or deployed correctness; those remain manual.

## Operator-controlled rollout (not performed)

Follow [deployment safeguards](ci-cd.md#separate-manual-d1-migration-procedure),
[Web authentication](web-auth.md), and [Supervisor assignments](supervisor-assignments.md).

1. Review and separately authorize merge, backup, migration and release. Confirm
   automatic CD is OFF and no competing Cloudflare Builds deployment is active.
2. Verify the existing Cloudflare account, API/Web Workers, `DB` database name
   and UUID, OIDC/CORS settings, and Bot Service Binding. No new resource is needed.
3. **Before migration**, capture and privately record an approved D1 backup or
   Time Travel recovery bookmark and a restore plan. Verify the actual applied
   history through 0008. Review 0009 as the only pending migration; stop if history,
   bindings or backup evidence differs. Never replay 0004 or seed production.
4. In a separately approved operator session with D1 write privileges, apply only
   genuinely pending migrations using the existing guarded `pnpm db:migrate:remote`
   procedure. Ordinary deployment/CI does not apply migrations. Verify migration
   history, the new audit table/constraints/index, unchanged operational data,
   and zero rows from `PRAGMA foreign_key_check` before releasing dependent code.
5. Release the approved revision using separate manual targets: **API first**.
   Do **not** use `all`: its Web-first ordering is unsafe for dependent changes.
   Verify Admin list/mutations/outcome endpoints, authorization and existing Bot/
   operational reads before releasing **Web**. No Bot source change is required.
6. Use explicitly authorized test identities/records for the smoke checklist below.
   Stop on any failure. Do not treat automatic retries as recovery.
7. Code rollback: remove dependent Web first, then revert API only if needed.
   Leave the additive audit table and successful history intact. Code rollback
   does not undo master edits, approvals or assignments. Do not drop/rewrite audit
   data or roll back D1 without a separately approved recovery plan.

### Smoke checklist

- [ ] Admin opens **Kelola Sales Force** from sidebar and Sales Force directory.
      Supervisor keeps the old directory; direct management requests return 403.
      Unauthenticated management requests return 401 without disclosing records.
- [ ] Create an explicit mixed-case code/name; verify exact ID, WIB creation date,
      success refresh, literal search and bounded next/first page navigation.
- [ ] Duplicate code, blank/whitespace/control input and oversized values show
      useful validation/conflict feedback without a new audit event.
- [ ] Register a Telegram user independently. In **Pengguna & Akses**, choose the
      new unclaimed master, approve as `sales_force`, then assign a Supervisor
      through **Penugasan Supervisor**. Verify existing permissions/catalogs and
      `/me`. Account creation and assignment must not happen implicitly.
- [ ] If approval choices are empty, follow the contextual master-management link,
      create the missing record, reopen approval and select it.
- [ ] Rename a record; verify immutable code, historical-name warning and existing
      report resolution. Open two Admin dialogs: first rename succeeds, second
      conflicts and requires reviewing refreshed data rather than overwriting it.
- [ ] Safely delete a truly unused test record; retain its master audit. Verify
      referenced rows show a reason/disabled deletion and API rejects forced
      deletion (including disabled account, history-only and cancelled draft cases).
- [ ] Interrupt a POST before its D1 batch. A current row/list GET must not unlock
      writes. Verify `pending`, then `committed` if released before cutoff, or
      `not_committed` and no late mutation if released after cutoff. Never resend.
- [ ] Lose a committed/no-op/rejected response, navigate/reload and reauthenticate;
      verify the separate master outcome panel and persisted write lock. Lookup
      errors/offline/unknown HTTP/5xx keep it locked. A1 account recovery remains
      independent and still works against its own audit.
- [ ] Fail list refresh after confirmed success; keep the success message and
      offer read refresh, never retry the POST. Inspect audit actor/before/after.
- [ ] Keyboard Tab/Shift-Tab, cancel/Escape, delete Cancel initial focus, target
      announcement, focus restoration after row deletion, mobile table scrolling,
      Indonesian validation, loading/empty/error/retry states, light/dark dialogs.
- [ ] Existing Dashboard, scoped reports, Bot registration/Visit submission,
      account-operation cutoff/recovery and Supervisor assignments still work.
