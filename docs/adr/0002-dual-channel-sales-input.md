# ADR-0002 — Support Sales Force input through Web and Telegram

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

The partner requested a Telegram bot for Sales Force reporting. The team also sees usability advantages in web forms, particularly for multiple products, reviewing inputs, and correcting mistakes. Both channels are required as options, not competing record systems.

## Decision

Sales Force may submit the **same business report** through **Telegram Bot or Web Dashboard**. Both channels must:

- Use shared API operations and validation rules.
- Record the same business meaning and core data, including outlet, reporter, time, and report details.
- Respect the same server-side permissions.
- Persist to the same authoritative data store.

Bot and Web may differ in interaction design: guided chat versus structured forms. **The Web Dashboard is not exclusive to Admin/Supervisor.**

The API is the business boundary. The bot does not maintain a separate report database or private, divergent validation rules. Track submission channel as metadata where operationally useful, distinct from the actor identity.

## Consequences

- **Positive:** flexible field reporting, consistent data, no duplicate systems.
- **Trade-off:** two UIs need maintenance and end-to-end testing.
- **Guardrail:** secure Telegram user-to-sales linking and prevent accidental duplicate submissions (e.g., retry/idempotency handling).

## Alternatives considered

- Telegram-only: excludes the structured web input workflow the team intends to support.
- Web-only: fails to satisfy the partner's explicitly requested channel.
