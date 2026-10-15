import cors from "cors";
import express from "express";
import { mkdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { type CloudIngestSummary, type HubSnapshot } from "@exa-foh/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.CLOUD_DB_PATH ?? join(__dirname, "../data/cloud.sqlite");
const port = Number(process.env.PORT ?? 4100);
const host = process.env.HOST ?? "127.0.0.1";

mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ingest_runs (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    tenant_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    source_hub_id TEXT NOT NULL,
    operating_unit_id TEXT NOT NULL,
    status TEXT NOT NULL,
    records_received INTEGER NOT NULL,
    records_upserted INTEGER NOT NULL,
    received_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cloud_records (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    source_hub_id TEXT NOT NULL,
    operating_unit_id TEXT NOT NULL,
    collection TEXT NOT NULL,
    local_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, operating_unit_id, collection, local_id)
  );

  CREATE TABLE IF NOT EXISTS backup_snapshots (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    source_hub_id TEXT NOT NULL,
    operating_unit_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const snapshotSchema = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  organizationName: z.string().min(1).default("EXA Organization"),
  organizationKind: z.enum(["exa", "organizer", "venue", "vendor"]).default("organizer"),
  sourceHubId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  snapshot: z.unknown()
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

function id(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function collectionEntries(snapshot: HubSnapshot): Array<{ collection: string; localId: string; payload: unknown }> {
  return [
    { collection: "events", localId: snapshot.event.id, payload: snapshot.event },
    ...snapshot.operatingPeriods.map((payload) => ({ collection: "operating_periods", localId: payload.id, payload })),
    ...snapshot.vendors.map((payload) => ({ collection: "vendors", localId: payload.id, payload })),
    ...snapshot.stores.map((payload) => ({ collection: "stores", localId: payload.id, payload })),
    ...snapshot.tables.map((payload) => ({ collection: "tables", localId: payload.id, payload })),
    ...snapshot.sections.map((payload) => ({ collection: "sections", localId: payload.id, payload })),
    ...snapshot.seats.map((payload) => ({ collection: "seats", localId: payload.id, payload })),
    ...snapshot.menuItems.map((payload) => ({ collection: "menu_items", localId: payload.id, payload })),
    ...snapshot.inventory.map((payload) => ({ collection: "inventory_items", localId: payload.id, payload })),
    ...snapshot.deposits.map((payload) => ({ collection: "deposits", localId: payload.id, payload })),
    ...snapshot.orders.map((payload) => ({ collection: "orders", localId: payload.id, payload })),
    ...snapshot.payments.map((payload) => ({ collection: "payments", localId: payload.id, payload })),
    ...snapshot.paymentConfirmations.map((payload) => ({ collection: "payment_confirmations", localId: payload.id, payload })),
    ...snapshot.paymentProviderEvents.map((payload) => ({ collection: "payment_provider_events", localId: payload.id, payload })),
    ...snapshot.vendorLedgerAccounts.map((payload) => ({ collection: "vendor_ledger_accounts", localId: payload.id, payload })),
    ...snapshot.ledgerEntries.map((payload) => ({ collection: "ledger_entries", localId: payload.id, payload })),
    ...snapshot.registerSessions.map((payload) => ({ collection: "register_sessions", localId: payload.id, payload })),
    ...snapshot.settlementBatches.map((payload) => ({ collection: "settlement_batches", localId: payload.id, payload })),
    ...snapshot.payouts.map((payload) => ({ collection: "payouts", localId: payload.id, payload })),
    ...snapshot.runnerAssignments.map((payload) => ({ collection: "runner_assignments", localId: payload.id, payload })),
    ...snapshot.deliveryRoutes.map((payload) => ({ collection: "delivery_routes", localId: payload.id, payload })),
    ...snapshot.customerProfiles.map((payload) => ({ collection: "customer_profiles", localId: payload.id, payload })),
    ...snapshot.loyaltyAccounts.map((payload) => ({ collection: "loyalty_accounts", localId: payload.id, payload })),
    ...snapshot.promotions.map((payload) => ({ collection: "promotions", localId: payload.id, payload })),
    ...snapshot.forecastMetrics.map((payload) => ({ collection: "forecast_metrics", localId: payload.id, payload })),
    ...snapshot.chargeRules.map((payload) => ({ collection: "charge_rules", localId: payload.id, payload })),
    ...snapshot.stockMovements.map((payload) => ({ collection: "stock_movements", localId: payload.id, payload })),
    ...snapshot.auditLog.map((payload) => ({ collection: "audit_logs", localId: payload.id, payload }))
  ];
}

function recordsForCollection<T>(collection: string): T[] {
  return (db.prepare("SELECT payload FROM cloud_records WHERE collection = ? ORDER BY updated_at DESC").all(collection) as Array<{ payload: string }>)
    .map((row) => JSON.parse(row.payload) as T);
}

app.get("/health", (_request, response) => {
  response.json({ ok: true, mode: "cloud-platform", persistence: "sqlite", dbPath });
});

app.post("/api/ingest/snapshot", (request, response) => {
  try {
    const input = snapshotSchema.parse(request.body);
    const snapshot = input.snapshot as HubSnapshot;
    const operatingUnitId = snapshot.event.id;
    const now = new Date().toISOString();

    const existing = db.prepare("SELECT * FROM ingest_runs WHERE idempotency_key = ?").get(input.idempotencyKey) as { id: string; records_received: number; records_upserted: number; received_at: string } | undefined;
    if (existing) {
      const latestBackup = db.prepare("SELECT id FROM backup_snapshots WHERE source_hub_id = ? ORDER BY created_at DESC LIMIT 1").get(input.sourceHubId) as { id: string } | undefined;
      response.json({
        runId: existing.id,
        status: "replayed",
        recordsReceived: existing.records_received,
        recordsUpserted: existing.records_upserted,
        backupId: latestBackup?.id ?? "",
        receivedAt: existing.received_at
      } satisfies CloudIngestSummary);
      return;
    }

    const organization = db.prepare("SELECT id FROM organizations WHERE id = ?").get(input.organizationId);
    if (!organization) {
      db.prepare(`
        INSERT INTO organizations (id, tenant_id, name, kind, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(input.organizationId, input.tenantId, input.organizationName, input.organizationKind, now);
    }

    const entries = collectionEntries(snapshot);
    const upsertRecord = db.prepare(`
      INSERT INTO cloud_records (
        id, tenant_id, organization_id, source_hub_id, operating_unit_id,
        collection, local_id, payload, payload_hash, first_seen_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, operating_unit_id, collection, local_id)
      DO UPDATE SET payload = excluded.payload, payload_hash = excluded.payload_hash, updated_at = excluded.updated_at
    `);
    const runId = id("ingest");
    const backupId = id("backup");
    const backupHash = hashPayload(snapshot);

    db.exec("BEGIN IMMEDIATE TRANSACTION;");
    try {
      let upserted = 0;
      for (const entry of entries) {
        const payloadHash = hashPayload(entry.payload);
        upsertRecord.run(
          id("cloudrec"),
          input.tenantId,
          input.organizationId,
          input.sourceHubId,
          operatingUnitId,
          entry.collection,
          entry.localId,
          JSON.stringify(entry.payload),
          payloadHash,
          now,
          now
        );
        upserted += 1;
      }
      db.prepare(`
        INSERT INTO backup_snapshots (
          id, tenant_id, organization_id, source_hub_id, operating_unit_id,
          payload, payload_hash, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(backupId, input.tenantId, input.organizationId, input.sourceHubId, operatingUnitId, JSON.stringify(snapshot), backupHash, now);
      db.prepare(`
        INSERT INTO ingest_runs (
          id, idempotency_key, tenant_id, organization_id, source_hub_id,
          operating_unit_id, status, records_received, records_upserted, received_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(runId, input.idempotencyKey, input.tenantId, input.organizationId, input.sourceHubId, operatingUnitId, "accepted", entries.length, upserted, now);
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }

    response.status(202).json({
      runId,
      status: "accepted",
      recordsReceived: entries.length,
      recordsUpserted: entries.length,
      backupId,
      receivedAt: now
    } satisfies CloudIngestSummary);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid cloud ingest" });
  }
});

app.get("/api/admin/operating-units", (_request, response) => {
  const events = recordsForCollection<HubSnapshot["event"]>("events");
  response.json(events.map((event) => ({
    id: event.id,
    name: event.name,
    venue: event.venue,
    containerType: event.containerType,
    status: event.status,
    reportingCadence: event.reportingCadence
  })));
});

app.get("/api/admin/reports/overview", (_request, response) => {
  const organizations = db.prepare("SELECT COUNT(*) as count FROM organizations").get() as { count: number };
  const operatingUnits = db.prepare("SELECT COUNT(*) as count FROM cloud_records WHERE collection = 'events'").get() as { count: number };
  const orders = recordsForCollection<HubSnapshot["orders"][number]>("orders");
  const payments = recordsForCollection<HubSnapshot["payments"][number]>("payments");
  const ledgerEntries = recordsForCollection<HubSnapshot["ledgerEntries"][number]>("ledger_entries");
  const lastRun = db.prepare("SELECT received_at FROM ingest_runs ORDER BY received_at DESC LIMIT 1").get() as { received_at: string } | undefined;

  const revenue = payments
    .filter((payment) => payment.status === "validated" || payment.status === "manually-confirmed")
    .reduce((sum, payment) => sum + payment.amount, 0);
  const ledgerBalance = ledgerEntries.reduce((sum, entry) =>
    entry.direction === "credit" ? sum + entry.amount : sum - entry.amount, 0);

  response.json({
    organizations: organizations.count,
    operatingUnits: operatingUnits.count,
    orders: orders.length,
    payments: payments.length,
    revenue,
    ledgerBalance,
    lastIngestedAt: lastRun?.received_at
  });
});

app.get("/api/backup/snapshots/:sourceHubId/latest", (request, response) => {
  const backup = db.prepare(`
    SELECT id, payload, payload_hash, created_at
    FROM backup_snapshots
    WHERE source_hub_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(request.params.sourceHubId) as { id: string; payload: string; payload_hash: string; created_at: string } | undefined;

  if (!backup) {
    response.status(404).json({ error: "Backup snapshot not found" });
    return;
  }

  response.json({
    id: backup.id,
    payloadHash: backup.payload_hash,
    createdAt: backup.created_at,
    snapshot: JSON.parse(backup.payload)
  });
});

httpServerListen();

function httpServerListen(): void {
  app.listen(port, host, () => {
    console.log(`EXA FOH cloud platform running on http://${host}:${port}`);
  });
}
