# A1 — Pengguna & Akses

Admin-only account management at `/users`, backed by the same D1 users,
Telegram identities, and access audit as Telegram Bot. This is not master-data
CRUD, manual account creation, or a new identity verification channel.

## Lifecycle and permissions

Users register themselves with `/register` in Telegram. The stored verified
Telegram profile snapshot is displayed; Web cannot supply or replace it.
An existing active Admin signs in using the existing Telegram OIDC Web session.
No bootstrap/recovery account is created by this feature.

| Operation                                       | Target / prerequisites                                | Result                                        |
| ----------------------------------------------- | ----------------------------------------------------- | --------------------------------------------- |
| List accounts / eligible SF                     | Active Admin only                                     | Bounded pages of stored records               |
| Approve                                         | Pending, no existing role/link; exactly one role      | Active Admin, Supervisor, or Sales Force      |
| Approve Sales Force                             | Existing, unclaimed SF ID required                    | Immutable association to that business record |
| Reject                                          | Pending, no existing role/link                        | Rejected; final in the existing lifecycle     |
| Change role                                     | Active account; active Admin demotion prohibited      | Access changes immediately; SF link retained  |
| Change to Sales Force                           | Explicit existing SF ID; unclaimed or owned by target | Existing link cannot be replaced              |
| Disable                                         | Active non-Admin                                      | Disabled; role, SF link, assignments retained |
| Enable                                          | Disabled account                                      | Active with stored role and associations      |
| Delete / manual creation / identity replacement | Never                                                 | Not implemented                               |

All active Admins are protected from demotion and disabling (stronger than the
last-active-Admin invariant). The last Admin returns `last_admin`; otherwise a
protected change returns `protected_admin`. Admin promotion is therefore an
important deliberate grant; reversal needs the separately reviewed operator
recovery procedure, not Web or Bot administration.

Supervisor assignments are never silently edited. Effective monitoring access
still requires an **active Supervisor** and the existing assignment. Assignment
rows can remain attached to disabled users or users whose role changed. A newly
approved active Supervisor immediately appears in `GET /supervisors`, which
feeds the existing **Penugasan Supervisor** page.

A matching role/status operation is a successful no-op with no extra audit event.
Repeated approval/rejection is rejected as `not_pending`, also without an extra
event. Rejected users cannot register again, be approved, or be enabled.
Disabling immediately removes effective Web/Bot access. As before, enabling can
restore an unexpired, unrevoked Web session; this PR does not change session policy.

## HTTP contracts

All routes require the existing `Authorization: Bearer <web session>` header.
No actor fields are accepted. Mutation targets are **internal User IDs**, resolved
against stored identities in SQL, never client-supplied Telegram identities.
JSON mutation bodies are strict and bounded to 16 KiB.

| Method / path                              | Query or JSON body                                                            | Success                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `GET /admin/users`                         | `after` (default empty), `limit` (1–100, default 50), optional exact `status` | `{ items: ManagedAccount[], next: string \| null }`               |
| `GET /admin/users/sales-force-options`     | `after` (default empty)                                                       | `{ items: { id, name }[], next }`, at most 50                     |
| `GET /admin/users/:id`                     | URL-encoded internal User ID                                                  | `Account` (informational current state, not operation completion) |
| `GET /admin/users/operations/new`          | None                                                                          | `{ operationId }`, database-clock cutoff in 30 seconds            |
| `GET /admin/users/operations/:operationId` | Issued operation ID                                                           | `{ status: "pending" \| "committed" \| "not_committed" }`         |
| `POST /admin/users/approve`                | `{ operationId, userId, role, salesForceId? }`                                | `Account`                                                         |
| `POST /admin/users/reject`                 | `{ operationId, userId }`                                                     | `Account`                                                         |
| `POST /admin/users/role`                   | `{ operationId, userId, role, salesForceId? }`                                | `Account`                                                         |
| `POST /admin/users/disable`                | `{ operationId, userId }`                                                     | `Account`                                                         |
| `POST /admin/users/enable`                 | `{ operationId, userId }`                                                     | `Account`                                                         |

