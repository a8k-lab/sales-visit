# @sales-visit/contracts

Shared runtime schemas and inferred TypeScript types for Web Dashboard, API,
and Telegram Bot. Domain language lives in [`CONTEXT.md`](../../CONTEXT.md);
see ADRs 0002–0004 for reporting boundaries.

```ts
import { visitSchema, type Visit } from "@sales-visit/contracts";

const visit: Visit = visitSchema.parse(input);
```

## Package boundary

- Private, ESM-only workspace package. Consumers declare
  `"@sales-visit/contracts": "workspace:*"`.
- The root export exposes TypeScript source to Vite and Wrangler; no build step
  or generated artifacts are needed. This is not a compiled JavaScript package
  for runtimes without TypeScript support. Node 24 can run the tests natively.
- Import from the package root, not internal paths. Types are inferred from Zod.
- Domain record contracts coexist with strict operation inputs and internal RPC
  result types. They are not persistence models or proof of authorization; the
  API checks current D1 identity/permissions. Partner-unvalidated business fields
  remain deferred.

## Initial conventions

- Sales Force, Outlet, and Product have opaque nonblank string IDs and names.
  No UUID format, account fields, catalog categories, or active-status rules
  are assumed.
- Visit records Sales Force, Outlet, visit time, optional notes/follow-up, and
  submission channel. A Visit does not require a Stock Report.
- Stock Report records Outlet, reporting time, Sales Force reporter, channel,
  and one or more product quantities. `visitId` is optional; no one-report-per-visit
  restriction is imposed. Reporter identity is separate from submission channel.
- Timestamps are ISO 8601 strings with `Z` or an explicit UTC offset, not `Date`
  objects or local-time strings. They describe the visit/report time, not a
  separate server receipt time.
- Quantities are nonnegative whole counts (including zero) of reported items.
  This transport convention does **not** define starting/ending stock, live
  inventory, Sales In, Sales Out, or Total Belanja; partner validation is still
  needed before adding those concepts or calculations.
- Schemas do not look up referenced records or check that a linked Visit belongs
  to the same Outlet. Such checks belong at the future API business boundary.
- Outlet is a business record, not an account. Outlet representative reporting
  is deferred; no speculative reporter union or self-reporting API is included.

## Outlet & Schedule operations

`planning.ts` separates unchanged public `Outlet` from timestamped `OutletDetail`,
create/update/key/list inputs, recurring schedule read/create models, and own vs
monitoring filters. `weekdaySchema` is an integer ISO weekday (Monday=1,
Sunday=7); `indonesianWeekdaySchema` converts trimmed case-insensitive Indonesian
names to that representation. Planning timestamps are integer epoch milliseconds,
not Visit/Stock Report event-time ISO strings. `BotIdentityService` extends
`BotPlanningService` for the existing private Service Binding, not public HTTP.
See [the foundation guide](../../docs/design/outlet-schedule-foundation.md) for
permissions, pagination and error codes. Private `OutletDetail` adds nullable
`businessId`/`noRs`; public `Outlet` remains `{ id, name }`. Creation requires
both metadata strings plus name. Business ID is unique when present; No. RS is
nonunique, not contact data. Input identifiers preserve case/leading zeros and
reject blank, >256 UTF-16 units and control/format characters. Keys are exactly
`{ id }` (internal) or `{ businessId }` (business), not both. Updates cannot
replace either ID; internal legacy updates may omit No. RS. Monitoring filters
accept `telegramUserId` (canonical decimal string, max 256) or `salesForceId`, not
both; own filters accept neither. Private Schedule details include Outlet
business metadata and nullable verified current Telegram ID. `duplicate` includes
business-ID collisions; `association_unavailable` means the requested Telegram
account has no unique active SF association. Authorization/resolution stays API-owned.

## Checks

From the repository root:

```sh
pnpm --filter @sales-visit/contracts typecheck
pnpm --filter @sales-visit/contracts test
pnpm typecheck
pnpm check
```
