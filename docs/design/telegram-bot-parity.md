# Telegram Bot parity and handoff

## Inspected baselines and credit

Latest fetched `main`: `3cd90fb`, merged PR #13. Reference executable source:
[rtrivaldo/telegram_bot](https://github.com/rtrivaldo/telegram_bot/tree/e7de4a9965b2a815160bd389a89be5fa6b1b73a7),
latest fetched commit `e7de4a9965b2a815160bd389a89be5fa6b1b73a7` (Paldo).
Inspected `src/bot/commands/{outlet,schedule}.commands.ts`, repositories for both,
and the existing parity audit before implementation. Credit to rtrivaldo/Paldo
and original contributors for command vocabulary, Indonesian guide and guided
Visit UX. Independent grammY/API/D1 adaptation, not a Telegraf/PostgreSQL port.
Reference package declares ISC; no standalone LICENSE was found; confirm reuse
terms before redistribution.

## Delivered command matrix

All commands are private-chat only. Roles mean **active** accounts, checked again
server-side on every protected RPC, including empty pages and follow-ups.
A = Admin, S = Supervisor, SF = Sales Force. Unchanged registration, audited user
management and durable Visit commands from PR #13 remain supported.

| Command                                                       | Permission / behavior                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `/outlets [KURSOR]`                                           | A/S; keyset list with Nama Outlet, ID Outlet Bisnis, No. RS                          |
| `/outlet BUSINESS_ID`                                         | A/S; exact business lookup, detail includes internal token for Visit/planning        |
| `/tambahoutlet BUSINESS_ID NO_RS NAMA_OUTLET`                 | A; all fields required, generated immutable internal UUID                            |
| `/editoutlet BUSINESS_ID NO_RS_BARU NAMA_OUTLET_BARU`         | A; business ID unchanged                                                             |
| `/hapusoutlet BUSINESS_ID KONFIRMASI`                         | A; explicit literal confirmation; rejects all Schedule/Visit/Stock Report references |
| `/outletinternal INTERNAL_ID`                                 | A/S; explicit legacy/internal lookup, no business fallback                           |
| `/editoutletinternal INTERNAL_ID NO_RS_BARU NAMA_OUTLET_BARU` | A; same guards, cannot assign/change business ID                                     |
| `/hapusoutletinternal INTERNAL_ID KONFIRMASI`                 | A; same confirmation/reference guards                                                |
| `/jadwal [HARI\|semua] [after=KURSOR]`                        | SF; own business SF only; defaults to actual current weekday Asia/Jakarta            |
| `/jadwalsales`                                                | A/S; all SF/all days                                                                 |
| `/jadwalsales HARI`                                           | A/S; case-insensitive Indonesian day                                                 |
| `/jadwalsales TELEGRAM_ID [HARI] [after=KURSOR]`              | A/S; canonical decimal string resolved server-side, not SF ID                        |
| `/jadwalsales [hari=HARI] [sf=SALES_FORCE_ID] [after=KURSOR]` | A/S; existing named filters, keys in any order                                       |
| `/tambahjadwal SALES_FORCE_ID OUTLET_ID HARI`                 | A; existing provisioning; OUTLET_ID remains internal                                 |
| `/salesvisit`, `/konfirmasi`, `/batal`                        | SF; unchanged durable minimal Visit wizard                                           |
| `/help`                                                       | Public self-service; nine role-aware sections, implemented grammar only              |

Positional filters must precede an optional `after=`; do not mix them with
`hari=`/`sf=`. Duplicates, unknown keys, noncanonical Telegram IDs, extra positional
arguments and dual Telegram/SF selection are rejected. One positional day may
also have trailing `after=`. No Telegram ID is converted to a JS Number.
All seven Indonesian weekday names are case-insensitive. Continuations preserve
all filters; `/jadwal` fixes the initial weekday even across midnight.

**Breaking Outlet grammar:** old name-only creation and internal-ID edit/delete
syntax are retired, never heuristically auto-detected. The first two creation
tokens now always mean business ID and No. RS; do not paste an old multiword name
as a command. No name-only compatibility path or duplicate business record is
created. Use explicitly named internal commands for legacy records.

## Identifier mapping and invariants

| Reference               | Monorepo                                  | Rules                                                                  |
| ----------------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| internal `outlets.id`   | existing `outlets.id`                     | Immutable primary/FK key; never replaced or reinterpreted              |
| `outlets.outlet_id`     | `businessId` / `business_id`              | Unique when present, BINARY/case-sensitive, no normalization           |
| `outlets.no_rs`         | `noRs` / `no_rs`                          | Nonunique registration/reference string; not assumed to be phone data  |
| `outlet_name`           | `name`                                    | Nonunique display label                                                |
| `users.telegram_id`     | `telegram_identities.telegram_user_id`    | Canonical decimal string, not business SF ID                           |
| `users.salesforce_code` | `users.sales_force_id` → `sales_force.id` | Explicit verified business SF association; no guessed import crosswalk |

Business ID and No. RS are opaque strings preserving leading zeros, case and
exact stored whitespace. Inputs are nonblank, max 256 UTF-16 units, reject
control/format characters; names are nonblank, bounded and trimmed. Bot arguments
use the existing canonical `~` + unpadded base64url UTF-8 token format for values
outside simple ASCII tokens. No. RS is displayed as plain text, not a contact link.
Legacy null metadata is shown as **belum didata**. No invented metadata is seeded
or backfilled. A reviewed crosswalk/import is still required to assign business
IDs to existing production records; this PR exposes no ID-changing operation.

Private API keys accept exactly `{ id }` (internal) **or** `{ businessId }`
(business). Both keys, unqualified identifiers and unknown fields fail validation.
Thus a token matching different records across namespaces is never guessed.
Business-key updates require name/No. RS. Internal legacy updates may omit No. RS
to retain its current/null value. No update can change either ID. Database
uniqueness plus `ON CONFLICT` gives one successful concurrent creation per business
ID; other calls return sanitized `duplicate`. Existing timestamp safe-integer
mutation guards, restrictive references and 50-row keyset limits remain intact.

Public unauthenticated business GETs still exist; **their shapes are unchanged**.
In particular `/outlets` returns only `{ id, name }`. New metadata and verified
Telegram IDs are only in private authorized RPC replies. No new HTTP management
routes, bypass headers or role caches were added.

## Schedule association and display policy

Telegram filtering resolves `telegram_identities` → active `users` with SF role →
existing business SF in the same serialized authorized D1 batch as the query.
Exactly one User may reserve that SF, counting disabled/role-changed accounts as
competing reservations. Missing identity, disabled/non-SF target, missing SF link
or ambiguous association returns `association_unavailable`, not guessed/empty
success or all plans. Named `sf=` still queries business plans without requiring
an available account. Scalar subqueries avoid identity-join row multiplication.

Schedule replies include SF name/business ID, Outlet name/business ID/No. RS,
Indonesian weekday, internal Outlet token for the Visit wizard, and Telegram ID
only for a unique active verified association. Own SF sees only its own plan;
only A/S can monitor others. Missing association is labeled. Blocks/pages remain
bounded plain text below Telegram's 4096 UTF-16-unit message limit.

**Ownership limitation:** reference schedules point to Users; monorepo schedules
point to business SF records. Current associations do not establish historical
Telegram-user ownership. Role/status changes never move schedules or silently
reassign associations. Existing administration reserves SF links even after role
changes; historical import/reassignment needs a separate reviewed crosswalk and
history policy. Plans remain distinct from completed Visits; no automatic
attendance, completion, new lifecycle operations or financial reporting is added.

## Migration and release implications

New additive migration: **`0006_windy_black_crow.sql`**, after already-deployed
`0005_good_puff_adder.sql`. Two nullable TEXT columns and one unique index; no
table rebuild, FK/primary-key change, backfill or timestamp rewrite. Previous
migrations are untouched. Populated 0005 upgrade tests preserve Visit, Stock Report,
Schedule and Telegram draft payload references with foreign keys enabled.

Worker names, D1 UUID, `IDENTITY` binding, webhook/secrets, release guards and
API-before-Bot order are unchanged. No remote migrations, resources, deployments,
production seeds or automatic CD settings were changed. Prevent an old-main CD
run racing the pending migration/new API; do not reapply 0005.

### Manual release checklist

1. Disable automatic CD before merging if currently enabled.
2. Review and back up the existing D1.
3. Merge only after CI/review approval.
4. Apply only the genuinely pending new migration to the verified remote database.
5. Verify migration history, constraints and foreign keys.
6. Run manual validation-only deployment.
7. Deploy API before the dependent Bot.
8. Verify API/Bot health and test the new commands with authorized synthetic accounts.
9. Re-enable automatic CD only after verification.

## Teammate handoff and remaining Visit differences

Teammate owns Bot UX/commands; coordinate shared API/contracts/DB review. Keep
API-owned authorization, named BotIdentity binding and durable D1 sessions.
Canonical Outlet commands now use business IDs; Schedule provisioning and Visit
wizard `outlet TOKEN` still use internal IDs. Never substitute a business ID into
an existing FK or draft. Use returned internal tokens. Existing local synthetic
Outlet seeds deliberately retain null metadata; new command examples create
synthetic business records explicitly, not duplicate compatibility records.

Registration/user management semantics from PR #13 are unchanged: audited
approve/reject/setrole/disable/enable, live role/status revocation, protected
active/last Admin, no rejected reapplication and no silent SF reassignment.

Visit wizard remains outlet → actual WIB time → notes → follow-up → preview →
confirmation, with durable expiry/revision/idempotent receipt. It does not yet
collect the reference's Periode 1–5, DigiPOS balance, three Stock/Selling/Sellout
triples, CVM/Voice/Digital flags or Total Belanja. Partner definitions, units,
period anchors and monetary precision are needed before implementation. Preserve
ADR-0003: Visit and Stock Report are separate, optionally linked. No unsupported
reporting/history/export commands are advertised. Web read authorization,
production import/cutover, SF reassignment history and richer reporting remain
separate work.

## Local reproduction and validation

Use Node 24 / pnpm 10.30.1. Run `pnpm install --frozen-lockfile`,
`pnpm -r --if-present test`, `pnpm typecheck`, `pnpm check`,
`pnpm --filter @sales-visit/db db:check`, `pnpm build:web`, and
`pnpm test:deployment`. Integration tests bundle real Workers and private named
RPC with disposable migrated D1; only Telegram delivery is simulated. No accounts,
credentials or production resources are needed.

Local validation passed: frozen install; 16 contracts tests, 16 DB tests,
86 API/Bot tests and 147 deployment-helper tests; workspace typecheck,
lint/format, Drizzle schema check and Web build. Web retains its >500 kB chunk
advisory; Wrangler type generation emits its existing Node-types advisory.
No remote/Telegram delivery validation is claimed. Coverage includes populated
0005→0006 upgrades, references/drafts, null legacy metadata, identifier validation,
leading zeros, nonunique No. RS, exact namespaces/collisions, concurrent creates,
role/status denial, Telegram association edge cases, positional/named filters,
Jakarta weekday boundaries, filter-preserving pages, Unicode reply bounds and
nine-section help. Existing registration, administration and durable Visit wizard
regressions remain in the local suite. Actual Telegram delivery and remote release
are separate consenting operator checks, not claimed by these tests.

Local sandbox: `pnpm db:migrate:local`, `pnpm db:seed:local`; optional schedule
fixture and controlled Admin bootstrap are documented in the [Bot README](../../apps/bot/README.md#reproducible-local-sandbox)
and [identity guide](../../packages/db/IDENTITY.md). These local commands must
never be repurposed as production seed or migration automation.
