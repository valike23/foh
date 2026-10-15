# EXA FOH Operations Product Plan

Status: proposed product completion plan, 2026-09-28. This is a plan, not a statement that these features are implemented.

Implementation has started with the [management foundation and venue slice](phases/milestone-a-management-foundation.md): real venue routes, management authentication, directory/create/edit, opening hours, status/history and safe migration. Milestone A and the wider venue/event scope are not yet complete; remaining work is recorded in that breakdown.

The [Milestone B business-management breakdown](phases/milestone-b-business-management.md) now records implemented event/vendor/storefront/floor pages, cloning, QR handling, and the remaining runtime-publishing dependencies. Use these status notes rather than assuming the complete milestone is finished.

## 1. Current Gap

The current prototype demonstrates the operating loop, but does not provide complete business management workflows.

Repository evidence:

- The BOH App Router has one page. Its sidebar uses fragment links such as `#setup` and `#inventory` in `apps/boh-dashboard/src/components/boh-dashboard-app.tsx`.
- Setup provides creation forms, rather than searchable directories, detail pages, editing, archiving, dependencies, and history.
- Inventory provides quantity adjustments, but no purchasing documents, receiving, transfers, stocktake sessions, or variance approvals.
- Staff are seeded users and assignments with a role selector, not a staff administration and secure login experience.
- The operating-unit endpoint updates the current wrapper. It is not a directory of independently managed venues and events.
- Cloud storage is a SQLite stand-in; production Postgres and production payment/authentication integrations remain unfinished.

Phase 0-6 notes describe prototype coverage, not operational acceptance. The next work is product completion as well as hardening. Each module must answer who uses it, what they can do, what happens afterward, what can fail, and how they recover.

## 2. Operating Model

### Business structure

- Organization: business or organizer owning memberships, vendors, shared catalogues and reporting access.
- Venue: persistent physical operation with address, timezone, business hours, floor layout, storefronts, stock locations and recurring service days.
- Event: bounded operation with dates, vendors, menu allocations, staffing, stock allocation and settlement. It may use a permanent venue or a temporary site.
- Operating unit: shared technical scope for events and venues; use recognizable venue/event names in the interface.
- Business day: reporting day with a configurable cutoff so after-midnight service can belong to the previous evening.
- Shift: staff working interval; shifts may overlap.
- Register session: cashier/device cash-drawer interval, distinct from a shift and business day.

Events and venues share services, not mutable identity. Creating an event at a venue must not overwrite that venue. A transaction belongs to exactly one operating unit and reporting period; aggregation must not double-count an event hosted at a venue.

### Vendors, storefronts and stock

- Vendor: independent business or internal operator owning sales and potentially receiving settlement.
- Storefront: selling and fulfillment point such as a bar, kitchen, stall or concession.
- Vendor allocation: participation in a venue/event, including storefronts, terms, access and dates.
- Stock location: physical holding area such as central storeroom, kitchen, main bar or event staging area; separate from a selling storefront.
- Stock ownership: stock belongs to an owner as well as a location. Vendors sharing storage do not implicitly share balances.

A simple bar starts with one venue, one internal vendor, one storefront and one stock location. Additional complexity appears only when needed.

### Everyday journeys

Venue: select venue -> check readiness -> receive/transfer stock -> open day/registers -> staff sign in -> take and fulfill orders -> settle tabs -> count cash/stock -> review exceptions -> close day.

Event: create or clone -> allocate vendors/storefronts -> publish menus -> assign staff -> allocate stock -> generate/test QR codes -> pass opening checklist -> run service -> count/return remaining stock -> reconcile vendors -> approve close-out -> archive.

Stock controller: review low stock -> draft purchase/transfer -> obtain approval -> receive actual quantities -> resolve differences -> release stock to storefronts -> count and reconcile.

## 3. Navigation And Real Pages

Use Next.js App Router, TypeScript, Tailwind and shadcn components following `/Users/samueladeyemi/Documents/GitHub/EXA/dashboard`. Replace anchor navigation with real routes, nested layouts, active navigation, breadcrumbs and list/detail/edit flows.

The header identifies organization, selected venue/event and business date. Storefront filters persist within that scope. Switching scope clears incompatible selections and handles unsaved forms. Organization-wide views are explicitly labeled.

