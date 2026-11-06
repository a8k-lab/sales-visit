# GitHub Actions CI/CD

## State and safety boundary

Automatic deployment is **OFF** unless repository variable `ENABLE_AUTO_DEPLOY`
is exactly `true`. This implementation does not set variables/secrets, create
environments, inspect live Cloudflare resources, deploy, migrate, seed, rotate
secrets or change Telegram webhooks. The operator confirms remote migration
`0004_misty_red_skull.sql` was already applied. **Do not apply it again.** Deployed
API/Bot versions remain unverified until a release preflight inspects them.

Reuse only these existing resources in the verified account:

| Target | Workspace/config          | Worker            | Root command                        |
| ------ | ------------------------- | ----------------- | ----------------------------------- |
| web    | `apps/web/wrangler.jsonc` | `sales-visit`     | `pnpm build:web && pnpm deploy:web` |
| api    | `apps/api/wrangler.jsonc` | `sales-visit-api` | `pnpm deploy:api`                   |
| bot    | `apps/bot/wrangler.jsonc` | `sales-visit-bot` | `pnpm deploy:bot`                   |

No staging environment, resource bootstrap or rollback automation is included.
Old bootstrap instructions in `docs/deployment.md` are historical, not steps to
repeat on these resources. No frontend tests or business behavior were added.

## Pull requests and branch protection

`.github/workflows/ci.yml` runs on **every** PR targeting `main`, including docs
changes and PRs retargeted to `main` (`edited` events). No workflow-level path exclusion, `pull_request_target`, Cloudflare
credentials or deployment environment is used. Permissions are `contents: read`.
Checkout credentials are not persisted. Third-party actions are commit-SHA pinned;
Node 24 and pnpm 10.30.1 are explicit. Installation uses the frozen lockfile.

Use **`CI required`** as the branch-protection required check, not individual
workspace checks. It runs with `always()` and fails on failures/cancellations;
intentionally skipped workspace checks are accepted. Require PR review and this
check on `main`; protect `.github/`, deployment helpers, package scripts and
Wrangler configurations with trusted review. Do not run untrusted PRs on a
credential-bearing/self-hosted deployment runner.

Shared path rules: `scripts/ci/changes.mjs`. PR comparisons use base/head
merge-base; push reports compare the full `before..after` range (not `HEAD^`).
Renames include both paths. Missing/invalid revisions fail; an all-zero initial
push base conservatively includes the complete tree.

| Changed paths                                        | CI workspaces                            | Automatic CD artifacts           |
| ---------------------------------------------------- | ---------------------------------------- | -------------------------------- |
| `apps/web/**`                                        | Web                                      | Web                              |
| `apps/api/**`                                        | API + Bot RPC integration                | API only                         |
| `apps/bot/**`                                        | Bot + API integration                    | Bot only                         |
| `packages/contracts/**`                              | All                                      | All consuming Workers            |
| `packages/db/**`                                     | API + Bot integration, DB validation     | API only                         |
| Root manifest/lockfile/workspace/TS/toolchain config | All + DB/helper checks                   | All (ambiguous dependency graph) |
| `scripts/**`, `.github/**`                           | All + deployment helpers + workflow lint | None by themselves               |
| Markdown / `docs/**`                                 | Global lint/format only                  | None                             |

App/shared-package paths are deliberately conservative, including tests/config
within those scopes. Lockfile importer/transitive attribution is not attempted;
all three artifacts are included rather than risking missed transitive changes.
A shared build change that changes artifacts must also update its owning app or
root build manifest; deployment/guard-only edits intentionally don't release code.

Global quality runs `pnpm check`. API checks typecheck contracts/DB/API and run
contracts, DB and API tests. Bot checks typecheck its RPC dependency and run
`apps/api/tests/bot-*.test.mjs`, including the API/Bot integration tests. Web checks
typecheck and production build. DB changes also run Drizzle `db:check`; DB tests
apply every SQL migration to local in-memory SQLite and exercise constraints.
Deployment tooling/workflow changes, app `package.json` deploy-script changes,
app Wrangler configs and app scripts run `pnpm test:deployment` and checksum-pinned
`actionlint` 1.7.12. These jobs need no external service credentials.

