# Authenticated Telegram Visit wizard

Later account-lifecycle update: `/users`, `/setrole`, `/disable` and `/enable`
now ship with audited API operations; see the [current parity handoff](telegram-bot-parity.md).
The lifecycle exclusions below describe this wizard's original implementation
milestone, not current Bot capabilities.

Implemented minimal Visit flow; not full parity with the teammate bot. Builds on
[the integration alignment](telegram-bot-integration-alignment.md) and ADRs
0002, 0003 and 0005. Registration, Outlet management and recurring Schedule
commands remain unchanged. No Web authentication or public write access is added.

## Phone workflow (private chat, Indonesian)

An Admin must first verify the person out of band, approve their registration as
`sales_force`, and associate an existing Sales Force record. Only an **active
Sales Force with a valid current association** can use this flow. Admin and
Supervisor cannot submit, even if an operator has assigned them an SF link.

Example using a synthetic Outlet token:

```text
SF:  /salesvisit
Bot: 1/5 • Pilih Outlet
     Ketik: outlet TOKEN_OUTLET
SF:  /jadwal semua
Bot: [existing own recurring schedule, including copyable Outlet tokens]
SF:  outlet out-01
Bot: 2/5 • Waktu kunjungan sebenarnya (WIB / Asia/Jakarta)
SF:  waktu 08-06-2026 00:30
Bot: 3/5 • Catatan kunjungan (maks. 1000 karakter)
SF:  catatan Bertemu pemilik
Bot: 4/5 • Tindak lanjut (maks. 1000 karakter)
SF:  tindaklanjut lewati
Bot: 5/5 • Tinjau Visit
     Outlet: ...
     Token: out-01
     Waktu sebenarnya (WIB): 8 Jun 2026, 00.30
     Catatan: Bertemu pemilik
     Tindak lanjut: (dilewati)
     Kirim: /konfirmasi
     Buang draf: /batal
SF:  /konfirmasi
Bot: Visit berhasil tersimpan.
     Nomor: visit-...
```

- `/salesvisit` starts or resumes; it never silently replaces a live draft.
  After submission/cancellation/expiry, an explicit new `/salesvisit` starts a
  different logical Visit with a fresh UUID.
- `outlet TOKEN` resolves an exact known Outlet, including unscheduled Outlets.
  `/jadwal semua` is a convenience, **not proof of attendance or a requirement**.
  Existing Admin/Supervisor Outlet-list/management permissions are unchanged.
  The narrow authenticated lookup is part of the API's Outlet-step transition.
- `waktu sekarang` records the API's current instant, once, before review.
  Alternatively, `waktu DD-MM-YYYY HH:mm` means **Asia/Jakarta (UTC+07:00)**,
  not the sender's/device's timezone. Invalid calendar dates and future instants
  are rejected. This wizard's explicit operational input window is the previous
  **366 days**, not a new universal Visit domain restriction. Historical imports
  and future planning must not use this wizard. The shared operation still uses
  its existing offset-aware contract; persisted input normalizes to UTC ISO
  milliseconds and D1 stores epoch milliseconds. Submission time is separate.
- `catatan ISI` and `tindaklanjut ISI` each allow 1000 UTF-16 units. Skip with
  `catatan lewati` / `tindaklanjut lewati` (case-insensitive keyword).
  Field labels are deliberate: delayed notes cannot become follow-up input.
- Invalid answers preserve the last valid step and show recovery guidance.
  Ordinary text never starts a draft or creates a Visit. Unrelated commands such
  as `/help`, `/start`, `/me`, Outlet and Schedule commands still route normally.
- `/batal` works at every editable step. There is no back/edit command yet:
  cancel/restart to change a reviewed draft. While submitting, cancellation
  succeeds **only if no Visit committed**; otherwise it recovers the receipt.
- Messages are plain text, with no Markdown/HTML parse mode or inline keyboards.
  Full notes/follow-up are included in preview, packed into messages of at most
  4096 UTF-16 units; Outlet display names are bounded to 256 code points.

### Exact opaque IDs

Reuse PR #9's raw simple token or canonical `~` + unpadded base64url UTF-8
format; copy tokens exactly. Decoded keys are never trimmed or normalized.
`createVisitSchema.outletId` now validates nonblankness **without trimming**.
For example `" out-01 "` and `"out-01"` resolve different stored records, or fail
if the exact record does not exist. This is intentionally narrow: Product and
independent Stock Report reference normalization, legacy approval grammar and
the generic identifier schema are unchanged. Existing clients that relied on
Visit Outlet trimming must send the actual ID instead. Regression tests create
both a whitespace-bearing Outlet and its trimmed alias and verify exact D1 FK
persistence. Tokens outside planning's bounded printable ID contract are rejected.

