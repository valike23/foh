import type { PrismaClient, StaffAssignment, Tenant } from "@prisma/client";
import type { HubSnapshot, Order } from "@exa-foh/shared";
import type { Request } from "express";

export type Identity = { tenant: Tenant; user: { id: string; name: string; email: string; role: string }; access?: WorkspaceAccess };
export class WorkspaceError extends Error { constructor(public status: number, message: string, public action?: { label: string; href: string }) { super(message); } }
const deny = (): never => { throw new WorkspaceError(403, "You do not have permission for this venue or storefront"); };
const managers = ["venue-manager", "storefront-manager"];
export class WorkspaceAccess {
  constructor(public owner: boolean, public assignments: StaffAssignment[], public stores: { id: string; venueId: string | null; eventId: string | null; vendorId: string }[], public events: any[]) {}
  venueOf(type: string, id: string): string | null { return type === "venue" ? id : this.events.find(e => e.id === id)?.venueId ?? null; }
  roles(storeId: string): string[] {
    const store = this.stores.find(s => s.id === storeId); if (!store) return [];
    const venue = store.venueId ?? this.venueOf("event", store.eventId!);
    return this.assignments.filter(a => a.storefrontId === storeId || (a.venueId && a.venueId === venue)).map(a => a.role);
  }
  store(id: string, roles?: string[]) { return this.owner || this.roles(id).some(r => !roles || roles.includes(r)); }
  venue(id: string, write = false) { return this.owner || this.assignments.some(a => a.venueId === id && (!write || a.role === "venue-manager")) || (!write && this.stores.some(s => (s.venueId === id || this.venueOf("event", s.eventId!) === id) && this.store(s.id))); }
  scope(type: string, id: string, write = false) { const v = this.venueOf(type, id); return this.owner || (!!v && this.assignments.some(a => a.venueId === v && (!write || a.role === "venue-manager"))) || (!write && this.stores.some(s => (type === "venue" ? s.venueId === id : s.eventId === id) && this.store(s.id))); }
  visible(kind: string, r: any): boolean {
    if (this.owner) return true;
    if (kind === "venues") return this.venue(r.id);
    if (kind === "events") return this.scope("event", r.id);
    if (kind === "storefronts") return this.store(r.id);
    if (kind === "vendors") return this.stores.some(s => s.vendorId === r.id && this.store(s.id));
    if (kind === "floor") return r.storefrontId ? this.store(r.storefrontId) : this.scope(r.scopeType, r.scopeId);
    return false;
  }
  editable(kind: string, r: any): boolean {
    if (this.owner) return true;
    if (kind === "venues") return this.venue(r.id, true);
    if (kind === "events") return this.scope("event", r.id, true);
    if (kind === "storefronts") return this.store(r.id, managers);
    if (kind === "floor") return this.scope(r.scopeType, r.scopeId, true);
    return false;
  }
  order(v: Order): Order {
    return this.store(v.storeId, [...managers, "cashier"]) ? v : { ...v, lines: v.lines.map(l => ({ ...l, unitPrice: 0, modifiers: l.modifiers.map(m => ({ ...m, priceDelta: 0 })) })), totals: { subtotal: 0, charges: [], depositApplied: 0, total: 0, balanceDue: 0 } };
  }
  snapshot(s: HubSnapshot): HubSnapshot {
    if (this.owner) return s;
    const stores = s.stores.filter(v => this.store(v.id)); const ids = new Set(stores.map(v => v.id));
    const finance = (id: string) => this.store(id, [...managers, "cashier"]);
    const tables = s.tables.filter(t => ids.has(t.storeId)); const vendorIds = new Set(stores.map(v => v.vendorId));
    const result = JSON.parse(JSON.stringify(s)) as HubSnapshot;
    // Clear everything first so new snapshot collections cannot accidentally expose other outlets.
    for (const key of Object.keys(result)) if (key !== "event") (result as any)[key] = [];
    result.stores = stores; result.vendors = s.vendors.filter(v => vendorIds.has(v.id));
    result.tables = tables; result.sections = s.sections.filter(v => v.storeIds.some(id => ids.has(id))).map(v => ({ ...v, storeIds: v.storeIds.filter(id => ids.has(id)) }));
    result.seats = s.seats.filter(v => tables.some(t => t.id === v.tableId));
    result.menuItems = s.menuItems.filter(v => ids.has(v.storeId)); result.inventory = s.inventory.filter(v => ids.has(v.storeId));
    result.stockMovements = s.stockMovements.filter(v => result.inventory.some(stock => stock.id === v.stockItemId));
    result.orders = s.orders.filter(v => ids.has(v.storeId)).map(v => this.order(v));
    result.payments = s.payments.filter(v => finance(v.storeId) && ids.has(v.storeId));
    result.onlinePermissions = Object.fromEntries(stores.map(store => [store.id, this.roles(store.id)]));
    result.operatingPeriods = s.operatingPeriods.map(p => ({ id: p.id, eventId: p.eventId, type: p.type, label: p.label, status: p.status, openedAt: p.openedAt, openedBy: p.openedBy, closedAt: p.closedAt, closedBy: p.closedBy }));
    return result;
  }
}

