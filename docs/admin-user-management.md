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

| Method / path                          | Query or JSON body                                                            | Success                                             |
| -------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------- |
| `GET /admin/users`                     | `after` (default empty), `limit` (1–100, default 50), optional exact `status` | `{ items: ManagedAccount[], next: string \| null }` |
| `GET /admin/users/sales-force-options` | `after` (default empty)                                                       | `{ items: { id, name }[], next }`, at most 50       |
| `GET /admin/users/:id`                 | URL-encoded internal User ID                                                  | `Account` (current state for reconciliation)        |
| `POST /admin/users/approve`            | `{ userId, role, salesForceId? }`                                             | `Account`                                           |
| `POST /admin/users/reject`             | `{ userId }`                                                                  | `Account`                                           |
| `POST /admin/users/role`               | `{ userId, role, salesForceId? }`                                             | `Account`                                           |
| `POST /admin/users/disable`            | `{ userId }`                                                                  | `Account`                                           |
| `POST /admin/users/enable`             | `{ userId }`                                                                  | `Account`                                           |

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

## Web behavior and limitations

- Indonesian copy; registration dates always `id-ID` / `Asia/Jakarta` (WIB).
- Pending requests and all accounts have separate keyset pages; exact status filter.
- shadcn Base UI Dialog provides modal keyboard/focus behavior and confirmation;
  focus falls back to the page heading if the refreshed row/trigger disappears.
- Role/SF selections, destructive consequences, saving states, and submission lock.
- Both lists refresh immediately after success. No automatic mutation retry.
  Ambiguous errors trigger an exact target GET; another attempt stays blocked
  until the current state is fetched. If verification fails, only verification
  can be retried in that dialog.
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

Local validation passed: contracts **16/16**, DB **16/16**, API/Bot integration
**154/154**, deployment safeguards **154/154**. Typecheck, lint/format, Drizzle
migration check, and Web production build passed. Hono CLI unauthenticated smoke
batch: **4/4**. The build reports a non-blocking bundle-size warning (>500 kB).
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
   errors are sanitized, old operational reads and Bot RPC remain usable.
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
   - [ ] Interrupt a mutation response; confirm status verification occurs before
         any retry. Check concurrent Admin changes surface current state/conflict.
   - [ ] Review expected audit records without logging tokens or identity data.
6. Stop on failure. Use the existing reviewed rollback procedure (Web first when
   removing the dependent UI, then API if necessary). Rollback is code-only and
   does not reverse successful account decisions or delete audit records.
