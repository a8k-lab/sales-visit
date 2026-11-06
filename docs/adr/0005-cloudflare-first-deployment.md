# ADR-0005 — Prefer Cloudflare-first deployment for the project

- **Status:** Accepted for MVP direction; limits and operational details to verify before production
- **Date:** 2026-11-02

## Context

The Computing Project prioritizes low ongoing cost and manageable operations. A permanently running VPS is not needed if the bot can receive Telegram updates through webhooks. The web, API, and bot can be independent deployment units.

## Decision

- **Web:** React/Vite static deployment via **Cloudflare Workers Static Assets**, replacing the initial Cloudflare Pages direction. Deploy only `apps/web/dist` with Wrangler and SPA fallback for TanStack Router; no Worker entrypoint, SSR, or Cloudflare Vite plugin. GitHub Actions is the selected CD owner, with separate web build and deploy commands and automatic deployment initially OFF (see the [CI/CD runbook](../ci-cd.md)). This supersedes the original Workers Builds/Git ownership: operators must disable overlapping Builds integrations before activating Actions, without recreating existing Workers.
- **API:** Hono on Cloudflare Workers.
- **Bot:** grammY on Cloudflare Workers using Telegram **webhooks**, not long polling.
- **Persistence:** Cloudflare D1 (SQLite-compatible semantics) via Drizzle ORM.
- **Integration:** Web calls public HTTPS API; Bot calls API through an appropriate internal mechanism (e.g. Workers Service Bindings).
- **Configuration:** secrets stored in Cloudflare configuration/secrets, never in source control.

Use the Cloudflare Free tier for prototype/MVP where it satisfies requirements. This is a preferred deployment strategy, **not** a promise of unlimited free capacity or a lock-in that prevents future migration.

### Current deployment scope (CI/CD foundation)

Reuse the existing `sales-visit`, `sales-visit-api` and `sales-visit-bot` Workers.
Only API binds D1 `DB`; its configured real UUID is not a placeholder. The operator
confirms remote migration `0004_misty_red_skull.sql` is already applied and must
not be reapplied. Deployed API/Bot versions remain unverified until inspected.
The Web is still a public synthetic-data prototype, not an authenticated app.
Each application retains an independent deployment boundary; automatic CD stays
OFF until the operator completes the [runbook](../ci-cd.md).

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

- https://developers.cloudflare.com/workers/static-assets/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
- https://grammy.dev/hosting/cloudflare-workers-nodejs
