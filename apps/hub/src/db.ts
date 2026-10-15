import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { createSeedSnapshot, type HubSnapshot } from "@exa-foh/shared";
import { installMockProductImages } from "./mock-product-images.js";

const collections = [
  "events",
  "operating_periods",
  "vendors",
  "users",
  "staff_assignments",
  "device_sessions",
  "stores",
  "tables",
  "sections",
  "seats",
  "menu_items",
  "inventory_items",
  "deposits",
  "orders",
  "payments",
  "payment_confirmations",
  "payment_provider_events",
  "vendor_ledger_accounts",
  "ledger_entries",
  "register_sessions",
  "settlement_batches",
  "payouts",
  "runner_assignments",
  "delivery_routes",
  "customer_profiles",
  "loyalty_accounts",
  "promotions",
  "forecast_metrics",
  "charge_rules",
  "stock_movements",
  "audit_logs",
  "sync_queue"
] as const;

type Collection = (typeof collections)[number];

type StoredDocument = {
  id: string;
  data: string;
};

export type HubDatabase = {
  dbPath: string;
  loadSnapshot: () => HubSnapshot;
  saveSnapshot: (snapshot: HubSnapshot) => void;
};

export function createHubDatabase(dbPath: string, legacyJsonPath?: string): HubDatabase {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  ensureSchema(db);

  if (isEmpty(db)) {
    const legacySnapshot = legacyJsonPath && existsSync(legacyJsonPath)
      ? JSON.parse(readFileSync(legacyJsonPath, "utf8")) as HubSnapshot
      : null;
    writeSnapshot(db, legacySnapshot ?? createSeedSnapshot());
  }

  installMockProductImages(db);

  return {
    dbPath,
    loadSnapshot: () => readSnapshot(db),
    saveSnapshot: (snapshot) => writeSnapshot(db, snapshot)
  };
}

function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hub_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  for (const collection of collections) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${collection} (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  db.prepare(`
    INSERT INTO hub_meta (key, value)
    VALUES ('schema_version', '1')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run();
}

function isEmpty(db: DatabaseSync): boolean {
  const row = db.prepare("SELECT COUNT(*) as count FROM events").get() as { count: number };
  return row.count === 0;
}

function readCollection<T>(db: DatabaseSync, collection: Collection): T[] {
  return (db.prepare(`SELECT id, data FROM ${collection}`).all() as StoredDocument[]).map((row) => JSON.parse(row.data) as T);
}

function writeCollection<T extends { id: string }>(db: DatabaseSync, collection: Collection, documents: T[]): void {
  db.prepare(`DELETE FROM ${collection}`).run();
  const insert = db.prepare(`
    INSERT INTO ${collection} (id, data, created_at, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);

  for (const document of documents) {
    insert.run(document.id, JSON.stringify(document));
  }
}

function readSnapshot(db: DatabaseSync): HubSnapshot {
  const [event] = readCollection<HubSnapshot["event"]>(db, "events");
  const seeded = createSeedSnapshot();

  if (!event) {
    writeSnapshot(db, seeded);
    return seeded;
  }

  const users = readCollection<HubSnapshot["users"][number]>(db, "users");
  const staffAssignments = readCollection<HubSnapshot["staffAssignments"][number]>(db, "staff_assignments");
  const vendors = readCollection<HubSnapshot["vendors"][number]>(db, "vendors");
  const seededAccounts = vendors.map((vendor) => ({
    id: `ledger-${vendor.id}`,
    vendorId: vendor.id,
    currency: "NGN" as const,
    status: "active" as const
  }));
  const vendorLedgerAccounts = readCollection<HubSnapshot["vendorLedgerAccounts"][number]>(db, "vendor_ledger_accounts");

  return {
    event,
    operatingPeriods: readCollection<HubSnapshot["operatingPeriods"][number]>(db, "operating_periods").sort((a, b) => b.openedAt.localeCompare(a.openedAt)),
    vendors,
    users: users.length ? users : seeded.users,
    staffAssignments: staffAssignments.length ? staffAssignments : seeded.staffAssignments,
    deviceSessions: readCollection<HubSnapshot["deviceSessions"][number]>(db, "device_sessions"),
    stores: readCollection(db, "stores"),
    tables: readCollection(db, "tables"),
    sections: readCollection(db, "sections"),
    seats: readCollection(db, "seats"),
    menuItems: readCollection(db, "menu_items"),
    inventory: readCollection(db, "inventory_items"),
    deposits: readCollection(db, "deposits"),
    orders: readCollection<HubSnapshot["orders"][number]>(db, "orders").sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    payments: readCollection<HubSnapshot["payments"][number]>(db, "payments").sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    paymentConfirmations: readCollection<HubSnapshot["paymentConfirmations"][number]>(db, "payment_confirmations").sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt)),
    paymentProviderEvents: readCollection<HubSnapshot["paymentProviderEvents"][number]>(db, "payment_provider_events").sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
    vendorLedgerAccounts: vendorLedgerAccounts.length ? vendorLedgerAccounts : seededAccounts,
    ledgerEntries: readCollection<HubSnapshot["ledgerEntries"][number]>(db, "ledger_entries").sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    registerSessions: readCollection<HubSnapshot["registerSessions"][number]>(db, "register_sessions").sort((a, b) => b.openedAt.localeCompare(a.openedAt)),
    settlementBatches: readCollection<HubSnapshot["settlementBatches"][number]>(db, "settlement_batches").sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    payouts: readCollection<HubSnapshot["payouts"][number]>(db, "payouts").sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    runnerAssignments: readCollection(db, "runner_assignments"),
    deliveryRoutes: readCollection<HubSnapshot["deliveryRoutes"][number]>(db, "delivery_routes").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    customerProfiles: readCollection<HubSnapshot["customerProfiles"][number]>(db, "customer_profiles").sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)),
    loyaltyAccounts: readCollection(db, "loyalty_accounts"),
    promotions: readCollection(db, "promotions"),
    forecastMetrics: readCollection<HubSnapshot["forecastMetrics"][number]>(db, "forecast_metrics").sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)),
    chargeRules: readCollection(db, "charge_rules"),
    stockMovements: readCollection<HubSnapshot["stockMovements"][number]>(db, "stock_movements").sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    auditLog: readCollection<HubSnapshot["auditLog"][number]>(db, "audit_logs").sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    syncQueue: readCollection<HubSnapshot["syncQueue"][number]>(db, "sync_queue").sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  };
}

