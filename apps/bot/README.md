# Telegram registration, Outlet, schedules & Visit submission

Active Sales Force can submit a minimal Visit through `/salesvisit`, review it,
then `/konfirmasi` or `/batal`. See the [Visit wizard guide](../../docs/design/telegram-visit-wizard.md)
for the exact Indonesian conversation, step labels, optional skipping, Jakarta
input policy, API authorization, durable D1 state, retry guarantees, deployment
order and manual acceptance checklist.

grammY Worker with local development and a single Cloudflare test deployment
configuration. See the [deployment runbook](../../docs/deployment.md) for current
provisioning status, secrets, webhook setup and remote bootstrap. No original-bot
cutover is performed. Uses a named Cloudflare Service Binding to the Hono API;
only the API has D1.

Remote test-bot operations use `scripts/telegram-test-bot.mjs` via
`pnpm telegram:test-bot` (native Node.js 24; no additional runtime). Run
`pnpm telegram:test-bot --help` for usage, and `pnpm test:deployment` for offline
operator-tool tests. Initial deployment and planned delete-and-redeploy credential
replacement require the private-terminal confirmations in the runbook;
`configure` remains disabled. This helper does not support local tunnel URLs.

## Commands (private chat only)

- `/start`, `/help`: Indonesian welcome and nine-section role-aware guide; safely
  packed replies and explicit differences from the original bot. See the
  [current command parity matrix and handoff](../../docs/design/telegram-bot-parity.md).
- `/register`: pending account from the verified update's `message.from.id`.
- `/me`: own role, status, Telegram display snapshot and Sales Force link.
- `/salesvisit`: active Sales Force starts/resumes a durable minimal Visit draft.
- `/konfirmasi`: submit the reviewed draft or recover its last result safely.
- `/batal`: discard the current uncommitted draft, from any step.
- `/pending [KURSOR]`: active Admin, ten profiles per page; copy the next command.
- `/approve TELEGRAM_ID admin` or `/approve TELEGRAM_ID supervisor`.
- `/approve TELEGRAM_ID sales SALES_FORCE_ID`: `sales` maps to `sales_force`.
  The canonical `sales_force` spelling also works. The SF ID is an existing
  opaque business-record ID, **not** a Telegram ID or profile name.
- `/reject TELEGRAM_ID`: active Admin rejects a pending registration.
- `/users [KURSOR]`: active Admin lists all accounts, ten per keyset page.
- `/setrole TELEGRAM_ID admin|supervisor` or
  `/setrole TELEGRAM_ID sales SALES_FORCE_ID` (also accepts `sales_force`):
  active Admin changes an active account's role, with verified SF association.
- `/disable TELEGRAM_ID`, `/enable TELEGRAM_ID`: active Admin disables an
  active account or reactivates a disabled one, retaining role and SF link.
  Active Admins cannot be demoted/disabled; the last active Admin is explicitly
  protected in the transaction. Recovery requires a separately reviewed operator
  process. Same-state repeats succeed without another audit event.

All user-facing messages are Indonesian. **Telegram user IDs** in registration
commands are canonical positive decimal strings (no signs, exponents or leading
zeroes). Planning business IDs are opaque strings; see the grammar below. Names/usernames are
optional display snapshots at first registration and are never matching keys.
An existing registration is unchanged, including rejected/disabled accounts.
Rejected reapplication and SF reassignment remain deferred. Role changes never
replace an existing SF link or release it when moving to Admin/Supervisor.
Disabled accounts retain their claims. Repeated approval/rejection decisions do
not mutate or create another audit event; lifecycle same-state retries are no-ops.

**Verification policy:** the Admin must verify the person's Telegram identity
and the intended existing SF business record out of band before approval.
There is no verified flag or authoritative staff-verification service in the
current schema. Explicit approval is the Admin's attestation; name matching is
never performed. An SF already linked to any account (even disabled) cannot be
claimed. The schema's non-unique FK is unchanged to avoid inventing a global
cardinality/migration policy; the conditional approval transaction enforces this
restriction for all application approval writers. Operators must not bypass it.
Approval gives Admin/Supervisor no SF link; later role changes preserve a
pre-existing link as a reservation, not permission to submit. Active Sales Force can submit minimal Visits
through the private RPC wizard; public Visit/Stock Report HTTP writes still deny
all requests.

## Outlet & Schedule command grammar

