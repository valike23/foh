# Phase 2: Roles, Access, And Multi-Sided UX

## Goal

Turn the app from a shared dashboard into a three-sided platform for Admin, Vendor, and Customer users.

## Product Outcome

Each user sees only the workflows and data appropriate to their role, and API enforcement protects vendor, financial, and operational boundaries.

## Implementation Status

Phase 2 is implemented as a local/offline role and access layer. The hub now seeds local users, store assignments, and device sessions; API reads are scoped by the selected user; and mutating endpoints enforce role and store permissions. The BOH dashboard includes a role selector so Admin, Vendor Manager, Prep, Waiter, and Cashier views can be tested against the same local hub.

## User Types

- EXA admin.
- Organizer or venue owner.
- Vendor owner or manager.
- Store operator.
- Waiter.
- Cashier.
- Kitchen/bar prep staff.
- Runner later.
- Customer/guest.

## Build Scope

- User and staff model.
- Role and permission model.
- Device/session model for local venue hardware.
- Auth flow for BOH users.
- Vendor-scoped dashboard.
- Admin-scoped aggregate dashboard.
- Prep-only mode.
- Cashier/waiter scopes.
- Vendor onboarding basics.

## Permission Model

- Admin can manage setup, users, financial reports, and aggregate activity.
- Vendor can manage own menu, own stock, own orders, own reports.
- Store operator can operate assigned store queues.
- Prep staff can see and update prep state but not financial totals.
- Waiter can create and manage assigned table/order flows.
- Cashier can confirm permitted payment methods and close register sessions later.
- Customer can only submit and inspect their own order/session.

## API Work

- Auth endpoints.
- Session management.
- Role assignment endpoints.
- Permission checks in hub routes.
- Store/vendor scoping in every read and write.
- Audit log user attribution.
- Device registration for tablets and local stations.

Implemented:

- `GET /api/users`
- `GET /api/session`
- `POST /api/auth/device-sessions`
- Scoped `GET /api/snapshot`
- Scoped `GET /api/setup`
- Role checks on setup, menu, inventory, order, status, and payment endpoints.
- Store assignment checks on store-scoped reads and writes.
- Financial redaction for prep/waiter-style views.

## UI Work

- Sign-in or device unlock screen.
- Role-aware BOH shell.
- Admin dashboard.
- Vendor dashboard.
- Prep/KDS screen with restricted data.
- Waiter/cashier screen with fast order creation and settlement.
- Vendor onboarding/setup flow.

Implemented:

- BOH role selector backed by local seeded users.
- Device session creation when switching users.
- Role-scoped snapshot loading and realtime socket subscription.
- Admin sees full setup, revenue, payments, audit, and all stores.
- Vendor Manager sees assigned store data and financials.
- Prep sees assigned prep/orders without financial totals or payments.
- Waiter sees assigned ordering/prep workflow.
- Cashier sees assigned orders and payment confirmation.

## Data Model Work

- `User`.
- `Role`.
- `Permission`.
- `StaffAssignment`.
- `DeviceSession`.
- `VendorMembership`.
- `AuditActor`.

Implemented:

- `User`
- `RoleName`
- `StaffAssignment`
- `DeviceSession`
- Audit actor attribution through the selected local user.

Deferred:

- Fine-grained permission objects.
- Vendor membership beyond local staff assignment.
- Cloud identity/provider integration.

## Verification

- Vendor A cannot access Vendor B data through UI or API.
- Prep role cannot see payment totals or reports.
- Cashier can confirm allowed payments only.
- Waiter can create orders only for permitted tables/stores.
- Admin can see aggregate activity.
- Audit entries show actor identity for manual actions.

## Risks

- UI-only permission checks are not enough.
- Local device auth must remain usable when internet is unavailable.
- Vendor-scoped data leaks can happen through aggregate endpoints.
- Staff workflows should not become slow because of auth friction.

## Exit Criteria

- Role-scoped app experiences exist.
- API enforces the same permissions as the UI.
- Vendor data isolation is testable.
- Staff/device sessions work locally.
- Audit logs identify who performed important actions.

Current caveat:

- This is a local-first access model for the hub. Production-grade authentication, passwords/PINs, cloud identity, and full permission management remain future work.