export async function loadAccess(db: PrismaClient, i: Identity) {
  return new WorkspaceAccess(i.user.role === "owner", await db.staffAssignment.findMany({ where: { tenantId: i.tenant.id, accountId: i.user.id } }), await db.storefront.findMany({ where: { tenantId: i.tenant.id }, select: { id: true, venueId: true, eventId: true, vendorId: true } }), (await db.workspaceRecord.findMany({ where: { tenantId: i.tenant.id, kind: "events" } })).map(r => r.data));
}

export async function authorizeRequest(db: PrismaClient, req: Request, i: Identity) {
  const a = i.access!; if (a.owner) return;
  const [kind, id, action, resource, resourceId] = req.path.split("/").filter(Boolean);
  if (kind === "staff") return deny();
  if (kind === "business") return;
  const write = req.method !== "GET";
  if (kind === "operations") {
    if (!id) return;
    const v = await db.venue.findFirst({ where: { tenantId: i.tenant.id, id } });
    const type = v ? "venue" : "event";
    if (!a.scope(type, id)) return deny();
    if (!write) return;
    if (action !== "service") { if (!a.scope(type, id, true)) deny(); return; }
    const row = await db.workspaceRecord.findUnique({ where: { tenantId_kind_id: { tenantId: i.tenant.id, kind: "runtime", id } } });
    const s = row?.data as unknown as HubSnapshot | undefined;
    let storeId = req.body.storeId;
    if (resource === "inventory") storeId = s?.inventory.find(v => v.id === resourceId)?.storeId;
    if (resource === "orders" && resourceId) storeId = s?.orders.find(v => v.id === resourceId)?.storeId;
    if (resource === "payments") storeId = s?.orders.find(v => v.id === req.body.orderId)?.storeId;
    const roles = resource === "payments" ? [...managers, "cashier"] : resource === "menu-items" ? managers : resource === "inventory" ? [...managers, "prep"] : resource === "orders" && resourceId ? [...managers, "prep", "waiter"] : resource === "orders" ? [...managers, "cashier", "waiter"] : [];
    if (!storeId || !s?.stores.some(v => v.id === storeId) || !a.store(storeId, roles)) deny();
    // Cashiers/waiters cannot accept/reject orders on behalf of kitchen management.
    if (resource === "orders" && resourceId && ["confirmed", "rejected", "void"].includes(req.body.status) && !a.store(storeId, [...managers, "prep"])) deny();
    return;
  }
  if (!["venues", "events", "vendors", "storefronts", "floor"].includes(kind)) return deny();
  let current: any;
  if (id) {
    current = kind === "venues" ? await db.venue.findFirst({ where: { tenantId: i.tenant.id, id } }) : kind === "storefronts" ? await db.storefront.findFirst({ where: { tenantId: i.tenant.id, id } }) : (await db.workspaceRecord.findUnique({ where: { tenantId_kind_id: { tenantId: i.tenant.id, kind, id } } }))?.data;
    if (!current || !a.visible(kind, current)) deny();
  }
  if (!write) return;
  if (current) {
    if (!a.editable(kind, current)) deny();
    // Assignments cannot be used to move a storefront or event into another scope.
    if (kind === "storefronts" && action !== "status") {
      const parent = a.stores.find(s => s.id === id)!;
      if (req.body.scopeId !== (parent.venueId ?? parent.eventId) || req.body.scopeType !== (parent.venueId ? "venue" : "event") || req.body.vendorId !== parent.vendorId) deny();
    }
    if (kind === "events" && req.body.venueId !== undefined && req.body.venueId !== current.venueId) deny();
    if (kind === "floor" && ((req.body.scopeId && req.body.scopeId !== current.scopeId) || (req.body.scopeType && req.body.scopeType !== current.scopeType))) deny();
  } else if (kind === "venues" || kind === "vendors" || (kind === "events" ? !a.venue(req.body.venueId, true) : !a.scope(req.body.scopeType, req.body.scopeId, true))) deny();
}
