# Milestone A: Management Foundation And Venue Slice

Source: [Operations Product Plan](../EXA-FOH-Operations-Product-Plan.md).

## Scope Of This Slice

- Real management routes and reference-based sidebar, separate from the existing service console.
- Password-backed management identity, HTTP-only browser sessions, logout and server-side venue grants.
- Venue directory with query/status/sort/page in URL.
- Persisted venue create, detail, edit, weekly hours, status transitions and history.
- Migration preserves the existing event and transactions; imports only its venue identity with an explicit service link.
- Optimistic version checks and archive guards for linked service obligations.
- Idempotent venue creation from the management UI, so retrying an uncertain response does not duplicate the venue.

## First Owner Setup

The hub creates a one-time setup key at `apps/hub/data/hub.sqlite.setup-key` (or `<HUB_DB_PATH>.setup-key`). Open `/login`, use this key, and choose the owner's name, email and password (at least 12 characters). The key is removed after successful setup. No default owner password is shipped.

For isolated automated environments, `EXA_SETUP_KEY` can specify the first key. It never overrides an existing account or existing setup key.

Management sessions last 12 hours. Passwords use salted scrypt hashes; sessions store only token hashes. The browser receives an HTTP-only, SameSite=Strict cookie through the Next.js proxy. HTTPS enables Secure cookies. Mutations require same-origin JSON requests. Login/setup requests are throttled. Production recovery/password reset and session administration remain pending.

## Data Ownership

New management tables share the hub database but are independent from the prototype snapshot rewrite. Venue writes and their history commit together. This is local management persistence, not yet cloud configuration publishing. Existing cloud snapshot backups do not include management tables; retain a SQLite database backup until that integration is implemented.

Only the owner creates venues. Managers may edit assigned venues; viewers may read assigned venues. Account/grant administration UI is a subsequent slice. Imported venue profiles start as draft because an event's live state does not establish complete permanent-venue configuration.

## Remaining Work Before Milestone A Is Complete

- Migrate legacy service APIs/realtime to authenticated, scoped sessions; the old role-selector service console remains prototype-only.
- Staff enrollment, grant management, account recovery and device/offline credential lifecycle.
- Organization configuration, full operating-context selection and multiple active operating units.
- Move remaining service sections into dedicated routes with complete workflows.
- Cloud Postgres/configuration publishing and management-inclusive backup/restore.

## Remaining Venue Work

Storefront/vendor assignments, persistent floor tools, live service provisioning for newly created venues, readiness beyond profile fields, and full business-day management remain Milestone B work. Creating a venue profile does not automatically start a new hub service. Venue registry status and linked service state are separate.

## Validation

`npm run test:management -w @exa-foh/hub` builds shared/hub and runs isolated API regression tests. Tests cover authentication, scope denial, deactivation, validation, create/edit, stale writes, lifecycle, archive blockers, audit history, persistence, idempotent migration and legacy-record preservation.

Browser acceptance: first-owner setup, login/logout, directory search, create venue, edit address/hours, activity history, archive/restore, deep links, small-screen navigation and form layout.

Verified with `scripts/verify-management-ui.mjs` using isolated hub/Next servers and Playwright at desktop and 390px mobile widths. Set `PLAYWRIGHT_MODULE` to an installed Playwright module path and optionally `CHROME_PATH` to an installed browser executable. The script does not create accounts or test venues in the live database.