## Operator setup (do not automate)

1. Confirm ownership of all three existing Workers and the D1 database. Confirm
   API is the only Worker with `DB`, and Bot uses `IDENTITY` → `sales-visit-api`,
   entrypoint `BotIdentity`. Inspect deployed versions; don't infer PR #10 is live.
2. In Cloudflare, inspect each Worker's **Settings → Builds / Git integration**.
   Disable/disconnect production and preview Git-triggered deployment for these
   same Workers, and check there are no pending Builds runs or other CI writers.
   Retain the existing Workers, URLs, D1 binding and Telegram secret names.
   GitHub Actions must be the sole CD owner before activation. This supersedes
   ADR-0005's original Workers Builds ownership, not its Cloudflare architecture.
3. Manually create a GitHub Environment (for example `cloudflare`). Restrict its
   deployment branches to `main`. Where the plan supports it, require reviewers
   and prevent self-review/admin bypass. No approval feature is required by PR
   CI. If reviewers are unavailable, retain main-only branch restrictions and
   use a separately recorded operator/reviewer release approval before dispatch.
4. Set **repository** variable `CLOUDFLARE_ENVIRONMENT` to that exact existing
   environment name (letters, digits, `_`, `-`). The plan job reads the GitHub API
   to confirm it exists before the release job references it; it never creates it.
   Only the plan job adds `actions: read` for Get an Environment; the release job
   retains `contents: read` with no GitHub write permissions.
   Do not rename/delete it concurrently with a release.
5. Configure the following variables/secrets manually:

| Setting                  | Kind / location                                     | Value                                              |
| ------------------------ | --------------------------------------------------- | -------------------------------------------------- |
| `ENABLE_AUTO_DEPLOY`     | Repository variable                                 | Leave unset or `false` initially                   |
| `CLOUDFLARE_ENVIRONMENT` | Repository variable                                 | Existing environment name                          |
| `CLOUDFLARE_ACCOUNT_ID`  | Environment or repository variable                  | Intended 32-lowercase-hex account ID               |
| `CLOUDFLARE_API_TOKEN`   | Environment secret (preferred) or repository secret | Dedicated scoped token                             |
| `WEB_URL`                | Environment or repository variable                  | Exact verified HTTPS Web origin, no trailing slash |
| `API_URL`                | Environment or repository variable                  | Exact verified HTTPS API origin, no trailing slash |
| `BOT_URL`                | Environment or repository variable                  | Exact verified HTTPS Bot origin, no trailing slash |

URLs currently must be the Workers' enabled **workers.dev** origins. The helper
independently reads the account subdomain and each Worker's subdomain status and
compares the complete URL. It never derives a subdomain from an account ID. Custom
domains require a separately reviewed ownership-verification extension; don't
substitute an arbitrary healthy URL. All three URLs are needed for automatic CD;
manual Web needs Web only, API needs API only, Bot needs Bot + API.

### Cloudflare token permissions

Use a dedicated **API token**, not a global API key/personal login. Scope it to
only the intended account; use finer existing-Worker restrictions if supported by
your Cloudflare plan/token model. Deployment needs **Workers Scripts: Edit**
(including static-assets upload and read inspection), **Account Settings: Read**
(for independent account identity), and **D1: Read** (database identity and the
read-only migration query). No D1 write, zone/DNS/routes edit, token-management,
Telegram secret rotation or webhook permission is requested. Validate actual
permissions in the manual dry-run; missing permissions fail, never escalate.

For validation-only dispatch, a separate token with **Workers Scripts: Read**,
Account Settings: Read and D1: Read is sufficient; read inspection does not imply
write authorization. The migration process uses separate operator authorization,
not the CI token. Never print token values, binding values, raw API responses or
Telegram updates. Wrangler output/log files are suppressed for deploys.