Private chat, active accounts only. Brackets mean optional arguments; do not type
the brackets. Arguments are whitespace-separated; quoted strings are **not** a
supported ID syntax. Names consume the remaining text and may contain spaces.

| Command                                                       | Role                                         |
| ------------------------------------------------------------- | -------------------------------------------- |
| `/outlets [KURSOR]`                                           | Admin, Supervisor                            |
| `/outlet BUSINESS_ID`                                         | Admin, Supervisor                            |
| `/outletinternal INTERNAL_ID`                                 | Admin, Supervisor; explicit legacy lookup    |
| `/tambahoutlet BUSINESS_ID NO_RS NAMA_OUTLET`                 | Admin                                        |
| `/editoutlet BUSINESS_ID NO_RS_BARU NAMA_OUTLET_BARU`         | Admin                                        |
| `/hapusoutlet BUSINESS_ID KONFIRMASI`                         | Admin; literal uppercase confirmation        |
| `/editoutletinternal INTERNAL_ID NO_RS_BARU NAMA_OUTLET_BARU` | Admin; legacy metadata/name update           |
| `/hapusoutletinternal INTERNAL_ID KONFIRMASI`                 | Admin; same deletion protections             |
| `/jadwal [HARI\|semua] [after=KURSOR]`                        | Sales Force; own linked business record only |
| `/jadwalsales [hari=HARI] [sf=SALES_FORCE_ID] [after=KURSOR]` | Admin, Supervisor                            |
| `/jadwalsales [HARI \| TELEGRAM_ID [HARI]] [after=KURSOR]`    | Admin, Supervisor                            |
| `/tambahjadwal SALES_FORCE_ID OUTLET_ID HARI`                 | Admin                                        |

`HARI`: senin, selasa, rabu, kamis, jumat, sabtu, minggu (case-insensitive).
`/jadwal` defaults to today in **Asia/Jakarta**, not UTC; `/jadwal semua` shows
all recurring days. Its follow-up command fixes the original weekday, even over
midnight. To pass `after=`, specify the day or `semua` first.
`/jadwalsales` defaults to all days/all SF. Its named options may be in any order,
with each key at most once; unknown keys are rejected. Positional forms accept
one day, one canonical decimal Telegram ID, or Telegram ID followed by day.
Do not mix positional filters with `hari=`/`sf=`; only trailing `after=` is
accepted with positional filters. Telegram IDs remain strings, never JS Numbers.
The API resolves Telegram identity → active User with SF role → business SF,
requiring exactly one account association (including reserved/disabled links).
Missing, disabled, role-changed, unlinked or ambiguous targets return a safe
association error, not all schedules or a guessed record. Named `sf=` still
queries the business plan regardless of account availability. `/jadwal` rejects SF
selection entirely. A supplied cursor cannot change the API's own-SF scope.

Examples with synthetic, simple IDs (replace Outlet IDs with actual returned IDs):

```text
/tambahoutlet 00123 00045 Toko Sintetis Jakarta
/outlet 00123
/editoutlet 00123 00046 Nama Baru Sintetis
/hapusoutlet 00123 KONFIRMASI
/tambahjadwal sf-01 out-01 senin
/jadwal
/jadwal MINGGU
/jadwal semua
/jadwalsales hari=senin sf=sf-01
/jadwalsales 123456789 SeNiN
/outletinternal out-01
```

Outlet `BUSINESS_ID` is the unique, case-sensitive business identifier; `NO_RS`
is an opaque registration/reference string, **not a telephone number** and not
unique. Both preserve leading zeros and exact case; 1–256 UTF-16 units, nonblank,
no control/format characters. Creation requires both plus a name. Business ID is
immutable through these operations. Existing records retain null fields displayed
as **belum didata**, not invented identifiers. No backfill/import operation is
provided; a reviewed crosswalk is needed to enrich legacy business IDs.

**Breaking grammar change:** the old `/tambahoutlet NAMA_OUTLET` and internal-ID
edit/delete syntax are retired, not auto-detected. Do not send an old multiword
name as a command; the first two tokens now always mean business ID and No. RS.
There is no name-only creation compatibility path or duplicate-record workaround.
Internal commands are explicit and never fall back to business IDs, even if the
same token exists in both namespaces. They can update legacy No. RS/name, not IDs.