Proposed operational routes below use `/operations/[unitId]` as a prefix. Organization directories are outside that prefix.

| Navigation | Pages |
| --- | --- |
| Overview | `/overview`: actionable live summary, readiness, exceptions and shortcuts |
| Venues | `/venues`, `/venues/new`, `/venues/[id]`: directory, onboarding and management |
| Events | `/events`, `/events/new`, `/events/[id]`: calendar/list, setup, service and close-out |
| Vendors & Storefronts | `/vendors`, `/vendors/[id]`, `/storefronts`, `/storefronts/[id]`: businesses, allocations and storefronts |
| Service | `/orders`, `/orders/[id]`, `/pos`, `/prep`, `/floor`, `/deliveries` |
| Menus | `/menus`, `/menus/[id]`, `/products`, `/products/[id]`, `/modifiers` |
| Inventory | `/inventory`, `/inventory/items/[id]`, `/inventory/locations`, `/inventory/movements`, `/inventory/transfers`, `/inventory/counts`, `/inventory/waste` |
| Purchasing | `/suppliers`, `/purchases`, `/purchases/[id]`, `/receipts`, `/receipts/[id]` |
| Staff | `/staff`, `/staff/[id]`, `/staff/roster`, `/staff/roles`, `/staff/sessions` |
| Finance | `/payments`, `/payments/[id]`, `/registers`, `/deposits`, `/refunds`, `/settlements`, `/settlements/[id]` |
| Close-out | `/business-days`, `/business-days/[id]`: opening, handover, closing and exceptions |
| Customers | `/customers`, `/customers/[id]`, `/promotions` |
| Reports | `/reports/sales`, `/reports/stock`, `/reports/staff`, `/reports/vendors`, `/reports/closeout` |
| Settings | General, Service, Charges, Payments, Inventory, Devices, Notifications, Sync & Recovery, Audit |

Navigation is permission-aware. Cashiers, waiters, prep staff, runners and stock staff enter focused workspaces. Move Cloud under Settings; replace Advanced with named features; replace Setup with management pages. Rename Periods to Business Days & Shifts where appropriate. Remove prototype phase badges.

## 4. Inventory And Stock Management

### Catalogue versus quantities

Inventory catalogue defines what is tracked: SKU, name, barcode, category, base unit, purchase pack sizes, suppliers, tracking method and cost method. Stock describes quantities on hand, reserved, available, in transit or unusable at each location.

Menu products are what customers buy; they reference stock consumption rules rather than acting as the entire inventory catalogue.

Example: receive 10 cases of water with 24 bottles per case. Add 240 bottles to central storage. Dispatch 48 to the bar; keep them in transit until received. A confirmed order consumes two bottles. One damaged bottle leaves 45 at the bar. A physical count of 44 proposes a -1 variance, posted only after approval. Every step has a source document and appears in movement history.

### Required pages

| Page | Content and actions |
| --- | --- |
| Stock overview | Filter owner, unit, storefront, location, category and low/out-of-stock; show on-hand, reserved, available, reorder point and permitted cost/value; receive, transfer, count and record waste |
| Item directory | Search SKU/barcode/name; create, import with preview and row errors, edit and archive; distinguish stock items from menu products |
| Item detail | Identity, units/conversions, suppliers, consumption mappings, location balances, reorder levels, cost and movement history |
| Locations | Create/edit storage and storefront locations, assign custody and fulfillment source; resolve balances and in-flight documents before archiving |
| Movement history | Filter/export receipts, sales consumption, transfers, waste, count variances, returns and reversals; link to source and actor |
| Transfers | Draft -> dispatch -> partial/full receipt -> complete; in-transit quantities, receiving acknowledgement, shortages and cancellation rules |
| Stocktakes | Choose location/items, expected snapshot, blind count option, recount, variance review and approval/posting; explicitly reconcile sales during counting |
| Waste & adjustments | Item, quantity, reason, actor, note/evidence and approval where required; no unrestricted quantity overwrite |
| Replenishment | Location-specific minimum/target levels, low-stock queue, draft purchase/transfer; clear alerts when availability recovers |

### Purchasing and receiving

Supplier directory includes contacts, supplied items, purchase units, lead times, payment terms and active/archive status. Supplier payables are separate from vendor revenue settlement.

