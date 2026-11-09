# Live Operational Dashboard — Admin & Supervisor

## Scope and release status

The Web now reads persisted API/D1 records through the existing Telegram OIDC
session, not mock fixtures or browser-local Visits. A Telegram Visit becomes
visible on the next authorized request. This is **operational monitoring**, not
Web submission or real-time push. This document describes implemented source;
it is not evidence that API/Web versions have been deployed or that a real
Telegram-to-browser smoke test has passed.

This advances ADR-0006's static-first prototype without changing ADR-0002's
commitment to **both Telegram and Web submission**. The next milestone remains
a dedicated Sales Force workspace and D1-backed Web Visit/Stock Report submission
using the same domain rules. No public report POST authorization, approval
workflow, Sales Groups, assignment semantic change, migration, resource,
spreadsheet import, production seed, or automatic deployment is introduced.

## Permissions

All business endpoints require an active, unexpired, unrevoked Web session.
Identity/role/assignment are resolved server-side, not trusted from the browser.

| Read surface                            | Admin                  | Supervisor                              | Sales Force                              |
| --------------------------------------- | ---------------------- | --------------------------------------- | ---------------------------------------- |
| `/dashboard/overview`                   | Global                 | Current assignments                     | 403                                      |
| `/visits`, `/visits/:id`                | Global                 | Current Visit owner assignments         | Own records                              |
| `/stock-reports`                        | Global                 | Current reporter assignments            | Own reporter records                     |
| Stock Reports nested in Visit detail    | Global                 | Independently scoped by reporter        | Own reporter records                     |
| `/sales-force`                          | All ID/name references | Assigned ID/name references             | 403                                      |
| `/outlets`, `/outlets/:id`, `/products` | Master catalog         | Same master catalog                     | Existing catalog access retained         |
| Supervisor assignment administration    | Existing Admin access  | 403                                     | 403                                      |
| Web monitoring navigation               | Available              | Available, no assignment administration | Unavailable; `/workspace` notice instead |

An unassigned Supervisor gets zero aggregates and empty operational collections,
not global fallback. Master Outlets/Products remain shared catalogs; their
presence is not evidence of authorized activity. Reassignment/unassignment
changes historical record visibility on subsequent requests, even with existing
sessions. Report scope uses **reporter**, never the owner of an associated Visit.
A linked report is counted once, and an independent report does not imply a Visit.
Inaccessible and nonexistent Visits both return the same 404. Named projections
never expose Telegram identities, access audits, or session data.

## Overview contract and KPI definitions

`GET /dashboard/overview` accepts **no query parameters**. Shared response types
are in `packages/contracts/src/dashboard.ts`.

- `period: { start, end, timeZone: "Asia/Jakarta" }`: UTC ISO timestamps.
- `metrics: { visits, outlets, salesForce, stockReports }`: authorized counts.
- `dailyVisits: [{ date: "YYYY-MM-DD", count }]`: 14 ascending WIB calendar days,
  including zero-activity days even when the database is empty.
- `channels: [{ channel: "web" | "telegram", count }]`: both channels, zero filled.
- `recentVisits`: at most five authorized Visits **within the reporting period**,
  with Visit fields and `outlet` / `member` ID/name references.

The default window is the latest **14 calendar days ending today in WIB**:
00:00 WIB thirteen days ago **inclusive**, through 00:00 WIB tomorrow
**exclusive** (`start <= event timestamp < end`). It is computed from the current
clock, never from the most recent record. All Visit metrics, daily counts,
channel counts and recent activity use `visited_at`; Stock Reports independently
use `reported_at`. Creation/submission receipt time is not substituted for event
time. Millisecond timestamps are stored in D1; Jakarta is UTC+7 without DST.

`visits` counts Visit rows. `outlets` counts distinct visited Outlet IDs, **not**
all catalog Outlets or a business-defined “active Outlet”. `salesForce` counts
distinct submitting Visit owners. `stockReports` counts report rows, including
independent reports; it is not an item/quantity sum. Counts and grouping run in
D1, with current authorization predicates, in one read batch; React only adds
chart labels and channel shares. No KPI is derived from a bounded list page.

Displaying the `web` channel means only that persisted records have that channel;
it does not enable or claim operational Web reporting.

## Existing endpoint extensions

Default list responses remain bare arrays. Default Visit detail and Bot/write
contracts remain unchanged. Opt-in read projections avoid redundant list APIs:

