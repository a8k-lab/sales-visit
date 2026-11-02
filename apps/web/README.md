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

## Mock data and scope

`src/data/mock-data.ts` contains a single coherent set of synthetic Sales Force, Outlet, Product, Visit, and Stock Report fixtures, typed against `@sales-visit/contracts`. Extra contact, address, territory, and catalog display fields are local prototype metadata, not new shared business rules. `src/features/visits/lib/filter-visits.ts` owns filtering and search normalization.

## Source organization

- `src/main.tsx` renders the router directly inside `StrictMode` and `ThemeProvider`.
- `src/router.tsx` owns the code-based route tree, redirects, search validation, and detail loader. Routing is not file-based.
- `src/app/` contains application-wide navigation, layouts, and providers.
- `src/features/visits/` contains visit pages, filter controls, and filtering logic.
- `src/features/stock-reports/` contains the stock-report card reused by visit details and the directory.
- `src/features/directory/` contains the reference-data page.
- `src/components/ui/` contains shadcn/ui primitives; `src/components/channel-badge.tsx` is shared reporting UI for Visits and Stock Reports.
- `src/lib/formatters.ts` owns shared Indonesian/WIB timestamp formatting; `src/lib/utils.ts` contains styling utilities.
- `src/data/mock-data.ts` remains the centralized relational fixture source, including lookup helpers. Shared hooks remain in `src/hooks/`.

Useful sample records:

- `VST-0012`: a Web visit with two associated stock reports.
- `VST-0010`: a Web visit without stock reports.
- `VST-0011`: a Telegram visit with a stock report containing a zero quantity.
- `SR-0001`: a standalone Sales Force stock report, not an outlet self-report or a visit.

This is a read-only prototype for Sales Force, Admin, and Supervisor discussion, not an authenticated or role-authorized application. Visit entry is a later milestone. No real authentication, network API, database, bot integration, outlet self-reporting, or unconfirmed business metrics are implemented. Quantities are reported snapshots, never live inventory or inferred sellout.

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
