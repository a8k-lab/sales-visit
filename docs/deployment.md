# First API + Telegram test deployment

**Development/testing only, not approved for operational use.** One Cloudflare
configuration, no staging/production pair. Dashboard deployment is independent:
none of these commands deploys Web. Business GETs are public; use synthetic data
only. Identity/audit are internal and report HTTP writes remain deny-by-default.

## Current handoff

Prepared from `main` after merged PR #5 (`53e413e`). Wrangler was **not
authenticated**, so no remote resources, migrations, deployments, secrets,
webhook changes, Admin bootstrap or live Telegram tests have been performed.
No deployed URLs are known. Local checks passed: workspace typechecks, 39
workspace tests, 17 deployment-helper tests, Drizzle migration checks, Hono route
inspection, both Worker bundle dry-runs, lint and formatting. These are automated/
local checks only, not remote deployment or real Telegram evidence.

The API's all-zero UUID remains a **local-only
sentinel**, not a Cloudflare database ID. Deployment/remote root commands fail
before invoking Wrangler until it is replaced with the real returned UUID.
Do not bypass the guard with direct `wrangler deploy` or `--remote` commands
while the sentinel remains. Never use temporary preview accounts.

## Prerequisites and target confirmation

- Node 24, pnpm 10.30.1; Python 3 for the operator-only Telegram tool.
- Authorized Cloudflare account with Workers + D1 permissions and a configured
  workers.dev subdomain. No custom domain, KV, queues or other resources needed.
- Separate BotFather test bot; consenting Admin and additional test users.
  Never use the teammate's original bot token, webhook or seed identities.
- Private non-recorded terminal, no shell tracing (`set -x`), restricted operator
  change record. Never paste credentials into chat, Git, CLI arguments or URLs.

```sh
pnpm install
pnpm --filter @sales-visit/api exec wrangler login
pnpm --filter @sales-visit/api exec wrangler whoami
pnpm --filter @sales-visit/api exec wrangler d1 list
```

Verify the intended account ID/name **privately** before any write. If multiple
accounts exist, select the intended account with `CLOUDFLARE_ACCOUNT_ID` in the
operator session and verify again. Do not copy sensitive command outputs into PRs.
Only the newly provisioned Sales Visit resources are in scope. If `sales-visit`
already exists, stop and establish ownership/purpose and whether it is the new
empty test target; never adopt an unrelated database just because its name matches.
Likewise inspect existing `sales-visit-api`/`sales-visit-bot` Workers in the account
before deploying; stop on any unrelated resource-name collision.

## D1 creation and configuration

If absent, create exactly one database:

```sh
pnpm --filter @sales-visit/api exec wrangler d1 create sales-visit
```

Copy the **actual returned** `database_id` into the existing `DB` binding in
`apps/api/wrangler.jsonc`, replacing the all-zero sentinel. Keep the config
JSON-compatible (the guard parses JSON), name `sales-visit`, migration path,
Worker name and `src/worker.ts` unchanged. A D1 UUID is not a credential and may
be committed after verifying the target; never invent one. Inspect it again:

```sh
pnpm --filter @sales-visit/api exec wrangler d1 info DB
pnpm db:migrate:remote
pnpm db:verify:remote
pnpm --filter @sales-visit/api exec wrangler d1 migrations list DB --remote
```

Compare the reported database UUID/account to the reviewed creation result before
applying migrations. No pending migrations should remain. `d1_migrations` must
record `0000_initial.sql`, `0001_identity_foundation.sql`, and
`0002_open_lucky_pierre.sql` exactly once. Expect nine application tables:
`sales_force`, `outlets`, `products`, `visits`, `stock_reports`,
`stock_report_items`, `users`, `telegram_identities`, `access_audit`, plus D1's
migration/internal tables. `PRAGMA foreign_key_check` must return zero rows.
No previous migration files are edited. Verification emits counts, not profiles.

Local commands remain local, sharing `apps/api/.wrangler/state`:

```sh
pnpm db:migrate:local
pnpm db:seed:local
pnpm dev:api
pnpm dev:bot
```

Changing the remote UUID does not make local commands remote. The database
package's `wrangler.local.jsonc` is still a separate sandbox. No install/dev
script migrates remotely or deploys anything.

