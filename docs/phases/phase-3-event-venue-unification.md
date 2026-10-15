# Phase 3: Event/Venue Unification

## Goal

Support one-off events and persistent fixed venues using one core order, payment, inventory, and reporting engine.

## Product Outcome

EXA can run both an event demo and a fixed-venue demo without maintaining two product stacks.

## Implementation Status

Phase 3 is implemented as an event/venue operating layer on top of the existing local hub. The code still uses the `Event` type name internally, but it now carries `containerType`, lifecycle, and reporting cadence fields. Orders and payments attach to an active `OperatingPeriod`, and the BOH dashboard can open, close, and report on event runs, venue days, shifts, and register sessions.

## Build Scope

- Introduce the operating wrapper for events and venues.
- Add lifecycle states.
- Add operating periods for event runs, venue days, shifts, and register sessions.
- Add venue-specific table/seat persistence.
- Add inventory carryover.
- Add event close-out and venue close-out reporting.

## Data Model Work

- Add `containerType: "event" | "venue"` to the current event wrapper.
- Add `OperatingPeriod`.
- Add event lifecycle fields: configure, open, live, closed, archived.
- Add venue lifecycle fields: active, paused, archived.
- Add shift/day period fields.
- Add persistent table and optional seat structure.
- Add reporting cadence fields.

Implemented:

- `containerType: "event" | "venue"` on the current event wrapper.
- Expanded lifecycle status and reporting cadence.
- `OperatingPeriod`.
- `operatingPeriodId` on orders and payments.
- SQLite persistence for operating periods.
- Period fallback for existing local databases.

Deferred:

- Full seat map tooling.
- A broad `Event` to `OperatingUnit` rename.

## Operating Periods

- Event run: one bounded event service period.
- Venue day: business day for reporting and reconciliation.
- Shift: staff and cash-drawer operating window.
- Register session: cashier drawer session.

## Event Behavior

- Event setup is usually created before opening.
- Vendor/store allocation can be event-specific.
- Inventory may be stocked for the event and closed out afterward.
- Reports focus on event performance and settlement.

## Venue Behavior

- Menus persist across days.
- Tables persist across days.
- Inventory carries over.
- Shifts and daily close-outs repeat.
- Reports focus on daily, weekly, monthly, and staff/register performance.

## API Work

- Operating unit endpoints.
- Operating period endpoints.
- Open/close/archive endpoints.
- Shift/day close-out endpoints.
- Reporting endpoints by period.
- Inventory carryover and period-bound stock movement queries.

Implemented:

- `PATCH /api/operating-unit`
- `POST /api/operating-periods`
- `PATCH /api/operating-periods/:periodId/close`
- `GET /api/reports/closeout`
- Automatic order/payment attachment to the active operating period.
- Close-out reports with revenue, settled totals, outstanding balance, cash expectation, and stock movement counts.

## UI Work

- Event setup/open/close controls.
- Venue daily operation controls.
- Shift open/close screens.
- Register session screen.
- Event close-out report.
- Venue day report.
- Clear labeling so operators know whether they are in event or venue mode.

Implemented:

- BOH event/venue mode panel.
- Open period controls.
- Close period controls.
- Close-out report summary.
- Clear current mode/status display.

## Verification

- Event demo can open, run orders, close, and produce event close-out.
- Venue demo can run two business days with persistent menus/inventory.
- Inventory carries forward for venues.
- Reports filter correctly by operating period.
- The same order/payment engine serves both modes.

## Risks

- Renaming `Event` too early could slow the build.
- Venue close-out can become accounting-heavy; keep MVP close-out practical.
- Shared model must not erase real differences between events and venues.

## Exit Criteria

- Event and venue demos both work.
- Event close-out produces a useful report.
- Venue shift/day close-out produces a useful report.
- Menus, tables, and inventory persist appropriately for venues.
- The codebase still has one core operational engine.

Current caveat:

- Venue persistence is implemented through the same stores, tables, menus, and inventory records. Advanced venue seating and recurring calendar tooling remain future work.
