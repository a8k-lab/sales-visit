# T1 — Demo authentication and test environments

## Local Web + API, without Telegram

From the repository root (Node 24, pnpm 10):

```sh
pnpm install --frozen-lockfile
cp apps/api/.dev.vars.example apps/api/.dev.vars # first setup only
cp apps/web/.env.example apps/web/.env # first setup only
pnpm db:migrate:local
pnpm db:seed:demo:local
pnpm dev:api
# in a second terminal:
pnpm dev:web
```

For existing private local vars, add `APP_ENV="local"`,
`DEMO_AUTH_ENABLED="true"`, `WEB_ORIGINS="http://localhost:5173"` and leave
`TELEGRAM_CLIENT_ID=""`. Restart Wrangler after changes. Open
`http://localhost:5173/login`. Choose a named account under **Demo Login**.
No Bot startup, token, webhook, tunnel, BotFather configuration or Telegram SDK
is required. Telegram is prepared only when its button is selected; after
preparation, click again to open its popup synchronously.

Migration 0011 adds nullable `users.display_name` only. Existing migrations and
Telegram registrations/linkage remain unchanged. All local commands share the
API's local D1 state; no remote flags, reset, or production credentials needed.
Wrangler tracks applied migrations; running local migration apply again is safe.

## Authentication and account management

- Demo routes require **both** `APP_ENV=local|staging` and
  `DEMO_AUTH_ENABLED=true` (exact strings). Missing/unknown/production config
  returns 404 from both routes. Production config pins `production`/`false`;
  existing release guards reject any other values. A frontend flag cannot enable it.
- `GET /auth/demo/accounts` returns `{ environment, items: [{ id, name, role,
  salesForceId }] }`, active eligible accounts only.
- `POST /auth/demo/login` accepts strictly `{ userId }` and returns the same
  `{ token, expiresAt, account }` as Telegram Login. Only active Users with valid
  names/roles and **no Telegram identity** qualify. SF needs a valid exclusively
  owned master. Eligibility is checked again in the session INSERT.
- Sessions remain random opaque tokens, SHA-256 hashes in `web_sessions`,
  60-minute absolute expiry, live status/role/association checks, existing logout.
  No password, JWT application session, fake authorization or second database.
- An active authenticated Admin can `POST /admin/users/demo` with
  `{ displayName, role, salesForceId?, operationId }`. SF requires an existing
  unclaimed master; other roles forbid an association input. Names are trimmed,
  1–256 characters, without control characters. Invalid input is 400, missing or
  expired session 401, non-Admin 403, ownership/operation conflicts 409.
- Creation and the existing `access_audit` **register** action commit in one D1
  batch, including live Admin/session, operation deadline/replay and ownership
  guards. `register` already means account creation; its JSON records name, role,
  status and association. No audit action-constraint change/table rebuild needed.
- **Pengguna & Akses → Tambah Akun Demo** is available only after the server
  confirms demo support. Uses existing operation tickets, tab lock and uncertain
  outcome recovery. Newly created Users appear in management and the next login
  account fetch, without editing frontend fixtures.
- Role/disable/enable support demo accounts and retain current Admin protection
  (Admins cannot be demoted/disabled) and immutable SF ownership rules. Association
  survives non-SF roles and disabling. Re-enabling may restore an unexpired,
  unrevoked session, exactly as for Telegram accounts.
- Web management has nullable Telegram fields plus `displayName`. Telegram Bot
  Demo Mode now selects the same eligible accounts through a separate D1 credential;
  demo accounts never acquire a Telegram identity. See [Telegram Demo Mode](telegram-demo-mode.md).
- Business write policy is unchanged: public Visit/Stock Report POSTs stay denied.

## Deterministic data

