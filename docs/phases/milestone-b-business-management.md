# Milestone B: Events, Vendors And Storefronts

## Implementation Contract

Management workflows are implemented. The single-runtime provisioning limitation below remains open; this is not a claim that newly configured events can already take orders.

Build persisted, scoped business setup on the authenticated management workspace. Use storefront throughout the interface. Keep the full-width layout and 2px radii.

- Events: directory, dates/timezone, hosted venue or temporary location, editing, lifecycle, configuration cloning, readiness and history.
- Vendors: organization directory, contacts, internal/external classification, editing and archive dependency checks.
- Storefronts: event/venue scope, vendor allocation, commercial terms, fulfillment/confirmation policy, prep destination, service sections, edit/pause/archive and history.
- Floor: scoped sections, tables and seats with creation/editing/archive and capacity/duplicate validation.
- QR: preview/download for storefront/table/seat, token rotation/disable, destination validation and a closed/unconnected guest state.
- Navigation: real routes and explicit operation filter; independent venue/event data, no browser-only configuration.
- Migration: import existing event/vendor/storefront/floor identities once; do not copy or mutate historical transactions.

## Acceptance

Create a venue and a hosted event, allocate two vendors to distinct storefronts, configure sections/tables/seats, generate a QR, clone the event into draft, and verify that stock, orders, payments, access and QR tokens are not copied. Scoped users cannot read or mutate another operation. Stale writes, invalid relationships and unsafe archives fail clearly.

## Service Boundary

The existing hub has one active transactional runtime. Management scopes do not implicitly switch it. Imported records can link to that runtime; new events remain administratively configured until a transactional runtime is connected. Starting service must enforce that connection, not simply flip a label. Full menu/inventory publishing and multi-unit transactional runtime provisioning remain a dependency for newly created operations; neither QR preview nor an event readiness label claims orders can already be taken there.

## Verification

Isolated API tests cover migration, tenant/venue scope, relationship validation, optimistic concurrency, lifecycle/readiness, cloning and QR rotation. Browser checks cover create/edit and desktop/mobile layouts without touching live accounts or transactions.

## Delivered Pages And Behaviors

- `/events`: search, status and venue filters, pagination, a three-step creation flow, detail/edit, readiness checks, cancel/archive and configuration cloning.
- `/vendors`: contact directory, detail/edit, internal/external classification and storefront allocations; archive blocked by active allocations.
- `/storefronts`: operation/vendor allocation, prep destination, fulfillment, confirmation policy, service sections, documented commercial terms, activate/pause/archive and history.
- `/floor`: operation-scoped sections, tables and seats, capacity/parent validation, edit/archive and QR destination tools.
- Venue detail links to its hosted events, permanent storefronts and floor. An event's floor and storefronts remain separate from the venue's.
- QR rendering uses the maintained `qrcode` library; PNG download, guest preview, disable and rotation are implemented. `/entry/[token]` in the guest app returns a closed/unavailable state rather than a fallback menu for unconnected or revoked destinations.
- The order API revalidates entry tokens before accepting QR-origin orders. Guest UI preserves the cart and shows failures instead of displaying a false success.
- Event times use Luxon to interpret the selected IANA timezone. Nonexistent or ambiguous daylight-saving times are rejected in the form.
- Clone copies configuration with fresh IDs/tokens and remapped floor references; it clears commercial terms and never copies transactional records, quantities or sessions.
- Setup changes return ready events to draft. Imported live configuration is read-only here until a runtime publishing workflow exists.

## Operating Notes

`NEXT_PUBLIC_GUEST_URL` sets the browser-facing guest origin used in QR images. The development default uses the dashboard hostname on port 5174. For printed codes, configure the reachable venue guest hostname before generating codes.

New tables (`business_records`, `business_activity`, `business_requests`) are persisted independently of legacy snapshot replacement. Existing snapshot cloud backup does not yet carry this management registry; use a whole-database backup for preservation until configuration sync is implemented.

## Still Required For Full Milestone B Completion

- Provision and publish configuration into a transactional runtime for newly created venues/events.
- Integrate live lifecycle/close-out with that runtime; imported published records remain managed by the existing service console.
- Finish the legacy API/session migration from Milestone A before treating management authorization as protection for the full service system.

Menu assignment and inventory locations depend on Milestone C; full staffing depends on Milestone E. The current commercial-terms field records an agreement and does not implement commission calculation or payout execution.