| Endpoint                                | Additional query parameters / projection                                                                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/visits`                               | `q`, `salesForceId`, `outletId`, `channel=web\|telegram`, `stock=with\|without`, `date=YYYY-MM-DD`; `view=page` returns `{ items: VisitListItem[], total }` with Outlet/member ID/name and authorized `stockReportCount` |
| `/visits/:id`                           | `include=references` adds Outlet/member references and reporter/product ID/name to authorized nested reports                                                                                                             |
| `/stock-reports`                        | `outletId` plus existing `reporterSalesForceId` / `salesForceId`; `view=page` returns `{ items, total }` with reporter/product references                                                                                |
| `/sales-force`, `/outlets`, `/products` | `view=page` returns `{ items: [{ id, name }], total }`; optional `q` searches name/ID in this mode                                                                                                                       |
| `/outlets/:id`                          | New master-detail projection: `{ id, name, businessId, noRs }`; nullable identifiers remain null, missing Outlet is 404                                                                                                  |

List limits remain 1–100 (default 100), offset 0–100000 (default 0). Lists and
counts apply identical authorization/filter predicates **before pagination**.
Visits/Stock Reports order by event timestamp descending, ID ascending; catalogs
by ID ascending (SQLite BINARY). `total` is the full filtered authorized count,
not the current page length. Each page/count is a D1 batch snapshot, not a frozen
multi-request export; concurrent submissions/reassignment can shift offset pages.

Visit `date` uses the same start-inclusive/end-exclusive WIB day. It filters
Visits only, not the timestamps of linked reports. `stock` checks the existence
of **authorized** linked reports (not other teams' reports); `stockReportCount`
has the same reporter scope. Search matches Visit ID, notes, Outlet name and
Sales Force name using literal substring matching, not SQL wildcards. SQLite
`lower` provides ASCII case folding; it does not promise Unicode case folding.
`q` is nonblank, max 200 characters, no ASCII controls. Reference filters preserve
exact stored IDs, including legacy whitespace/Unicode/control characters; they
are not trimmed or truncated. The complete API URL is bounded to 16,384 characters.
Invalid enums, dates, unknown/duplicate query parameters or pagination bounds
return sanitized 400. SQL values are bound, never caller-provided SQL identifiers.

Visit detail retains its maximum of **100 authorized linked Stock Reports**;
the UI explicitly labels that bound. Outlet report history uses independently
paginated `/stock-reports?outletId=...`, never a Visit-owner join. Nullable/missing
references render an ID rather than crashing or inventing attributes. Only
stored name/ID and actual Outlet business identifiers are displayed—no fabricated
addresses, contacts, phones, territories, coordinates, product units, or statistics.
Authentication, exact CORS policy, sanitized errors and `Cache-Control: no-store`
are retained. Bearer credentials stay in headers/sessionStorage, never URLs or
rendered error messages; sessionStorage remains vulnerable to XSS.

## Web behavior

TanStack Router loaders own request/pending/error state and URL filter/pagination
dependencies. No new Query library, frontend tests or frontend dependencies are
added. Lists use 25-row pages; catalogs/Stock Reports are independently paginated.
Visit ID filters offer the first 100 authorized reference suggestions, explicitly
labeled as suggestions, with arbitrary exact IDs accepted from searchable catalog
pages. Suggestions do not restrict server-side filtering to those 100 records.

Data refreshes on navigation, manual **Perbarui data**, window focus, and every
60 seconds while the page is visible. There is no WebSocket/push guarantee.
Inactive route cache retention and preloading are disabled. Loading, empty,
retry and failure states are explicit; a failed API request never loads fixtures.
Dates/numbers use `id-ID`, timestamps `Asia/Jakarta` (WIB).

`/visits/new` is an unavailable notice; **Catat Kunjungan** actions and the
localStorage Visit store are removed. Existing local records are ignored, not
uploaded or silently deleted. Reusable entry controls/validation and their
prototype fixtures remain isolated, unused by operational routes and excluded
from the operational production bundle. Future Web submission must replace their
fixture-dependent reference validation. Sales Force Web login is preserved but
routes to `/workspace`, not an incomplete monitoring/submission workspace.

## Verification evidence

Local checks (2026-11-09):

| Command                                  | Result                                                               |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `pnpm -r --if-present test`              | Passed: contracts, DB, API/Bot/auth integration; API suite 142 tests |
| `pnpm typecheck`                         | Passed, including regenerated Worker bindings                        |
| `pnpm check`                             | Passed: lint and formatting                                          |
| `pnpm --filter @sales-visit/db db:check` | Passed; no new migrations                                            |
| `pnpm build:web`                         | Passed; Vite warns that the main chunk exceeds 500 kB                |
| `pnpm test:deployment`                   | Passed: 154 tests; no remote services contacted                      |

New disposable Miniflare D1 coverage exercises >100 Visits, distinct owners/shared
Outlets, linked and independent reporters, Admin/two disjoint Supervisors/an
unassigned Supervisor, reassignment/unassignment using existing sessions, scoped
filters/counts/pagination, exact legacy IDs, invalid inputs, empty operational
data, independent Stock Report boundaries, WIB midnight inclusivity and zero days,
404 equivalence, named detail privacy and no-store. Existing tests remain intact.
The real Worker Bot wizard test now verifies a persisted webhook-created Visit
through the Admin/Supervisor **HTTP overview** handler. This is local end-to-end
integration, not a live Telegram/browser verification. No authenticated browser
screenshots or manual browser usability pass are claimed by these commands.

## Operator-controlled activation and smoke test

Nothing in this PR merges, migrates remote D1, deploys, changes Telegram/webhook
configuration, or enables automatic CD. Follow existing [release guards](ci-cd.md)
and [auth](web-auth.md)/[assignment](supervisor-assignments.md) prerequisites.

- [ ] Review and merge only after approval/required CI. **CI success is not API
      deployment, Web deployment, or real Telegram end-to-end verification.**
- [ ] Keep automatic deployment OFF; verify no competing release writers.
      Record approved current-main revision and existing API/Web rollback versions.
- [ ] Confirm existing Worker/D1 identities, schema migrations **0000–0008** and
      empty FK check through approved read-only preflight. This feature adds no
      migration: do not replay historical SQL or run seeds. If prerequisites are
      missing, stop and use their separate reviewed rollout.
- [ ] Preserve OIDC client/origins, session/rate-limiter settings, API URL,
      BotIdentity binding, credentials and webhook. Use only approved accounts
      and actual operator-managed business records for smoke tests.
- [ ] Deploy **target `api` first**: validation-only dispatch, then separately
      approved release. Verify deployed revision/limiter attestations and health;
      verify authenticated overview/page/detail reads and unauthenticated denial.
      Health alone is not acceptance. Old Web remains compatible with default
      arrays/detail contracts.
- [ ] Deploy **target `web` separately, after API verification**: validation-only,
      then approved release. **Do not use `all`**, whose existing order is
      Web → API → Bot. Bot deployment is not required by this feature.
- [ ] In approved browsers, log in as Admin, two Supervisors, unassigned Supervisor
      and Sales Force. Check direct SPA links, Indonesian/WIB formatting, keyboard
      access, mobile layout, loading/empty/error/retry/manual refresh, catalogs,
      URL filters, multiple pages and inaccessible Visit 404 states.
- [ ] Have a consenting assigned Sales Force member submit a real Visit with the
      existing **Telegram Bot** wizard. Privately note its noncredential Visit ID,
      Outlet and WIB event time. Confirm persistence, Admin overview/list/detail,
      owning Supervisor visibility and absence for other/unassigned Supervisors.
      Use a Visit inside the current reporting window when checking overview.
- [ ] Reassign that member using the existing Admin page. Without re-login,
      refresh both Supervisor sessions: historical visibility must move. Unassign
      and confirm removal. Restore intended assignment through the audited UI.
- [ ] Check independent/linked Stock Reports with differing Visit owners only
      where approved real records exist; never create synthetic production data
      to satisfy the check. Missing cases remain explicitly unverified remotely.
- [ ] Confirm `/visits/new` cannot save anything and Sales Force sees only the
      workspace notice. Inspect sanitized error rates and no-store responses;
      never retain tokens, headers, callback bodies or Telegram profile screenshots.
- [ ] Record **API release**, **Web release**, and **Telegram/browser smoke-test**
      outcomes separately before operator sign-off. On failure keep automation off,
      stop activation and use approved recovery. Do not roll back to pre-scoping
      globally permissive Supervisor code; restrict access or use a reviewed fix.
      A code rollback does not undo business records or assignment/audit changes.
