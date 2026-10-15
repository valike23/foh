# Phase 1: Local Operating Loop

## Goal

Make the on-site local hub usable for a real small event or fixed-venue pilot without editing seed data or relying on curl.

## Product Outcome

An operator should be able to configure a venue/event, accept guest and staff-created orders, move orders through prep, settle payments locally, and see inventory changes survive a restart.

## Implementation Status

Phase 1 is implemented as the current local operating console. The BOH dashboard now includes setup, staff order entry, prep, inventory, payments, tables, sync, and audit panels. The hub API supports the corresponding local mutations and persists them to SQLite.

## Build Scope

- Admin setup screens.
- Waiter/cashier order-taking.
- Kitchen/bar prep display.
- Guest QR ordering refinements.
- Order lifecycle controls.
- Inventory operations.
- Deposits, tabs, and basic settlement.
- Local audit visibility.

## Admin Setup Screens

- Stores and vendors.
- Menu categories and menu items.
- Tables and table QR metadata.
- Charges, taxes, and service fees.
- Inventory items and low-stock thresholds.
- Item availability and 86 controls.

Implemented in the BOH setup console:

- Vendor creation.
- Store creation.
- Table creation.
- Menu item creation with opening stock.
- Event charge creation.
- Item availability control from inventory.

## Staff Ordering

- Waiter/cashier can create an order for a table, walk-up customer, or named customer.
- Staff can search/filter menu items by store and category.
- Staff can add notes and quantity changes.
- Staff can submit orders into the same order queue as QR orders.
- Staff can collect payment by cash, POS, or transfer confirmation.

Implemented:

- Waiter/cashier origin selection.
- Store and table/walk-up selection.
- Manual cart entry from the store menu.
- Staff-created orders land in the same confirmation/prep queue.

## Kitchen And Bar Display

- Store-scoped prep queue.
- New, accepted, preparing, ready, served, voided, and rejected states.
- Clear item quantities, modifiers/notes later, table/customer info, and elapsed time.
- Fast actions for accept, start prep, mark ready, and served.
- Prep display must not expose financial totals unless role allows it in later phases.

Implemented:

- Prep queue for sent, confirmed, preparing, and ready orders.
- Actions for accept, preparing, ready, served, and void.
- Financial role separation is still deferred to Phase 2.

## Guest QR Flow

- Support table QR mode.
- Support vendor/store QR mode.
- Support walk-up mode where no table is required.
- Show deposit/tab coverage where available.
- Make unavailable items obvious and impossible to order.
- Keep the flow quick enough for bar/venue service.

Implemented:

- Table QR mode with `?store=...&table=...`.
- Store/walk-up mode with `?store=...`.
- Unavailable items cannot be added.

## Inventory Operations

- Receive stock.
- Restock stock.
- Record wastage.
- Record manual adjustment.
- Mark menu item unavailable.
- Show low-stock warnings.
- Deduct inventory when orders are confirmed.
- Persist all changes in SQLite.

## Deposits And Settlement

- Display table deposit balance.
- Apply deposit coverage to order totals.
- Show balance due.
- Settle by cash, POS, transfer, or deferred gateway placeholder.
- Keep a record of who confirmed each manual payment.

Implemented:

- Local payment confirmation for cash, POS, and bank transfer.
- Paga card/transfer records stay pending-network.
- Payment confirmation writes to the local audit log.

## Data And API Work

- CRUD endpoints for stores, vendors, tables, menu items, charges, and inventory.
- Order status mutation endpoint for every lifecycle transition.
- Staff-created order endpoint or expanded order origin support.
- Payment confirmation endpoint for manual methods.
- Audit log model and API.
- Socket updates for setup, order, payment, and inventory changes.

Implemented endpoints:

- `POST /api/vendors`
- `POST /api/stores`
- `POST /api/tables`
- `POST /api/menu-items`
- `POST /api/charge-rules`
- `PATCH /api/menu-items/:menuItemId/availability`
- `POST /api/inventory/:stockItemId/adjustments`
- `POST /api/orders`
- `PATCH /api/orders/:orderId/status`
- `POST /api/payments`

## UI Work

- BOH navigation for setup, orders, prep, inventory, payments, and audit.
- Setup forms using the existing shadcn-style primitives.
- Store-scoped queue views.
- Compact operational layouts that work on tablets/laptops.
- Keep the visual language close to the EXA dashboard reference.

## Verification

- Configure a pilot venue/event from the dashboard.
- Create a guest QR order and see it appear in BOH.
- Create a staff order and move it through prep.
- Settle an order using a manual payment method.
- Restart the hub and confirm setup, orders, payments, and inventory persist.
- Confirm no internet is required for non-gateway flows.

## Risks

- Setup screens can sprawl if we try to solve every venue type at once.
- Manual payment confirmation needs audit from the start.
- Inventory deduction rules must be simple and predictable for MVP.
- Prep display should stay fast and uncluttered.

## Exit Criteria

- A pilot can be configured without seed edits.
- Guest and staff orders run through the same operational queue.
- Staff can settle orders locally.
- Inventory survives restart and reflects order activity.
- Local hub works offline for cash, POS-manual, transfer-manual, and prep flows.

Current caveat:

- Full role isolation and prep-only financial hiding are Phase 2 work. The Phase 1 UI exposes the operating loop in one BOH console so the workflow can be tested before permissions are split.