function writeSnapshot(db: DatabaseSync, snapshot: HubSnapshot): void {
  db.exec("BEGIN IMMEDIATE TRANSACTION;");
  try {
    writeCollection(db, "events", [snapshot.event]);
    writeCollection(db, "operating_periods", snapshot.operatingPeriods ?? []);
    writeCollection(db, "vendors", snapshot.vendors);
    writeCollection(db, "users", snapshot.users ?? []);
    writeCollection(db, "staff_assignments", snapshot.staffAssignments ?? []);
    writeCollection(db, "device_sessions", snapshot.deviceSessions ?? []);
    writeCollection(db, "stores", snapshot.stores);
    writeCollection(db, "tables", snapshot.tables);
    writeCollection(db, "sections", snapshot.sections ?? []);
    writeCollection(db, "seats", snapshot.seats ?? []);
    writeCollection(db, "menu_items", snapshot.menuItems);
    writeCollection(db, "inventory_items", snapshot.inventory);
    writeCollection(db, "deposits", snapshot.deposits);
    writeCollection(db, "orders", snapshot.orders);
    writeCollection(db, "payments", snapshot.payments);
    writeCollection(db, "payment_confirmations", snapshot.paymentConfirmations ?? []);
    writeCollection(db, "payment_provider_events", snapshot.paymentProviderEvents ?? []);
    writeCollection(db, "vendor_ledger_accounts", snapshot.vendorLedgerAccounts ?? []);
    writeCollection(db, "ledger_entries", snapshot.ledgerEntries ?? []);
    writeCollection(db, "register_sessions", snapshot.registerSessions ?? []);
    writeCollection(db, "settlement_batches", snapshot.settlementBatches ?? []);
    writeCollection(db, "payouts", snapshot.payouts ?? []);
    writeCollection(db, "runner_assignments", snapshot.runnerAssignments ?? []);
    writeCollection(db, "delivery_routes", snapshot.deliveryRoutes ?? []);
    writeCollection(db, "customer_profiles", snapshot.customerProfiles ?? []);
    writeCollection(db, "loyalty_accounts", snapshot.loyaltyAccounts ?? []);
    writeCollection(db, "promotions", snapshot.promotions ?? []);
    writeCollection(db, "forecast_metrics", snapshot.forecastMetrics ?? []);
    writeCollection(db, "charge_rules", snapshot.chargeRules);
    writeCollection(db, "stock_movements", snapshot.stockMovements);
    writeCollection(db, "audit_logs", snapshot.auditLog ?? []);
    writeCollection(db, "sync_queue", snapshot.syncQueue);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}