## Trusted boundary and state machine

```text
verified Telegram text + human sender + private chat
  -> Bot adapter extracts from.id + message.message_id
  -> IDENTITY Service Binding / BotIdentity.visitWizard(actor, input)
  -> API resolves Telegram identity, User, current status/role and existing SF
  -> API-owned D1 draft transition / guarded createVisit
  -> D1 Visit + durable receipt
  -> Telegram plain-text reply
```

The Bot has no D1 binding, sessions, SQL, trusted Sales Force argument, submission
key generator, or channel argument. RPC envelopes are strict. The named
WorkerEntrypoint is a caller capability granted only to trusted bound Workers;
a compromised bound Worker can impersonate actors. Public HTTP `POST /visits`
and `POST /stock-reports` still deny all ordinary requests, including spoofed
headers. No HTTP wizard routes, identity headers or dev bypass exist.

Migration `0004_misty_red_skull.sql` adds `telegram_visit_drafts` only. Existing
migrations are unchanged. The primary key is registered User ID: one latest
workflow/receipt per owner. Private draft payloads are never joined to public
reads. The row contains a generated UUID, pinned SF link, step, validated partial
payload, revision, per-owner private-chat message watermark, expiry and Visit ID.

```text
outlet -> time -> notes -> followUp -> review -> submitting -> submitted
   \________ editable steps _______/         |
              -> cancelled                   -> cancelled only if no Visit
              -> expired
```

- Editable drafts expire **24 hours after creation**, not sliding activity.
  Expiry is checked lazily on access; expiry/cancellation clears the payload.
  `/salesvisit` may explicitly replace an expired draft. No scheduled cleanup or
  physical deletion is installed. An abandoned row can remain stored until its
  owner's next interaction; TTL is workflow validity, not a data-erasure SLA.
- Submitting drafts do **not** expire: their UUID and frozen payload must survive
  an ambiguous commit. Submitted receipts remain until explicitly starting the
  next Visit. The immutable Visit itself remains the permanent retry receipt
  under the existing append-only operation policy.
- Conditional writes compare owner, draft key, revision and a strictly newer
  private-chat `message_id`. Authorization is checked again in each D1 batch.
  Message IDs, not a global Telegram `update_id` maximum, order this one owner's
  private chat for this one configured bot. Do not share this table across
  independently identified bots without adding a bot namespace first.
- A CAS loser is **not** automatically applied to the newer step. It returns
  current progress and asks the user to retry. Explicit answer labels prevent
  sequentially delivered duplicate/delayed field messages from crossing steps.
  Concurrent or stale messages may be rejected rather than queued/reordered.
- The association is pinned for the logical draft. Reassignment blocks submission
  instead of changing attribution or the idempotency scope. Cancel/restart after
  reassignment. Revocation/disable/role changes deny operations and receipt replay;
  account recovery is an operator task, not an authentication fallback.

## Confirmation and failure guarantees

Confirmation first conditionally freezes `review -> submitting`. All retries use
that row's **same UUID, SF, normalized event time and payload** with the existing
`createVisit()` operation. API constructs `salesForceId` and fixes channel to
`telegram`; none can be selected by client JSON.

`createVisit` checks authorization before replay and places an additional trusted
Telegram guard inside the D1 Visit `INSERT ... SELECT`: current registered User,
active status, Sales Force role, current existing SF, pinned link, draft key and
frozen state must still match. This serializes the insert against account changes
and cancellation, not merely a stale preflight read. No interactive transactions
or process-local locks are used. Existing optional linked Stock Report behavior
remains unchanged outside this minimal Telegram path.

| Failure                                            | Recovery                                                                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Duplicate/concurrent confirmation                  | Deterministic existing Visit ID/primary key and semantic payload comparison; one logical Visit                    |
| Visit committed, Telegram reply failed             | Webhook returns 500; redelivery or `/konfirmasi` returns receipt                                                  |
| Visit committed, draft finalization failed/crashed | Row stays `submitting`; retry replays `createVisit`, then finalizes                                               |
| API transport fails at unknown commit point        | Retry the same wizard/confirmation; never generate a replacement key                                              |
| Cancel races with submit                           | Guarded cancel checks absence of deterministic Visit ID; insert checks frozen state; whichever commits first wins |
| Outlet deleted before confirmation                 | No Visit; frozen draft reports missing Outlet; `/batal`, then restart with a valid token                          |
| Account disabled/link revoked                      | Denied, including replay; do not create a new identity or impersonate the old SF                                  |