`status`: `pending`, `active`, `disabled`, `rejected`; omit for all users.
Pending registrations use `GET /admin/users?status=pending`, not a separate route.
`role`: exactly `admin`, `supervisor`, or `sales_force` (no Web legacy alias).
`salesForceId` is required only for `sales_force`, forbidden for other roles,
and compared verbatim to storage. IDs/cursors are bounded to 256 characters.
Lists use ascending ID keyset pagination, not offsets; an empty page is genuine.
Eligible SF options exclude claims by **any** account, including disabled accounts.
The role dialog also offers the target's already-owned immutable association.

`Account` is the shared identity contract: `id`, `telegramUserId`, `status`,
nullable `role`, `salesForceId`, `username`, `firstName`, `lastName`, and epoch-ms
`createdAt`. `ManagedAccount` additionally includes nullable `salesForceName`.
No session hashes, OIDC proofs, or audit internals are returned.

Errors have `{ error: string }`:

- **401:** absent, malformed, expired, or revoked credential; disabled/unapproved
  account; otherwise unusable session.
- **403:** valid non-Admin session, including demotion after middleware.
- **400:** malformed JSON, invalid schema/filter/limit, oversized body.
- **404:** unknown target (only after Admin authorization).
- **409:** lifecycle conflict: `not_pending`, `invalid_transition`,
  `association_locked`, `sales_force_unavailable`, `protected_admin`, `last_admin`.
- **503:** sanitized service/D1 failure; no SQL, credential, or exception details.

No full-text search is added: bounded exact filters and indexed ID pagination are
the intentionally small initial contract. Concurrent decisions use the serialized
D1 predecessor, not a stale browser state. A conflicting SF claim must be reviewed
and selected again, never bypassed.

## Security and audit integrity

`IdentityOperations` shares lifecycle predicates between the existing Bot methods
and an internal Web adapter. Bot methods retain strict `BotActor` validation and
the original named `BotIdentity` Service Binding contract. The Web adapter is not
exposed by that Worker entrypoint; there is no public RPC dispatcher or trusted
Telegram actor synthesized from Web input.

Every privileged audit INSERT checks the live Web session hash, revocation state,
expiry **at database execution time**, actor active status, current Admin role,
target lifecycle, and SF ownership inside the serialized D1 batch. The following
UPDATE is gated by that invocation's unique audit ID. Actor ID is selected from
the stored session, not the request or a cached account. A stale preflight check
cannot authorize a write. Read pages also check authorization in the same batch,
including when no rows match. Denials disclose no target information.

`access_audit` records actor, target, action, previous state, and resulting state.
Audit and target change commit or roll back together, including failure in a
statement after the UPDATE. No-op operations add no duplicate event. Existing
CORS, no-store headers, OIDC, one-hour session lifetime, and 60-second visible-page
refresh policy are unchanged. No migration, Cloudflare binding/resource, CI/CD
activation, webhook, or production data changes are required by A1.

## Operation outcomes: bounded writes, no new receipt table

A browser timeout does not cancel a Worker or its D1 batch. **One account GET,
an expected status, or elapsed browser time cannot prove completion.** A1 now
uses a small operation protocol instead of that unsafe inference:

1. An authenticated Admin obtains `operationId = web:<deadline-ms>:<UUID-v4>`
   using the primary D1 clock. The deadline is encoded once, so POST and lookup
   cannot use different cutoffs. The allocation is stateless, not an authority
   grant; every write still needs the live session/Admin guard.
2. Web persists that credential-free handle in tab-scoped `sessionStorage`
   **before** submitting one POST. All account writes in that tab are blocked
   while it is unresolved, including after row removal, navigation, reload, or
   reauthentication. Storage failure before POST prevents submission.
3. Inside the atomic audit INSERT, SQL also requires database time **before**
   that deadline and a window no larger than 30 seconds. An already-recorded
   operation cannot record another change. Each invocation still has a fresh
   audit ID (`operationId:invocation-UUID`); a replay cannot reapply an earlier
   audit's state. Bot audit IDs/contracts are unchanged.
