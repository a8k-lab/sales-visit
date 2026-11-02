# ADR-0003 — Model Visit and StockReport as separate concepts

- **Status:** Accepted (conceptual design; fields pending validation)
- **Date:** 2026-11-02

## Context

A field visit and a stock observation can happen together but are **not the same event**. If an outlet later reports stock independently, tying every stock report to a visit would misrepresent activity and force a migration.

## Decision

Separate the concepts:

- **Visit:** a Sales Force member's visit to an Outlet, including when it happened and relevant visit-specific notes/actions.
- **StockReport:** a snapshot of reported stock at an Outlet at a given time, with a reporter and one or more product-level items.
- **StockReportItem:** product and quantities captured for a StockReport.

A `StockReport` **may reference a Visit, but that relationship is optional**. A Visit need not automatically imply a StockReport. Retain history and submission provenance. Do not make one-report-per-visit cardinality a rule without partner evidence.

The reporter can initially be Sales Force; the design may later support an Outlet representative. A self-reported outlet stock snapshot is **not evidence** that a Sales Force visit took place.

## Consequences

- **Positive:** enables future self-reporting without rewriting the core relationship; more accurate visit metrics and audit trail.
- **Trade-off:** queries and forms must intentionally coordinate related Visit/StockReport records.
- **Guardrail:** avoid computing `sales in`, `sales out`, `total belanja`, or `outlet aktif` from assumptions; definitions remain open.

## Alternatives considered

- Put all stock fields directly on Visit: simpler initially, but incorrectly forces all stock reports to be visits and complicates history/provenance.
