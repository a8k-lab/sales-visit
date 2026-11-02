# ADR-0005 — Prefer Cloudflare-first deployment for the project

- **Status:** Accepted for MVP direction; limits and operational details to verify before production
- **Date:** 2026-11-02

## Context

The Computing Project prioritizes low ongoing cost and manageable operations. A permanently running VPS is not needed if the bot can receive Telegram updates through webhooks. The web, API, and bot can be independent deployment units.

## Decision

- **Web:** React/Vite static deployment, initially Cloudflare Pages.
- **API:** Hono on Cloudflare Workers.
- **Bot:** grammY on Cloudflare Workers using Telegram **webhooks**, not long polling.
- **Persistence:** Cloudflare D1 (SQLite-compatible semantics) via Drizzle ORM.
- **Integration:** Web calls public HTTPS API; Bot calls API through an appropriate internal mechanism (e.g. Workers Service Bindings).
- **Configuration:** secrets stored in Cloudflare configuration/secrets, never in source control.

Use the Cloudflare Free tier for prototype/MVP where it satisfies requirements. This is a preferred deployment strategy, **not** a promise of unlimited free capacity or a lock-in that prevents future migration.

## Consequences and risks

- **Positive:** no VPS required, low operational burden, independent releases, integrated serverless SQL.
- **Trade-off:** D1 is not PostgreSQL; SQL dialect and migration behavior differ. Webhook-based bot programming and stateless execution require durable conversation state.
- **Limits:** Free-tier quotas, CPU budget, storage and query limits can cause failed requests; monitor and re-evaluate with actual workload.
- **Security:** verify Telegram webhook requests; link Telegram identity to an authorized Sales record; enforce API auth; plan database backup/recovery.
- **Guardrail:** never rely on process-local memory to persist bot conversation progress between requests.

## Alternatives considered

- VPS + Docker Compose + PostgreSQL: valid fallback if runtime/platform limitations become material, but adds ongoing hosting and operations.
- Long polling on Workers: inappropriate for an always-on polling process in a request-driven runtime.

## References

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
- https://grammy.dev/hosting/cloudflare-workers-nodejs