4. An Admin-only lookup reads the indexed audit-ID prefix and database clock in
   **one primary statement**, using `withSession("first-primary")`:
   - `committed`: this operation's atomic audit/change exists. This proves that
     change, not that the account still has its historical resulting state.
   - `pending`: no receipt yet, but the cutoff has not passed. It does **not**
     mean the server has received or accepted the POST. Do not retry it.
   - `not_committed`: no audit/change exists and the primary clock has reached
     the cutoff. A delayed batch cannot subsequently pass its SQL write guard.
     This may mean rejection, rollback, no-op, or a request that never arrived;
     it is not a claim about the account's current role/status.
5. A completed 2xx response confirms the request. A known application rejection
   (400/401/403/404/409) completes it without a success confirmation; Web refreshes actual data and
   makes no claim that the account was unchanged. Unknown HTTP failures (such as
   a proxy 408), transport/JSON failures, and 5xx (which may be proxy errors or
   post-commit failures) retain the recovery
   handle. Only an explicit terminal operation outcome clears that uncertainty.
   Lookup failures never unlock writes. No privileged POST is automatically
   retried. List refresh failures are handled separately from mutation results.

**Tradeoff:** this avoids a migration by reusing the existing change audit and
adding an enforced execution window. No-op/rejected requests remain unaudited,
so a lost response may require waiting until the cutoff, rather than immediately
recovering a full per-request result. The ID is a correlation/fence handle, **not**
a general retry/idempotency contract: never resubmit it. A durable exact result
for every no-op/rejection, indefinite execution, or server-enforced cross-tab
request coordination would require a separate receipt table and retention policy;
that broader persistence/API change is deliberately not introduced here.