Purchase order: draft -> submitted -> approved -> sent -> partially received -> received/closed. Include supplier, location, lines, conversions, agreed costs, expected date and references; allow reasoned cancellation and short-close.

Receipt records actual quantities, rejected/damaged quantities and unit costs against a purchase order. Support authorized direct receipt for urgent purchases. Partial deliveries leave remaining quantities open. Duplicate posting must not duplicate stock. Correct posted receipts with reversals/returns, not silent edits.

Supplier return selects receipt/item, reason and quantity; authorization posts the outflow and tracks a supplier credit reference. Full accounts-payable software is outside the initial scope.

### Stock invariants

- Base-unit quantities use suitable precision; conversion changes cannot rewrite historical receipts.
- Keep consumption at order confirmation, as in the prototype. Add reservations at accepted submission where stock limits apply; release on rejection/expiry and atomically convert to consumption on confirmation.
- Available = on-hand minus active reservations. Concurrent confirmations cannot oversell unless an explicit, authorized negative-stock policy permits it.
- Stock movement and order transition commit together; retrying an action never deducts twice.
- Pre-preparation cancellation may restore stock through a reversal. After preparation, require an explicit restock or waste decision. A financial refund alone must not replenish food or drinks.
- Transfers preserve owner and total quantity across origin, transit and destination. Cross-owner movement requires a commercial transaction, not an ordinary transfer.
- Posted movements are append-only with actor, time, location, scope, reason, source and approval. Corrections link to original movements.
- During stocktake, pause movements for that scope or reconcile movements since the count snapshot. Never replace live balances with stale counted values.
- Archive items with history; do not delete them. Menu/recipe edits must not rewrite past consumption.
- Propose moving weighted-average valuation initially; confirm costing policy before implementation. Stock valuation is not full financial accounting.

### Recipes and perishables

Complete packaged-item workflows first. Optional recipe/BOM support then covers cocktails, spirits by measure, ingredients and modifier-dependent consumption. This needs conversions, yields, recipe versions and preparation waste. Batch/expiry tracking and FEFO are separate capabilities; bring them forward if perishables are launch-critical. A single stock quantity does not establish recipe or expiry support.

## 5. Staff Management

- Directory: search/filter status, role, venue/event, vendor and shift; add/invite, edit, suspend, reactivate and archive; expose onboarding state.
- Detail: profile/contact, membership, scoped roles, storefront/section assignments, roster, sessions and activity; restrict personal information.
- Roles: templates and capabilities for receipts, adjustments, approval, refunds, discounts, payment confirmation, exports and settings; scope and expiry; preview effective access before saving.
- Roster: daily/weekly venue schedule and event roster; role, storefront, section, shift and supervisor; flag overlapping shifts and unfilled positions; publish changes.
- Attendance/handover: clock in/out, reasoned manager corrections, handover notes and unresolved register/order responsibilities. Payroll is initially out of scope.
- Sessions: authenticated login or staff PIN on enrolled devices, auto-lock, revocation, lost-device response and secure handover. Remove role selection as a way to acquire authority.

| Role | Default responsibilities |
| --- | --- |
| Organization owner | Organization administration and delegation |
| Venue/event manager | Scoped setup, service oversight, staffing and close-out |
| Vendor manager | Own allocation, menu, stock, staff access and sales |
| Stock controller | Assigned receiving, transfers, counts and waste |
| Purchasing approver | Authorized purchase and stock-variance approval |
| Cashier | Permitted collections and own register |
| Waiter | Assigned table orders and service |
| Prep | Assigned station tickets and readiness |
| Runner | Assigned pickup/delivery |
| Finance | Scoped reconciliation, refund/settlement approval and reporting |
| Auditor | Authorized read-only records and history |

People may hold several scoped roles. Supervisor approval for sensitive actions is a capability, not an implied permission for everyone with a manager label.

Enforce boundaries in API reads/writes, exports and realtime subscriptions. Vendor isolation applies to IDs, totals, searches and reports. Deactivation preserves historical attribution and revokes access. Offline access requires enrolled devices and bounded cached grants; document revocation limitations while disconnected.

## 6. Venue Management

Venue directory: name, location, manager, status, today's service state and connectivity freshness; search/filter, create, clone configuration, pause and archive.

Venue detail tabs:

1. Overview: service, open tabs, low stock, unresolved payments, staffing and device exceptions.
2. Profile: address, timezone, contacts, branding, hours, overnight cutoff and receipt identity.
3. Storefronts & Vendors: operators, allocations, storefront hours, prep stations and service areas.
4. Floor: sections, tables, seats, capacity, labels, QR destinations, waiter assignments and out-of-service status. Start with structured editing; visual floor design can follow.
5. Menus: assignments, schedules, availability and overrides.
6. Stock Locations: storerooms, storefront stock sources and replenishment rules.
7. Team: access and roster.
8. Business Days: readiness, shifts, registers and close-out history.
9. Events: hosted events, shared resources and schedule conflicts.
10. Settings & History: service/payment rules, devices and changes.

Opening checks cover menus, stock sources, staff access, payment methods and required devices. Stock carries over between days; close-out never resets it. Pausing ordering preserves existing tabs. Archiving requires resolving or explicitly handing over active service and liabilities.

## 7. Event Management

Directory: upcoming/live/closing/archived filters, list/calendar views, organizer/venue filters, create and clone.

Creation wizard: identity/dates/timezone -> host venue or temporary site -> vendors/storefronts -> menus/prices -> floor/QR -> staffing -> stock -> charges/payments -> readiness review.

Detail tabs: Overview, Vendors & Storefronts, Menus, Floor & QR, Stock, Staff, Service, Finance, Close-out, Settings.

Lifecycle: draft -> ready -> live -> closing -> closed -> archived, with cancellation for events that will not run. Transitions enforce readiness and close-out conditions, not just labels.

- Clone configuration only: exclude transactions, balances, physical stock, sessions and unreviewed commercial terms.
- Vendor onboarding: contacts/invitation, allocation, menu approval, access expiry, charges/commission terms and restricted settlement details.
- Stock planning: estimates, actual transfers from named locations, event purchases and separate vendor ownership.
- QR management: generate/download/print, preview destination, disable/rotate; closed-event QR cannot submit orders into another event.
- Live control: pause per storefront/section, inspect queues and low stock, assign staff and resolve exceptions.
- Closing: stop new orders, resolve active work/tabs, count stock, return remainder, reconcile registers, review vendor statements and sign off.
- Closed records are read-only for ordinary staff. Subsequent refunds/corrections use audited adjustments; reopening requires permission and a reason.

## 8. Menus, Vendors And Storefronts

Product detail: name, description, image, category, price, modifiers, supplied allergen information, prep destination, tax category, availability schedule and stock mapping. Selling price and stock cost remain separate.

Menu management: draft/published versions, category ordering, storefront assignments, scheduling, price overrides with precedence, bulk change preview and customer preview. Modifiers may affect price and stock. Snapshot sold descriptions, prices, charges and consumption rules on transactions.

Vendor detail: profile, contacts, allocations, staff access, menus, stock ownership, terms, sales and settlement history. Vendor portal exposes only its allocations.

Storefront detail: vendor/unit, menu, prep routing, stock source, service sections, opening hours, confirmation/payment policy, staff and pause controls. Paused storefronts retain existing work.

## 9. Service Workspaces

| Workspace | Required workflow |
| --- | --- |
| Orders | Search/filter number, time, storefront, table and state; detail with items, notes, timeline, payments and fulfillment; authorized edits, rejection, cancellation and reprint |
| POS | Fast search/modifiers, table/customer, held draft, send to prep, split bill by item/amount, partial payment, receipt and stale price/availability handling |
| Prep | Fullscreen station queue, elapsed time, notes, accept/preparing/ready, unavailable-item exception and partial readiness across stations |
| Floor & tabs | Table state, named running tabs, transfer table/waiter, audited split/merge, deposit balance and payment history |
| Runner | Pickup queue, assignment, location details, pickup/delivered, failure and reassignment; paid-but-undelivered orders remain visible |
| Guest | Vendor discovery, contextual menu, modifiers, availability, submission acknowledgement, tracking, running balance, payment pending/failure/retry and receipt |

Separate order, fulfillment and payment states. Paid does not mean delivered; delivered does not mean paid. Initially provide separate checkout per vendor with shared discovery. Combined vendor checkout requires explicit order splitting and payment allocation design.

## 10. Finance And Close-out

