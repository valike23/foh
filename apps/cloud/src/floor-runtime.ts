import type { FloorPlace, HubSnapshot } from "@exa-foh/shared";
import { WorkspaceError } from "./workspace-access.js";

export function refreshFloor(snapshot: HubSnapshot, configured: FloorPlace[]) {
  const active = configured.filter(p => p.status === "active");
  const sections = active.filter(p => p.kind === "section"); const tables = active.filter(p => p.kind === "table"); const seats = active.filter(p => p.kind === "seat");
  for (const table of tables) {
    if (!sections.some(s => s.id === table.parentId) || !snapshot.stores.some(s => s.id === table.storefrontId)) throw new WorkspaceError(422, "Every active table needs an active section and a published storefront.");
    if (seats.filter(s => s.parentId === table.id).length > table.capacity) throw new WorkspaceError(422, "Table capacity cannot be smaller than its active seat count.");
  }
  for (const seat of seats) if (!tables.some(t => t.id === seat.parentId && t.storefrontId === seat.storefrontId) || seat.capacity !== 1) throw new WorkspaceError(422, "Every active seat needs an active table with the same storefront and capacity one.");
  // Existing orders retain their floor references, even when service is closed.
  for (const order of snapshot.orders) {
    if (order.tableId && !tables.some(t => t.id === order.tableId && t.storefrontId === order.storeId)) throw new WorkspaceError(409, "A table used by an order cannot be archived or moved to another storefront.");
    if (order.seatId && !seats.some(s => s.id === order.seatId && s.parentId === order.tableId)) throw new WorkspaceError(409, "A seat used by an order cannot be archived or moved to another table.");
  }
  snapshot.sections = sections.map(p => ({ id: p.id, eventId: snapshot.event.id, label: p.name, zone: p.name, storeIds: snapshot.stores.map(s => s.id) }));
  snapshot.tables = tables.map(p => ({ id: p.id, storeId: p.storefrontId!, label: p.name, section: sections.find(s => s.id === p.parentId)!.name, status: snapshot.tables.find(t => t.id === p.id)?.status ?? "open", assignedWaiter: snapshot.tables.find(t => t.id === p.id)?.assignedWaiter ?? "" }));
  snapshot.seats = seats.map(p => ({ id: p.id, tableId: p.parentId!, sectionId: tables.find(t => t.id === p.parentId)!.parentId!, label: p.name, status: snapshot.seats.find(s => s.id === p.id)?.status ?? "available" }));
}