`OUTLET_ID` in `/tambahjadwal` and `outlet TOKEN` in the Visit wizard **remain
internal** immutable FK targets. Schedule replies include the internal token for
that purpose. SF IDs are business-record IDs, **not Telegram IDs**. There is no
Bot SF lookup/provisioning command yet: obtain verified synthetic SF IDs from
the operator. Duplicate Outlet names are allowed. Deletion is blocked by
any Schedule, Visit or Stock Report reference; Bot never bypasses that rule.
Schedules are weekly plans, **not completed Visits**. No schedule edit/delete,
exceptions, effective dates or enforcement is added. The separate Visit wizard
accepts scheduled or unscheduled known Outlet tokens. Replies show Outlet name,
business ID/No. RS, SF name/business ID and Indonesian day. A Telegram ID is shown
only for a unique active SF association (own SF or authorized monitoring); missing
associations are labeled, never guessed. Schedules are business-SF-owned, not a
historical record of Telegram-user ownership; role changes never reassign plans.

### Exact opaque token format (planning commands and Visit Outlet entry)

This encoding also applies to business IDs and No. RS arguments containing
punctuation/Unicode/whitespace. No. RS is displayed as text, not dialable contact data.

- Raw token: nonempty ASCII `[A-Za-z0-9_.-]+`, validated against API limits.
- Otherwise: `~` followed by **canonical unpadded base64url of the exact UTF-8
  bytes**. Preserve leading/trailing whitespace, Unicode, punctuation and case;
  never trim or normalize a decoded ID. `~` is reserved, so an ID starting with
  `~` itself must be encoded. No `=`, `+`, `/`, or whitespace in encoded tokens.
- Noncanonical encodings (including encoded simple IDs), invalid UTF-8, blank
  decoded IDs, control characters, or IDs over the API's 256 UTF-16-unit limit
  are rejected. Tokens are not credentials or secrets. Cursors use exactly this
  same format, not Telegram user IDs or offsets.
- Copy ID tokens and complete `Berikutnya:` commands exactly. Pages contain at
  most 50 records; next commands retain all filters. No next command means the
  last page. Pages are live snapshots, not a frozen export.

For an operator who already holds an exact synthetic SF/Outlet ID, this local
Node.js expression produces the same token (do not use sensitive business data):

```js
const id = " SF 日本 + ";
const token = /^[A-Za-z0-9_.-]+$/.test(id)
  ? id
  : "~" + Buffer.from(id, "utf8").toString("base64url");
console.log(token);
```

This grammar does not change `/approve` or `/pending`: approval and `/setrole`'s
SF argument is a simple whitespace-free ID and its identity contract trims
it; do not use planning tokens there. Linking legacy whitespace-bearing SF IDs
requires a separately reviewed identity-contract change, not a Bot bypass.

Responses use plain text, never Markdown/HTML parse mode. Record blocks are packed
into messages of at most 4096 UTF-16 units (no message per row for normal pages).
Names are display-truncated after 256 Unicode code points with `…`, and control/
format characters are replaced in display labels only. IDs are never truncated:
stored IDs outside API operation limits are explicitly marked unmanageable, and
an unusable next cursor stops navigation with an operator message. Timestamp
details use exact epoch milliseconds; legacy null updated time remains unknown.

## Trust and persistence

1. Bot checks the configured Telegram webhook secret before parsing/Telegram
   calls. Bodies are bounded to 128 KiB. Only ordinary text-message updates with
   a safe positive human sender ID are handled; unsupported updates are ignored.
2. Private-chat middleware rejects groups before any identity RPC. Actor comes
   only from `ctx.from.id`, not chat ID, forwarded user, username or command text.
3. `IDENTITY` binds specifically to API `BotIdentity`, a named `WorkerEntrypoint`
   exported by `apps/api/src/worker.ts`. It has RPC methods and no HTTP handler.
   The default Hono fetch export has no identity routes/dispatcher. Public
   requests and spoofed headers cannot call it; no shared-secret API endpoint
   exists. Only Workers granted this binding should receive this capability.
   Cloudflare account/configuration access and the Bot Worker are trusted: a
   compromised bound Worker can impersonate actors. Binding configuration is
   the caller capability, not a per-user permission or a caller-ID header.
4. API validates input, resolves the actor from D1 on each protected call, and
   checks current role/status and SF scope. Approval checks active Admin
   permissions in the decision transaction itself. Role/status management checks
   current actor, target transition, Admin protections and SF claims in the same
   serialized D1 batch as audit + mutation; no client-claimed role is accepted.
   Registration creates User + identity + audit atomically. Decisions condition
   on pending/unassigned state and unclaimed SF; lifecycle/audit roll back
   together. See [identity invariants and bootstrap](../../packages/db/IDENTITY.md).

