import { randomUUID } from "node:crypto";
import { createSeedSnapshot, type HubSnapshot, type ManagedStorefront, type ManagedVendor, type FloorPlace } from "@exa-foh/shared";

export function provisionSnapshot(source: { id: string; name: string; address?: string; location?: string }, type: "event" | "venue", stores: ManagedStorefront[], vendors: ManagedVendor[], floor: FloorPlace[]): HubSnapshot {
  const snapshot = createSeedSnapshot();
  for (const key of Object.keys(snapshot)) if (key !== "event") (snapshot as unknown as Record<string, unknown>)[key] = [];
  snapshot.event = { id: source.id, name: source.name, venue: source.address ?? source.location ?? "", dateLabel: "", currency: "NGN", containerType: type, status: "setup", reportingCadence: type === "venue" ? "daily" : "event-closeout", defaultChargeRuleIds: [] };
  snapshot.vendors = vendors.filter(v => stores.some(s => s.vendorId === v.id)).map(v => ({ id: v.id, name: v.name, kind: v.kind === "internal" ? "organizer" : "third-party" }));
  snapshot.stores = stores.map(s => ({ id: s.id, eventId: source.id, vendorId: s.vendorId, name: s.name, kind: s.kind, manualConfirmation: s.manualConfirmation, prepStation: s.prepStation, fulfillment: s.fulfillment }));
  snapshot.sections = floor.filter(p => p.kind === "section").map(p => ({ id: p.id, eventId: source.id, label: p.name, zone: p.name, storeIds: stores.map(s => s.id) }));
  snapshot.tables = floor.filter(p => p.kind === "table").map(p => ({ id: p.id, storeId: p.storefrontId!, label: p.name, section: floor.find(s => s.id === p.parentId)?.name ?? "", status: "open", assignedWaiter: "" }));
  snapshot.seats = floor.filter(p => p.kind === "seat").map(p => ({ id: p.id, tableId: p.parentId!, sectionId: floor.find(t => t.id === p.parentId)?.parentId ?? "", label: p.name, status: "available" }));
  snapshot.vendorLedgerAccounts = snapshot.vendors.map(v => ({ id: randomUUID(), vendorId: v.id, currency: "NGN", status: "active" }));
  return snapshot;
}
export function openingBlockers(s: HubSnapshot) { return !s.stores.length ? ["Add an active storefront before publishing"] : s.stores.filter(store => !s.menuItems.some(m => m.storeId === store.id && m.available && s.inventory.some(i => i.id === m.stockItemId && i.quantity > 0))).map(store => `${store.name} needs menu items with stock`); }
export function closeoutBlockers(s: HubSnapshot) { return [s.orders.some(o => !["settled", "void", "rejected"].includes(o.status)) ? "Resolve all open orders" : "", s.payments.some(p => p.status === "pending-network") ? "Resolve pending payments" : "", s.registerSessions.some(r => r.status === "open") ? "Close open registers" : ""].filter(Boolean); }