The fence relies on D1's serialized transactional execution and authoritative
primary clock; do not replace it with a replica read, browser clock, or unguarded
write path. See [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
and [primary sessions](https://developers.cloudflare.com/d1/best-practices/read-replication/#start-a-session-with-all-latest-data).
This is tab-scoped UX protection, not a global lock: other Admins/tabs can make
independent authorized changes. Unavailable API/auth/storage intentionally keeps
writes blocked until verification can succeed. Audit history must not be deleted
or rewritten as part of ordinary account management or recovery.

## Web behavior and limitations

- Indonesian copy; registration dates always `id-ID` / `Asia/Jakarta` (WIB).
- Pending requests and all accounts have separate keyset pages; exact status filter.
- shadcn Base UI Dialog provides modal keyboard/focus behavior and confirmation;
  focus falls back to the page heading if the refreshed row/trigger disappears.
- Role/SF selections, destructive consequences, saving states, and submission lock.
- Both lists refresh immediately after success. No automatic mutation retry.
  Ambiguous failures keep an operation recovery panel in the dialog and page;
  closing it does not clear uncertainty or unlock writes. Only a proven terminal
  operation outcome allows a new, separately confirmed action.
- Every Sales Force request captures an options generation. Close/reopen, role
  changes, retry, and unmount invalidate older first-page/pagination callbacks,
  including their error/loading cleanup. Opening always resets loading.
- No synthetic fallback. Empty/loading/error/retry states use existing conventions.
- If no unclaimed SF exists: **“Belum ada Sales Force yang tersedia. Tambahkan
  master Sales Force terlebih dahulu.”** Creation belongs to PR A2.
- Web changes do not send Telegram notifications. Users can inspect `/me`.
- No frontend tests/frameworks added, per `apps/web/AGENTS.md`. Authenticated
  browser/OIDC smoke testing and screenshots remain operator verification tasks;
  local integration tests do not establish deployed behavior.

## Verification

Disposable local Miniflare D1 tests in `apps/api/tests/admin-users.test.mjs` apply
all migrations and cover permissions/disclosure, expired/revoked/disabled/stale
sessions, write-time expiry, all approval roles, SF claims/immutability, rejection
finality, role/status changes, Admin protection, concurrent decisions/claims/
promotion/disable, no-op audits, Bot/Web consistency, and rollback after failed
audit, account update, and post-update statements. The Supervisor-option acceptance
path is exercised without Telegram Admin commands. Existing real Worker RPC,
registration, webhook, and Bot authorization tests remain intact.

`apps/api/tests/admin-operation.test.mjs` additionally holds POSTs before their
D1 batch, reads pre-commit account state, and verifies both late-commit and
post-cutoff rejection paths. It covers missing/lost responses, no-op/rejection
termination without audit, post-commit failure, replay fencing, all lifecycle
cutoffs, authorization and atomic rollback. Shared contract tests reject malformed
operation handles and caller-supplied deadline/identity overrides. Frontend tests
remain prohibited; the browser regression checklist below is still manual.

Local validation passed: contracts **18/18**, DB **16/16**, API/Bot integration
**162/162**, deployment safeguards **154/154**. Typecheck, lint/format, Drizzle
migration check, and Web production build passed. Hono CLI unauthenticated smoke
batch: **6/6**. The build reports a non-blocking bundle-size warning (>500 kB).
These are local results, not real OIDC/browser or deployed smoke-test evidence.

Required local validation:

```sh
pnpm -r --if-present test
pnpm typecheck
pnpm check
pnpm --filter @sales-visit/db db:check
pnpm build:web
pnpm test:deployment
```

## Operator-controlled rollout and smoke checklist

Follow [CI/CD safeguards](ci-cd.md), [OIDC setup](web-auth.md), and
[Supervisor assignment rollout](supervisor-assignments.md). This document does
not authorize deployment, remote migrations, production account changes, or merge.

1. Review/merge only through the normal separately authorized process. Confirm
   automatic CD remains OFF and no competing Cloudflare Builds job is active.
2. Verify existing API/Web/Bot resources, OIDC/CORS configuration, `DB` binding,
   Bot Service Binding, and already-applied migrations through 0008. A1 adds none;
   do not replay migrations or seed production.
3. Use separate manual GitHub Actions targets: **`api` first**, with the guarded
   dry-run/release process and approved revision. Do **not** choose `all` (the
   orchestrator's Web-first ordering cannot activate dependent features safely).
4. Verify API access before dispatching **`web`** at the intended revision:
   Admin list works, Supervisor/Sales Force get 403, missing session gets 401,
   operation allocation/lookup and cutoff guards are available, errors are
   sanitized, old operational reads and Bot RPC remain usable. The updated Web
   requires the new operation API; there is no legacy unsafe-POST fallback.
5. After Web release, using explicitly authorized test identities/data:
   - [ ] Register a user through Telegram; confirm it appears pending in Web.
   - [ ] Approve as Supervisor; confirm active role in all users and `/me`.
   - [ ] Open Penugasan Supervisor; confirm the approved Supervisor is selectable.
   - [ ] Check Admin/Supervisor/Sales Force navigation and direct-route denials.
   - [ ] Check role confirmation, destructive rejection/disable, enable, protected
         Admin display, preserved links/assignments, and immediate effective access.
   - [ ] Check unclaimed SF choices and the exact unavailable-SF empty message.
   - [ ] Check keyboard Tab/Shift-Tab, Escape/cancel, focus restoration, mobile
         table scrolling, WIB dates, and light/dark dialog readability.
   - [ ] Throttle a Sales Force next-page request, close/reopen the dialog, load a
         fresh first page, then release the old success/error response. Confirm
         no old options, loading reset, or errors overwrite the new opening.
         Repeat with a role change and a first-page retry.
   - [ ] Interrupt POST before the server batch. A current account GET must not
         unlock writes. Verify `pending` keeps the dialog honest; release before
         cutoff and verify `committed`, or after cutoff and verify `not_committed`
         with no late account change. Do not resend the POST.
   - [ ] Lose a no-op/rejected response: verify checking after cutoff terminates
         without waiting indefinitely for an expected account state.
   - [ ] Reload/navigate or let a row disappear while an outcome is unknown;
         confirm the page recovery panel and account-write lock persist.
   - [ ] Check definitive 400/404/409 failures allow review without pretending
         success; proxy 408/unknown HTTP/5xx/network/JSON failures retain recovery. Fail a list refresh
         after a successful POST: the mutation must not be labeled uncertain.
   - [ ] Verify lookup errors/offline/auth expiry keep writes blocked; restore
         Admin access and resolve using only GET. Check concurrent Admin changes
         do not turn an audit receipt into a claim about the latest account state.
   - [ ] Review expected audit records without logging tokens or identity data.
6. Stop on failure. Use the existing reviewed rollback procedure (Web first when
   removing the dependent UI, then API if necessary). Rollback is code-only and
   does not reverse successful account decisions or delete audit records.