## Existing-target guard

`scripts/ci/targets.mjs` reads the actual JSON/JSONC configs, allowlists names,
entrypoints and supported configuration fields, and rejects alternate environments,
accounts, resource definitions and unexpected deployment-script contents. Unknown
settings require explicit review rather than being silently accepted.

Before any selected release is written, the helper:

- Checks a well-formed explicit account and reads its identity through the
  authenticated, account-scoped API. Wrangler receives that same account ID.
- Lists existing scripts and requires exactly the intended name and immutable
  script tag. Missing/inaccessible Workers never become a create fallback.
- Reads the active deployment/version; split traffic, unknown versions, binding
  mismatches and inaccessible metadata fail closed. Script-version metadata
  (`/workers/scripts/{name}/versions/{version_id}`) supplies bindings/handlers;
  the documented Worker-version endpoint
  (`/workers/workers/{name}/versions/{version_id}`) supplies revision annotations.
  Both responses must match the exact active deployment's version UUID, never
  `latest`. Missing or incorrect commit annotations cannot pass post-deploy checks.
- Requires API `DB` to match the configured real UUID and independently fetched
  D1 name `sales-visit`/UUID. Requires the deployed `BotIdentity` named entrypoint.
- Uses only `SELECT name FROM d1_migrations ORDER BY id` and compares every local
  SQL filename, exactly once, against remote history. Pending, unknown, duplicate
  or unavailable history blocks release. This includes already-applied 0004.
- Requires Bot's exact Service Binding/entrypoint and existing secret **names**
  `TELEGRAM_BOT_TOKEN`/`TELEGRAM_WEBHOOK_SECRET`, never their values.
- Requires Web assets at `./dist` with SPA fallback and no Worker entrypoint.
- Rejects explicitly disabled `workers_dev` before any upload; omission/default
  or `true` is allowed, but the existing remote workers.dev origin must be enabled.

The existing `scripts/cloudflare-remote.mjs` target validation remains in the API
deploy path. Its migration/verification commands remain separate operator actions.
Web/Bot workspace deploy scripts now also use the guarded wrapper. Root commands
are unchanged; the wrapper pins the workspace, `--config wrangler.jsonc`, an empty
`--env-file /dev/null`, immutable `WRANGLER_CI_MATCH_TAG`, and commit `--tag`.
Unapproved `--name`, `--env` and extra CLI arguments are refused. No arbitrary
Wrangler command can be supplied by dispatch. Local deploy commands now require
the same token/account/URL settings and `RELEASE_REVISION` equal to current
`main`; prefer the approved workflow rather than bypassing wrappers.

### Diagnosing a Bot Service Binding refusal

The Dashboard display is not a reason to assume a binding is missing or to
redeploy. Preflight reads bindings from the exact **active deployment version**,
not a latest upload or an unverified Dashboard draft. `[bot-binding-guard]` reports
only a service count, fixed condition booleans and a closed environment enum:

```text
[bot-binding-guard] source=active-version {"serviceCount":1,"expectedBindingPresent":true,"targetMatch":true,"entrypointMatch":true,"unexpectedEnvironment":false,"environment":"production"}
```

A refusal carries the same fields in its error; successful active-version
validation emits one line. No binding names/values from the response, arbitrary
fields, secret values, tokens or raw API responses are logged. The configured
name, target and entrypoint remain exact comparisons, with exactly one Service
binding required. `environment` is only `omitted`, `production` or `unexpected`.

Cloudflare's [documented Service metadata](https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/#bindings)
can explicitly contain `environment: "production"`. The old truthiness check
incorrectly rejected that valid API representation. Active-version validation
accepts only omission or that exact production value; other values fail closed.
Local Wrangler config still must omit the environment field, and `--env` remains
forbidden. No binding/resource change is needed to correct this schema assumption.

