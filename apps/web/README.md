# Sales Visit Web Dashboard

React + Vite + TanStack Router + shadcn/ui (Base UI / nova, Phosphor icons).

## Run locally

From the repository root, using Node.js 24 and pnpm 10.30.1:

```bash
pnpm install
pnpm dev:web
```

## First milestone

- `/` redirects to `/visits`.
- `/visits` supports text search, Sales Force, outlet, channel, stock-report presence, and visit-date filters. Filters are stored in the URL and retained when returning from a visit detail.
- `/visits/$visitId` displays outlet and Sales Force information, metadata, notes, follow-up, and all linked stock reports. Unknown IDs display a not-found state.
- `/directory` shows the read-only reference fixtures and stock report register, including a standalone Sales Force stock snapshot.
- The dashboard shell adapts the official shadcn/ui `sidebar-07` block, installed through the CLI inside this app. Desktop icon collapse, mobile drawer, sidebar keyboard shortcut (Ctrl/Cmd+B), and theme switching are preserved. Demo teams, projects, and account actions were removed.

The list uses a table on desktop and visit cards on mobile. User-facing copy defaults to **Bahasa Indonesia**. Dates use the **id-ID** locale and **Asia/Jakarta (WIB, UTC+7)** timezone, independently of the browser's timezone. See [AGENTS.md](AGENTS.md) for ongoing frontend language and prototype verification conventions.

## Milestone 2: Visit entry

- **Catat Kunjungan** opens `/visits/new`. Outlet, manually selected Sales Force, and visit time are required. Notes and follow-up are optional; the channel is always `web`.
- Visit time defaults to now in WIB, even if the browser uses another timezone. Local `submittedAt` metadata records the separate submission time without changing shared contracts or inventing submission times for seed records.
- Optional **Laporan Stok** supports adding/removing catalog products, nonnegative whole quantities (including zero), and one row per product. Enabled reports require at least one valid row; disabled reports are omitted. The selected Sales Force is the reporter.
- React state and a small validation helper keep this local form dependency-free. Inline Indonesian errors preserve input, and submission locks plus stable form-owned UUIDs prevent double-click/retry duplicates.
- `src/data/visit-store.ts` reads static seeds plus new records from the versioned `sales-visit:entries:v1` localStorage key. One atomic write stores a Visit and its optional Stock Report. Shared Zod schemas and relational checks validate persisted records at the browser boundary. Invalid/unavailable storage falls back to seeds for reading; saving fails visibly without clearing input or overwriting corrupt data.
- List, detail, and directory route loaders use this same data source. A successful write invalidates router data and opens the new detail URL, retaining list filters. Refreshing preserves saved entries and linked reports.

Data is specific to this browser and origin. Clearing site data removes local entries. There is no backend submission, cross-device sync, live cross-tab update, or protection against simultaneous writes in multiple tabs. Unsaved forms do not survive refresh/navigation. Malformed local data is not automatically deleted or repaired; inspect site storage before clearing it. Seed/demo data is never overwritten.

## Mock data and scope

`src/data/mock-data.ts` contains a single coherent set of synthetic Sales Force, Outlet, Product, Visit, and Stock Report fixtures, typed against `@sales-visit/contracts`. Extra contact, address, territory, and catalog display fields are local prototype metadata, not new shared business rules. `src/features/visits/lib/filter-visits.ts` owns filtering and search normalization.

## Source organization

- `src/main.tsx` renders the router directly inside `StrictMode` and `ThemeProvider`.
- `src/router.tsx` owns the code-based route tree, redirects, search validation, and detail loader. Routing is not file-based.
- `src/app/` contains application-wide navigation, layouts, and providers.
- `src/features/visits/` contains visit pages, entry controls, form validation, and filtering logic.
- `src/features/stock-reports/` contains isolated stock-entry fields and the stock-report card reused by visit details and the directory.
- `src/features/directory/` contains the reference-data page.
- `src/components/ui/` contains shadcn/ui primitives; `src/components/channel-badge.tsx` is shared reporting UI for Visits and Stock Reports.
- `src/lib/formatters.ts` owns shared Indonesian/WIB timestamp formatting; `src/lib/utils.ts` contains styling utilities.
- `src/data/mock-data.ts` remains the centralized seed fixture source; `src/data/visit-store.ts` owns browser persistence and relational lookups. Shared hooks remain in `src/hooks/`.

Useful sample records:

- `VST-0012`: a Web visit with two associated stock reports.
- `VST-0010`: a Web visit without stock reports.
- `VST-0011`: a Telegram visit with a stock report containing a zero quantity.
- `SR-0001`: a standalone Sales Force stock report, not an outlet self-report or a visit.

This is a local prototype for Sales Force, Admin, and Supervisor discussion, not an authenticated or role-authorized application. No real authentication, network API, database, bot integration, outlet self-reporting, or unconfirmed business metrics are implemented. Quantities are reported snapshots, never live inventory or inferred sellout.

## Verification commands

```bash
pnpm --filter @sales-visit/web typecheck
pnpm lint
pnpm format:check
pnpm --filter @sales-visit/web build
```

Do not introduce frontend unit, component, or E2E tests, testing frameworks, or test dependencies during the prototype phase. Preserve existing shared-package tests. Prioritize functional implementation and usability, with typechecking, linting, formatting, and production builds for verification. Production static hosting must serve `index.html` for client-side routes (including direct visit-detail URLs).

## Adding UI components

Use the existing `components.json` configuration from inside `apps/web`:

```bash
pnpm dlx shadcn@latest add <component>
```
