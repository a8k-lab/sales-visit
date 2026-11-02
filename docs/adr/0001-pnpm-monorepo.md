# ADR-0001 — Use a pnpm monorepo with independent deployment units

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Sales Visit includes a React web dashboard, a Telegram bot, and a shared backend. They operate on the same business concepts and benefit from shared contracts, but not necessarily the same runtime or release schedule. The team is small and the project has limited time.

## Decision

Use a **single Git repository** with **pnpm workspaces** (`pnpm@10.30.1`, Node 24.x). Planned boundaries:

```text
apps/web          React + Vite application
apps/api          Hono API on Cloudflare Workers
apps/bot          grammY Telegram bot on Cloudflare Workers
packages/contracts   Shared types and runtime schemas
packages/db          Drizzle schema and migrations
```

Use `workspace:*` for internal package dependencies. Keep individual app build and deployment configurations separate. Do not introduce Turborepo or Nx unless a concrete need emerges.

## Consequences

- **Positive:** one place for contracts, coordinated changes, straightforward team collaboration, and independent deploys.
- **Trade-off:** changes to shared packages may affect multiple apps; CI should check/deploy affected dependents.
- **Guardrail:** sharing a repository does **not** justify sharing every internal module or accessing the database directly from every app.

## Alternatives considered

- Separate repositories: extra synchronization overhead for contracts and coordinated changes.
- Single combined application: unnecessary coupling between web, bot, and API runtimes.