The original post-merge dry-run logged only a generic refusal, so its precise
failed condition cannot be recovered from that log. After review/merge, an
operator may repeat **validation-only** (`dry_run: true`, automatic CD OFF) to
obtain the sanitized conditions. A count/name/target/entrypoint mismatch or
`unexpectedEnvironment: true` means stop and investigate the active version;
do not edit or redeploy the Worker merely to make preflight pass. A documented
production environment is not a legacy missing-binding recovery scenario.

### Source and Web artifact provenance

The wrapper refuses tracked, staged and untracked working-tree changes. It then
exports only tracked files from the verified Git commit into a private temporary
snapshot; a later caller edit, ignored `.env`/`.dev.vars`, old `dist`, or original
workspace symlink cannot become tagged source. Dependencies are installed from the
frozen lockfile into that snapshot using the already populated pnpm store
(`--offline --ignore-scripts`, no Cloudflare credentials). Preserve the configured
pnpm store location; if required packages are unavailable offline, fail rather than
fall back to the mutable checkout. Run the normal frozen install first.

For Web the wrapper removes snapshot `dist` and runs the existing `pnpm build:web`
there before invoking Wrangler from the snapshot workspace. An earlier caller
`pnpm build:web` is useful for local validation but is never deployment provenance.
The release orchestrator does not build Web twice: actual deployment builds in
the wrapper; validation-only dispatch builds locally without invoking the wrapper.
All snapshots are removed on ordinary success/failure, and the current-main check
is repeated after preparation. Abrupt runner termination may leave a local temp
directory; it contains no copied dotenv files or deployment credentials.

### Bot RPC compatibility without Telegram credentials

`BotIdentity` existence and `/health` alone do not prove `visitWizard` support.
There is no existing public API compatibility endpoint or safe HTTP RPC probe.
Do not add an auth bypass, invoke mutating RPCs, or use Telegram credentials.
Instead, the release checks the verified active API's full Git revision tag:
it must equal the release revision, or be an available ancestor with no changes
to API/shared runtime inputs according to the same conservative impact rules
(API, contracts, DB, root manifest/lockfile/toolchain). Current API/Bot integration
tests validate the checked-out contract. Unknown history, missing tags or changed
API inputs block Bot-only release even if the API is healthy; explicitly release
current API first, then Bot, or select `all` if the existing targets pass preflight.
Changes confined to Bot do not force an unchanged compatible API deployment.

Immediately before Bot upload, both the orchestrator and direct guarded wrapper
inspect API prerequisites, require this source-compatibility proof, and check API
health. The orchestrator also refuses a changed API identity/version since its
last verification. After a combined release, the newly verified API revision
satisfies the proof. This is conservative source equivalence under sole CD
ownership, not a claim of live RPC/Telegram E2E coverage.

### Legacy entrypoint/binding recovery: stop rather than bypass

The standard guard intentionally rejects an API without deployed `BotIdentity`
or a Bot without the correct `IDENTITY` binding, including an `all` baseline.
It also rejects wrong bindings: never classify a binding to another service as a
safe missing-binding upgrade. An existing name is not proof that a legacy Worker
is safe to overwrite. These are separate operator recovery cases, not dispatch
options. No `skip-bindings`, `skip-migrations`, `force`, or unrestricted deployment
escape hatch is implemented.

For a legacy target that cannot pass preflight:

1. Keep automatic CD OFF and stop other deployment/resource writers. Record the
   precise guard failure, account, immutable Worker tag, active deployment/version,
   database UUID/history through 0004, and existing secret names privately.
2. Obtain operator/reviewer approval for the exact existing-resource repair and
   recovery evidence. A normal `all` dispatch cannot repair it by weakening checks.
3. Prepare a separately reviewed **single-target, exact-version repair**: for API,
   permit only the recorded absent entrypoint as the pre-state, preserving account,
   name, immutable identity, D1 binding/UUID/migration and isolated-source guards.
   Require the repaired API entrypoint/version/revision and health as postconditions
   before any Bot release. For a genuinely missing Bot binding, permit only that
   recorded absence; add exactly `IDENTITY` → `sales-visit-api` / `BotIdentity` after
   API compatibility succeeds, preserving both existing secret names and resource
   identity. Never repair unknown/wrong bindings or missing resources by guessing.
