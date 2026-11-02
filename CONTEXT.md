# Sales Visit — Domain Language

A shared vocabulary for Sales Visit contributors and coding agents. This file defines **what terms mean**, not product requirements, implementation plans, or technical decisions. See [README.md](README.md) for the project overview and [ADRs](docs/adr/) for decisions.

## Language

**Sales Force (SF)**:
A field staff member responsible for visiting assigned outlets and recording visit outcomes.
_Avoid_: Using **sales** ambiguously for both the staff member and sales volume.

**Admin**:
An internal operator who maintains operational master data and reviews reports.
_Avoid_: Assuming Admin is the only Web Dashboard user.

**Supervisor / Manager**:
An internal user who monitors field activity, reviews reports, and evaluates follow-ups.
_Avoid_: Treating the role as interchangeable with Admin permissions before access rules are defined.

**Outlet**:
A retail point of sale visited by Sales Force and tracked by the distributor. An Outlet is a **business record**, not necessarily a system account.
_Avoid_: Automatically treating every Outlet as an authenticated user.

**Outlet representative**:
A person acting on behalf of an Outlet. May become a system user if outlet self-reporting is approved; **not part of the current MVP**.
_Avoid_: Outlet user, when only the Outlet business record exists.

**Product**:
A Telkomsel-distributed item tracked in reports, such as a starter SIM card or physical voucher. Product definitions are managed as master data.
_Avoid_: Conflating a product catalog record with a quantity currently held by an Outlet.

**Visit**:
A field activity in which a Sales Force member visits an Outlet at a particular time. A Visit exists independently of whether stock was reported.
_Avoid_: Using Visit as a synonym for Stock Report.

**Visit report**:
The recorded outcome of a Visit, including the visited Outlet, Sales Force member, visit time, notes, and any applicable follow-up.
_Avoid_: Treating a report entered via Telegram differently from the same report entered via Web.

**Stock Report**:
A timestamped account of quantities reported for an Outlet. It may be linked to a Visit, but that link is **optional**. Initially submitted by Sales Force; a future Outlet representative may also submit one.
_Avoid_: Live inventory, current stock, or Visit, unless those meanings are explicitly intended.

**Stock Report Item**:
One product's reported quantity within a Stock Report.
_Avoid_: A product's permanent inventory balance.

**Reporter**:
The person or system identity responsible for submitting a report.
_Avoid_: Equating reporter identity with the interface used to submit.

**Submission channel**:
The interface through which a report was created, initially **Telegram Bot** or **Web Dashboard**.
_Avoid_: Treating Web and Telegram as separate reporting systems or sources of truth.

**Telegram Bot**:
The chat-based interface that Sales Force can use to enter reports.
_Avoid_: The only permitted Sales Force interface.

**Web Dashboard**:
The browser-based interface for operational reporting and monitoring. Sales Force can **submit** reports here, while Admin/Supervisor use role-appropriate management and monitoring capabilities.
_Avoid_: Admin-only dashboard, read-only dashboard.

**Outlet self-reporting**:
A **proposed, deferred** capability for an Outlet representative to report stock without a Sales Force Visit.
_Avoid_: Treating an Outlet Stock Report as evidence of a Visit.

**Stock verification**:
A potential future activity in which Sales Force checks a previously reported stock snapshot against conditions observed during a Visit.
_Avoid_: Assuming verification is required for every Visit or already implemented.

## Telkomsel / partner terminology

**Perdana SA**:
Starter SIM-card products. Examples discussed include Simpati and by.U starter packs.

**VF Data**:
Physical data/internet voucher products.

**VF Voice**:
Physical voice/calling voucher products.

**DigiPOS**:
An existing Telkomsel point-of-sale ecosystem used in the outlet/distribution context. Sales Visit is **not** intended to replace it.

**Saldo DigiPOS**:
A balance associated with DigiPOS. Its exact reporting and integration needs are not yet established for Sales Visit.

**Lunas**:
A payment arrangement in which the relevant purchase has been paid, such as by cash or transfer.

**Konsinyasi**:
A deferred-payment/consignment arrangement as discussed in team brainstorming. Detailed settlement rules need partner confirmation.

## Terms awaiting partner validation

These terms appear in source notes, but their **precise operational meaning and formulas are not yet agreed**. Do not derive metrics or validation rules from assumptions.

**Stock**:
Quantity recorded for an Outlet at a particular point in time. Confirm whether the partner means observed on-hand stock, starting stock, ending stock, or another measure.

**Sales In / Selling**:
A column/term in existing outlet reporting. Working notes suggest purchases or restocking into an Outlet, but the partner must confirm the definition and whether these labels are equivalent.

**Sales Out / Sellout**:
A column/term in existing outlet reporting. Confirm whether it means actual consumer sales, an inferred change in stock, or something else; brainstorming notes are not sufficiently consistent.

**Total Belanja**:
A value appearing in existing records. Confirm its data source, scope, and calculation before using it as a KPI.

**Outlet aktif (Active Outlet)**:
An outlet classification whose criteria have not been confirmed. Do not infer activity from a recent Visit alone.

**Restock request**:
A possible request from an Outlet for additional Product stock. Its workflow and inclusion in the MVP are unconfirmed.

**Product recommendation**:
A proposed suggestion to Sales Force about what to offer an Outlet. The recommendation logic, required inputs, and MVP scope are not yet confirmed.
