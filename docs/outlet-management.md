# A4 — Web Outlet Management

Admin manages Outlet business records from the existing `/outlets` directory
(**Tambah Outlet**) and detail (**Ubah Outlet**, **Hapus Outlet**). This starts
from `main` at merged PR #21 (`817f81b`). Supervisor monitoring remains read-only;
existing Visit/Stock Report ownership and assignment scopes are unchanged.
No Outlet accounts, import/bulk tools, schedule management, Bot command changes,
reporting changes, deployment, or remote D1 operations are included.

## Domain and concurrency decisions

- Reuse `createOutletSchema`, `updateOutletSchema`, `planningIdSchema`, existing
  Outlet timestamp guards and unreferenced predicates, and restrictive D1 FKs.
  No HTTP-to-RPC proxy or caller-supplied actor is introduced.
- Create requires `businessId`, `noRs`, `name`; the server generates an internal
  UUID. Business ID remains unique under SQLite BINARY comparison, case-sensitive,
  opaque, and immutable. Names need not be unique.
- Existing rules apply: identifiers/No. RS are nonblank, at most 256 string units,
  and preserved exactly (including surrounding whitespace); control/format
  characters are rejected. Names are trimmed, nonblank, at most 256 units, without
  control/format characters. No. RS is not interpreted as a phone number.
- Only name/No. RS can change. Omitted No. RS preserves the stored value, including
  legacy null. Existing values cannot be cleared to null/blank. Legacy null business
  IDs remain null and cannot be assigned through update. No backfill is performed.
- Web updates require the exact `expectedName` and nullable `expectedNoRs` reviewed
  when opening the dialog. Concurrent edits (including Bot edits) conflict rather
  than silently overwriting changed values. A matching no-op succeeds without an
  audit event or timestamp change. This compares values, not revisions; an ABA
  change back to the original values is not detected.
- Renamed master names also resolve on historical reports. Visit/Stock Report
  contents, provenance, totals, and relationships are never rewritten.
- Deletion requires no Visit, Stock Report (including standalone), or Schedule
  reference. Detail shows all three usage reasons. Actual SQL rechecks usage;
  restrictive FKs remain the final protection and nothing is cascade-deleted.
  Audit records deliberately do not reference Outlet via FK, so they survive an
  allowed deletion. Telegram draft payloads are not new Outlet FKs; existing Bot
  lookup/submit validation remains unchanged.
- Existing Bot operations retain their existing authorization, contracts and
  last-write-wins behavior. The only incidental implementation adjustment makes
  `OutletOperations`' constructor explicit for Node's native TypeScript test
  loader; it does not change runtime behavior. This is Web audit, not a claim of
  a complete cross-channel master-data audit trail.

## Authenticated API

All routes below require an active Admin's verified Web Bearer session. The
standard CORS/no-store policy applies. Missing, revoked, expired, disabled or
otherwise unusable sessions return 401; active non-Admins return 403. Both
preflight and SQL queries check authorization, including live write-time
revocation/expiry/status/role using the database clock. Request bodies are strict
JSON, bounded to 16 KiB. Inputs are parameterized; composed SQL is constant or
allowlisted. No session, identity profile or SQL diagnostics are returned.

| Route                                        | Input                                                          | Success                                                   |
| -------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------- |
| `GET /admin/outlets/detail`                  | Query `id` (exact internal key, URL bounded to 16 KiB)         | Outlet detail plus `references`                           |
| `POST /admin/outlets/create`                 | `{ operationId, businessId, noRs, name }`                      | 201 `{ ok: true, changed: true }`                         |
| `POST /admin/outlets/update`                 | `{ operationId, id, name, noRs?, expectedName, expectedNoRs }` | 200 `{ ok: true, changed }`                               |
| `POST /admin/outlets/delete`                 | `{ operationId, id }`                                          | 200 `{ ok: true, changed: true }`                         |
| `GET /admin/outlets/operations/new`          | None                                                           | `{ operationId }`, 30-second database-clock deadline      |
| `GET /admin/outlets/operations/:operationId` | Strict operation handle                                        | `{ status: "pending" \| "committed" \| "not_committed" }` |

Invalid input returns 400; missing update/delete targets 404; duplicate business
ID, stale edit, referenced deletion or expired/replayed handle 409; D1 failure or
unsafe stored timestamps sanitized 503. Unsafe timestamps are not implicitly
repaired. Existing `/outlets` ID/name list and `/outlets/:id` read contracts and
operational endpoints are unchanged. Management inherits the foundation's
256-unit key limit; unusually long stored keys require a separately reviewed
limit change rather than normalizing them.

### Audit and uncertain outcomes

Additive migration `0010_acoustic_captain_flint.sql` introduces
`outlet_master_audit` (17 application tables after migration), its Outlet lookup
index, restrictive actor User FK, JSON and action-transition CHECKs. Each event
records invocation ID, acting User selected from the stored session, internal
Outlet ID, action, before/after business fields, and epoch-ms creation time.
No existing table, operational FK, record, or applied migration is changed.