4. This pipeline does **not** implement or authorize that repair operation. Review
   its narrowly scoped tooling/change record separately; do not run unguarded
   Wrangler commands or add a permanent bypass to make this pipeline pass.
5. After approved repair and independent post-verification, return to the unchanged
   strict guards, run validation-only, then perform the approved baseline release.
   Do not recreate Workers, reapply 0004, rotate secrets or change webhooks.

## Manual release and activating automatic CD

1. Leave automatic CD OFF. Merge the reviewed pipeline PR without deploying.
2. Verify the settings above and existing-resource ownership out of band.
3. Dispatch **Deploy existing Workers**, branch **main**, explicit target
   `web`, `api`, `bot`, or `all`, and `dry_run: true` (the default). This performs
   read-only remote checks and local validation/builds but never invokes deploy.
   Resolve failures through reviewed configuration/permission fixes, not new resources.
4. Only with separate release approval, dispatch `target: all`, `dry_run: false`.
   This establishes commit tags for the existing Workers. It is an explicit
   operator release, **not** performed by this implementation. Individual manual
   selections always deploy just those selected Workers, even if unchanged.
5. Inspect actual deployment/version IDs in the job summary, health, bindings,
   and application reachability. Complete real Telegram E2E separately.
6. Only after all three Workers have a verified tagged baseline and GitHub is the
   sole deployment owner, manually set repository variable `ENABLE_AUTO_DEPLOY`
   to exactly `true`. The next main push considers cumulative affected artifacts.
   Unset/set it to `false` to stop future automatic releases; that does not cancel
   an already active release. Never cancel an active upload as routine rollback.

Dry-run does not call Wrangler deploy, migrate, secret or webhook operations.
It validates/builds selected artifacts; it does not run a remote preview upload.
A successful dry-run does not prove the token has deployment-write permission.

## Ordering, revision tracking and concurrency

One repository-wide `cloudflare-existing-workers` lock serializes the entire
release, with `cancel-in-progress: false`. This intentionally serializes independent
Web releases too, trading throughput for simple, safe API/Bot coordination. All
targets/prerequisites are checked **before any write**. Web is built only when
selected and releases first. API then deploys, has target/version verification
and `/health` checked; only then may selected Bot deploy and pass equivalent
checks. Bot-only releases inspect API migration/entrypoint state and API health,
but do not redeploy API. Any API upload, verification or health failure blocks Bot.
No selected Worker is silently skipped after a failure; partial releases require
inspection and a new current-main run, not blind rollback.

GitHub can replace pending runs and does not guarantee dispatch-order execution.
Each automatic run compares **each currently active Worker's commit tag** against
its checked-out current main revision, instead of trusting only this push's diff
or a global last-success watermark. This recovers an earlier Web change even if
its queued run was replaced by a later API/docs push. Tags must be full Git SHAs
and ancestors of the selected revision. Untagged/foreign/diverged baselines fail
closed until an explicit manual baseline/reconciliation. Full checkout history
supports merge commits and multi-commit pushes.

Immediately before each deploy, the orchestrator and wrapper compare checkout
HEAD and remote main HEAD to `GITHUB_SHA`. Older queued/retried/manual-branch runs
fail as stale. They cannot overwrite a newer successful release under this lock.
If main advances during an upload, that active upload is allowed to finish;
remaining stale operations stop, and the next run recovers cumulative changes.
Pre/post inspection checks immutable Worker identity, new deployment/version IDs
and matching commit tag. HTTP checks retry for bounded propagation and follow no
redirects: API/Bot `/health`, Web `/` with the expected HTML root.

