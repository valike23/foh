# EXA FOH Updated Plan

This plan incorporates the newer use cases from `EXA-FOH-Use-Cases-and-Requirements (1).md`. That document is product context; this file is the repo-facing implementation plan.

## Product Completion Plan

The [Operations Product Plan](EXA-FOH-Operations-Product-Plan.md) is the current forward plan for completing management pages, inventory and purchasing, staff administration, venues, events, service workflows and settings. It supersedes the immediate-next-work list below. Phase 0-6 notes remain a record of prototype implementation, not proof of complete operational workflows or production readiness.

## Product Scope

EXA FOH is now a front-of-house commerce platform for any setting where food and beverage is sold:

- Events: festivals, concerts, parties, pop-ups, brand activations.
- Fixed venues: bars, restaurants, clubs, lounges, sporting arenas.

The core system stays the same across both: order management, QR customer ordering, vendor/store operations, inventory, payments, charges, reconciliation, reporting, and live oversight.

The wrapper differs:

- An event is a bounded operating container with a start, live period, close-out, and archive.
- A fixed venue is a persistent operating container with shifts, daily close-outs, recurring menus, ongoing inventory, and longer-term reporting.

Recommended data-model stance for now: model both as a single `OperatingUnit` concept. In the current code this is still named `Event`; later we can rename or extend it without splitting the core services.

## Platform Sides

### Admin

Admin users represent EXA, an event organizer, or a venue owner/operator.

Responsibilities:

- Create and configure an event or venue.
- Onboard vendors and assign stores.
- Configure charges and taxes at container and vendor/store level.
- See live order/payment/inventory activity across vendors.
- Manage staff, tables, seats, and floor/section status.
- Reconcile payments, cash drawers, and offline transactions.
- View vendor settlement/accounting reports.

Event additions:

- Event lifecycle: configure, open, run live, close out, archive.
- End-of-event financial report.

Fixed-venue additions:

- Shift/day lifecycle: open shift, close register, daily close-out.
- Persistent tables/seats and menu/inventory.
- Weekly/monthly reporting.

### Vendor

Vendor users represent a bar, kitchen, stall, concession, or internal venue store.

Responsibilities:

- Manage menu items, categories, modifiers, pricing, branding, and item availability.
- Manage sellable-item inventory, restocks, wastage, and low-stock alerts.
- Receive and confirm orders from waiters, cashiers, or customers.
- Use kitchen/bar display to mark orders preparing/ready.
- See only their own sales, stock, and order data.

Event additions:

- Vendor configuration may be cloned or rebuilt per event.
- Vendor access is scoped to the event allocation.

Fixed-venue additions:

- Menu persists and evolves over time.
- Tabs may stay open through longer visits or shifts.

### Customer

Customers interact through QR/mobile ordering.

Responsibilities:

- View one vendor menu, one venue menu, or browse vendors inside an event/arena.
- Build and submit an order.
- Pay online through Paga where internet is available.
- Use offline-assisted payment flows: POS terminal, transfer, or cash.
- View running tab, deposit offsets, and balance due.

Event additions:

- Browse across vendors, or land directly on a vendor/table QR.
- See deposits applied against table bills.

Fixed-venue additions:

- QR usually opens the venue's own menu.
- Arenas may require seat-based ordering and runner fulfillment.

## Payments And Accounting

All payment methods should land in the same `Payment` model:

- Online card/transfer through Paga: gateway-confirmed, internet required.
- POS terminal: SDK-confirmed if integrated, otherwise staff-confirmed.
- Offline bank transfer: staff-confirmed with audit trail.
- Cash: staff-confirmed and reconciled during close-out.

The confirmation source differs, but reporting, ledger attribution, and inventory effects should stay unified.

## Wallet / Settlement Decision

This is now a primary CTO decision.

### Option A: Vendor Sub-Wallets

Each vendor has a wallet or virtual account if Paga supports it.

Pros:

- Clear separation of vendor funds.
- Less EXA exposure to holding third-party funds.
- Potential direct vendor settlement visibility.

Cons:

- Depends on Paga sub-account or split-settlement support.
- Vendor KYC friction, especially for one-off event vendors.
- More complex payment integration.

### Option B: Single Wallet With Internal Ledger

Payments land in one EXA/venue-controlled wallet. The system tracks vendor balances in an internal ledger and produces settlement/payout reports.

Pros:

- Faster MVP.
- Simpler gateway integration.
- No per-vendor gateway onboarding at first.
- Ledger still gives clear accounting by vendor.

Cons:

- EXA/venue temporarily holds vendor funds.
- Requires legal/compliance review.
- Vendor payouts become a manual or semi-automated operating process.

Recommended MVP path: Option B, pending compliance review. Build the ledger cleanly from the start so Option A can be added later if Paga supports sub-wallets or split settlement.

## Architecture Implications

### Keep Local-First For Events

Events still require local-network-first operation:

- Local hub is the live source of truth.
- SQLite remains appropriate for the local event/venue appliance.
- Cloud sync moves local operating records into Postgres for platform reporting.
- Paga confirmation queues when internet is unavailable.

### Use Postgres In Cloud

Cloud backend should use Postgres for:

- Multi-tenant organizations and venues.
- User/auth/permissions.
- Cross-event and cross-venue reporting.
- Ledger and settlement history.
- Long-term analytics.

Recommended persistence split:

```text
Local hub appliance: SQLite
Cloud platform: Postgres
Sync worker: local SQLite -> cloud Postgres
```

### Venue As Long-Running Event

To avoid two parallel product stacks, fixed venues should share the same order/payment/inventory engine.

Implementation path:

1. Keep the current `Event` entity in code while prototyping.
2. Add fields for `containerType: "event" | "venue"`, lifecycle state, and reporting cadence.
3. Rename to `OperatingUnit` or `Container` only when the domain stabilizes.
4. Treat a venue as an operating unit that stays open across many shifts/days.

## Data Model Updates Needed

Add or evolve these concepts:

- `OperatingUnit`: event or venue wrapper.
- `OperatingPeriod`: event run, venue day, or shift.
- `VendorLedgerAccount`: per vendor balance and settlement identity.
- `LedgerEntry`: double-entry-style record for vendor revenue, refunds, charges, commissions, and payouts.
- `PaymentConfirmation`: gateway, POS terminal, staff transfer confirmation, or cash confirmation.
- `RegisterSession`: cashier/staff cash drawer session.
- `Seat`: optional fixed seat for arenas and in-seat ordering.
- `RunnerAssignment`: later arena-specific fulfillment role.

Current code already has useful starting points:

- `Event`
- `Store`
- `Vendor`
- `Order`
- `Payment`
- `InventoryItem`
- `StockMovement`
- `Deposit`
- `SyncQueueItem`

## Phased Roadmap

The phases below are sequenced so each phase leaves the product usable, testable, and easier to extend. Phase 1 remains local-hub-first; cloud and advanced venue behavior come after the operational loop is proven.

Each phase has its own implementation breakdown:

- [Phase 0: Product Decisions And Technical Baseline](phases/phase-0-product-decisions-and-technical-baseline.md)
- [Phase 1: Local Operating Loop](phases/phase-1-local-operating-loop.md)
- [Phase 2: Roles, Access, And Multi-Sided UX](phases/phase-2-roles-access-and-multi-sided-ux.md)
- [Phase 3: Event/Venue Unification](phases/phase-3-event-venue-unification.md)
- [Phase 4: Payments, Confirmations, And Ledger](phases/phase-4-payments-confirmations-and-ledger.md)
- [Phase 5: Cloud Platform And Sync](phases/phase-5-cloud-platform-and-sync.md)
- [Phase 6: Advanced Venue And Customer Features](phases/phase-6-advanced-venue-and-customer-features.md)

## CTO Decisions To Resolve

1. Wallet model: vendor sub-wallets or single wallet with ledger segregation?
2. Does Paga support virtual accounts, sub-accounts, split settlement, terminal SDKs, and batch payouts?
3. Should commission calculation move into platform scope now, or should the ledger report balances only?
4. Is sporting arena in-seat delivery a near-term target?
5. Should events and venues remain one unified entity, or does the CTO want separate top-level models?
6. For fixed venues, should single-vendor be the default, with multi-vendor enabled only for arenas and food halls?

## Immediate Next Engineering Work

The next practical build step is no longer just "more event setup." It should be:

1. Add `containerType` and operating-period/shift concepts.
2. Build admin setup screens for stores, menus, tables, and inventory.
3. Add staff/device auth and role scoping.
4. Add payment confirmation models for online, POS, transfer, and cash.
5. Design the first ledger schema before integrating Paga deeply.
