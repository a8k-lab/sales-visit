# Frontend conventions

These conventions apply to `apps/web` and subsequent frontend development.

## UI language

- Use Bahasa Indonesia for all user-facing content: navigation, titles, labels, placeholders, buttons, empty states, validation messages, accessibility labels, and notifications. Include default copy in shared UI primitives and synthetic fixture content displayed on screen.
- Preserve established business and technical terminology such as Sales Force, Outlet, Dashboard, and Telegram Bot, along with proper names, record IDs, and product category codes.
- Format displayed dates using the `id-ID` locale and `Asia/Jakarta` timezone (WIB), regardless of the browser timezone. Keep machine-readable timestamps, route paths, query keys, and domain enum values unchanged.
- Keep operational copy concise and useful. Put technical explanations, architecture rationale, and implementation notes in documentation, not operational screens. A brief data-example indicator is appropriate for the prototype.

## Prototype verification

- Do not add frontend unit tests, component tests, E2E tests, testing frameworks, or test dependencies during the prototype phase.
- Preserve existing tests in shared packages.
- Prioritize functional implementation and usability over automated test coverage.
- Continue running TypeScript typechecking, linting, formatting checks, and production builds. Report unrelated existing failures without changing out-of-scope files.

```bash
pnpm --filter @sales-visit/web typecheck
pnpm lint
pnpm format:check
pnpm --filter @sales-visit/web build
```

Follow the root domain glossary and ADRs. Localizing copy must not change functionality or shared domain contracts.
