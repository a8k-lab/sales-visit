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
- These are minimal domain record contracts, not endpoint request/response
  contracts, persistence models, authorization rules, or finalized business rules.
  Add API-specific schemas only when operations are agreed.

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

## Checks

From the repository root:

```sh
pnpm --filter @sales-visit/contracts typecheck
pnpm --filter @sales-visit/contracts test
pnpm typecheck
pnpm check
```