Audit INSERT and mutation share a serialized D1 batch. The INSERT checks the live
Admin session, cutoff, and absence of a receipt for that operation. The mutation
is gated by that invocation's fresh event ID. Failure rolls back both. Failed,
no-op and rejected requests do not add events. Web history must not be pruned or
rewritten during ordinary operation/recovery.

This uses A1/A2's proven fencing pattern, with **dedicated Outlet audit queries,
endpoints and `sales-visit.pending-outlet-operation` sessionStorage key**. It does
not generalize or change account/Sales Force protocols. The browser persists the
credential-free handle before sending one POST; storage failure prevents sending.
All Outlet mutations in the tab stay blocked through close/navigation/reload/
reauthentication until completion. Known 400/401/403/404/409 rejections or completed
2xx responses end the request. Transport/JSON/unknown HTTP/5xx failures retain the
handle and offer explicit GET verification only. A list/detail refresh is never
completion evidence and a failed refresh never retries a POST.

Primary receipt lookup reads the audit range and D1 clock in one statement:
`committed` proves an atomic change, not the current master value;
`not_committed` proves no event and fences delayed writes after cutoff; `pending`
remains unresolved. Lost no-op/rejected responses may need to wait for cutoff.
Lookup/storage failures remain locked. No mutation is automatically retried.
This is tab-scoped protection, not a global lock or an exact per-request receipt.
If deletion removes the detail page after a lost response, return to **Outlet**
via navigation to use the same persisted recovery panel.

## Verification

`apps/api/tests/outlet-management.test.mjs` uses disposable Miniflare D1, migrates
populated pre-A4 data, checks FK integrity, and covers permissions, strict
validation, exact/case-sensitive metadata, generated IDs, audit actor/before/after,
CAS/no-op updates, legacy nulls/timestamps, all independent deletion restrictions,
audit retention/rollback, concurrent mutations/references, live authorization,
receipt isolation/replay/deadline/lost-response fencing, Bot compatibility and
role-scoped operational reads. The explicit API CI list includes the suite.
Per `apps/web/AGENTS.md`, no frontend test framework/tests/dependencies are added.
Browser/OIDC behavior still requires manual verification.

Local results: `pnpm -r --if-present test` passed (contracts 18/18, DB 16/16,
API/Bot integration 187/187, including the 13-test A4 suite).
`pnpm typecheck`, `pnpm check` (lint and format),
`pnpm --filter @sales-visit/db db:check`, `pnpm build:web`, and
`pnpm test:deployment` (167/167) passed. Hono CLI smoke batch passed 7/7
(health and unauthenticated management/catalog denials). Web retains the
non-blocking >500 kB bundle warning; no unrelated build refactor is included.

## Release prerequisites (operator-controlled; not performed)

1. Review/merge only with approval and green CI. Keep automatic CD off and confirm
   no competing deployment writer. Follow [deployment safeguards](ci-cd.md) and
   existing [authentication configuration](web-auth.md); no new resources, vars,
   secrets, BotFather settings or Bot release are required.
2. Verify existing account/Workers/DB identity and migration history through 0009.
   Capture approved backup/Time Travel evidence and recovery plan. Under separate
   operator approval apply only pending `0010_acoustic_captain_flint.sql` using the
   guarded migration procedure. Never replay older migrations or seed real data.
3. Verify audit DDL/index/constraints, unchanged business/history rows, and empty
   `PRAGMA foreign_key_check`. Release **API first**, verify authenticated behavior,
   then **Web** using separately approved targets. Do not select `all` (Web-first).
4. On rollback remove dependent Web first, then API if needed. Leave the additive
   audit table and committed history intact. Code rollback does not undo edits.

### Concise manual checklist

- [ ] Admin: create with business ID/No. RS/name; detail shows exact ID/metadata.
      Duplicate exact ID conflicts; different case succeeds. Blank/control/
      oversized inputs show validation. No account is created.
- [ ] Update name/No. RS; business ID is immutable; legacy nulls remain unchanged
      when omitted. Historical labels resolve the new name. Two dialogs editing
      the same values: first succeeds, stale second requires refresh/review.
- [ ] Delete genuinely unused Outlet with Cancel initially focused; return to
      directory. Visit, independent Stock Report and Schedule references each
      disable deletion with a reason and forced API requests conflict.
- [ ] Lose a POST response; close, navigate, reload, re-login. Other Outlet writes
      remain locked; explicit outcome check resolves committed or cutoff-fenced
      not-committed. Offline/malformed/5xx lookup keeps the lock. Never resend.
- [ ] Failed refresh after confirmed save shows success plus read-refresh advice.
      Check loading/empty/error states, Indonesian copy, keyboard/Escape/focus
      restoration, mobile overflow, and light/dark dialogs.
- [ ] Supervisor has no management controls and API returns 403; monitoring remains
      scoped. Unauthenticated requests return 401. Existing Bot Outlet/Schedule/
      Visit commands, Dashboard, reporting and A1/A2 recovery still work.
