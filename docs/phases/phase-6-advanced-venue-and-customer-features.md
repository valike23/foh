# Phase 6: Advanced Venue And Customer Features

## Goal

Support larger fixed venues and repeat-customer experiences after the core operating model is stable.

## Product Outcome

EXA can serve arenas, high-volume venues, and returning customers without compromising the fast anonymous ordering flow needed for events and bars.

## Build Scope

- Arena seat-based ordering.
- Runner fulfillment and delivery routing.
- Section/vendor availability rules.
- Customer order history.
- Saved payment methods if compliant and supported.
- Loyalty, promotions, or CRM hooks.
- Advanced forecasting and item performance analytics.

## Implementation Status

Implemented as a first advanced-venue MVP slice.

- Added `Section` and `Seat` models for arena/venue seat-based ordering.
- Added `RunnerAssignment` and `DeliveryRoute` models for handoff from prep to runners.
- Added optional `CustomerProfile` and `LoyaltyAccount` models so guests can remain anonymous or opt into history/points with a phone number.
- Added `Promotion` and `ForecastMetric` models.
- Guest ordering supports `seat`, optional phone identity, and promo code query/input while preserving anonymous ordering.
- Hub order creation validates store availability by seat section, applies active promotions, creates/updates customer profiles, grants simple loyalty points, and creates delivery routes for seat orders.
- BOH has a runner fulfillment console for assign, pick up, delivered, and issue states.
- BOH has an advanced venue console for section/seat setup, promotion creation, customer lookup, and analytics.
- Cloud ingest includes sections, seats, runner assignments, delivery routes, customer profiles, loyalty accounts, promotions, and forecast metrics.

## Arena Features

- Seat, row, section, and zone model.
- QR or seat-code ordering.
- Vendor availability by section.
- Runner assignment by zone.
- Order handoff from prep to runner.
- Delivery status visible to staff and customer.

## Customer Features

- Optional customer identity.
- Order history.
- Saved preferences.
- Loyalty balance or promotions.
- Receipts and reorder flows.
- Anonymous checkout remains available.

## Analytics Features

- Item performance by venue/event/store.
- Stock forecasting.
- Peak-time analysis.
- Vendor comparison.
- Refund/void/wastage trends.
- Customer repeat behavior where identity is available.

## Data Model Work

- `Seat`.
- `Section`.
- `RunnerAssignment`.
- `DeliveryRoute`.
- `CustomerProfile`.
- `LoyaltyAccount`.
- `Promotion`.
- `ForecastMetric`.

Implemented local APIs:

- `POST /api/sections`
- `POST /api/seats`
- `POST /api/runner-assignments`
- `POST /api/promotions`
- `GET /api/runner/routes`
- `PATCH /api/delivery-routes/:routeId/status`
- `GET /api/customers/history?phone=...`
- `GET /api/reports/advanced`

## UI Work

- Seat map or section selector.
- Runner queue.
- Runner handoff screen.
- Customer account/order history screen.
- Promotion management.
- Advanced analytics dashboards.

## Verification

- Seat order routes to the correct vendor/store.
- Runner can accept, pick up, and deliver an order.
- Customer can still order anonymously.
- Customer history only appears with consent/identity.
- Analytics are derived from existing operational records.

## Risks

- Arena fulfillment is operationally complex.
- Saved payment methods require provider and compliance confidence.
- Loyalty/CRM can distract from core FOH reliability.
- Seat maps need careful setup tooling.

Deferred past this phase:

- Visual seat-map editor.
- Saved payment methods.
- Real CRM integration.
- Promotion stacking and exclusion rules.
- Advanced forecasting beyond derived operational metrics.
- Runner mobile app with geofenced routing.

## Exit Criteria

- Arena-style in-seat ordering has a complete fulfillment path.
- Runner workflows work with prep and customer states.
- Repeat-customer features are optional.
- Advanced analytics build on the same order, payment, inventory, and ledger foundations.
