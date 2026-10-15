# EXA FOH

Local-network-first front-of-house system for EXA events and fixed venues.

This repo starts the MVP described in the system plan: an on-site local hub that can run order taking, BOH confirmation, guest QR ordering, inventory deduction, deposits/tabs, and cash/Paga payment states over a venue LAN.

The latest product plan is in [docs/EXA-FOH-Updated-Plan.md](docs/EXA-FOH-Updated-Plan.md). FOH now covers two operating modes that share one core engine:

- Events: one-off or short-run containers with close-out.
- Fixed venues: persistent bars, restaurants, clubs, lounges, and arenas with shifts/day close-out.

## Apps

- `apps/hub` - local venue hub API and realtime event stream.
- `apps/cloud` - local cloud-platform API for Phase 5 ingestion, backup snapshots, and cross-unit reporting.
- `apps/boh-dashboard` - Next.js + Tailwind BOH command dashboard for orders, payments, storefronts, tables, stock, vendors, and sync status.
- `apps/guest-order` - Next.js + Tailwind guest-facing QR ordering surface.
- `packages/shared` - shared TypeScript domain model, seed event data, currency formatting, and charge/deposit calculation.
- `packages/ui` - shadcn-style shared UI primitives used by the Next.js apps.

## Current MVP Loop

1. The hub starts with a seeded live event at Harbour Point, Lagos.
2. The guest app reads `?store=store-main-bar&table=table-14` and submits a self-order.
3. The hub records the order as `sent`, calculates charges, applies active deposit coverage, persists local state, and emits the updated snapshot over Socket.IO.
4. The BOH dashboard receives the order in the confirmation queue.
5. BOH can accept the order, move it through prep states, and record cash, POS, transfer, deposit-offset, or pending Paga payment.
6. Confirmed payments create payment confirmations and vendor ledger entries.
7. Inventory is deducted when an order becomes confirmed.
8. Admins can review settlement reports, draft payout batches, mark payouts paid, and close cash registers with variance.
9. Larger venues can use section/seat QR ordering, runner delivery routes, customer history, promo codes, and advanced reporting.
10. The hub can push an idempotent snapshot to the cloud-platform service for backup and cross-event reporting.
11. Cloud/Paga work is represented as a local sync queue, so event operations stay available when internet is down.

## Local Persistence

The hub now persists live event state to SQLite at:

```text
apps/hub/data/hub.sqlite
```

You can override the location with:

```bash
HUB_DB_PATH=/path/to/hub.sqlite npm run dev:hub
```

On first boot, the hub seeds the database. If the older JSON state file exists, the hub imports it once into SQLite.

## Run Locally

### Event Guest Appearance

Open **Events > select an event > Guest appearance** to configure its guest ordering page. Background colour or image (cover/tile), menu surface and accent colours, header artwork, built-in font families or uploaded WOFF/WOFF2 fonts, and up to 20 sponsor logos with optional HTTPS links are supported. Sponsors can be reordered or removed. Preview changes before saving; Reset appearance changes the draft until saved.

Images accept static PNG/JPEG/WebP up to 5 MB and 16 megapixels; the hub normalizes them to WebP. Fonts accept WOFF/WOFF2 up to 2 MB. Only upload fonts and artwork you are licensed to use. Media is stored in SQLite alongside versioned event appearance settings, with a 100 MB asset limit per event. Uploaded branding media is public by design. Include `guest_branding` and `guest_branding_assets` in whole-database backups; the legacy service-snapshot export does not include these tables.

Appearance changes are permitted for owners and assigned managers even after service configuration is published. Viewers have read-only access. Saving applies branding across the event's QR destinations, including the closed-service screen, without modifying stock, orders or payments. Active guest pages refresh saved appearance with their next menu poll. New or cloned events start with default appearance until configured.

The new management workspace opens at `/venues`, with first-owner setup at `/login`. Its one-time setup key is in `apps/hub/data/hub.sqlite.setup-key` after starting the hub. Choose your own owner credentials; no default password is included. The existing prototype service console is now at `/service`. See the [management foundation notes](docs/phases/milestone-a-management-foundation.md) for scope and remaining authentication migration work.

Management now also includes `/events`, `/vendors`, `/storefronts`, and `/floor`, with separate operation scopes, event cloning, floor configuration and downloadable QR codes. The [Milestone B notes](docs/phases/milestone-b-business-management.md) distinguish implemented setup workflows from pending live-runtime provisioning. New event setup does not automatically enable guest ordering.

