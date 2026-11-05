# Telegram registration & approval

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

- `/start`, `/help`: account-aware welcome/help, Admin guidance when active.
- `/register`: pending account from the verified update's `message.from.id`.
- `/me`: own role, status, Telegram display snapshot and Sales Force link.
- `/pending [KURSOR]`: active Admin, ten profiles per page; copy the next command.
- `/approve TELEGRAM_ID admin` or `/approve TELEGRAM_ID supervisor`.
- `/approve TELEGRAM_ID sales SALES_FORCE_ID`: `sales` maps to `sales_force`.
  The canonical `sales_force` spelling also works. The SF ID is an existing
  opaque business-record ID, **not** a Telegram ID or profile name.
- `/reject TELEGRAM_ID`: active Admin rejects a pending registration.

All user-facing messages are Indonesian. IDs in commands are canonical positive
decimal strings (no signs, exponents or leading zeroes). Names/usernames are
optional display snapshots at first registration and are never matching keys.
An existing registration is unchanged, including rejected/disabled accounts.
Rejected reapplication, reactivation, reassignment and role changes are deferred.
Repeated decisions do not mutate or create another audit event.

**Verification policy:** the Admin must verify the person's Telegram identity
and the intended existing SF business record out of band before approval.
There is no verified flag or authoritative staff-verification service in the
current schema. Explicit approval is the Admin's attestation; name matching is
never performed. An SF already linked to any account (even disabled) cannot be
claimed. The schema's non-unique FK is unchanged to avoid inventing a global
cardinality/migration policy; the conditional approval transaction enforces this
restriction for all application approval writers. Operators must not bypass it.
Admin/Supervisor have no SF link. Even approved Sales Force cannot submit reports
yet: existing Visit/Stock Report HTTP writes still deny all requests.

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
   checks current active Admin permissions in the decision transaction itself.
   Registration creates User + identity + audit atomically. Decisions condition
   on pending/unassigned state and unclaimed SF; lifecycle/audit roll back
   together. See [identity invariants and bootstrap](../../packages/db/IDENTITY.md).

Telegram replies/decision notifications are not transactional with D1. Failed
notification does not undo approval; `/me` is authoritative. A transport failure
returns retryable HTTP 500; retrying registration/decisions cannot duplicate or
change committed decisions. Exactly-once replies/notification redelivery are not
promised. There is no conversation state in this milestone. Existing public
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
`src/services/auth.service.ts`, and `src/repositories/user.repository.ts`.
This is a new grammY/API/D1 implementation, not an import of Telegraf, Express,
Node runtime, PostgreSQL or seed data. The reference declares ISC in package.json
but has no standalone LICENSE; confirm reuse terms with its maintainer before
production redistribution. No license permission is inferred by this PR.

Security differences: private-only handling, canonical string IDs, no rejected
reapplication, explicit verified SF association, API-owned authorization, atomic
auditing/claims, bounded lists/body, safe errors and no raw-update/token logs.
Deferred: OIDC/Web sessions/read authorization, reporting wizard and durable
state, Outlet/schedule workflows, other account lifecycle commands, history,
exports, financial measures, imports and production cutover.
