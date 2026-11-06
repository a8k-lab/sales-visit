# Telegram Web authentication and protected reads

## Architecture and boundaries

This milestone advances **authentication only** beyond ADR-0006's initial static prototype. Web remains a static-assets-only Worker (`sales-visit`), communicating over HTTPS with the existing `sales-visit-api`. There is no BFF, Web entrypoint, Service Binding, cookie dependency, or Web report-write authorization. The existing `sales-visit` D1, BotIdentity private RPC binding, Bot lifecycle/approval rules, durable wizard, and Telegram webhook are unchanged.

The official [Telegram Login documentation](https://core.telegram.org/bots/telegram-login) defines `Telegram.Login.auth`, its signed `id_token` callback, `profile` scope, and nonce. We use `https://oauth.telegram.org/js/telegram-login.js?6`; **no authorization-code exchange, Client Secret, UserInfo endpoint, phone scope, or messaging permission** is needed.

1. The browser prepares `/auth/config`, `/auth/challenge`, and the SDK before enabling the login button. The button invokes the SDK synchronously in the click handler, not after an asynchronous fetch. A stale challenge requires preparation and another click. Cancel/closed popup, SDK/network failure, and a bounded popup timeout have Indonesian status feedback. The SDK does not notify blocked popups, so the timeout explains how to permit popups and retry.
2. API generates separate 256-bit random challenge references and nonces, valid for **3 minutes**. Only the signed nonce is trusted. JOSE verifies Telegram's official JWKS (`https://oauth.telegram.org/.well-known/jwks.json`), issuer `https://oauth.telegram.org`, configured audience, **RS256 only**, required expiry/issued-at/nonce/ID, a maximum token age of 5 minutes, and 30-second clock tolerance. These fixed trust anchors are deliberately not request-configurable.
3. Telegram's `profile` scope places its Bot API user ID in the **top-level JWT `id` claim**. It must be a positive safe integer; it is converted to a canonical decimal string. Neither `sub`, SDK-decoded `user`, username, nor display name supplies identity. There is no separate `profile_verified` flag or UserInfo call: verification means the profile claim is inside the cryptographically verified token.
4. `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now AND nonce = verified_nonce RETURNING id` atomically selects one winner, including concurrent callbacks. Invalid proofs do not consume challenges. The winner resolves `telegram_identities.telegram_user_id` to an existing active User with an assigned valid role. Login never registers, approves, relinks, or edits a profile. All unavailable/unapproved/disabled accounts receive the same sanitized login failure.
5. A 256-bit random opaque Bearer token is returned once. Only its SHA-256 hash is stored in D1, with User ID, creation/expiry/revocation timestamps. TTL is **60 minutes**, absolute, without refresh. Every authenticated read rechecks session expiry/revocation and live User status/role. Sales Force also needs an existing, unambiguously owned Sales Force link; missing/shared links fail closed. Role/association changes affect existing sessions immediately on the next request. Logout revokes the session; even a disabled User can revoke their own otherwise-valid credential.

Tokens are sent in the `Authorization` header, never URLs, and stored in **sessionStorage**, not localStorage. Expired/revoked sessions clear the client credential and redirect to login. Network failures do not silently discard a credential whose logout revocation has not succeeded; the user can retry. **sessionStorage does not protect against XSS**. Avoid untrusted scripts/HTML, keep dependencies updated, and review CSP. Same-origin HttpOnly cookies/BFF are possible future work, not part of this milestone. Disable blocks access while disabled; re-enabling may restore an unexpired, unrevoked session. Logout/revocation remains permanent.

Sensitive responses and errors use `Cache-Control: no-store`. Errors contain no raw ID tokens, session tokens, JOSE diagnostics, SQL, or account lifecycle details. Do not enable request-body/Authorization-header logging or paste callback bodies into tickets. Cloudflare observability and any external logging must retain this policy.

## HTTP contracts

No `/api` prefix. Success bodies are JSON; errors consistently use `{ "error": "sanitized message" }`.

| Endpoint               | Access and success body                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| `GET /health`          | Public liveness, `{ "status": "ok" }`                                            |
| `GET /auth/config`     | Public `{ clientId: number, scope: ["profile"] }`; 503 if unavailable            |
| `POST /auth/challenge` | Public, no body required; `{ challenge, nonce, expiresAt }` (epoch milliseconds) |
| `POST /auth/telegram`  | Strict `{ idToken: string, challenge: string }`; `{ token, expiresAt, account }` |
| `GET /auth/me`         | Bearer required; `{ account: { id, name, role, salesForceId } }`                 |
| `POST /auth/logout`    | Bearer required; `{ ok: true }`, revokes server-side credential                  |

Malformed input returns 400; invalid proof/challenge/account/session returns 401; forbidden origin/scope returns 403; service/configuration failures return 503. Auth request bodies are limited to 16 KiB. Configure an appropriate edge rate limit for `/auth/*` (especially challenge creation and verification) before public activation, and monitor D1/JWKS failure rates without capturing credentials. Expired challenges are incrementally pruned after an hour; session records retain revocation history. Schedule operator-reviewed deletion of expired session records according to the deployment's retention policy; no new cron infrastructure is introduced here.

### Business read policy

All of these GETs (and implicit HEADs) require a valid Web session:

| Read                    | Admin / Supervisor        | Sales Force                                                       |
| ----------------------- | ------------------------- | ----------------------------------------------------------------- |
| `/sales-force`          | All ID/name references    | 403                                                               |
| `/outlets`, `/products` | ID/name reference data    | Same limited ID/name references for reporting                     |
| `/visits`               | All Visits                | Own Sales Force only                                              |
| `/visits/:id`           | Visit plus linked reports | Own Visit only; nested reports also restricted to own reporter ID |
| `/stock-reports`        | All reports               | Own reporter Sales Force only                                     |

Supervisor receives no account-administration privilege. Non-owned and nonexistent Visit detail IDs both return 404. Sales Force query parameters selecting another `salesForceId`/`reporterSalesForceId` return 403; ownership predicates are applied in SQL regardless of browser filtering. Admin/Supervisor lists are unfiltered monitoring reads; those query parameters do not implement optional reporting filters.

Lists retain bare-array contracts with `limit` (1–100, default 100) and `offset` (0–100000, default 0). Continue with the next offset until an empty page; sorting remains deterministic. Visit detail embeds at most 100 reports; use paginated `/stock-reports` for additional reports. No identity tables, audit history, challenges, session hashes, or token material are projected in business responses.

**Business `POST /visits` and `POST /stock-reports` remain denied (401), even with a Web session.** Existing private Bot RPC uses its established independent authorization and transactional write behavior. No identity-administration HTTP routes are added.

## Required configuration (operator only)

Do not modify production settings, webhook, deploy, or migrate merely to test this PR.

### BotFather

1. Select the **existing bot** in BotFather → **Login Widget**.
2. Register exact approved Web origin(s), e.g. `https://sales-visit.<account-subdomain>.workers.dev`, and the SDK's actual return URL `https://sales-visit.<account-subdomain>.workers.dev/login` under **Allowed URLs**. Register approved development/staging origins and their `/login` URLs separately if Telegram permits them; otherwise use an approved HTTPS development origin. The SDK constructs its return URL from `location.origin + location.pathname`, not an API callback.
3. Record the displayed **Client ID** (not username, not a guessed identifier). Keep **RS256** selected under Advanced. The Client Secret is not used by this browser-library flow and must not enter this repo, frontend, or API code.
4. Keep the existing Bot token and webhook entirely unchanged. Login does not request permission to message the User; Bot registration/approval is still a prerequisite.

### API Worker and CORS

`apps/api/wrangler.jsonc` declares two **nonsecret** runtime vars, initially empty so browser login is disabled:

- `TELEGRAM_CLIENT_ID`: canonical positive decimal BotFather Client ID.
- `WEB_ORIGINS`: comma-separated exact origins, **no spaces, paths, trailing slash, wildcard, credentials, or query**. Example: `https://sales-visit.<account-subdomain>.workers.dev,http://localhost:5173`. Production must contain only approved deployed origins; include development origins only when explicitly approved. HTTPS is required except explicit localhost/127.0.0.1 development origins.

Prepare actual values as a reviewed configuration change before the approved release; do not expect untracked Dashboard vars to survive Wrangler deployment. No new API runtime secret is required. The Bot's existing secrets remain private and separate.

CORS permits only exact allowlisted origins and GET/POST preflights with Authorization/Content-Type. Unknown origins are denied, including `null` and deceptive suffixes; no credentials cookies or wildcard CORS are used. Non-browser requests without Origin still require authentication. CORS is not authentication. Strict deployment config validation permits exactly these two API vars, not arbitrary bindings or overrides, with offline regression tests.

### Static Web and build variables

- Local development: `VITE_API_URL=http://localhost:8787 pnpm dev:web` (the matching Web development origin must be explicitly allowlisted by API). A local build may use `VITE_API_URL=https://<approved-api-origin> pnpm build:web`.
- Approved release: existing GitHub Environment variable **`API_URL`** must be the API's exact verified HTTPS workers.dev origin. The isolated-source deployment wrapper explicitly maps **only** this public value to `VITE_API_URL` during `build:web`, then removes it before Wrangler. Caller-supplied VITE variables and dotenv files are not inherited. Missing/unsafe API URLs stop deployment. Never put secrets in any `VITE_*` variable.
- Keep Worker names, D1 UUID/name, API entrypoint, BotIdentity binding, webhook and Web's static-only Wrangler configuration unchanged.
- Do not set `Cross-Origin-Opener-Policy: same-origin`: Telegram popup messaging would fail. Use `same-origin-allow-popups` or omit it. If introducing CSP, permit the official SDK script from `https://oauth.telegram.org` and API `connect-src` for the exact API origin; review the SDK's injected styles and popup behavior before enforcing it. Do not weaken unrelated policies or add broad wildcards. Test actual popup interaction in supported browsers, including keyboard activation.

With missing Client ID the API config/challenge/login endpoints return 503; missing frontend API URL also fails closed. No mock account, password fallback, live-key test requirement, or development authentication bypass exists.

## Manual release checklist

This is a **manual operator procedure, not work performed by this PR**. Use the existing [CI/CD](ci-cd.md) and [deployment/recovery](deployment.md) guards and approved GitHub Environment. No remote seed data is required.

1. Keep `ENABLE_AUTO_DEPLOY=false`. Verify no overlapping Workers Builds/Git deployment owner can release early.
2. Verify BotFather Allowed URLs, RS256 and Client ID, approved Web origin(s), reviewed API vars, verified `API_URL`/`WEB_URL`, and popup headers. Plan API staging checks using an approved origin/configuration on the existing deployment targets, not a new Worker or D1. Do not activate the new Web interface yet.
3. Review **only new `0007_lying_grim_reaper.sql`** and its Drizzle snapshot. Confirm migrations 0000–0006 are already applied exactly once, that 0007 is the only pending migration, and the selected account/D1 UUID matches the existing reviewed target. If not, stop and reconcile; never replay or edit old migrations. Capture a D1 Time Travel recovery bookmark (`wrangler d1 time-travel info DB`) or approved backup evidence before migration.
4. Merge only after review and CI approval. Deployment tooling accepts only the verified current `main` revision; do not bypass that guard to release this branch.
5. In the approved operator environment, use the existing guarded `pnpm db:migrate:remote` **only after verifying 0007 is the sole pending migration**. It must apply only that new pending migration, not recreate resources or load seeds.
6. Run `pnpm db:verify:remote` and the existing guarded migration-history inspection. Verify all 0000–0007 entries once, no pending migration, `PRAGMA foreign_key_check` empty, and DDL/indexes for `web_login_challenges` and `web_sessions`: unique nonce, valid session hash/expiry, User FK, lookup/expiry indexes. Expected application table count is now **13**, including the existing durable Telegram draft table. Inspect DDL/counts only; do not print challenges, token hashes or credentials.
7. Dispatch approved manual deployment **target `api`**, validation-only first, then actual release after approval. Stage API runtime configuration and test authentication/read denial before releasing the Web login interface. Existing release guards (resource identity, migration state, revision, tests, binding validation and health) remain mandatory. `/health` alone does not prove authentication readiness.
8. **Do not select `all`** for this release: the orchestrator intentionally runs **`web → api → bot`**. After API verification, dispatch a separate approved **target `web`** validation-only/actual release. This uses the existing individually selectable targets to achieve API-before-Web without changing or bypassing guards. Bot need not be redeployed for this milestone; if separately required, select `bot` only after verified API compatibility.
9. Verify Web SPA reachability including `/login` and a direct protected route; unauthenticated GET/HEAD denial; successful login for approved roles; scoped Sales Force list/detail reads; wrong-Origin denial and approved preflight; logout followed by session denial; disable/role-change behavior; synthetic-data labels; and no remote Web writes. Privately verify unchanged Bot registration/approval, Outlet/Schedule commands and durable Visit wizard/webhook behavior. Never paste credentials into command arguments, CI logs or review comments.
10. Restore automatic CD only after these checks and operator sign-off. On failure keep it disabled. A Worker rollback does not undo migrations or revocation/account state; follow the existing recovery procedure with Bot delivery controlled where necessary. The additive auth tables can remain while rolling back code; do not drop tables or replay migrations as a shortcut.

## Verification and remaining scope

`pnpm -r --if-present test`, `pnpm test:deployment`, `pnpm typecheck`, `pnpm check`, `pnpm --filter @sales-visit/db db:check`, and `pnpm build:web` are local/offline checks. Auth tests use synthetic Users, disposable local D1, locally generated RSA keys and a local JWKS verifier. Existing Bot, registration, Outlet, Schedule, transport and Visit/RPC suites remain included. No remote Cloudflare/Telegram credential or frontend test framework is needed.

Dashboard metrics/charts/Visits/Outlets and the browser-local Visit form are **synthetic-only demo content behind login**, not live D1 reporting. The shell labels this explicitly. The prototype form never calls the API; browser-local mock entries remain distinct from sessionStorage credentials. Sales Force navigation excludes the monitoring directory and direct entry shows an unauthorized state. Intended internal redirects are allowlisted; external/protocol-relative/backslash redirects are rejected.

Remaining milestones: live dashboard reads/role-specific operational UI, Web Visit/Stock Report submission authorization, stronger same-origin cookie/BFF architecture if desired, reporting/pagination UX, and explicit session administration/retention automation. Real browser Telegram/popup checks and production configuration/migration/deployment are operator acceptance steps, not claimed by offline CI.
