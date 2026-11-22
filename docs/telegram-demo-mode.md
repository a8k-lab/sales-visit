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
2. Send `/demo_login account_id`, using the exact internal ID displayed by `/demo`.
   No prior listing or expiring picker token is required. IDs with whitespace or
   special characters use the existing reversible `~` ID/token format (not an
   authentication token). `/me` and `/help` reflect the selected role. `/demo_status` reports
   its internal User ID, role and remaining minutes. `/me`'s Telegram ID remains
   the verified sender, not a Telegram identity belonging to the demo account.
3. Admin/Supervisor: `/outlets`, `/outletinternal TOKEN`, `/jadwalsales`.
   Supervisor schedule queries retain current team-assignment scope.
4. Sales Force: `/jadwal semua` reads only its own synthetic schedules;
   monitoring/Admin commands remain forbidden.
5. `/demo_login account_id` switches accounts and starts a new one-hour session.
   Invalid/ineligible account selections leave the existing session unchanged.
6. `/demo_logout` deletes the demo credential; the original Telegram
   registration/role returns unchanged. Expiry also restores normal authentication.

Demo Mode is intentionally **read-only**: `/register`, user enumeration and
administration, Outlet/schedule mutations, and the complete Visit wizard (including
drafts) are forbidden. It cannot submit reports, notify real target users, or alter
operational data. `/help` is a compact single-message guide showing only commands
permitted for the selected role, with all disabled writes hidden. Demo commands
appear only when the API reports Demo Mode enabled. Normal non-demo commands are unchanged.

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
- Private RPC `demoLogin(actor, accountId)` explicitly accepts an internal account
  ID, not an opaque selection token. It validates the input, environment and
  verified sender server-side, then atomically upserts that sender's session only
  when the selected account satisfies the shared Web demo eligibility predicate.
  No target owner/Telegram ID or role is accepted as login input. A user's login,
  switch or logout cannot alter another Telegram sender's session. Missing,
  disabled, Telegram-linked and otherwise ineligible accounts return the same
  unavailable result. Listing is read-only. Expired sessions are inert and replaced
  by the next explicit login (at most one stored credential per sender).
- Migration `0013_remove_demo_choices.sql` drops only the now-unused picker table
  `telegram_demo_choices` and its indexes. Drizzle schema/snapshot/journal are
  updated; migration 0012 remains unchanged. Existing sessions, identities and
  operational data are preserved. Apply pending migrations locally with
  `pnpm db:migrate:local`. For a future reviewed non-Production rollout, update
  API and Bot together because `demoLogin` replaces the `demoSelect` RPC contract.
  No remote migration or deployment is part of this change.
- Test/local webhook helpers request `allowed_updates=["message","callback_query"]`.
  Demo login now needs only text messages; no webhook changes are necessary for
  this flow. Callback support remains available for unrelated features and old
  buttons are safely acknowledged without selecting accounts. Never take over a
  Production/shared bot.
- The authenticated, bounded webhook parser accepts both text `message` and
  `callback_query` updates. It validates the callback's own sender separately from
  the original keyboard message (which is normally sent by the bot), query ID,
  chat, and 1–64-byte callback data. Ambiguous/malformed updates are ignored.
  Unknown, obsolete demo, group, mismatched-chat and inline-message callbacks are
  acknowledged without demo RPC or session changes.
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
pnpm --filter @sales-visit/api exec node --test tests/telegram-demo.test.mjs tests/bot-demo.test.mjs tests/bot-help.test.mjs tests/bot-callback-webhook.test.mjs tests/demo-auth.test.mjs
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
