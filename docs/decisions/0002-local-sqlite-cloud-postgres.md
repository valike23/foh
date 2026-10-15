# 0002: Local SQLite And Cloud Postgres

## Status

Accepted for MVP.

## Decision

Use SQLite for the local venue/event hub and Postgres for the future cloud platform.

## Context

The on-site hub must keep working during unreliable internet. The cloud platform must support multi-tenant reporting, users, permissions, ledger history, and cross-venue/event analytics.

## Local Hub

SQLite is the local source of truth during service.

Responsibilities:

- Orders.
- Payments and payment confirmation state.
- Inventory.
- Tables.
- Menus.
- Deposits/tabs.
- Audit trail.
- Sync queue.

## Cloud Platform

Postgres is the cloud source for platform history and reporting.

Responsibilities:

- Tenants and organizations.
- Users and permissions.
- Cross-event and cross-venue reporting.
- Ledger and settlement history.
- Long-term analytics.
- Backups and support visibility.

## Sync Direction

```text
Local hub SQLite -> sync queue -> cloud API -> cloud Postgres
```

The local hub remains usable if sync is delayed. Sync must be idempotent so retries do not duplicate orders, payments, inventory movements, or ledger entries.

## Consequences

- Phase 1 stays local-first.
- Phase 5 introduces cloud Postgres and sync worker.
- Records need stable IDs and later cloud ID mappings.
- Cloud reporting must tolerate delayed sync.

