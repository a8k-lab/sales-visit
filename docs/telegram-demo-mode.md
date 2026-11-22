# Telegram Bot Demo Mode

## Local setup (no deployment or webhook changes)

Use Node 24 and pnpm 10. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm db:migrate:local
pnpm db:seed:demo:local
```

In the ignored `apps/api/.dev.vars`, explicitly set:

```dotenv
APP_ENV="local"
DEMO_AUTH_ENABLED="true"
```

Restart API and Bot in separate terminals with `pnpm dev:api` and `pnpm dev:bot`.
The existing `IDENTITY` service binding must connect locally. Do not use `--remote`.
Production configuration is unchanged: even `DEMO_AUTH_ENABLED=true` cannot enable
Demo Mode when `APP_ENV=production`. Missing/unknown environments default off.
The API is authoritative; there is no separate Bot flag to get out of sync.

With an already configured **dedicated test bot**, in private chat:

1. `/demo`: dynamically lists eligible accounts grouped by Admin, Supervisor,
   Sales Force. New eligible Web demo accounts appear without code changes.
2. Choose an account. `/me` and `/help` reflect its role. `/demo_status` reports
   its internal User ID, role and remaining minutes. `/me`'s Telegram ID remains
   the verified sender, not a Telegram identity belonging to the demo account.
3. Admin/Supervisor: `/outlets`, `/outletinternal TOKEN`, `/jadwalsales`.
   Supervisor schedule queries retain current team-assignment scope.
4. Sales Force: `/jadwal semua` reads only its own synthetic schedules;
   monitoring/Admin commands remain forbidden.
5. `/demo` again switches accounts and starts a new one-hour session.
6. `/demo_logout` deletes the demo credential and picker; the original Telegram
   registration/role returns unchanged. Expiry also restores normal authentication.

Demo Mode is intentionally **read-only**: `/register`, user enumeration and
administration, Outlet/schedule mutations, and the complete Visit wizard (including
drafts) are forbidden. It cannot submit reports, notify real target users, or alter
operational data. `/help` describes normal role capabilities as well as this
additional restriction. Normal non-demo Bot commands are unchanged.

## Architecture and security

- `apps/api/src/demo-auth.ts` is the shared Web/Bot feature gate, account projection
  and eligibility predicate: active supported role, valid display name, no Telegram
  identity; Sales Force requires an existing exclusively linked master. No account
  list or namespace is hardcoded in the Bot.
- `bot-service.ts` is the private RPC's centralized actor router. An unexpired
  demo credential takes precedence over real authentication, including real Admins.
  Every read rechecks current eligibility/role in D1. An ineligible selected account
  fails closed until logout/expiry; it never falls through to the real account.
- Migration `0012_telegram_demo.sql` adds `telegram_demo_sessions`, keyed by verified
  Telegram sender, with internal User FK, absolute creation/expiry milliseconds
  and a database-enforced one-hour duration. D1 survives Worker restarts. There
  are no browser tokens, process-local sessions or changes to `telegram_identities`.
- `telegram_demo_choices` holds random UUID-derived opaque picker tokens, bound to the
  requesting sender, selected internal User and five-minute expiry. Callback data
  is `demo:TOKEN` (37 ASCII bytes), never an arbitrary target User/Telegram ID.
  Atomic D1 batch selection rechecks ownership, expiry and shared eligibility,
  replaces the owner's session and consumes all their choices. Replay, old picker,
  malformed and cross-user callbacks cannot activate sessions. Logout and a fresh
  `/demo` invalidate existing choices. Expired choices are cleaned in bounded
  batches during picker creation; expired sessions are inert and overwritten on
  the next selection (at most one stored credential per sender).
- Both commands and callbacks require a non-bot, positive safe Telegram sender ID
  and a private chat. Callbacks also require the chat ID to match that sender. Inline-message/group callbacks
  cannot reach RPC. The existing authenticated webhook boundary remains unchanged.
- Migration 0012 also adds `demo_only` (default 0) to Outlets, Sales Force masters
  and schedules. Demo reads require explicit provenance, not a `demo-*` ID prefix.
  Schedule reads require **all three** rows marked; real Telegram target filters
  are rejected and Telegram identities are never projected. Existing planning
  policy guards, pagination, own-SF and Supervisor team scope are reused.
- The local/staging synthetic seed marks only rows it **newly inserts**. Conflicts
  never mark/overwrite existing records. Already seeded pre-0012 data therefore
  remains hidden until an operator has verified and explicitly marked those rows
  in a disposable local database, or uses a fresh local database. Do not blanket
  mark records by ID prefix and do not mark real data. New demo accounts may have
  empty schedules; demo eligibility does not itself establish data provenance.
- Web authentication behavior is otherwise unchanged; this feature's read-only
  restriction applies to the Telegram demo credential, not ordinary Web sessions.

## Automated local checks

All D1 test writes are disposable Miniflare-local only. No Telegram network calls:

```sh
pnpm --filter @sales-visit/api exec node --test tests/telegram-demo.test.mjs tests/bot-demo.test.mjs tests/demo-auth.test.mjs
pnpm --filter @sales-visit/api test
pnpm --filter @sales-visit/db test
pnpm typecheck
pnpm lint
pnpm exec oxfmt --check apps/api/src/bot-service.ts apps/api/src/demo-auth.ts apps/api/src/telegram-demo.ts apps/bot/src/demo/commands.ts
pnpm --filter @sales-visit/api exec wrangler deploy --dry-run --outdir .wrangler/demo-build
pnpm --filter @sales-visit/bot exec wrangler deploy --dry-run --outdir .wrangler/demo-build
```

Some older integration tests use URL `.pathname` as a filesystem path and fail on
Windows/paths containing spaces; the new tests use file URLs or `fileURLToPath`
instead. The new RPC test bundles the service with the existing esbuild dependency,
matching Workers' TypeScript handling without requiring experimental Node flags.