### Minimal remote test fixture (explicit operator step)

**Do not run `apps/api/seeds/local.sql` remotely.** It includes 3 SF, 5 Outlets,
4 Products, 3 Visits, 4 Stock Reports and 7 items; that scope is unnecessary.
After checking the newly created DB is empty, use only this synthetic SF record:

```sh
pnpm --filter @sales-visit/api exec wrangler d1 execute DB --remote --command \
  "INSERT INTO sales_force (id, name) VALUES ('test-sf-01', 'Synthetic registration test SF') ON CONFLICT(id) DO NOTHING;"
pnpm db:verify:remote
```

Inspect `SELECT id, name FROM sales_force;` privately and confirm the fixture
before linking it. Other business tables should remain empty. No real business
records, contact data or imports are needed.

## Deployment order and HTTP smoke checks

```sh
pnpm deploy:api
# Record the actual URL returned by Wrangler, not a guessed subdomain.
curl -fsS https://sales-visit-api.YOUR_SUBDOMAIN.workers.dev/health
# Next: the private initial-deploy procedure below, NOT pnpm deploy:bot yet.
```

API health: `{"status":"ok"}`. Bot health adds
`"service":"sales-visit-bot"`. Health is liveness only, not D1/RPC proof.
Bot config must show `IDENTITY` → `sales-visit-api`, entrypoint **`BotIdentity`**.
Only API has `DB`. Keep `src/index.ts` as Bot entrypoint. Both Telegram secrets
are declared under `secrets.required`; the first Bot deployment must supply them
with `deploy --secrets-file` as below. Plain `pnpm deploy:bot` is for subsequent
code-only redeployments after both secrets exist, not for initial bootstrap.
Inspect deployed bindings in the Cloudflare dashboard after initial deployment
(the helper suppresses Wrangler output); do not change the
Service Binding to HTTP if RPC fails. Check account, Worker names, deployment
order, exported entrypoint and versions first.

Use the actual API URL for these **remote** checks:

| Request                                                             | Expected                                |
| ------------------------------------------------------------------- | --------------------------------------- |
| GET `/sales-force`                                                  | 200, only synthetic `test-sf-01`        |
| GET `/outlets`, `/products`, `/visits`, `/stock-reports`            | 200, `[]`                               |
| POST `/visits`, `/stock-reports` without credentials                | 401, even with spoofed identity headers |
| GET `/users`, `/telegram_identities`, `/access_audit`               | 404                                     |
| POST `/register`, `/approve`, `/reject`, `/pending`, `/BotIdentity` | 404                                     |

Also try identity/audit paths with hyphens and `/identity/*`: all must be 404.
The named RPC export has no HTTP dispatcher. Do not introduce identity routes,
auth bypasses, or public bootstrap. Missing webhook secret is 503 before setup;
a missing/wrong `X-Telegram-Bot-Api-Secret-Token` is 401 after secrets are stored.

## Separate Telegram test bot and secrets

1. In the official BotFather chat, create a **new test bot** with `/newbot` or
   select a known separate test bot using `/mybots`. Verify its username and
   ownership there. Do not revoke or modify the teammate's bot credentials.
2. Run the operator tool **locally in a private terminal**, not through an agent
   session/recorded terminal. It prompts for the token with echo disabled, calls
   `getMe`, displays only bot ID/username, and requires `TEST username` confirmation.
   Compare to BotFather. Abort on any mismatch; a bot ID is not an Admin user ID.
3. Confirm Cloudflare login/account, the account's actual workers.dev subdomain
   (dashboard → Workers & Pages), no unrelated Worker-name collision, and the
   already deployed API/`BotIdentity` entrypoint. Use that verified subdomain for
   the new Bot URL; do not guess it. Then use the same private helper for bootstrap:

### Initial Bot deployment (both required secrets supplied with code)

```sh
pnpm telegram:test-bot initial-deploy https://sales-visit-bot.YOUR_SUBDOMAIN.workers.dev/
pnpm telegram:test-bot info https://sales-visit-bot.YOUR_SUBDOMAIN.workers.dev/
```