**Limits:** Cloudflare/Wrangler does not provide an atomic existing-only
compare-and-swap across inspection and upload. The immutable-tag check and
immediate reinspection narrow this race but cannot defeat an external writer
that deletes/replaces resources during upload. Freeze external resource changes
and use only this deployment owner; never grant broader account permissions to
work around a guard refusal. GitHub environment deletion between existence check
and job scheduling has a similar external-administration race. A healthy HTTP
response verifies liveness, not D1 business operations or Telegram delivery.
Tags describe uploaded code, not a durable successful-smoke ledger. Every automatic
run rechecks health for all unchanged active Workers before returning success or
mutating another target. Thus a same-revision rerun cannot silently turn an earlier
committed-but-unhealthy upload green; it must obtain a fresh successful smoke check.
An unhealthy unchanged Worker blocks the run without rebuilding/redeploying it.
Investigate failures rather than assuming a tag means a successful release. No
automatic schema rollback or webhook/secret changes are attempted.

## Separate manual D1 migration procedure

Ordinary deployment **never** applies remote migrations. **0004 is already
applied; do not run it again or edit any historical migration.** For a future
pending migration:

1. Review new SQL, affected features, compatibility and release sequencing.
2. Confirm account, existing API Worker, `DB`, database name and UUID independently.
3. Capture a D1 Time Travel recovery bookmark or approved backup evidence and
   record operator/reviewer approval privately. Do not reset/import data.
4. In an approved private operator session, use the existing guarded
   `pnpm db:migrate:remote` script for genuinely pending migrations only. The CI
   token intentionally lacks D1 write permission. Do not add a migration job.
5. Inspect migration history, expected constraints and
   `PRAGMA foreign_key_check`; use `pnpm db:verify:remote` as supplementary evidence.
6. Resume current-main API deployment after its read-only migration guard passes.
7. Release a dependent Bot only after verified API success.

Worker code rollback does not roll back D1. Follow the separately reviewed
recovery procedure in `docs/deployment.md`; don't edit applied SQL or auto-rollback
an ambiguous partial release.

## Offline regression checks and manual acceptance

```sh
pnpm install --frozen-lockfile
pnpm test:deployment
pnpm typecheck
pnpm -r --if-present test
pnpm --filter @sales-visit/db db:check
pnpm check
pnpm build:web
# actionlint 1.7.12 on the two workflows (or checksum-pinned Linux helper):
bash scripts/ci/lint-workflows.sh
```

Deployment-helper tests mock Cloudflare and subprocesses, including dry-run,
disabled automation, target errors, migrations, stale revisions and API-before-Bot
failure handling. They do not need live credentials or perform remote operations.

Implementation validation executed locally: 127 deployment-helper tests and
106 workspace tests passed (contracts 15, DB 14, API/Bot 77), frozen installation,
workspace typechecks, Drizzle validation, lint/format, Web production build and
`actionlint` 1.7.12. Web retains its existing >500 kB chunk-size warning. No live
Cloudflare inspection or write, migration, credential or webhook operation was
executed. Live deployment and Telegram acceptance remain unverified.

Operator checklist (not executed as part of implementation):

- [ ] Confirm sole CD owner, main protection, environment approvals and token scope.
- [ ] Confirm exact existing Worker identities, D1 UUID/history through 0004,
      Bot secret names/Service Binding and enabled verified URLs.
- [ ] Run manual dry-run; confirm no Cloudflare mutations in activity history.
- [ ] Separately approve a manual baseline release; record version IDs and health.
- [ ] Confirm Web reachable, API/Bot health and deployed Bot Service Binding.
- [ ] Verify consenting synthetic Telegram flows separately; health is not E2E.
- [ ] Test affected-target reports, stale-run refusal and failure blocking in review.
- [ ] Enable automatic CD only after all prerequisites; never merge automatically.

References: [GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency),
[environment protection](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments),
[Cloudflare script inspection](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/list/),
[deployment inspection](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/),
[Worker-version annotations](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/get/),
[D1 read-only query permissions](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/).
