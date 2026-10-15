# Phase 0 Baseline

This file records what Phase 0 has locked in for the current prototype.

## Runtime Baseline

- Node.js 22.5 or newer.
- Next.js app router for BOH and guest apps.
- TypeScript across apps and shared packages.
- Tailwind CSS with shadcn-style shared primitives.
- Local hub API using Express and Socket.IO.
- Local persistence using SQLite through `node:sqlite`.

## Current Apps

- `apps/hub`: local hub API and realtime event stream.
- `apps/boh-dashboard`: operator dashboard.
- `apps/guest-order`: QR guest ordering.
- `packages/shared`: shared domain types, seed data, totals calculation.
- `packages/ui`: shared UI primitives.

## Current Verification

Run:

```bash
npm run verify:phase0
```

This runs typechecking and production builds for the current workspace.

For live smoke testing, run:

```bash
npm run dev
```

Then check:

- Hub API: `http://localhost:4000/health`
- BOH dashboard: `http://localhost:5173`
- Guest order: `http://localhost:5174/?store=store-main-bar&table=table-14`

## Event To Operating Unit Audit

The current code still uses `Event`. That is intentional for Phase 0.

Known event-shaped areas:

- `packages/shared/src/index.ts`: `Event`, `eventId`, and `HubSnapshot.event`.
- `packages/shared/src/index.ts`: seed data creates the current live demo event.
- `apps/hub/src/server.ts`: health, setup, order, payment, store creation, and charge rules read from `snapshot.event`.
- `apps/hub/src/db.ts`: SQLite collection is named `events`.

Phase 3 should add the operating-unit fields before any broad rename:

- `containerType: "event" | "venue"`.
- Lifecycle state.
- Reporting cadence.
- Operating periods for event runs, venue days, shifts, and register sessions.

## Phase 0 Decisions

- [Unified Operating Unit](decisions/0001-unified-operating-unit.md)
- [Local SQLite And Cloud Postgres](decisions/0002-local-sqlite-cloud-postgres.md)
- [MVP Wallet And Ledger Path](decisions/0003-mvp-wallet-and-ledger-path.md)