The Visit commit and draft finalization are deliberately **separate recoverable
writes**. D1 persistence is logically idempotent, not transactional with Telegram.
Exactly-once replies, ordered Telegram delivery and automatic notification
redelivery are **not** promised. `/konfirmasi` addresses the current reviewed or
submitted draft; explicitly starting a new wizard replaces the latest receipt.
Old already-applied message IDs cannot confirm a new draft. Separate logical
Visits, or entries submitted independently through another channel/key, are not
automatically deduplicated by Outlet/time similarity.

## Verification, deployment order and smoke test

Automated, offline (no Telegram credentials or remote Cloudflare resources):

```sh
pnpm --filter @sales-visit/contracts test
pnpm --filter @sales-visit/db test
pnpm --filter @sales-visit/db db:check
pnpm --filter @sales-visit/api test
pnpm typecheck
pnpm check
```

`apps/api/tests/bot-visits.test.mjs` bundles the real Bot/API Workers and uses
Miniflare/workerd, a named service binding, real additive migrations and disposable
D1. It restarts Workers against persistent temporary storage. Telegram
`getMe`/`sendMessage` are simulated. Tests include finalization failure via a
SQLite trigger, delivery failure after commit, concurrent/repeated confirmations,
state validation, TTL/cancel, reassignment/revocation, exact IDs, owner isolation,
public-write denial and existing command regressions. A **test-only** Worker
injects disable between authorization preflight and insertion to verify the
actual guarded insert. It is not imported by any deployed entrypoint.

Deployment is **not performed by this PR**. When separately authorized:

1. Back up/check target D1 and verify prior migrations through `0003`.
2. Apply additive `0004` before deploying the API (normal migration runbook).
3. Deploy API with the new `BotIdentity.visitWizard` RPC; existing Bot remains
   compatible. Then deploy Bot. Do not point the new Bot at the old API.
4. Verify binding/entrypoint configuration and `/health` independently; health
   checks do not prove D1, authorization or Telegram acceptance.
5. Do not roll back by dropping the draft table. Retain submitting UUIDs/rows
   during rollback. Never turn on public writes to diagnose binding failures.

Manual live Telegram acceptance, using **only synthetic business data** while
public business reads remain unauthenticated:

- [ ] Verify a consenting SF's Telegram identity and SF association out of band;
      approve; `/me` shows active `sales_force` and the intended link.
- [ ] `/salesvisit`, `/jadwal semua`, select a token, enter explicit WIB time,
      skip one optional field, review all fields, confirm, and read back the
      Visit privately in D1. Verify Outlet, exact SF, UTC event instant and channel.
- [ ] Enter an unscheduled known Outlet; verify it is accepted without changing
      Outlet management permissions or generating a Schedule.
- [ ] Repeat `/konfirmasi`; inspect D1 for the same Visit ID/count.
- [ ] Cancel at an intermediate step; resume after a Worker restart; verify
      neither ordinary messages nor Schedule queries create Visits.
- [ ] Check pending/disabled/non-SF users are denied, unrelated commands still
      work, and HTTP POST remains 401. Test revocation only through an approved
      local/synthetic operator procedure; no new account-lifecycle commands ship.
- [ ] Record remote deployment evidence separately from automated tests and
      actual live Telegram delivery/acceptance. Do not infer one from another.

## Deferred fields and limitations

No DigiPOS balance, category Stock/Selling/Sellout triples, CVM/Voice/Digital
activity, Total Belanja, week reporting-period calculations, product Stock Report
wizard, Outlet self-reporting, Web auth/dashboard integration, Excel export,
schedule enforcement or automatic Visit generation. The business operation still
supports its existing optional `stockReport`; the wizard does not collect it.
No financial formulas, partner metrics, data imports, callbacks, account lifecycle
extensions or production cutover are introduced. Attribution for the adapted
Indonesian guided-entry/preview/confirm/cancel interaction remains in the
[Bot reference](../telegram-bot-reference.md#attribution-and-deliberate-differences).