- Payments: searchable list/detail, method, amount, confirmation source, collector, reference, bill and states; duplicate-reference checks and manual confirmation evidence.
- Registers: open with float and cashier/device; cash in/out with reason, expected/count comparison, denomination count, variance review, handover and close. Support creation, not just closing a seeded register.
- Deposits: payer/table/event, funded amount, applications and remaining liability; prevent concurrent double application; authorize transfers/refunds.
- Refunds/voids: full/partial request, reason, approval, actual payment outcome and ledger reversal; distinguish recording an external refund from executing one through a gateway.
- Settlements: vendor sales, refunds, attributable charges, commission, prior payouts and payable balance; draft -> reviewed -> approved -> payout pending -> paid/failed; evidence and reconciliation. Marking paid is not proof that money moved.
- Close-out: resolve orders/unpaid balances, reconcile cash/POS/transfer, review payment exceptions and stock variances, close registers, manager sign-off; block or explicitly authorize unresolved exceptions.
- Ledger: immutable attributable postings/reversals. Balanced journals and account definitions must be implemented/tested before claiming double-entry accounting; the existing vendor ledger is a prototype.

Version historical charge settings. Validate tax rules and actual gateway capabilities during implementation; this plan does not prescribe rates or promise provider operations.

## 11. Settings And Reporting

| Settings area | Controls |
| --- | --- |
| General | Business identity, defaults, timezone, currency, numbering, receipt branding |
| Service | Confirmation, fulfillment, tabs, void reasons, queue alerts, business-day cutoff |
| Charges | Inclusive/exclusive calculation, precedence, rounding, overrides, effective dates, bill preview |
| Payments | Allowed methods, terminal references, manual confirmation permissions, gateway connection test; secrets excluded from client responses |
| Inventory | Units/conversions, negative stock, reorder levels, approvals, stocktake policy, storefront stock source |
| People | Role templates, login/lock rules, offline grants, invitation/session policies |
| Devices | Hub/tablet/prep/printer enrollment, scope, connection test, last seen, revoke and receipt retry queue |
| Notifications | Role-targeted low stock, stale tickets, pending payments, variances and sync failures; external channels only when configured |
| Sync & recovery | Last successful sync, queued/failed records, retry, backups, restore preview/verification; separate internet failure from hub failure |
| Audit & data | Actor/entity/action search, export permissions, retention and controlled customer deletion/anonymization |

Reports cover gross/net sales with definitions, payment methods/outstanding bills, item/category/storefront/vendor performance, theoretical/count stock, waste, purchasing, valuation, register discrepancies, staff activity, event comparison and venue trends. Every report exposes scope, business date, timezone, freshness, drill-down and export. Forecasts are labeled as estimates.

Customer history requires authorized staff scope or verified customer access; knowing a phone number is insufficient. Loyalty/promotions need eligibility, limits, reversals and consent handling.

## 12. Definition Of A Finished Page

- Real route, deep links/refresh, active navigation, breadcrumbs and back behavior.
- Search/filter/sort/pagination, persistent filters, meaningful empty states and authorized actions.
- Detail/edit/archive where appropriate, dependencies and history. Posted financial/stock documents use reversals.
- Form validation, save progress, field errors, unsaved changes, duplicate-submit protection and concurrent-edit handling.
- Loading, no-access, not-found, stale-data, reconnect and API failure states; no false success notices.
- Usable desktop manager and tablet service layouts, touch targets, keyboard/focus support and no overflow.
- Persisted scoped data, no dependence on seed resets or demo identities.
- UI/API acceptance scenarios include permission denial and failure paths. Visual similarity alone is not completion.

## 13. Data And Architecture Work

Preserve existing IDs/orders through migrations. Add models as their workflows are implemented:

- Structure: organization, venue, event, vendor allocation, scope, business day, shift and register.
- Access: identity, membership, scoped grant, staff profile, roster, attendance, device and session.
- Catalogue: product, menu version, modifier, stock item, conversion, recipe version, location and owner.
- Stock: reservation, movement, supplier, purchase/lines, receipt/lines, transfer/lines, count/lines, waste and approval.
- Commerce: independent states, bill/tab, deposit allocation, refund, settlement approval and versioned terms.

Add scoped list/detail/create/edit/archive contracts and workflow commands with server validation, pagination, idempotency and atomic updates. Do not power every new page from a global snapshot.

