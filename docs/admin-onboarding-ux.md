# A3 — Admin onboarding & UX foundation

## Scope

Web-only UX refinement, based on `main` at `101f459` (which includes merged PR #20).
No API contracts, migrations, authorization policies, authentication protocol/storage,
Bot behavior, aggregation logic, or production configuration changed. PR #19 account
operation recovery and PR #20 master mutation recovery remain unchanged.

### Navigation and hierarchy

- Monitoring: Ringkasan, Kunjungan, Laporan stok.
- Data / Referensi: Outlet, Sales Force, Produk.
- Administrasi (Admin only): Kelola Sales Force, Pengguna & Akses, Penugasan Supervisor.
- Sales Force retains Ruang kerja only. Supervisors retain monitoring/reference access.
- Directory links reuse `/directory?kind=…`; selection is keyed by `kind`, not just path.
- One sidebar account entry exposes identity, role, and logout in a dialog. Collapsed
  navigation has tooltips; the mobile menu closes after route selection. Theme control
  stays in the header.
- Declarative breadcrumbs identify administration and detail hierarchy. Non-route group
  labels are not links. Visit parent navigation preserves validated filters. Ringkasan
  and Ruang kerja do not repeat their page title in a breadcrumb.

### Refresh, login, and assignments

- No dashboard interval or window-focus invalidation. Existing route-entry loaders and
  mutation-success/recovery invalidation remain. Assignments retain their own initial
  read and explicit reload; successful saves replace the row with the API response.
- Manual refresh is compact, secondary, click-guarded, and disabled during its request.
  It retains its visible dimensions and exposes an accessible loading label. No fetch
  timestamp is fabricated and no footer promises periodic updates.
- Telegram preparation does not open a popup. A real click on Masuk dengan Telegram
  invokes authentication synchronously. Preparation, waiting, verification, failure,
  expiry, cancellation, and timeout have separate feedback. Coba lagi only appears
  when preparation must restart; retries never automatically open Telegram.
- Preparation and login attempts have immediate duplicate guards and stale callback
  guards. Duplicate SDK callbacks cannot submit verification twice.
- Assignment selection alone never saves. A shadcn/Base UI Dialog names the Sales
  Force, current Supervisor, and proposed Supervisor, including unassignment. It
  explains immediate historical-monitoring access changes. Cancel precedes confirmation.
- A save failure conservatively blocks further edits until a successful fresh read.
  It does not claim failure proves no write committed, and never automatically retries
  a mutation. Unavailable existing Supervisors remain visible but cannot be newly selected.

### Empty states

- Admin sees a lightweight getting-started guide when the **14-day reporting window**
  contains zero Visits. This is not evidence of no lifetime activity or incomplete
  master setup. No checklist completion or persisted progress is inferred.
- Guide links to existing master management, account approval, and assignment pages;
  registration and Visit submission direct users to Telegram Bot, not unavailable Web input.
- Assignments link to master management when no Sales Force exists, and explain
  Telegram registration/approval when no active Supervisor exists. Reference and account
  empty states explain appropriate next actions without introducing CRUD destinations.
- Operational zeros remain genuine API data; no mock fallback was introduced.

## Executed verification

All passed:

- `pnpm --filter @sales-visit/web typecheck`
- `pnpm lint` (no warnings on final code)
- `pnpm format:check`
- `pnpm build:web`
- `pnpm check`
- `pnpm -r --if-present test`: contracts 18, database 16, API 174 tests.
  API/database tests use their existing disposable local databases, not remote D1.
- Active LSP probe on all 10 changed TSX files: no code errors; informational
  English-spellchecker findings on intentional Indonesian copy only.

Build limitation: Vite reports the >500 kB chunk advisory. No bundle architecture or
additional test framework was introduced for this milestone.

## Intended browser checks — NOT EXECUTED

Use approved local/test accounts and disposable data. Do not create synthetic production
records. No screenshots or browser/OIDC success claims are available from this work.

- [ ] Admin: navigate master Sales Force → Pengguna & Akses → assignments → monitoring.
- [ ] Supervisor: only monitoring/reference links; Admin destinations still denied.
- [ ] Sales Force: only Ruang kerja; monitoring/Admin routes retain existing boundaries.
- [ ] Expanded/collapsed sidebar, icon tooltips, narrow mobile Sheet, account dialog/logout,
      long identity text, and closing the mobile menu after navigation.
- [ ] Directory kinds highlight exactly one sidebar destination; reload/deep link works.
- [ ] Breadcrumb detail parents work, visit filters survive return navigation, group labels
      are not clickable, long content truncates without horizontal header overflow.
- [ ] Network panel: leave overview open >60 seconds and blur/refocus; no global polling.
- [ ] Manual refresh: pending label announced, size stable, repeated click ignored; filters
      and unrelated controls remain usable. Failed route load exposes explicit retry.
- [ ] Existing account/master mutations and their uncertain-outcome recovery still refresh
      affected data without relying on polling.
- [ ] Telegram: normal login success and validated return URL; preparation failure, idle
      expiry, blocked popup, cancellation, timeout, verification failure, duplicate click,
      stale/duplicate callback, explicit retry. Retry prepares only; another click opens popup.
- [ ] Assignment: unchanged selection cannot save; selecting does not write; dialog shows
      old/new names; cancel/Escape restores focus without saving; confirm saves once.
- [ ] Assignment/reassignment/unassignment, inactive existing Supervisor, loading feedback,
      API-returned row, and success message. Simulate a dropped save response and verify
      no repeat write is offered before successful explicit reload.
- [ ] Empty master list and no active Supervisors provide working links; filtered account
      and reference empty states are truthful. Zero-Visit Admin guide does not show completed
      steps; Supervisor does not see it; populated overview keeps actual data.
- [ ] Light/dark themes, keyboard-only navigation, focus trapping/restoration, visible focus,
      screen-reader labels/status announcements, long names, and mobile table scrolling.

## Delivery constraints

No merge, deployment, remote D1 operation, or production configuration change is included.
PR #20 API/Web deployments were reported completed by the operator, but production smoke
testing remains unconfirmed; passing local regression suites is not production verification.
