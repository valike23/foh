# Phase 5: Cloud Platform And Sync

## Goal

Turn local hub operations into a multi-tenant EXA platform with cloud reporting, backup, and support visibility.

## Product Outcome

Local hubs can operate independently, then sync orders, payments, inventory, and reports into a cloud Postgres backend for long-term platform operations.

## Build Scope

- Cloud Postgres schema.
- Tenant and organization model.
- Sync worker from local SQLite to cloud Postgres.
- Idempotent sync records.
- Retry/backoff and failure visibility.
- Cross-event and cross-venue reporting.
- Vendor onboarding and organization management.
- Cloud backup and restore path.

## Implementation Status

Implemented as a local cloud-platform MVP slice.

- Added `apps/cloud`, a separate Express/TypeScript cloud service that runs on port `4100`.
- The cloud service uses SQLite as a local stand-in for the future Postgres backend while preserving the intended tenant, organization, operating-unit, and ingestion boundaries.
- Added idempotent snapshot ingestion at `POST /api/ingest/snapshot`.
- Cloud records are stored by stable local IDs under tenant, organization, source hub, operating unit, collection, and local ID.
- Cloud backups are stored on every accepted ingest and can be retrieved by source hub.
- Added cloud overview reporting for organizations, operating units, orders, payments, revenue, and ledger balance.
- Expanded local hub sync queue metadata with attempts, last attempt, retry timing, cloud IDs, and error messages.
- Added local hub sync endpoints for status, manual push sync, failed-item retry, local backup export, and cloud overview proxying.
- Added a BOH cloud sync console for cloud health, manual sync, retry, local backup hash, sync queue inspection, and cloud admin overview.

## Cloud Model

- EXA platform tenant.
- Organizer organization.
- Venue organization.
- Vendor organization.
- Users and memberships.
- Operating units.
- Operating periods.
- Orders, payments, inventory, ledger, and audit records.

## Sync Principles

- Local hub remains the live source of truth during service.
- Every synced record has a stable local ID and cloud ID mapping.
- Sync must be idempotent.
- Sync should resume after internet loss.
- Failed sync should be visible to operators.
- Cloud reporting should tolerate delayed records.

## Data Work

- Postgres schema aligned with local domain.
- Sync queue expansion.
- Conflict-safe ID strategy.
- Sync status table.
- Cloud import checkpoints.
- Backup snapshots for local hub data.

Current local implementation:

- `apps/cloud/data/cloud.sqlite` stores organizations, ingest runs, cloud records, and backup snapshots.
- `apps/hub/data/hub.sqlite` remains the local live source of truth.
- `CLOUD_SYNC_URL` controls whether the local hub can push into the cloud service.

## API Work

- Cloud ingestion endpoints.
- Local sync worker.
- Sync status endpoint.
- Tenant management endpoints.
- Cloud reporting endpoints.
- Restore/bootstrap endpoint later.

Implemented local endpoints:

Cloud service:

- `GET /health`
- `POST /api/ingest/snapshot`
- `GET /api/admin/operating-units`
- `GET /api/admin/reports/overview`
- `GET /api/backup/snapshots/:sourceHubId/latest`

Local hub:

- `GET /api/sync/status`
- `POST /api/sync/run`
- `POST /api/sync/retry-failed`
- `GET /api/backups/local`
- `GET /api/cloud/reports/overview`

## UI Work

- Sync health panel.
- Cloud admin dashboard.
- Organization and venue/event list.
- Cross-event/venue reporting.
- Vendor onboarding management.
- Backup and restore status.

## Verification

- Local hub can create records offline and sync later.
- Replayed sync batches do not duplicate orders or payments.
- Cloud dashboards show synced events/venues.
- Sync failures are visible and retryable.
- Backup and restore path is tested on a demo hub.

## Risks

- Conflict handling can get complex if cloud writes back to local during service.
- Network instability is normal in live venues; retry design matters.
- Reporting must account for delayed sync.
- Cloud auth and local auth need a clean boundary.

Deferred past this phase:

- Production Postgres migrations.
- Authenticated cloud API keys and per-tenant RBAC.
- Automatic background sync loop.
- Cloud-to-local restore/bootstrap.
- Conflict resolution for cloud-originated writes.
- Vendor self-service onboarding screens.

## Exit Criteria

- Local hub operates independently.
- Cloud receives local operational records idempotently.
- EXA admin can see events and venues across tenants.
- Sync failures are observable.
- A basic backup and restore path exists.