The local hub owns active local service and stock movements. Cloud Postgres owns organization administration and consolidated reporting. Design versioned configuration publishing, acknowledgement and conflict handling. Prevent multiple writers to one stock location without a coordination protocol. Cross-hub transfers stay pending until acknowledged; stock cannot appear available at both ends.

Use durable sync identities, a transactional outbox where appropriate, retry/deduplication, visible errors and tested recovery. Reconnect refreshes authoritative state before stale actions resume. A guest unable to reach a hub must not be told an offline order succeeded.

## 14. Delivery Milestones

These supersede the assumption that only hardening remains. Each receives its own implementation breakdown before coding, following the existing phase-document approach.

| Milestone | Deliverable | Exit demonstration |
| --- | --- | --- |
| A. Structure and access | Reference-based shell, real routes, unit context, authentication, scoped permissions, shared list/detail/form patterns and migrations | Different users navigate real pages; out-of-scope API calls fail; existing records remain intact |
| B. Business management | Venues/events/vendors/storefronts directories, edit/archive, relationships, allocations, readiness, floor/QR setup | Create venue and hosted event as distinct scopes; clone configuration without transactions |
| C. Menus and stock foundation | Products, menus, stock catalogue, units, ownership, locations, reservations, consumption and low stock | Publish menu, map stock, submit competing orders and verify exactly-once consumption |
| D. Stock operations | Suppliers, PO approvals, partial receipts, transfer receipt, waste, counts and variance approval | Complete the 240-bottle/48-bottle example; reconcile count during sales; retries do not duplicate stock |
| E. People management | Staff lifecycle, assignments, roles, roster, attendance, revocation and handover | Roster event/venue shifts; restrict assigned work; suspension preserves history and removes access |
| F. Service and finance | Complete POS/orders/prep/floor/delivery/guest flows, deposits, registers, refunds, settlements, close-out and real payment integration | Run service with partial payments, prepared-item cancellation, failed delivery, refund, variance and signed close-out |
| G. Operational release | Reports/settings, cloud Postgres, configuration publishing, sync/recovery, printers/devices, deployment/runbooks and regression tests | Internet outage preserves local service; resync deduplicates; backup restore and agreed pilot pass |
| H. Optional extensions | Recipes/batches/expiry, visual floor editor, richer loyalty/forecasting, combined vendor checkout, extended procurement | Separate acceptance per approved feature; pull recipes/expiry earlier when launch requires them |

Security and stock/financial invariants are built with their modules, not deferred to G. Avoid calendar estimates until migration scope and first-launch operation are agreed.

Recommended first slice: A plus the Venue directory/detail from B, establishing persisted management, editing and access before reusing those patterns for Events and Inventory.

## 15. Product Acceptance Scenarios

1. From an empty organization, a manager creates a venue, storefronts/staff/menu, receives stock, opens service, fulfills/settles an order and closes the day without database editing.
2. An organizer runs an event with two vendors, separate stock/staff/QR codes and isolated views; final statements reconcile to source transactions.
3. A stock controller completes partial receipt, transfer, waste and count variance; balances equal movement history and retries never corrupt quantities.
4. A cashier handles split/partial payment and approved refund; bill/register/ledger/settlement agree; pending never displays as confirmed.
5. Overnight service with overlapping shifts/registers closes against the correct business day without resetting stock or losing obligations.
6. Internet fails and returns; local service continues and cloud receives records once. Hub failure has an honest unavailable state and recovery procedure.
7. Reassignment/suspension changes API, realtime, exports and session access within documented connectivity guarantees.
8. A manager opens another device and resumes authorized pending work with meaningful history rather than browser-only state.

## 16. Business Decisions To Confirm

Proposed defaults support planning, not implied approval:

- First acceptance pair: a permanent bar and a multi-vendor event.
- Stock depth: packaged items first; bring ingredient/spirits recipes and expiry forward if essential at launch.
- Separate organization/vendor stock ownership even when co-located.
- Block overselling by default; overrides require permission, reason and visible exception.
- Include basic roster/attendance; defer payroll/HR.
- Include purchasing/receipts/returns; defer full supplier accounting.
- Separate vendor checkout initially, with shared discovery.
- Confirm settlement terms, provider capabilities, costing policy and approval thresholds before dependent calculations are implemented.