`apps/api/seeds/demo.sql` reserves `demo-*` IDs. It creates 2 Admins, 4 Supervisors,
14 SF Users and unique SF masters; names are Indonesian and no Telegram identities
are inserted. Supervisor assignments are **4 / 5 / 5 / 0**. There are 35 Outlets,
4 Products, 156 Visits, 78 Stock Reports (312 items), and 98 weekly schedules.
Activity varies from 2 to 24 Visits per SF; SF 13/14 have none. Visits span
**3–26 November 2026 (WIB)**, multiple Outlets and reporters. Use these dates for
filters when the current dashboard period no longer intersects the fixtures.
Catalogs/operational lists exceed UI page sizes; the 20-persona account list fits
one page initially. Additional accounts appear immediately through the API.

Conflicts are specific no-ops, never UPDATE/DELETE/REPLACE. Reruns preserve edits,
assignments and unrelated business data. If a reserved ID or master is already
claimed, the seed preserves it rather than repairing/overwriting it; inspect
conflicts privately. Only a pristine namespace guarantees the initial counts.
Use only the guarded `db:seed:demo:local` / `db:seed:demo:staging` commands;
never run the SQL against production. Original local seeds remain available.

## Staging operator prerequisites (not performed by this change)

Staging is **new dedicated resources**, not the existing/current production
Workers or D1. Existing production release/migration scripts remain strict and
must not be pointed at staging or loosened to accept it. No CI rewrite or Bot
staging deployment is required.

1. Approve provisioning a **new** D1 named `sales-visit-staging`, a Worker
   `sales-visit-api-staging`, and a static Worker `sales-visit-web-staging` in the
   intended Cloudflare account. Record/verify their resource identities privately.
   Do not attach the production D1, Bot service binding or webhook.
2. Choose two custom HTTPS hostnames under the **same registrable domain**, e.g.
   `staging.example.com` and `api.staging.example.com`, distinct from production.
   Edit the dedicated `apps/{api,web}/wrangler.staging.jsonc` templates in a
   reviewed configuration change: replace `.invalid` hostnames and the D1 UUID.
   Templates intentionally cannot deploy/usefully validate as supplied. Keep
   `workers_dev=false`, `preview_urls=false`, and only these custom-domain routes.
   Do not enable alternate workers.dev, preview, old zone routes or other domains.
3. **Before making demo routes reachable**, create Cloudflare Access self-hosted
   applications covering **all paths** on both hostnames. Allow only approved
   tester identities/groups, deny everyone else, set suitable session duration.
   No public Bypass/Everyone or service-token policy for actual API methods.
   Confirm no overlapping application/path policy bypasses the protection. Block
   or delete any alternate direct-access routes. Worker previews and workers.dev
   must remain disabled on both Workers, including after every deployment.
4. API Access application: enable **Bypass OPTIONS requests to origin** only.
   Browsers omit Access cookies from preflights; the API answers exact-origin
   preflights without application authentication, while Access still protects
   actual GET/POST/PUT. API CORS allows only the staging Web origin, credentials,
   Authorization and Content-Type. No wildcard, no public Access bypass for GET.
   See [Cloudflare Access CORS guidance](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/cors/).
5. Testers first open the Web hostname and complete Access login, then open
   **the API `/health` URL directly** and complete its Access login too. Return
   to Web and reload. Each hostname needs its own `CF_Authorization` cookie;
   logging into Web alone does not guarantee an API cookie. Frontend requests now
   use `credentials: include`, and API returns exact-origin
   `Access-Control-Allow-Credentials: true`. Use same-site domains and confirm
   browser cookie policies allow the Access cookie. Expired Access sessions may
   appear as CORS/network errors: revisit API `/health`, authenticate and retry.
   These edge cookies do **not** authenticate an application User: Bearer sessions
   and live D1 authorization are still mandatory for protected application reads.

### Operator-controlled release

Do not execute these remote steps as part of implementing/reviewing this PR.
After approval/merge, use the reviewed current `main`, green CI, clean checkout,
recorded commit SHA, verified Cloudflare account and a scoped operator token.
Keep automatic production CD off. Provision/verify the dedicated resources and
Access above first; deployment must not implicitly create/repurpose resources.

