# Sales Visit

**Sales Visit** is a university **Computing Project** focused on digitizing field-sales visits and outlet reporting for a Telkomsel product-distribution workflow associated with partner **Citra Indah**.

> **Project status:** Admin/Supervisor Web monitoring now reads actual API/D1 Visits, Stock Reports and master catalogs using Telegram OIDC sessions and current Supervisor assignment scope. Telegram guided Visit reporting persists through the API. Web submission is **not enabled**; the local-only form/store have been disabled/removed. A dedicated Sales Force Web workspace and D1-backed submission remain the next milestone. See [live dashboard contracts, permissions, KPI definitions and API-first rollout](docs/live-dashboard.md). Local checks do not establish deployed versions or real Telegram/browser verification; releases remain operator-controlled.

## Background

In the current workflow described during team brainstorming, Sales Force staff visit outlets, record information in a physical notebook, and hand those records to an Admin for re-entry and reporting. The manual handoff creates duplicated work and makes it harder to review field activity promptly.

Sales Visit aims to provide a single place to record visits, view outlet information, and monitor reports—without turning the project into a full POS system or replacing DigiPOS.

## Goals

- Reduce handwritten reporting and duplicate data entry.
- Let **Sales Force submit reports using either Telegram Bot or Web Dashboard**, based on their preference.
- Give Admin and Supervisor role-appropriate visibility into visits and outlet activity.
- Maintain consistent data and business rules regardless of the submission channel.
- Keep the initial delivery manageable while allowing the domain model to evolve following partner feedback.

## Users and scope

| Actor                     | Intended capabilities                                                                                             | Current scope          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **Sales Force**           | Select an outlet, record a visit, report stock observations, and review their reports through **Web or Telegram** | MVP direction          |
| **Admin**                 | Maintain sales, outlet, and product records; inspect reports                                                      | MVP direction          |
| **Supervisor / Manager**  | Monitor visits and evaluate reported activity                                                                     | MVP direction          |
| **Outlet representative** | Potentially submit independent stock reports and restock requests                                                 | **Proposed, deferred** |

An **Outlet** is always modeled as an operational entity, even if no outlet representative ever receives an application account.

### Core reporting model

A **Visit** represents Sales Force field activity. A **Stock Report** represents quantities reported for an Outlet at a given time. They are separate concepts: a Stock Report may be linked to a Visit, but it does not require one. This permits future independent outlet reporting without misclassifying stock submissions as Sales Force visits.

Web and Telegram are two interfaces for the **same business operations**, not separate databases or conflicting reporting processes. Both are intended to use a shared API and validation logic once integration is implemented.

See [CONTEXT.md](CONTEXT.md) for precise terminology and [ADR-0003](docs/adr/0003-separate-visit-and-stock-report.md) for the modeling decision.

## Planned functionality

**Operational Web monitoring:**

- Existing responsive shadcn/ui shell and role-appropriate navigation.
- D1-backed 14-day WIB overview, scoped aggregates and recent Visits.
- Server-filtered/paginated Visit list and authenticated Visit detail.
- Actual Outlet/reference catalogs and independently scoped Stock Report history.
- Explicit unavailable Web submission route; Sales Force workspace notice.

**Implemented local backend:** D1-backed reads for Sales Force, Outlets, Products,
Visits (including linked Stock Reports), and Stock Reports; atomic Visit/Stock
Report creation with shared validation, trusted-identity boundaries and retry
protection; plus local migrations and idempotent synthetic seeding. Default
runtime report writes are unauthorized. Telegram `/register`, `/me`, `/pending`,
`/approve`, and `/reject` use API-owned identity operations. See
[API documentation](apps/api/README.md) and the [Bot sandbox runbook](apps/bot/README.md).

**Next milestone:** dedicated Sales Force workspace and Web report-write authorization backed by D1, using the same domain rules as Telegram. Telegram guided reporting remains available through its existing private RPC/wizard.

**Not part of the current MVP commitment:** Outlet login/self-reporting, advanced product recommendations, comprehensive sales-order and payment flows, or replacement of DigiPOS. These require business validation and an explicit scope decision.

## Proposed technology stack

| Layer             | Choice                                                                  |
| ----------------- | ----------------------------------------------------------------------- |
| Workspace         | pnpm workspaces + TypeScript                                            |
| Web               | React, Vite, TanStack Router, Tailwind CSS, shadcn/ui                   |
| Web data/forms    | TanStack Query / TanStack Form where useful                             |
| API               | Hono on Cloudflare Workers                                              |
| Telegram Bot      | grammY with Telegram webhooks on Cloudflare Workers                     |
| Persistence       | Cloudflare D1 with Drizzle ORM                                          |
| Shared contracts  | TypeScript + Zod                                                        |
| Developer tooling | Oxlint, Oxfmt, Lefthook                                                 |
| Hosting direction | Cloudflare Free-tier-first, subject to quota and operational validation |

The three apps are intended to be **deployed independently** even though they share a monorepo. See the [ADRs](docs/adr/) for the rationale and trade-offs.

## Target repository structure

The workspace contains the following apps and shared packages:

