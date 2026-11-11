# First API + Telegram test deployment

> **Current milestone:** [Sales Force Master Management (A2)](sales-force-management.md#operator-controlled-rollout-not-performed) adds audit migration 0009 (16 application tables). An approved backup and migration must precede API → Web releases using separate targets, never `all`. No Bot source/contract deployment is required. Earlier bootstrap/auth checklists below are historical, not instructions to replay migrations.
>
> **Current release procedure:** use [GitHub Actions CI/CD](ci-cd.md).
> The bootstrap sections below are historical instructions, not authorization to
> create resources or replay migrations. Existing Workers must be reused. The
> operator confirms `0004_misty_red_skull.sql` is already applied remotely; do not
> apply it again. API/Bot deployed versions remain unverified until inspected.
> Automatic deployment stays OFF. Guarded deploy commands now also require the
> account/token, verified URLs and current-main `RELEASE_REVISION` described in
> the CI/CD runbook. Migration/Telegram operations remain separate manual tasks.

**Development/testing only, not approved for operational use.** One Cloudflare
configuration, no staging/production pair. Dashboard deployment is independent:
none of these commands deploys Web. Business GETs now require Web sessions and
current role/assignment scope. Identity/audit are restricted and report HTTP writes
remain deny-by-default. Use synthetic data for local/bootstrap rehearsals.

## Historical bootstrap handoff (PR #5)

Prepared from `main` after merged PR #5 (`53e413e`). Wrangler was **not
authenticated**, so no remote resources, migrations, deployments, secrets,
webhook changes, Admin bootstrap or live Telegram tests have been performed.
No deployed URLs are known. Local checks passed: workspace typechecks, 39
workspace tests, 20 deployment-helper tests, Drizzle migration checks, Hono route
inspection, both Worker bundle dry-runs, lint and formatting. These are automated/
local checks only, not remote deployment or real Telegram evidence.

The API's all-zero UUID remains a **local-only
sentinel**, not a Cloudflare database ID. Deployment/remote root commands fail
before invoking Wrangler until it is replaced with the real returned UUID.
Do not bypass the guard with direct `wrangler deploy` or `--remote` commands
while the sentinel remains. Never use temporary preview accounts.

## Prerequisites and target confirmation

- Node.js 24 and pnpm 10.30.1. Operational tools use native Node.js ES modules;
  no additional runtime is required.
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

Verify the intended account ID/name **privately** before any write. Set
`CLOUDFLARE_ACCOUNT_ID` in the operator session to that actual 32-hex account ID
(not a token), even if you have only one account. Verify Wrangler access to that
account again. The Bot deployment helper requires this explicit selection and
pins the child Wrangler process to it. Do not copy sensitive command outputs into PRs.
Only the newly provisioned Sales Visit resources are in scope. If `sales-visit`
already exists, stop and establish ownership/purpose and whether it is the new
empty test target; never adopt an unrelated database just because its name matches.
Likewise inspect existing `sales-visit-api`/`sales-visit-bot` Workers in the account
before deploying; stop on any unrelated resource-name collision.

## D1 creation and configuration

**Existing installations:** do not repeat resource creation or bootstrap below.
For the Web authentication milestone, follow [the staged rollout checklist](web-auth.md#manual-release-checklist),
verify 0000–0006 are applied, and apply only pending 0007. Current schema has
13 application tables, adding the durable Telegram draft and Web challenge/session
tables beyond the older ten-table bootstrap description below.

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
pnpm --filter @sales-visit/api exec wrangler whoami
pnpm --filter @sales-visit/api exec wrangler d1 info DB
```

**STOP before any remote migration.** Verify the selected Cloudflare account ID
and name against the intended account, and compare the actual D1 UUID reported
by `d1 info DB` with both the reviewed creation result and `database_id` in
`apps/api/wrangler.jsonc`. Confirm this is the new `sales-visit` test database,
not an unrelated resource. Record the target verification privately. A matching
database name or a syntactically valid UUID alone is not sufficient. On any
mismatch or missing evidence, stop; do not run a migration.

Only after completing that explicit verification, run separately:

```sh
pnpm db:migrate:remote
pnpm db:verify:remote
pnpm --filter @sales-visit/api exec wrangler d1 migrations list DB --remote
```

After migration, no pending migrations should remain. `d1_migrations` must
record `0000_initial.sql`, `0001_identity_foundation.sql`, and
`0002_open_lucky_pierre.sql`, and `0003_greedy_spot.sql` exactly once. The
Outlet/Schedule backend requires migration 0003 **before** the matching API
release; Bot code alone must not be used as migration verification. Expect ten application tables:
`sales_force`, `outlets`, `products`, `visits`, `stock_reports`,
`stock_report_items`, `users`, `telegram_identities`, `access_audit`,
`visit_schedules`, plus D1's
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
2. Run `scripts/telegram-test-bot.mjs` via `pnpm telegram:test-bot` **locally in a
   private terminal**, not through an agent session/recorded terminal. Both input
   and output must be terminals; redirected/piped sessions are refused. Use
   `pnpm telegram:test-bot --help` for credential-free usage. It prompts for the
   token with echo disabled, calls `getMe`, displays only bot ID/username, and
   requires `TEST username` confirmation.
   Compare to BotFather. Abort on any mismatch; a bot ID is not an Admin user ID.
3. Confirm Cloudflare login/account, the account's actual workers.dev subdomain
   (dashboard → Workers & Pages), no unrelated Worker-name collision, and the
   already deployed API/`BotIdentity` entrypoint. Use that verified subdomain for
   the new Bot URL; do not guess it. In that same account's dashboard verify the
   subdomain belongs to the account ID selected in `CLOUDFLARE_ACCOUNT_ID`.
   The helper displays that account ID and URL and requires typing
   `ACCOUNT ACCOUNT_ID sales-visit-bot.YOUR_SUBDOMAIN.workers.dev` before creating
   the secrets file or invoking Wrangler. This is a mandatory operator ownership
   attestation, not automatic ownership discovery; public health is not proof of
   account ownership. Independently verify the Worker is dedicated to this
   separate test bot, using trusted deployment records and the Worker owner.
   The helper sees only the supplied token's webhook; it cannot detect another
   bot whose webhook targets the same Worker URL. Replacing that Worker's token
   or secret would disrupt the other bot. Never replace a Worker used by another
   bot, and never use the teammate's credentials to investigate. Abort on any
   uncertainty. Then use the helper for bootstrap:

### Initial Bot deployment (both required secrets supplied with code)

```sh
pnpm telegram:test-bot initial-deploy https://sales-visit-bot.YOUR_SUBDOMAIN.workers.dev/
pnpm telegram:test-bot info https://sales-visit-bot.YOUR_SUBDOMAIN.workers.dev/
```

After `getMe` identity confirmation, verifying **no webhook is active for the
supplied bot token**, and
account/URL ownership confirmation, the helper generates a cryptographically random 32-byte URL-safe webhook secret. It
writes both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` to a temporary JSON
file **outside the checkout**, in a private 0700 directory with a 0600 file. It
invokes Wrangler `deploy --name sales-visit-bot --secrets-file PATH`, supplying
both required secrets with the first Worker version. Only the random file path,
not a credential, appears in arguments. JSON avoids dotenv variable expansion.
The file/directory are removed after Wrangler exits, including deployment errors,
write failures, Ctrl-C, SIGTERM and terminal closure (SIGHUP). On macOS and Linux,
interruption terminates the Wrangler process group (including pnpm descendants),
with a bounded SIGKILL fallback, before removing credentials. Hidden input uses
raw terminal mode without echo and restores terminal state on cancellation.
As with any local file, uncatchable termination (SIGKILL/power loss) cannot guarantee cleanup: use a
trusted private temporary filesystem and remove any abandoned
`sales-visit-secrets-*` directories privately before retrying. No manual secret
file or token-bearing shell command is needed; a repository-local TMPDIR is refused.

Only after Wrangler succeeds and GET `/health` at the supplied Worker URL returns
200 with exactly `{"status":"ok","service":"sales-visit-bot"}` does the helper
re-fetch `getWebhookInfo` for the supplied bot and require its URL to still be
empty before calling `setWebhook`, using the same generated `secret_token` and
`allowed_updates: ["message"]`. A failed deployment or health check leaves the
Telegram webhook unchanged. Health verifies liveness/service identity, not RPC;
inspect the deployed `IDENTITY` binding and complete the acceptance checks below.

### Subsequent code updates and planned credential replacement

**`configure` is disabled** and fails before reading credentials or making remote
calls. There is no in-place secret rotation: updating Cloudflare first can break
an active webhook if Telegram rejects `setWebhook`, and the previous generated
secret cannot be recovered. Health checks cannot solve that consistency problem.
`initial-deploy` also refuses an active webhook for the supplied bot, including
one at the same URL, so it cannot bypass this restriction for that bot. This
check says nothing about other bots using the Worker; independently verify
Worker ownership and exclusive use before deploying, including when changing
to a different test-bot token.

For code-only updates use `pnpm deploy:bot`, which preserves existing secrets,
after rechecking the selected account and Worker ownership; then check `/health`.
For credential replacement or webhook reconfiguration, schedule an explicit test
interruption and use this stop-and-redeploy procedure:

1. Reverify the separate test bot, selected Cloudflare account, URL/Worker
   ownership and that no other bot uses this Worker.
2. Run the helper's `delete` action below. It confirms bot identity and the exact
   existing test webhook, requires explicit deletion confirmation and retains
   pending updates. Check `info` shows no active webhook. Never delete another
   bot's webhook or ignore a different-webhook refusal.
3. Run `initial-deploy` again with the intended URL. It reconfirms account/URL
   ownership, redeploys code with fresh credentials using the same private
   secrets-file procedure, verifies health, then registers the webhook.
4. Check `info` and actual delivery. This deliberately stops delivery rather than
   risking an existing webhook with an unknown, obsolete secret.

Run this procedure with **one operator per bot/Worker at a time**, with other
webhook writers and deployment automation stopped. Immediately before each
`setWebhook` or `deleteWebhook`, the helper re-fetches `getWebhookInfo`:
registration requires no active webhook; deletion requires the intended URL.
A conflicting, absent (for deletion), malformed or unreadable latest state
refuses the mutation. These checks narrow but do not eliminate concurrent-change
risks: Telegram provides no atomic compare-and-set for webhook mutations, and
another writer can change state between the read and write. A same-URL change
with different credentials is not detectable. A late refusal after deployment
does not undo the Worker deployment; inspect the state privately rather than
blindly retrying.

No token, secret, response payload, error URL or traceback is printed. Wrangler
output is discarded and persistent Wrangler debug logging is disabled. Cloudflare
login must already work. Pending updates are retained and redirects are not
followed. If deploy, health or webhook setup fails, delivery remains stopped;
verify prerequisites privately (including workers.dev propagation) and inspect
`info` before retrying. If no webhook is active, retry `initial-deploy`; the secret
is not retained and a new one is generated. If Telegram accepted `setWebhook` but
the response was lost, `info` may show an active webhook: verify delivery instead
of blindly retrying. To retry credential replacement, explicitly delete that
verified test webhook first. Do not weaken secret validation or enable in-place
rotation without a reviewed recovery mechanism.

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

## Outlet & Schedule manual smoke checklist (separate test bot)

This is an **unexecuted operator checklist**, not authorization to deploy, migrate,
change webhooks, or modify credentials. Use the existing separate test bot only,
after independently approved API migration/release and Bot release procedures.
For local testing, use the tunnel procedure in `apps/bot/README.md` instead.
Keep all business records synthetic while public business GETs remain unauthenticated.
See the [exact command grammar](../apps/bot/README.md#outlet--schedule-command-grammar).

- [ ] Confirm intended bot username, exclusive Worker ownership, named `IDENTITY`
      binding to `BotIdentity`, migration 0003 and active test Admin/Supervisor/SF.
      Never inspect or alter the teammate's bot. Verify test SF link out of band;
      reuse `test-sf-01` only if the operator verified it is synthetic.
- [ ] Admin `/help`: management and monitoring commands shown. Supervisor sees
      Outlet reads/monitoring only; SF sees `/jadwal`; pending/disabled sees no
      planning commands. Existing `/register`, `/pending`, `/approve`, `/reject`,
      `/me` still work with consenting synthetic test accounts.
- [ ] Admin `/tambahoutlet Toko Sintetis PR9`; record returned internal token
      privately. Repeat only intentionally to check duplicate names are allowed.
      Supervisor `/outlets` and `/outlet TOKEN` work; Supervisor/SF mutation denied.
- [ ] Admin `/editoutlet TOKEN Nama Baru Sintetis`; confirm details. Create a
      disposable second Outlet, check deletion without `KONFIRMASI` is denied, then
      `/hapusoutlet SECOND_TOKEN KONFIRMASI` succeeds. Unknown Outlet is not found
      for Admin, but unauthorized callers receive only access denial.
- [ ] Admin `/tambahjadwal test-sf-01 TOKEN senin` succeeds; repeat returns
      duplicate. Supervisor provisioning is denied. Referenced Outlet deletion is
      denied; do not delete reports or schedules to work around the restriction.
- [ ] Linked SF `/jadwal` matches current Jakarta day, `/jadwal SENIN` filters,
      `/jadwal minggu` shows an empty state if unassigned, `/jadwal semua` spans all
      days. SF `/jadwalsales sf=test-sf-01` and `/jadwal sf=other` cannot select
      another member. Admin/Supervisor `/jadwalsales hari=senin sf=test-sf-01` works.
- [ ] In a disposable **local** fixture with >50 records, copy complete next
      commands. Verify filters persist, whitespace/Unicode tokens round-trip, no
      truncation of ID tokens, readable packed messages <=4096 characters, and
      `<b>`, `&`, `*` in synthetic names remain plain text. Automated tests cover
      these cases without filling the remote test DB unnecessarily.
- [ ] Test group commands and a non-Admin message forwarding an Admin message:
      neither grants authority. Unregistered/inactive users remain denied.
- [ ] On transport/delivery failure, inspect the list before repeating creates;
      no exactly-once receipt exists. Do not induce remote failures or expose raw
      logs. Mark actual live outcomes separately from automated results.
- [ ] Verify no Visit/Stock Report was created by scheduling. Public writes stay
      401; no new administrative HTTP routes exist. Record sanitized evidence only.
      Retain referenced synthetic schedules for reviewed cleanup: schedule deletion
      and reporting wizard are deliberately not implemented.

No remote deployment, migration, credential or webhook operation was performed
as part of the Telegram Outlet/Schedule implementation.

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
For replacement, follow the planned interruption procedure above: remove only
this test webhook, reconfirm account/URL ownership, and run `initial-deploy`.
Do not use the disabled `configure` action. The helper intentionally supports only
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