Export nonsecret approvals `STAGING_D1_ID`, `STAGING_WEB_ORIGIN`,
`STAGING_API_ORIGIN` matching the reviewed templates, plus private
`CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`. Clear all Wrangler environment,
config/name/account override variables. Run `pnpm check:staging`; it refuses the
production D1, resource names, unknown environment, direct URLs and wildcard or
unapproved origins. The check is offline configuration validation, **not proof
of Access setup or remote resource ownership**. Independently compare the account,
Worker identities, D1 UUID/name and routes to the Cloudflare inventory; stop on
any mismatch. The existing production guards are deliberately not bypassed.

In `apps/api`, operator may then run, with no additional overrides:

```sh
pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.staging.jsonc --env-file /dev/null
pnpm exec wrangler deploy --minify --config wrangler.staging.jsonc --env-file /dev/null
```

Seed only after verifying migration history and Access. From repository root:

```sh
STAGING_ACCESS_CONFIRMED=true STAGING_SEED_CONFIRM=sales-visit-staging pnpm db:seed:demo:staging
```

The seed wrapper revalidates config, requires both confirmations and checks the
remote D1 UUID/name before invoking Wrangler. It does not create resources or
reset data. Seed can be rerun; never adapt the wrapper to permit production.

Build Web from the same clean revision with
`VITE_API_URL="$STAGING_API_ORIGIN" pnpm build:web` (public URL only), then in
`apps/web` run `pnpm exec wrangler deploy --config wrangler.staging.jsonc --env-file /dev/null`.
Review the dry-run bundle/config before approved actual deploys. Record versions
and verify Access/routes again; no Bot/Telegram changes. These are manual staging
steps, separate from guarded production CI; do not substitute production config.
Rollback to recorded staging Worker versions if necessary; do not roll back or
reset business data. Production rollout needs the additive migration through its
existing operator procedure; production vars remain `production` / `false`, and
**no demo seed** is part of that procedure.

## Manual verification checklist

- [ ] Local login with Telegram Client ID empty, no Bot process, Telegram host
      blocked: account groups/names/roles, loading/error/retry/empty states work.
- [ ] Admin sees all data and management; Supervisors 1/2/3 see only assigned SF,
      Supervisor 4 sees empty state; SF sees only own Visits/reports, including
      no-Visit accounts. Exercise pagination/date/outlet/reporter filters.
- [ ] Admin creates each role; SF requires a free master. New name appears on
      management/login. Duplicate claims fail; disabling blocks login and current
      sessions; role changes affect next read; Admin protection remains.
- [ ] Logout/expiry redirects; reload restores live session. Unknown write result
      uses existing operation recovery, not blind retry.
- [ ] Telegram Login and Bot registration, approval, private reporting and webhook
      remain functional with separately approved test credentials (not locally
      verified against Telegram by this change).
- [ ] Staging unauthorized browser gets Access denial for Web and API, including
      `/auth/demo/*`, `/health` and direct URLs; OPTIONS alone discloses no accounts.
      Approved tester logs into both hostnames and completes Demo Login and API
      reads with Access cookies + application Bearer token. Verify expiry/relogin.
- [ ] Production demo GET/POST return 404 even with forged frontend flags or
      `DEMO_AUTH_ENABLED=true` while APP_ENV remains production. No demo data seeded.

Automated checks use disposable Miniflare D1, existing Bot/Telegram regressions,
seed reruns, live lifecycle/scoping, audit rollback/ownership conflicts and offline
configuration guards. Real Cloudflare inventory, Access/IdP/browser cookies,
remote migration history, deployment, BotFather and Telegram popup behavior require
operator validation. Demo auth intentionally grants any approved tester all
listed personas (including Admin); it is not suitable for production or sensitive
production data. Access is the staging perimeter, not CORS or the demo selector.