Service sections have separate routes under `/service`: `command`, `sessions`, `setup`, `staff-order`, `prep`, `inventory`, `payments`, `ledger`, `cloud`, `runner`, `advanced`, `tables`, and `audit`. Each URL carries `?operation=<id>`; navigation preserves that selection. `/service?operation=<id>` redirects to Command, and entering a service page without an operation returns to `/operations`. Only the selected section is mounted. Command contains the overview, vendor revenue, order confirmation and live feed; the sync queue lives on Cloud.

Use Node.js 22.5 or newer. The local hub uses `node:sqlite` for SQLite persistence.

```bash
npm install
npm run build
npm run dev
```

Services:

- Cloud platform API: `http://localhost:4100`
- Hub API: `http://localhost:4000`
- BOH dashboard: `http://localhost:5173`
- Guest order: `http://localhost:5174/?store=store-main-bar&table=table-14`

To enable local hub push-sync while running services separately:

```bash
CLOUD_SYNC_URL=http://localhost:4100 npm run dev:hub
```

The hub and cloud services bind to `127.0.0.1` by default for local development. For a controlled venue LAN deployment, set `HOST=0.0.0.0` deliberately.

The dashboard and guest app use the same design direction as `/Users/samueladeyemi/Documents/GitHub/EXA/dashboard`: Next.js app router, TypeScript, Tailwind tokens, and shadcn-style component primitives.

## Useful API Calls

```bash
curl http://localhost:4000/health
curl http://localhost:4000/api/snapshot
curl http://localhost:4000/api/setup
curl http://localhost:4000/api/reports/settlement
curl http://localhost:4000/api/sync/status
curl http://localhost:4100/api/admin/reports/overview
```

Create a guest self-order:

```bash
curl -X POST http://localhost:4000/api/orders \
  -H 'Content-Type: application/json' \
  -d '{"storeId":"store-main-bar","tableId":"table-14","origin":"guest-self-order","customerName":"Demo Guest","createdBy":"Demo Guest","lines":[{"menuItemId":"item-heineken","quantity":2}]}'
```

Create setup data:

```bash
curl -X POST http://localhost:4000/api/stores \
  -H 'Content-Type: application/json' \
  -d '{"name":"VIP Lounge","kind":"bar","manualConfirmation":true}'

curl -X POST http://localhost:4000/api/menu-items \
  -H 'Content-Type: application/json' \
  -d '{"storeId":"store-main-bar","name":"Chapman","category":"Drinks","price":5000,"unit":"cups","quantity":40,"lowStockThreshold":10}'

curl -X POST http://localhost:4000/api/inventory/stock-water/adjustments \
  -H 'Content-Type: application/json' \
  -d '{"quantityDelta":12,"type":"restock","note":"Received more water"}'
```

## Phase Status

### Product Photos

Open an operation's **Inventory > Menu items** to add, replace or remove product photos. Static PNG, JPEG and WebP files up to 5 MB / 16 megapixels are normalized to WebP. Guest menus display responsive image cards with quantity controls; products without photos show a placeholder. Changes appear on the next menu refresh.

Photos are public assets stored in the `menu_images` SQLite table (100 MB per operation, including retained older versions). Include this table in whole-database backups: legacy JSON snapshots and cloud snapshot sync contain image references, not image files. Photo mutations require operation management access and are blocked after close-out.

Follow the phased roadmap in [docs/EXA-FOH-Updated-Plan.md](docs/EXA-FOH-Updated-Plan.md). Each phase has its own breakdown under [docs/phases](docs/phases).

Phase 0 implementation notes are in [docs/phase-0-baseline.md](docs/phase-0-baseline.md), with decision records under [docs/decisions](docs/decisions).

Implemented:

- [Phase 0: Product Decisions And Technical Baseline](docs/phases/phase-0-product-decisions-and-technical-baseline.md)
- [Phase 1: Local Operating Loop](docs/phases/phase-1-local-operating-loop.md)
- [Phase 2: Roles, Access, And Multi-Sided UX](docs/phases/phase-2-roles-access-and-multi-sided-ux.md)
- [Phase 3: Event/Venue Unification](docs/phases/phase-3-event-venue-unification.md)
- [Phase 4: Payments, Confirmations, And Ledger](docs/phases/phase-4-payments-confirmations-and-ledger.md)
- [Phase 5: Cloud Platform And Sync](docs/phases/phase-5-cloud-platform-and-sync.md)
- [Phase 6: Advanced Venue And Customer Features](docs/phases/phase-6-advanced-venue-and-customer-features.md)

Phase 0-6 provide prototype coverage, not complete operational workflows. The dashboard still needs real management pages and full inventory, purchasing, staffing, venue/event and close-out flows, alongside production hardening. The [Operations Product Plan](docs/EXA-FOH-Operations-Product-Plan.md) defines those pages, workflows, settings, acceptance criteria and delivery milestones.
