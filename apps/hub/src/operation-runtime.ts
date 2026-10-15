import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { createSeedSnapshot, type HubSnapshot, type ManagedEvent, type ManagedVenue, type ManagedStorefront, type ManagedVendor, type FloorPlace, type ScopeRef } from "@exa-foh/shared";

export class OperationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type OperationRuntime = { id: string; scope: ScopeRef; revision: number; snapshot: HubSnapshot };

export function createOperationStore(db: DatabaseSync, organizationId: string) {
  db.exec("CREATE TABLE IF NOT EXISTS operation_runtimes (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, data TEXT NOT NULL)");
  const cache = new Map<string, OperationRuntime>();
  function get(id: string): OperationRuntime | undefined {
    if (cache.has(id)) return cache.get(id);
    const row = db.prepare("SELECT data FROM operation_runtimes WHERE id = ? AND organization_id = ?").get(id, organizationId) as { data: string } | undefined;
    if (!row) return;
    const runtime = JSON.parse(row.data) as OperationRuntime;
    cache.set(id, runtime);
    return runtime;
  }
  function save(runtime: OperationRuntime) {
    const revision = runtime.revision + 1;
    db.prepare("INSERT INTO operation_runtimes VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
      .run(runtime.id, organizationId, JSON.stringify({ ...runtime, revision }));
    runtime.revision = revision;
    cache.set(runtime.id, runtime);
  }
  return { get, save };
}

export function provisionOperation(scope: ScopeRef, source: ManagedEvent | ManagedVenue, stores: ManagedStorefront[], vendors: ManagedVendor[], floor: FloorPlace[]): OperationRuntime {
  // Start with the shape, never the demo's transactions, quantities or identities.
  const snapshot = createSeedSnapshot();
  for (const key of Object.keys(snapshot) as (keyof HubSnapshot)[]) {
    if (key !== "event") (snapshot[key] as unknown[]) = [];
  }
  snapshot.event = { id: source.id, name: source.name, venue: "location" in source ? source.location : source.address,
    dateLabel: "startsAt" in source ? source.startsAt : "", currency: "NGN", containerType: scope.scopeType,
    status: "setup", reportingCadence: scope.scopeType === "event" ? "event-closeout" : "daily", defaultChargeRuleIds: [] };
  snapshot.vendors = vendors.filter(v => stores.some(s => s.vendorId === v.id)).map(v => ({ id: v.id, name: v.name, kind: v.kind === "internal" ? "organizer" : "third-party" }));
  snapshot.stores = stores.map(s => ({ id: s.id, eventId: source.id, vendorId: s.vendorId, name: s.name, kind: s.kind, manualConfirmation: s.manualConfirmation, prepStation: s.prepStation, fulfillment: s.fulfillment }));
  snapshot.sections = floor.filter(p => p.kind === "section").map(p => ({ id: p.id, eventId: source.id, label: p.name, zone: p.name,
    storeIds: stores.filter(s => s.sectionIds.includes(p.id) || floor.some(t => t.parentId === p.id && t.storefrontId === s.id)).map(s => s.id) }));
  snapshot.tables = floor.filter(p => p.kind === "table").map(p => ({ id: p.id, storeId: p.storefrontId!, label: p.name, section: floor.find(s => s.id === p.parentId)!.name, status: "open", assignedWaiter: "" }));
  snapshot.seats = floor.filter(p => p.kind === "seat").map(p => ({ id: p.id, tableId: p.parentId!, sectionId: floor.find(t => t.id === p.parentId)!.parentId!, label: p.name, status: "available" }));
  snapshot.vendorLedgerAccounts = snapshot.vendors.map(v => ({ id: randomUUID(), vendorId: v.id, currency: "NGN", status: "active" }));
  return { id: source.id, scope, revision: 0, snapshot };
}

export function openingBlockers(snapshot: HubSnapshot): string[] {
  const blockers: string[] = [];
  if (!snapshot.stores.length) blockers.push("Publish at least one active storefront");
  for (const store of snapshot.stores) {
    if (!snapshot.menuItems.some(item => item.storeId === store.id && item.available && snapshot.inventory.some(stock => stock.id === item.stockItemId && stock.storeId === store.id && stock.quantity > 0))) {
      blockers.push(`${store.name} needs an available menu item with stock`);
    }
  }
  return blockers;
}

export function closeoutBlockers(snapshot: HubSnapshot): string[] {
  const blockers: string[] = [];
  if (snapshot.orders.some(o => !["settled", "void", "rejected"].includes(o.status))) blockers.push("Resolve all open orders");
  if (snapshot.payments.some(p => p.status === "pending-network")) blockers.push("Resolve pending payments");
  if (snapshot.orders.some(o => o.status === "settled" && snapshot.payments.filter(p => p.orderId === o.id && ["validated", "manually-confirmed"].includes(p.status)).reduce((sum, p) => sum + p.amount, 0) < o.totals.total)) blockers.push("Reconcile unpaid settled orders");
  if (snapshot.registerSessions.some(r => r.status === "open")) blockers.push("Close all registers");
  if (snapshot.deposits.some(d => d.status === "active")) blockers.push("Resolve active deposits");
  if (snapshot.deliveryRoutes.some(r => !["delivered", "cancelled"].includes(r.status))) blockers.push("Resolve delivery routes");
  return blockers;
}

export function transitionOperation(runtime: OperationRuntime, action: "open" | "pause" | "close", actor: string, reason: string) {
  const snapshot = runtime.snapshot;
  const status = snapshot.event.status;
  if (action === "open") {
    if (!["setup", "paused", ...(snapshot.event.containerType === "venue" ? ["closed"] : [])].includes(status)) throw new OperationError(409, "This operation cannot be opened");
    const blockers = openingBlockers(snapshot);
    if (blockers.length) throw new OperationError(409, blockers.join(". "));
    if (!snapshot.operatingPeriods.some(p => p.status === "open")) snapshot.operatingPeriods.unshift({ id: randomUUID(), eventId: snapshot.event.id,
      type: snapshot.event.containerType === "venue" ? "venue-day" : "event-run", label: `${snapshot.event.name} ${new Date().toISOString().slice(0, 10)}`,
      status: "open", openedAt: new Date().toISOString(), openedBy: actor, openingCash: 0 });
    snapshot.event.status = "live";
  } else if (action === "pause") {
    if (status !== "live") throw new OperationError(409, "Only live service can be paused");
    snapshot.event.status = "paused";
  } else {
    if (!["live", "paused"].includes(status)) throw new OperationError(409, "Only live or paused service can close");
    const blockers = closeoutBlockers(snapshot);
    if (blockers.length) throw new OperationError(409, blockers.join(". "));
    snapshot.operatingPeriods = snapshot.operatingPeriods.map(p => p.status === "open" ? { ...p, status: "closed", closedAt: new Date().toISOString(), closedBy: actor, notes: reason } : p);
    snapshot.event.status = "closed";
  }
  snapshot.auditLog.unshift({ id: randomUUID(), actor, action: `Service ${action}: ${reason}`, createdAt: new Date().toISOString() });
}
