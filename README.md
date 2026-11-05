# Sales Visit

**Sales Visit** is a university **Computing Project** focused on digitizing field-sales visits and outlet reporting for a Telkomsel product-distribution workflow associated with partner **Citra Indah**.

> **Project status:** The Web Dashboard uses synthetic mock data and browser-local storage. Shared contracts, the Drizzle/D1 schema and migrations, local Hono reads, and atomic/idempotent Visit and Stock Report write operations are implemented. Writes are integration-tested with injected trusted identities; the default runtime rejects all writes until real authentication is implemented. Telegram registration and Admin approval now use a private Worker Service Binding and audited D1 operations. API/frontend integration, Web authentication, Telegram reporting, and remote API/D1 deployment remain unimplemented.

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

**Initial prototype (static/mock data):**

- Responsive dashboard shell and role-appropriate navigation.
- Visits list and detail screens.
- Sales Force visit-report input on the Web.
- Outlet list/detail and visit history.
- Overview metrics derived from coherent sample data.

**Implemented local backend:** D1-backed reads for Sales Force, Outlets, Products,
Visits (including linked Stock Reports), and Stock Reports; atomic Visit/Stock
Report creation with shared validation, trusted-identity boundaries and retry
protection; plus local migrations and idempotent synthetic seeding. Default
runtime report writes are unauthorized. Telegram `/register`, `/me`, `/pending`,
`/approve`, and `/reject` use API-owned identity operations. See
[API documentation](apps/api/README.md) and the [Bot sandbox runbook](apps/bot/README.md).

**Later integration:** API-backed Web operations, Telegram guided reporting, real authentication/authorization to enable writes, and operational reporting.

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
pnpm dev:web             # Mock-backed dashboard
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

- **[CONTEXT.md](CONTEXT.md):** shared domain glossary and naming conventions.
- **[Architecture Decision Records](docs/adr/):** decisions and alternatives behind the proposed system.
- **[API + Bot test deployment](docs/deployment.md):** Cloudflare setup, guarded remote commands, test webhook and Admin bootstrap; deployment pending credentials.
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

The static Web workflow, local API/D1 reads, and protected write operations are
implemented separately. The Web still uses synthetic mocks; connecting it to the
API, implementing real authentication to enable writes, and Telegram reporting
are future milestones. No API or D1 remote resources have been created or deployed.