After `getMe` identity confirmation and checking for a conflicting webhook, the
helper generates a cryptographically random 32-byte URL-safe webhook secret. It
writes both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` to a temporary JSON
file **outside the checkout**, in a private 0700 directory with a 0600 file. It
invokes Wrangler `deploy --name sales-visit-bot --secrets-file PATH`, supplying
both required secrets with the first Worker version. Only the random file path,
not a credential, appears in arguments. JSON avoids dotenv variable expansion.
The file/directory are removed after Wrangler exits, including deployment errors,
write failures, Ctrl-C, SIGTERM and terminal closure. As with any local file,
uncatchable termination (SIGKILL/power loss) cannot guarantee cleanup: use a
trusted private temporary filesystem and remove any abandoned
`sales-visit-secrets-*` directories privately before retrying. No manual secret
file or token-bearing shell command is needed; a repository-local TMPDIR is refused.

Only after Wrangler succeeds and GET `/health` at the supplied Worker URL returns
200 with exactly `{"status":"ok","service":"sales-visit-bot"}` does the helper
call `setWebhook`, using the same generated `secret_token` and
`allowed_updates: ["message"]`. A failed deployment or health check leaves the
Telegram webhook unchanged. Health verifies liveness/service identity, not RPC;
inspect the deployed `IDENTITY` binding and complete the acceptance checks below.

### Subsequent secret rotation / webhook setup

For an **already deployed** Worker, including replacing this test webhook:

```sh
pnpm telegram:test-bot configure https://sales-visit-bot.YOUR_SUBDOMAIN.workers.dev/
```

This confirms the separate bot identity again, refuses a different existing
webhook, and requires a healthy Worker **before** any secret write. It uploads
both credentials via `wrangler secret bulk` **stdin**, with a freshly generated
webhook secret, then checks health again before `setWebhook`. It does not deploy
code and is not an initial-deployment command. For code-only updates use
`pnpm deploy:bot`, which preserves existing secrets, then check `/health`.

Both paths retain pending updates, refuse an existing different webhook, and
never follow redirects. No token, secret, response payload, error URL or traceback
is printed. Wrangler output is captured and persistent Wrangler debug logging
is disabled. Cloudflare login must already work. If a step fails, verify account,
target, deployment and health privately; rerun the appropriate helper command for
this test bot only (allow workers.dev propagation time after initial deployment).
A successful credential write and webhook update are not atomic: the old webhook
may temporarily fail authentication after rotation. Rerun promptly after a partial
failure; do not weaken secret validation. The secret is not retained after the
command; rerunning generates a new one. If bootstrap already deployed code but
webhook setup failed, `configure` can finish once health passes; `initial-deploy`
can also be retried deliberately, redeploying code and rotating both credentials.

Check `webhook_matches: true`, queue count, and error flags. Error flags may
reflect an older delivery error; compare timestamps and subsequent successful
delivery. `getWebhookInfo` alone does **not** prove actual delivery or RPC.
Use Cloudflare dashboard secret names/`wrangler secret list` to confirm presence,
never values. Ignored `.dev.vars` is local only, not a remote secret source.
No scripts automatically read the existing local credentials.

## First Admin (pending until a verified user ID is available)

Use the exact SQL template and invariants in
[`packages/db/IDENTITY.md`](../packages/db/IDENTITY.md#controlled-first-admin-provisioning).
This deployment request authorizes targeting the new test DB, not bypassing the
restricted operator/reviewer/change-record requirements. Obtain the Admin's
canonical Bot API **human user ID** from a trusted authenticated Telegram
interaction and verify ownership out of band (for example, an already trusted
operator-managed Bot API receiver: have the person send a fresh agreed nonce in
a private message and inspect that authenticated update's `message.from.id`
privately). Exchange the ID/nonce with the intended person over a trusted channel.
Do not substitute a chat ID, username or bot ID. `/me` only displays an ID after
registration; do not register the first Admin before bootstrap: the template is
not a promotion procedure. If already registered, stop for a reviewed operator resolution.

Rehearse with synthetic local IDs as documented. Then pause test access-management
commands, confirm there are no active Admins or conflicting IDs, choose a fresh
UUID, take the approved D1 recovery checkpoint (`wrangler d1 time-travel info DB`
where available), and prepare the substituted SQL **outside the repository**.
Verify `whoami`, `d1 info DB`, and the config UUID again. Execute only after
operator/reviewer confirmation against the newly created remote DB:

```sh
pnpm --filter @sales-visit/api exec wrangler d1 execute DB --remote --file /absolute/private/bootstrap.sql
pnpm --filter @sales-visit/api exec wrangler d1 execute DB --remote --command 'PRAGMA foreign_key_check;'
```

Inspect privately: intended User UUID, exact Telegram identity, active status,
admin role, null SF link, exactly one active Admin. No FK violations. Bootstrap
intentionally creates **no application audit event**: record operator, reviewer,
reason/change ID, UTC time, database and before/after results in the restricted
change record. The template is multi-statement, not atomic; inspect partial state
on interruption and retain the same UUID on a reviewed retry. Never blindly
promote an existing account or use this as recovery. Remove private SQL per
retention policy. If the user ID/approval is unavailable, leave bootstrap pending.

## Real Telegram acceptance (not automated)

- New user private chat: `/start`, `/register`, `/register`, `/me`. Expect exactly
  one pending User/identity and one registration audit event, no duplicate.
- Active Admin: `/pending`; verify the person's Telegram identity and the explicit
  synthetic SF record out of band; `/approve TELEGRAM_ID sales test-sf-01`.
  New user `/me` must show active Sales Force and `test-sf-01`.
- Another consenting user: register, then Admin `/reject TELEGRAM_ID`. Repeating
  `/register` must remain rejected; repeat decisions must not add events.
- Non-Admin approval/pending rejected; group-chat Admin commands rejected before
  RPC; rejected/disabled users cannot gain Admin permissions. Disabled lifecycle
  has no Bot command: if manually testing that state, use a reviewed private
  operator SQL change on a disposable test user, retain role, record it externally.
- Privately inspect User/identity joins, exact SF linkage and `access_audit`
  actor/target/action/before/after values. Expect registration + approval events
  for the approved user and registration + rejection for the rejected user.
  Recheck foreign keys. No personal IDs or audit rows in the PR.
- Repeat public HTTP denials above. Observe real replies/update delivery and D1
  changes: that is the end-to-end proof of webhook + named RPC + persistence.

Keep three result categories separate: **automated tests**, **remote deployment
checks**, **real Telegram E2E**. Do not mark live verification complete based on
Miniflare tests, health responses or webhook metadata alone.

## Logs, rollback, webhook removal

`pnpm --filter @sales-visit/api exec wrangler tail --format pretty` and the same
command filtered to `@sales-visit/bot` show Worker logs. Use privately; do not enable
raw request/header/update capture or Telegram client debug logging. Bot error
messages are sanitized, but Cloudflare metadata can still contain personal data.
Never publish raw tails, D1 output, tokens, URLs containing tokens or screenshots.

Before changes record deployed version IDs privately. For code rollback use
`wrangler deployments list` then `wrangler rollback VERSION_ID` within the API or
Bot package only, inspecting the target Worker first. On first deployment there
may be no prior version: remove only the test webhook to stop updates, fix and
redeploy API then Bot. Redeploying does not run migrations or seeds. Worker
rollback does **not** undo D1 migrations, identity actions or secret rotation;
never roll schema back by editing checked-in migrations. Use forward reviewed
migrations or an approved D1 recovery checkpoint, with Bot delivery stopped and
data-loss consequences reviewed. Do not delete the database as routine rollback.

```sh
pnpm telegram:test-bot delete https://sales-visit-bot.YOUR_SUBDOMAIN.workers.dev/
```

Deletion verifies bot identity/current webhook and requires another confirmation;
it preserves pending updates. Never switch to polling with the original token.
For replacement, remove only this test webhook, deploy the replacement, verify
its target/identity, then configure again. The helper intentionally supports only
the named Bot Worker workers.dev URL. Retire test credentials via BotFather only
for this separate test bot. Original bot and Dashboard remain untouched.

## Repository checks

```sh
pnpm typecheck
pnpm -r --if-present test
pnpm test:deployment
pnpm --filter @sales-visit/db db:check
pnpm check
```

References: [D1 commands](https://developers.cloudflare.com/d1/wrangler-commands/),
[Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/),
[Telegram webhook API](https://core.telegram.org/bots/api#setwebhook).
