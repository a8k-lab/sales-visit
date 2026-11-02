# Sales Visit

**Sales Visit** is a university **Computing Project** focused on digitizing field-sales visits and outlet reporting for a Telkomsel product-distribution workflow associated with partner **Citra Indah**.

> **Project status (2 November 2026):** Early prototype / monorepo setup. The initial Web Dashboard is being developed with mock data; the API, Telegram Bot integration, database, and deployment are planned rather than completed.

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

**Later integration:** API-backed operations, Telegram guided reporting, persistent storage, authentication/authorization, and operational reporting.

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

This is a **target layout**; not every directory or application is necessarily implemented yet.

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

App-specific development commands will be documented once each app is scaffolded. Do not assume that the Web, API, or Bot can run yet simply because the workspace exists.

## Documentation and design references

- **[CONTEXT.md](CONTEXT.md):** shared domain glossary and naming conventions.
- **[Architecture Decision Records](docs/adr/):** decisions and alternatives behind the proposed system.
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

The immediate focus is to demonstrate the Web reporting and monitoring workflow using consistent, synthetic mock data. Bot/API/database integration follows after the core workflow has been reviewed.
