# ADR-0004 — Keep Outlet self-reporting optional and deferred

- **Status:** Accepted as a scope boundary; feature itself **not approved**
- **Date:** 2026-11-02

## Context

The team proposed allowing outlets to report stock themselves rather than requiring a Sales Force member to type it during every visit. This might reduce data entry but introduces adoption, data freshness, verification, and account-management questions. The partner has not confirmed the need.

## Decision

- Always model **Outlet** as a first-class business entity.
- Do **not** treat Outlet as an authenticated application actor by default.
- Reserve conceptual support for a `StockReport` whose reporter could eventually be an Outlet representative; this is compatible with ADR-0003.
- **Defer** outlet accounts, self-reporting forms, restock requests, permissions, notifications, and verification workflow until partner validation.
- Keep visits independent; an outlet's self-report must never be counted as a Sales Force visit.

## Consequences

- **Positive:** preserves a feasible future path while protecting MVP time.
- **Trade-off:** the eventual feature still needs implementation, onboarding, authorization, and UX work; this is not a zero-cost toggle.
- **Guardrail:** avoid building unused screens, APIs, or feature flags merely because the domain could support them.

## Open validation questions

Will outlets willingly submit data? What direct benefit would they receive? How should corrections/verification work? Is any independent stock report operationally useful?