Planning commands acknowledge processed updates even when API transport or
Telegram delivery fails; they never automatically retry a create. An ambiguous
failure can mean the mutation committed: reconcile `/outlets` or `/jadwalsales`
before manually repeating it. A failed reply may leave no visible confirmation.
There is no durable deduplication receipt: duplicate upstream deliveries can
still create duplicate-named Outlets. This is not exactly-once processing.

Telegram replies/decision notifications are not transactional with D1. Failed
notification does not undo approval; `/me` is authoritative. For registration/approval, a transport failure
returns retryable HTTP 500; retrying registration/decisions cannot duplicate or
change committed decisions. Exactly-once replies/notification redelivery are not
promised. The Visit wizard separately uses API-owned durable conversation state
and idempotent confirmation, not planning's acknowledge-on-failure policy. Existing public
business reads remain unchanged: use only synthetic data until read authorization
ships. Identity/audit tables are never joined into those responses.

## Reproducible local sandbox

Use Node 24 and pnpm 10.30.1. All commands below run from the repository root.
No Cloudflare account, remote DB or deployment is needed.

```sh
pnpm install
pnpm db:migrate:local
pnpm db:seed:local  # synthetic SF sf-01, sf-02, sf-03 plus business fixtures
```

Before starting Workers, provision one local Admin using the exact SQL template
in [IDENTITY.md](../../packages/db/IDENTITY.md#controlled-first-admin-provisioning).
For automated/manual synthetic HTTP testing use a fresh UUID and synthetic ID
`900`. For a real separate Telegram test bot, replace that ID with your own
verified test-account Bot API ID. Never use teammate seed IDs. Save the substituted
SQL in a private temporary file outside Git, then apply it to the **API sandbox**
(the package bootstrap example otherwise uses a different package sandbox):

```sh
pnpm --filter @sales-visit/api exec wrangler d1 execute DB --local --file /absolute/private/bootstrap.sql
pnpm --filter @sales-visit/api exec wrangler d1 execute DB --local --command 'PRAGMA foreign_key_check;'
```

Inspect the bootstrap SELECT and verify exactly the intended active Admin,
Telegram ID, null SF and one active Admin overall; record operator evidence as
required by that runbook. Do not use this procedure to promote existing accounts.
Local API migrations/seeds/bootstrap/dev all use `apps/api/.wrangler/state`.
The package's `wrangler.local.jsonc` is a separate sandbox. No application
bootstrap endpoint or development permission bypass exists.

Create ignored `apps/bot/.dev.vars` privately (do not print/share its contents):

```dotenv
TELEGRAM_BOT_TOKEN="token-from-a-separate-test-bot"
TELEGRAM_WEBHOOK_SECRET="fresh-random-test-only-secret"
```

Wrangler declares required secret names (no plaintext vars); missing secrets
fail closed. Never use the existing
production bot's token or webhook. Generate API types before Bot types on a fresh
checkout (`pnpm typecheck` does this in workspace order). Start two terminals:

```sh
pnpm dev:api  # http://localhost:8787; owns API-local D1
pnpm dev:bot  # http://localhost:8788; discovers local sales-visit-api binding
```

Wait for Wrangler to show the binding as connected. `/health` on each Worker
checks liveness only. Workers must both be running; disconnected binding errors
are not an authentication fallback. Do not add `--remote` or deploy placeholders.

### Optional Telegram manual test

1. Use a separate bot created with BotFather and a consenting second test user.
   Verify the local Admin ID out of band before bootstrap. Keep only synthetic
   business records in this sandbox.
2. Forward an HTTPS tunnel to `http://localhost:8788` (for example an existing
   operator-managed tunnel). This does not deploy a Worker. Treat the URL as
   publicly reachable and keep webhook-secret validation enabled.
3. Privately call Telegram `setWebhook` for **that test bot only**, with the
   HTTPS tunnel URL, `secret_token` equal to the ignored local secret, and
   `allowed_updates: ["message"]`. Use an operator tool reading the token from
   private configuration; do not put tokens in shell arguments/history, PRs,
   screenshots or logs. No webhook registration command runs automatically here.
4. Second user: `/start`, `/register`, repeat `/register`, `/me` → pending.
   Admin: `/pending`, `/approve SECOND_TELEGRAM_ID sales sf-01` → active/link.
   Check `/me` from the second user. A different pending user cannot claim sf-01.
5. Register a third user and `/reject THIRD_TELEGRAM_ID`; re-registration remains
   rejected. Check non-Admin `/pending` and group-chat commands are denied.
6. Check audit rows privately and `PRAGMA foreign_key_check`. Public POST
   `/approve` must be 404 and POST `/visits` must still be 401.
7. Remove **only the test bot's** webhook using `deleteWebhook`, stop the tunnel
   and Workers, and remove private local credentials per retention policy.
   Never replace/delete the original bot's webhook or poll using its token.

## Automated tests versus Telegram

```sh
pnpm --filter @sales-visit/api test
pnpm --filter @sales-visit/db test
pnpm --filter @sales-visit/contracts test
pnpm typecheck
pnpm check
```

`apps/api/tests/identity.test.mjs` bundles the actual API/Bot Workers, runs them
in Miniflare/workerd with a real named Service Binding and disposable D1, applies
all checked-in SQL migrations, and provisions a synthetic Admin with the exact
bootstrap template. A test-only bound caller exercises API input validation;
it is never bundled into app entrypoints. Tests cover idempotence, concurrent
claims/decisions, forbidden roles/states, rollback on forced failures, audit,
public spoofing, actual sender/private-chat enforcement and Indonesian commands.
`bot-planning.test.mjs` additionally exercises Outlet CRUD, all roles/states,
weekly provisioning and monitoring, deterministic Sunday-UTC/Monday-Jakarta
own-day queries, opaque whitespace-bearing IDs/cursors, 50-row pagination,
plain-text output, maximum Unicode IDs, legacy long names, and message bounds.
It also verifies registration/approval regressions and acknowledged delivery
failures. `bot-transport.test.mjs` uses a test-only faulting named RPC worker to
verify ambiguous create failures are sanitized, acknowledged and called once.
All planning result codes and exact 4096-unit packing boundaries have helper tests.
`bot-visits.test.mjs` adds the real-Worker durable Visit flow, restart/persistence,
exact IDs, authorization/link changes, duplicate/concurrent confirmation, cancel,
TTL, failed Telegram reply and failed draft-finalization recovery. See the Visit
guide for its test-only stale-authorization race injector.
Only Telegram `getMe`/`sendMessage` are simulated, using synthetic credentials;
no real Telegram/Cloudflare resource calls occur. Miniflare is pinned to the beta
matching the repository's Wrangler/workerd compatibility date, and uses its
provided v4-options converter. Existing Visit/Stock Report local D1 tests remain.
Actual Telegram delivery, BotFather setup, tunnel connectivity and permission to
message users require the separate manual test above; they are not claimed as
verified by CI or this implementation.

## Attribution and deliberate differences

Business command behavior and recognizable Indonesian registration/profile/
approval UX are adapted from **rtrivaldo and the original contributors** to
[rtrivaldo/telegram_bot](https://github.com/rtrivaldo/telegram_bot), inspected at
`e7de4a9965b2a815160bd389a89be5fa6b1b73a7`, especially
`src/bot/commands/auth.commands.ts`, `src/bot/bot.ts`,
`src/services/auth.service.ts`, and `src/repositories/user.repository.ts`. Outlet/Schedule behavior additionally
references `src/services/schedule.service.ts` (Jakarta weekday names, own versus
monitoring views) and the backend foundation's Outlet reference checks. We use
explicit, documented commands and opaque tokens rather than its legacy IDs.
This is a new grammY/API/D1 implementation, not an import of Telegraf, Express,
Node runtime, PostgreSQL or seed data. The reference declares ISC in package.json
but has no standalone LICENSE; confirm reuse terms with its maintainer before
production redistribution. No license permission is inferred by this PR.

Security differences: private-only handling, canonical string IDs, no rejected
reapplication, explicit verified SF association, API-owned authorization, atomic
auditing/claims, bounded lists/body, safe errors and no raw-update/token logs.
Deferred: OIDC/Web sessions/read authorization, Stock Report/financial reporting
wizards, schedule editing/deletion/exceptions/effective dates, SF reassignment,
rejected reapplication, Admin incident recovery, history, exports, financial
measures, imports and production cutover. Migration `0005_good_puff_adder.sql`
is already deployed; the new pending migration is `0006_windy_black_crow.sql`.
See the exact manual checklist and teammate handoff in
[parity and handoff](../../docs/design/telegram-bot-parity.md). No credentials,
resources, automatic CD settings, webhook or deployment bindings change here.