```text
sales-visit/
├── README.md
├── CONTEXT.md
├── apps/
│   ├── web/             # React dashboard
│   ├── api/             # Shared backend
│   └── bot/             # Telegram interface
├── packages/
│   ├── contracts/       # Shared types and runtime schemas
│   └── db/              # Database schema and migrations
├── docs/
│   └── adr/             # Architecture Decision Records
├── pnpm-workspace.yaml
└── package.json
```

## Local development

Use **Node.js 24.x** and **pnpm 10.30.1**, as declared in the root `package.json`.

From the repository root:

```bash
pnpm install
```

```sh
pnpm dev:web             # API-backed dashboard; configure VITE_API_URL and OIDC
pnpm db:migrate:local    # API-local D1 only
pnpm db:seed:local       # Idempotent synthetic seed
pnpm dev:api             # http://localhost:8787
```

See [Web instructions](apps/web/README.md) and [API instructions](apps/api/README.md)
for details. For registration/approval, follow the [Bot instructions](apps/bot/README.md)
for local Admin bootstrap, ignored test secrets, and running both Workers.
No remote Cloudflare resources are needed for local development.

Operational scripts use native Node.js 24 ES modules (no additional runtime).
`pnpm test:deployment` runs all deployment-tool tests using `node:test`, without
contacting Telegram or Cloudflare. The private-terminal test-bot helper is
`scripts/telegram-test-bot.mjs` (`pnpm telegram:test-bot --help`); follow the
[deployment runbook](docs/deployment.md) before any remote operation.

## Documentation and design references

- **[Sales Force master management (A2)](docs/sales-force-management.md):** Kelola Sales Force, immutable business IDs, guarded deletion, dedicated audit and migration → API → Web rollout.
- **[Admin user management (A1)](docs/admin-user-management.md):** Pengguna & Akses, account lifecycle, API contracts, security and operator-controlled rollout.
- **[Live Operational Dashboard](docs/live-dashboard.md):** contracts, permissions, KPI window, verification and manual API-first rollout.
- **[CONTEXT.md](CONTEXT.md):** shared domain glossary and naming conventions.
- **[Architecture Decision Records](docs/adr/):** decisions and alternatives behind the proposed system.
- **[GitHub Actions CI/CD](docs/ci-cd.md):** change-aware CI, existing-Worker release guards, operator setup and manual migration policy. Automatic CD is OFF; deployed API/Bot versions are unverified.
- **[API + Bot test deployment](docs/deployment.md):** historical bootstrap and separate operator-only Telegram/recovery procedures; do not replay applied migrations.
- **[Sales Visit FigJam](https://www.figma.com/board/xYjjlXsulf3fGKFFyNhd0W/Sales-Visit?node-id=0-1):** team brainstorming and research notes.
- **[As-Is business flow](https://www.figma.com/board/xYjjlXsulf3fGKFFyNhd0W/Sales-Visit?node-id=104-115):** existing handwritten visit-report workflow.
- **[Initial To-Be business flow](https://www.figma.com/board/xYjjlXsulf3fGKFFyNhd0W/Sales-Visit?node-id=105-147):** **outdated draft** drawn before confirming that Sales Force can use **both** Web and Telegram. Must be revised before treating it as the agreed flow.

### Architecture Decision Records

1. [ADR-0001 — pnpm monorepo and independent deployments](docs/adr/0001-pnpm-monorepo.md)
2. [ADR-0002 — Dual-channel Sales Force reporting](docs/adr/0002-dual-channel-sales-input.md)
3. [ADR-0003 — Separate Visit and Stock Report](docs/adr/0003-separate-visit-and-stock-report.md)
4. [ADR-0004 — Optional Outlet self-reporting](docs/adr/0004-optional-outlet-self-reporting.md)
5. [ADR-0005 — Cloudflare-first deployment](docs/adr/0005-cloudflare-first-deployment.md)
6. [ADR-0006 — Static-first dashboard](docs/adr/0006-static-first-dashboard.md)

## Open business questions

The team must validate these before formalizing related data rules or KPI calculations:

- What precisely do **stock**, **sales in / selling**, and **sales out / sellout** mean in the partner's existing records?
- How should **total belanja** and **outlet aktif** be determined?
- Must stock be reported on every Sales Force Visit?
- Does the partner actually want Outlet self-reporting and, if so, how should it be validated?
- Which recommendation, order, and payment features are necessary within the agreed delivery scope?

Until confirmed, avoid presenting invented business calculations as actual operational metrics.

## Near-term milestones

The team's FigJam notes list a **static dashboard target of 3 November 2026** and a **planned partner discussion on 4 November 2026**. These dates reflect the working plan, not completed deliverables.

The Web operational reads, API/D1 operations and Telegram reporting are implemented
as independent units. Web submission remains deferred; monitoring never mixes mock
or browser-local Visits with D1 data. Follow the [live dashboard rollout](docs/live-dashboard.md)
and [Web authentication setup](docs/web-auth.md). Existing Workers must be reused.
The operator confirms remote D1 migration 0004 is applied; deployed API/Bot versions
remain unverified until inspected. See the [release runbook](docs/ci-cd.md).
