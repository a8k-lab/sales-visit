# ADR-0006 — Build the web dashboard static-first

- **Status:** Accepted for current development phase
- **Date:** 2026-11-02

## Context

The team needs a comprehensible prototype for partner discussion on a short timeline. The monorepo, API, bot, database, and real authentication do not yet need to be fully integrated for the first dashboard demonstration.

## Decision

Bootstrap **`apps/web` first** with React, Vite, TypeScript, TanStack Router, Tailwind CSS, and shadcn/ui. Use realistic, **synthetic relational mock data** for Sales, Outlet, Product, Visit, StockReport, and report items.

Prototype core workflows in this priority:

1. App shell/navigation and mock fixtures.
2. Visits list and visit detail.
3. **Sales Force web visit-report input**, since Web is also an input channel (ADR-0002).
4. Outlet list/detail with visit history.
5. Overview derived from mock records rather than independent hardcoded counters.

Use TanStack Query/Form where it adds value, rather than wiring a network-oriented layer before network data exists. Structure data access so it can be replaced with API-backed operations later without rewriting all UI components.

Do **not** implement real bot integrations, D1, authentication, Outlet self-reporting, or undefined metrics for this milestone.

## Consequences

- **Positive:** fast testable demo and early workflow feedback; reduced risk of building infrastructure around misunderstood requirements.
- **Trade-off:** synthetic behavior is not production functionality. UI interactions must be described honestly during demo.
- **Guardrail:** do not claim a feature is integrated merely because its mock form works; use one coherent set of relational fixtures across screens.
