# Sales Visit Web Dashboard

React + Vite + TanStack Router + shadcn/ui (Base UI / nova, Phosphor icons).

## Run locally

From the repository root, using Node.js 24 and pnpm 10.30.1:

```bash
pnpm install
VITE_API_URL=http://localhost:8787 pnpm dev:web
```

Run the API separately and follow the [Telegram OIDC setup](../../docs/web-auth.md).
There is no authentication bypass or public demo shortcut. Business requests use
opaque revocable Bearer sessions in sessionStorage, not URL credentials.

## Operational monitoring

See [Live Operational Dashboard](../../docs/live-dashboard.md) for API contracts,
permission matrix, KPI definitions, reporting boundaries, limitations and smoke tests.

- `/overview`: Admin global / Supervisor current-assignment aggregates, latest
  14 WIB calendar days ending today, zero days, channel counts and recent Visits.
- `/visits`: full-dataset server-side search, owner/Outlet/channel/report/date
  filters, deterministic 25-row pages and actual filtered totals. ID fields offer
  the first 100 reference suggestions but accept other exact IDs from directories.
- `/visits/$visitId`: authenticated detail, names, notes/follow-up and at most
  100 independently authorized linked Stock Reports. Inaccessible IDs are 404.
- `/outlets`: searchable, paginated actual ID/name catalog; detail shows stored
  business identifiers plus independently paginated authorized Visit/report history.
- `/directory`: paginated Sales Force, Products and Stock Reports. Supervisors
  see only assigned Sales Force references and reporter-scoped Stock Reports.
- `/supervisor-assignments`: existing Admin-only audited assignment management.
- `/visits/new`: unavailable notice, **no local save or operational POST**.
- Sales Force login routes to `/workspace`, an explicit not-yet-available notice.
  A dedicated workspace and Web submission remain the next milestone.

No operational loader imports mock fixtures or reads browser-local Visits. Old
localStorage entries are ignored, not uploaded or deleted. The obsolete Visit
store was removed. Reusable entry controls/validation remain for future work;
their fixture-dependent validation must be replaced before operational reuse.

TanStack Router loaders own URL dependencies, pending/error/retry state; no new
query library or frontend test dependencies were added. Navigation, manual reload,
window focus and a visible-page 60-second timer refresh data. No push-stream or
frozen pagination snapshot is promised. Request failure never falls back to fixtures.

The existing desktop Visit table/mobile cards, navigation, theme and sidebar are
retained. UI is Indonesian; dates/numbers use `id-ID` and `Asia/Jakarta` (WIB).
Catalogs do not invent missing addresses, contacts, territories, statistics or
product units. Stock snapshots are not live inventory or inferred sellout.

## Deployment

**Deploy API first, then Web manually. Do not use `all` (Web-first).** Follow the
[operator checklist](../../docs/live-dashboard.md#operator-controlled-activation-and-smoke-test)
and existing [CI/CD guards](../../docs/ci-cd.md). No remote migration is added.
Local checks and build success are not deployment or real Telegram/browser evidence.

Web authentication uses the existing API URL/origin/OIDC configuration. Deploy
only Vite `dist` to the existing `sales-visit` Worker Static Assets; no Worker
entrypoint, SSR, new resource or Cloudflare Vite plugin is introduced. SPA fallback
must serve `index.html` for direct client-side routes. Automatic CD stays OFF.

```bash
pnpm build:web
pnpm preview:web # Local build + Wrangler preview, no deployment/authentication bypass
```

After separate approval on verified current-main, the operator may use the existing
guarded `pnpm deploy:api`, then `pnpm deploy:web` paths. The deploy helper rebuilds
Web in an isolated revision, not from a local `dist`. Do not enable competing
Workers Builds/Git release writers. No Bot deployment or webhook change is required.

## Source organization

- `src/router.tsx`: code-based routes, role boundary, URL validation and loaders.
- `src/app/`: shell, navigation, layout and visible-page refresh.
- `src/features/auth/`: API client, Telegram OIDC login and workspace notice.
- `src/features/overview/`: aggregate read adapter and existing chart/cards.
- `src/features/visits/`: list/detail reads, search validation and reusable entry controls.
- `src/features/outlets/`, `src/features/directory/`: live catalogs and scoped history.
- `src/features/stock-reports/`: named report display and retained entry fields.
- `src/components/`: shared operational states, bounded pagination, channel badge.
- `src/components/ui/`: existing shadcn/ui primitives.
- `src/lib/formatters.ts`: Indonesian/WIB timestamp formatting.
- `src/data/mock-data.ts`: isolated legacy entry-control fixtures, not operational data.

## Verification

```bash
pnpm --filter @sales-visit/web typecheck
pnpm lint
pnpm format:check
pnpm --filter @sales-visit/web build
```

Per [AGENTS.md](AGENTS.md), do not add frontend unit/component/E2E tests,
frameworks or test dependencies. Preserve shared/API/Bot tests. Browser usability,
accessibility and live Telegram smoke checks remain operator verification steps.
sessionStorage credentials remain vulnerable to XSS; follow the auth security notes.

## Adding UI components

Use existing `components.json` from `apps/web`:

```bash
pnpm dlx shadcn@latest add <component>
```
