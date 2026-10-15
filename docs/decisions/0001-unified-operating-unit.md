# 0001: Unified Operating Unit

## Status

Provisional.

## Decision

Use one operating wrapper for both events and fixed venues. The product language should move toward `OperatingUnit`, but the current code can continue using `Event` during the prototype until the model stabilizes.

## Context

EXA FOH now needs to support:

- Events: bounded service periods with setup, live operation, close-out, and archive.
- Fixed venues: persistent operations with shifts, daily close-out, recurring menus, and ongoing inventory.

Both modes share the same core engine:

- Orders.
- Payments.
- Inventory.
- Charges.
- Deposits/tabs.
- Vendors/stores.
- Reporting.

## Why

A unified model avoids building two parallel systems. Event and venue differences can be represented by operating type, lifecycle fields, operating periods, and reporting cadence.

## Implementation Guidance

- Keep the current `Event` type for now.
- Add `containerType: "event" | "venue"` in Phase 3.
- Add `OperatingPeriod` in Phase 3 for event runs, venue days, shifts, and register sessions.
- Rename `Event` to `OperatingUnit` only after the field model is stable.

## Consequences

- Phase 1 can focus on local operations instead of a broad domain rename.
- Phase 3 will need a deliberate migration from event-only assumptions.
- UI copy should increasingly say "event/venue" or "operating unit" where useful.

