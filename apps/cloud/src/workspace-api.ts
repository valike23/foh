import { Router, type Request, type Response, type NextFunction } from "express";
import { Prisma, type PrismaClient, type Tenant, type Venue } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { emptyVenueProfile, type BusinessEntity, type BusinessKind, type ManagedStorefront, type ManagedVendor, type FloorPlace, type ManagedVenue, type HubSnapshot, calculateOrderTotals, type Order } from "@exa-foh/shared";
import { venueSchema, businessSchemas } from "./workspace-schemas.js";
import { provisionSnapshot, openingBlockers, closeoutBlockers } from "./workspace-runtime.js";
import { refreshFloor } from "./floor-runtime.js";

import { storefrontRecord, storefrontData } from "./storefront-repository.js";
import { loadAccess, authorizeRequest, WorkspaceError, type Identity } from "./workspace-access.js";
export { WorkspaceError } from "./workspace-access.js";
const now = () => new Date().toISOString();
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function fail(status: number, message: string): never { throw new WorkspaceError(status, message); }
const profile = (v: Venue): ManagedVenue => ({ ...emptyVenueProfile(), ...(v.profile as object), id: v.id, organizationId: v.tenantId, name: v.name, address: v.address, status: v.status as ManagedVenue["status"], version: v.version, createdAt: v.createdAt.toISOString(), updatedAt: v.updatedAt.toISOString() });

export function createWorkspaceApi(db: PrismaClient, authenticate: (req: Request, res: Response) => Promise<Identity>) {
  const router = Router();
  const run = (fn: (req: Request, res: Response, identity: Identity) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void authenticate(req, res).then(async identity => { identity.access = await loadAccess(db, identity); await authorizeRequest(db, req, identity); return fn(req, res, identity); }).catch(next); };
  async function venue(tenantId: string, id: string) { return await db.venue.findFirst({ where: { tenantId, id } }) ?? fail(404, "Venue not found"); }
  async function all<T = BusinessEntity>(tenantId: string, kind: string): Promise<T[]> { if (kind === "storefronts") return (await db.storefront.findMany({ where: { tenantId } })).map(storefrontRecord) as T[]; return (await db.workspaceRecord.findMany({ where: { tenantId, kind } })).map(r => r.data as unknown as T); }
  async function record<T = BusinessEntity>(tenantId: string, kind: string, id: string): Promise<T> { if (kind === "storefronts") { const store = await db.storefront.findFirst({ where: { tenantId, id } }); return store ? storefrontRecord(store) as T : fail(404, "Storefront not found"); } const row = await db.workspaceRecord.findUnique({ where: { tenantId_kind_id: { tenantId, kind, id } } }); return row ? row.data as unknown as T : fail(404, "Record not found"); }
  const directory = (items: any[], req: Request, i: Identity, kind: string) => {
    items = items.filter(r => i.access!.visible(kind, r));
    const counts = { total: items.length, active: items.filter(v => v.status === "active").length, draft: items.filter(v => v.status === "draft").length, archived: items.filter(v => v.status === "archived").length, paused: items.filter(v => v.status === "paused").length };
    const filtered = items.filter(v => (!req.query.q || v.name.toLowerCase().includes(String(req.query.q).toLowerCase())) && (!req.query.status || req.query.status === "all" || v.status === req.query.status) && ["scopeId", "scopeType", "vendorId"].every(k => !req.query[k] || v[k] === req.query[k]));
    const page = Math.max(1, Number(req.query.page) || 1); return { items: filtered.slice((page - 1) * 12, page * 12), total: filtered.length, counts, page, pageSize: 12, canCreate: i.user.role === "owner" || (kind !== "venues" && kind !== "vendors" && i.access!.assignments.some(a => a.role === "venue-manager")) };
  };
  router.get("/venues", run(async (req, res, i) => res.json(directory((await db.venue.findMany({ where: { tenantId: i.tenant.id }, orderBy: { createdAt: "desc" } })).map(profile), req, i, "venues"))));
  router.post("/venues", run(async (req, res, i) => {
    const input = venueSchema.parse({ ...emptyVenueProfile(), ...req.body });
    const saved = await db.venue.create({ data: { tenantId: i.tenant.id, name: input.name, address: input.address, profile: json(input), activity: json([{ id: randomUUID(), actor: i.user.name, action: "Created venue", changes: [], createdAt: now() }]) } });
    res.status(201).json(profile(saved));
  }));
  router.get("/venues/:id", run(async (req, res, i) => { const v = await venue(i.tenant.id, String(req.params.id)); res.json({ venue: profile(v), activity: v.activity, canEdit: i.access!.editable("venues", v), archiveBlockers: [], linkedService: null }); }));
  router.patch("/venues/:id", run(async (req, res, i) => {
    const current = await venue(i.tenant.id, String(req.params.id)); const { version: rawVersion, ...values } = req.body; const version = z.number().int().positive().parse(rawVersion);
    const input = venueSchema.parse(values);
    const changed = await db.venue.updateMany({ where: { tenantId: i.tenant.id, id: current.id, version }, data: { name: input.name, address: input.address, profile: json(input), version: { increment: 1 }, activity: json([...(current.activity as any[]), { id: randomUUID(), actor: i.user.name, action: "Updated venue", changes: [], createdAt: now() }]) } });
    if (!changed.count) fail(409, "Changed elsewhere. Reload before saving.");
    res.json(profile(await venue(i.tenant.id, current.id)));
  }));
  router.post("/venues/:id/status", run(async (req, res, i) => {
    const current = await venue(i.tenant.id, String(req.params.id));
    const input = z.object({ status: z.enum(["draft", "active", "paused", "archived"]), version: z.number().int(), reason: z.string().trim().min(3).max(300) }).parse(req.body);
    if (input.status === "archived" && (await all<any>(i.tenant.id, "runtime")).some(r => r.event.id === current.id && r.event.status !== "closed")) fail(409, "Close service before archiving");
    const result = await db.venue.updateMany({ where: { id: current.id, tenantId: i.tenant.id, version: input.version }, data: { status: input.status, version: { increment: 1 }, activity: json([...(current.activity as any[]), { id: randomUUID(), actor: i.user.name, action: `Set status to ${input.status}`, changes: [input.reason], createdAt: now() }]) } });
    if (!result.count) fail(409, "Changed elsewhere. Reload before saving."); res.json(profile(await venue(i.tenant.id, current.id)));
  }));
  router.get("/business/options", run(async (_req, res, i) => { const options = { venues: (await db.venue.findMany({ where: { tenantId: i.tenant.id } })).map(profile), events: await all(i.tenant.id, "events"), vendors: await all(i.tenant.id, "vendors"), storefronts: await all(i.tenant.id, "storefronts"), floor: await all(i.tenant.id, "floor") }; res.json(Object.fromEntries(Object.entries(options).map(([kind, rows]) => [kind, rows.filter(r => i.access!.visible(kind, r))]))); }));
  function checkFloorService(id: string, s: HubSnapshot) {
    if (s.event.status === "live") throw new WorkspaceError(409, "Published operation configuration is locked while service is live. Pause service before changing the floor.", { label: "Manage this operation", href: `/operations?operation=${encodeURIComponent(id)}` });
    if (!["setup", "paused", "closed"].includes(s.event.status)) fail(409, "This service cannot accept floor configuration changes.");
  }
  async function configurationWrite<T>(tenantId: string, kind: BusinessKind, ref: Record<string, any>, write: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (kind !== "floor") return write(db);
    return db.$transaction(async tx => {
      const runtime = await tx.workspaceRecord.findUnique({ where: { tenantId_kind_id: { tenantId, kind: "runtime", id: ref.scopeId! } } });
      const snapshot = runtime?.data as unknown as HubSnapshot | undefined;
      if (snapshot) checkFloorService(ref.scopeId!, snapshot);
      const result = await write(tx);
      if (runtime && snapshot) {
        const floor = (await tx.workspaceRecord.findMany({ where: { tenantId, kind: "floor" } })).map(r => r.data as unknown as FloorPlace).filter(p => p.scopeId === ref.scopeId && p.scopeType === ref.scopeType);
        refreshFloor(snapshot, floor);
        const changed = await tx.workspaceRecord.updateMany({ where: { tenantId, kind: "runtime", id: runtime.id, version: runtime.version }, data: { data: json(snapshot), version: { increment: 1 } } });
        if (!changed.count) fail(409, "Service changed while saving the floor. Reload and try again.");
      }
      return result;
    });
  }
  async function validate(tenantId: string, kind: BusinessKind, input: any) {
    if (kind === "events") { if (Date.parse(input.endsAt) <= Date.parse(input.startsAt)) fail(422, "End time must follow start time"); if (input.venueId) await venue(tenantId, input.venueId); else if (!input.location) fail(422, "Choose a venue or location"); }
    if (kind === "storefronts" || kind === "floor") {
      if (input.scopeType === "venue") await venue(tenantId, input.scopeId); else await record(tenantId, "events", input.scopeId);
      const runtime = await db.workspaceRecord.findUnique({ where: { tenantId_kind_id: { tenantId, kind: "runtime", id: input.scopeId } } });
      if (runtime) { if (kind === "storefronts") fail(409, "Published operation configuration is locked"); else checkFloorService(input.scopeId, runtime.data as unknown as HubSnapshot); }
    }
    if (kind === "storefronts") {
      const vendor = await record<ManagedVendor>(tenantId, "vendors", input.vendorId); if (vendor.status !== "active") fail(422, "Choose an active vendor");
      for (const id of input.sectionIds) { const section = await record<FloorPlace>(tenantId, "floor", id); if (section.kind !== "section" || section.scopeId !== input.scopeId || section.scopeType !== input.scopeType) fail(422, "Section is outside this operation"); }
    }
    if (kind === "floor" && input.kind !== "section") {
      const parent = await record<FloorPlace>(tenantId, "floor", input.parentId); const store = await record<ManagedStorefront>(tenantId, "storefronts", input.storefrontId);
      if (parent.kind !== (input.kind === "table" ? "section" : "table") || parent.scopeId !== input.scopeId || store.scopeId !== input.scopeId || parent.scopeType !== input.scopeType || store.scopeType !== input.scopeType || parent.status !== "active") fail(422, "Choose a parent and storefront in this operation");
      if (input.kind === "seat" && (input.capacity !== 1 || parent.storefrontId !== input.storefrontId)) fail(422, "Seats must use their table's storefront and have capacity one");
    }
    if (kind === "floor" && input.kind === "section" && (input.parentId || input.storefrontId)) fail(422, "A section cannot have a parent or storefront.");
  }
  for (const kind of Object.keys(businessSchemas) as BusinessKind[]) {
    router.get(`/${kind}`, run(async (req, res, i) => res.json(directory(await all(i.tenant.id, kind), req, i, kind))));
    router.post(`/${kind}`, run(async (req, res, i) => {
      const input = businessSchemas[kind].parse(req.body); await validate(i.tenant.id, kind, input);
      const data = { ...input, id: randomUUID(), organizationId: i.tenant.id, status: kind === "floor" ? "active" : "draft", version: 1, createdAt: now(), updatedAt: now(), ...(["storefronts", "floor"].includes(kind) ? { qrToken: null } : {}) };
      await configurationWrite(i.tenant.id, kind, input, async tx => {
        if (kind === "storefronts") await tx.storefront.create({ data: storefrontData(data as ManagedStorefront) });
        else await tx.workspaceRecord.create({ data: { tenantId: i.tenant.id, kind, id: data.id, data: json(data) } });
      }); res.status(201).json(data);
    }));
    router.get(`/${kind}/:id`, run(async (req, res, i) => { const data = await record(i.tenant.id, kind, String(req.params.id)); res.json({ record: data, activity: [], canEdit: i.access!.editable(kind, data), blockers: [], readiness: [], transitions: data.status === "active" ? ["paused", "archived"] : data.status === "archived" ? ["draft"] : ["active", "archived"], linkedService: false }); }));
    router.patch(`/${kind}/:id`, run(async (req, res, i) => {
      const { version: rawVersion, ...values } = req.body; const version = z.number().int().positive().parse(rawVersion); const current = await record<any>(i.tenant.id, kind, String(req.params.id)); const input = businessSchemas[kind].parse(values); await validate(i.tenant.id, kind, input);
      if (kind === "floor" && ((input as FloorPlace).scopeId !== current.scopeId || (input as FloorPlace).scopeType !== current.scopeType || (input as FloorPlace).kind !== current.kind)) fail(422, "A floor location's operation and type cannot be changed.");
      const data = { ...current, ...input, version: current.version + 1, updatedAt: now() };
      await configurationWrite(i.tenant.id, kind, data, async tx => {
        const result = kind === "storefronts" ? await tx.storefront.updateMany({ where: { tenantId: i.tenant.id, id: current.id, version }, data: storefrontData(data) }) : await tx.workspaceRecord.updateMany({ where: { tenantId: i.tenant.id, kind, id: current.id, version }, data: { version: { increment: 1 }, data: json(data) } }); if (!result.count) fail(409, "Changed elsewhere. Reload before saving.");
      }); res.json(data);
    }));
    router.post(`/${kind}/:id/status`, run(async (req, res, i) => {
      const input = z.object({ status: z.enum(["draft", "active", "paused", "archived", "ready", "cancelled"]), version: z.number().int(), reason: z.string().trim().min(3).max(300) }).parse(req.body);
      const current = await record<any>(i.tenant.id, kind, String(req.params.id));
      if (kind !== "vendors") await validate(i.tenant.id, kind, current);
      const data = { ...current, status: input.status, version: current.version + 1, updatedAt: now() };
      await configurationWrite(i.tenant.id, kind, data, async tx => {
        const result = kind === "storefronts" ? await tx.storefront.updateMany({ where: { tenantId: i.tenant.id, id: current.id, version: input.version }, data: storefrontData(data) }) : await tx.workspaceRecord.updateMany({ where: { tenantId: i.tenant.id, kind, id: current.id, version: input.version }, data: { data: json(data), version: { increment: 1 } } }); if (!result.count) fail(409, "Changed elsewhere. Reload before saving.");
      }); res.json(data);
    }));
  }
  router.post("/events/:id/clone", run(async (req, res, i) => {
    const input = z.object({ name: z.string().trim().min(2).max(100), startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }) }).parse(req.body);
    const source = await record<any>(i.tenant.id, "events", String(req.params.id));
    const data = { ...source, ...input, id: randomUUID(), status: "draft", version: 1, createdAt: now(), updatedAt: now() };
    await validate(i.tenant.id, "events", data);
    const allocations = [...(await all<any>(i.tenant.id, "storefronts")).map(r => ({ kind: "storefronts", record: r })), ...(await all<any>(i.tenant.id, "floor")).map(r => ({ kind: "floor", record: r }))].filter(r => r.record.scopeType === "event" && r.record.scopeId === source.id);
    const ids = new Map(allocations.map(r => [r.record.id, randomUUID()]));
    await db.$transaction(async tx => {
      await tx.workspaceRecord.create({ data: { tenantId: i.tenant.id, kind: "events", id: data.id, data: json(data) } });
      for (const allocation of allocations) {
        const value = { ...allocation.record, id: ids.get(allocation.record.id)!, scopeId: data.id, version: 1, createdAt: now(), updatedAt: now(), qrToken: null, ...(allocation.kind === "storefronts" ? { sectionIds: allocation.record.sectionIds.map((id: string) => ids.get(id)).filter(Boolean) } : { parentId: ids.get(allocation.record.parentId) ?? null, storefrontId: ids.get(allocation.record.storefrontId) ?? null }) };
        if (allocation.kind === "storefronts") await tx.storefront.create({ data: storefrontData(value) });
        else await tx.workspaceRecord.create({ data: { tenantId: i.tenant.id, kind: allocation.kind, id: value.id, data: json(value) } });
      }
    }); res.status(201).json(data);
  }));
  router.get("/operations", run(async (_req, res, i) => {
    const sources = [...(await db.venue.findMany({ where: { tenantId: i.tenant.id, status: { not: "archived" } } })).map(v => ({ ...profile(v), scopeType: "venue" })), ...(await all<any>(i.tenant.id, "events")).filter(e => !["archived", "cancelled"].includes(e.status)).map(e => ({ ...e, scopeType: "event" }))];
    const runtimes = await db.workspaceRecord.findMany({ where: { tenantId: i.tenant.id, kind: "runtime" } });
    res.json({ canManage: i.user.role === "owner" || i.access!.assignments.some(a => a.role === "venue-manager"), items: sources.filter(source => i.access!.scope(source.scopeType, source.id)).map(source => { const row = runtimes.find(r => r.id === source.id); const s = row?.data as unknown as HubSnapshot | undefined; return { id: source.id, name: source.name, scopeType: source.scopeType, version: source.version, revision: row?.version ?? 0, published: !!s, status: s?.event.status ?? "setup", orders: s ? i.access!.snapshot(s).orders.length : 0, openingBlockers: s && i.access!.scope(source.scopeType, source.id, true) ? openingBlockers(s) : [], closeoutBlockers: s && i.access!.scope(source.scopeType, source.id, true) ? closeoutBlockers(s) : [], canManage: i.access!.scope(source.scopeType, source.id, true) }; }) });
  }));
  router.post("/operations/:id/publish", run(async (req, res, i) => {
    const input = z.object({ scopeType: z.enum(["event", "venue"]), version: z.number().int() }).parse(req.body); const id = String(req.params.id);
    const source = input.scopeType === "venue" ? profile(await venue(i.tenant.id, id)) : await record<any>(i.tenant.id, "events", id);
    if (source.version !== input.version) fail(409, "Configuration changed. Reload first.");
    const stores = (await all<ManagedStorefront>(i.tenant.id, "storefronts")).filter(s => s.scopeId === id && s.scopeType === input.scopeType && s.status === "active");
    if (!stores.length) fail(422, "Add and activate at least one storefront before publishing");
    const s = provisionSnapshot(source, input.scopeType, stores, await all<ManagedVendor>(i.tenant.id, "vendors"), (await all<FloorPlace>(i.tenant.id, "floor")).filter(f => f.scopeId === id && f.scopeType === input.scopeType && f.status === "active"));
    await db.workspaceRecord.create({ data: { tenantId: i.tenant.id, kind: "runtime", id, data: json(s) } }); res.json({ id, published: true });
  }));
  // Optimistic revision checks make concurrent stock/order writes atomic.
  async function mutate<T>(tenantId: string, id: string, fn: (s: HubSnapshot) => T, expected?: number) {
    return db.$transaction(async tx => {
      const current = await tx.workspaceRecord.findUnique({ where: { tenantId_kind_id: { tenantId, kind: "runtime", id } } });
      if (!current) fail(404, "Publish this operation first");
      if (expected !== undefined && current.version !== expected) fail(409, "Service changed. Reload first.");
      const snapshot = current.data as unknown as HubSnapshot;
      const result = fn(snapshot);
      const changed = await tx.workspaceRecord.updateMany({ where: { tenantId, kind: "runtime", id, version: current.version }, data: { version: { increment: 1 }, data: json(snapshot) } });
      if (!changed.count) fail(409, "Service changed. Please retry."); return result;
    });
  }
  router.post("/operations/:id/lifecycle", run(async (req, res, i) => {
    const input = z.object({ action: z.enum(["open", "pause", "close"]), revision: z.number().int(), reason: z.string().trim().min(3).max(300) }).parse(req.body);
    await mutate(i.tenant.id, String(req.params.id), s => {
      const status = s.event.status;
      if (input.action === "open") {
        if (!["setup", "paused", ...(s.event.containerType === "venue" ? ["closed"] : [])].includes(status)) fail(409, "Service cannot be opened from this state");
        const blockers = openingBlockers(s); if (blockers.length) fail(409, blockers.join(". "));
        if (!s.operatingPeriods.some(p => p.status === "open")) s.operatingPeriods.unshift({ id: randomUUID(), eventId: s.event.id, label: s.event.name, type: s.event.containerType === "venue" ? "venue-day" : "event-run", status: "open", openedAt: now(), openedBy: i.user.name, openingCash: 0 });
        s.event.status = "live";
      } else if (input.action === "pause") { if (status !== "live") fail(409, "Only live service can pause"); s.event.status = "paused"; }
      else { if (!["live", "paused"].includes(status)) fail(409, "Only open service can close"); const blockers = closeoutBlockers(s); if (blockers.length) fail(409, blockers.join(". ")); s.event.status = "closed"; s.operatingPeriods = s.operatingPeriods.map(p => p.status === "open" ? { ...p, status: "closed", closedAt: now(), closedBy: i.user.name } : p); }
      s.auditLog.unshift({ id: randomUUID(), actor: i.user.name, action: `${input.action}: ${input.reason}`, createdAt: now() });
    }, input.revision); res.json({ ok: true });
  }));
  router.get("/operations/:id/service/snapshot", run(async (req, res, i) => res.json(i.access!.snapshot(await record<HubSnapshot>(i.tenant.id, "runtime", String(req.params.id))))));
  router.post("/operations/:id/service/menu-items", run(async (req, res, i) => {
    const input = z.object({ storeId: z.string(), name: z.string().trim().min(2).max(100), category: z.enum(["Drinks", "Food", "Bottle Service", "Merch"]), price: z.number().int().nonnegative().max(1e9), quantity: z.number().int().nonnegative().max(1e6), lowStockThreshold: z.number().int().nonnegative().max(1e6), unit: z.string().trim().min(1).max(40) }).parse(req.body);
    const result = await mutate(i.tenant.id, String(req.params.id), s => {
      if (s.event.status === "closed") fail(409, "Service is closed");
      if (!s.stores.some(v => v.id === input.storeId)) fail(422, "Choose a storefront in this operation");
      const stockId = randomUUID(); const item = { id: randomUUID(), storeId: input.storeId, name: input.name, category: input.category, price: input.price, stockItemId: stockId, available: input.quantity > 0, modifiers: [] };
      s.menuItems.push(item); s.inventory.push({ id: stockId, storeId: input.storeId, name: input.name, unit: input.unit, quantity: input.quantity, lowStockThreshold: input.lowStockThreshold }); return item;
    }); res.status(201).json(result);
  }));
  router.post("/operations/:id/service/inventory/:stockId/adjustments", run(async (req, res, i) => {
    const input = z.object({ quantityDelta: z.number().int().min(-1e6).max(1e6).refine(v => v !== 0), note: z.string().trim().min(3).max(300) }).parse(req.body);
    await mutate(i.tenant.id, String(req.params.id), s => {
      if (s.event.status === "closed") fail(409, "Service is closed"); const stock = s.inventory.find(v => v.id === req.params.stockId); if (!stock) fail(404, "Stock item not found"); if (stock.quantity + input.quantityDelta < 0) fail(422, "Stock cannot become negative");
      stock.quantity += input.quantityDelta; s.stockMovements.push({ id: randomUUID(), stockItemId: stock.id, type: input.quantityDelta > 0 ? "restock" : "waste", quantityDelta: input.quantityDelta, note: input.note, createdAt: now() }); s.menuItems = s.menuItems.map(m => m.stockItemId === stock.id ? { ...m, available: stock.quantity > 0 } : m);
    }); res.json({ ok: true });
  }));
  router.post("/operations/:id/service/orders", run(async (req, res, i) => {
    const input = z.object({ storeId: z.string(), tableId: z.string().optional(), customerName: z.string().trim().max(100).optional(), lines: z.array(z.object({ menuItemId: z.string(), quantity: z.number().int().positive().max(1000) })).min(1).max(100) }).parse(req.body);
    const order = await mutate(i.tenant.id, String(req.params.id), s => {
      if (s.event.status !== "live") fail(409, "Open service before taking orders");
      if (input.tableId && !s.tables.some(t => t.id === input.tableId && t.storeId === input.storeId)) fail(422, "Table is outside this storefront");
      const requested = new Map<string, number>();
      const lines = input.lines.map(line => { const menu = s.menuItems.find(m => m.id === line.menuItemId && m.storeId === input.storeId); if (!menu || !menu.available) fail(422, "Item unavailable"); const stock = s.inventory.find(v => v.id === menu.stockItemId); const quantity = (requested.get(menu.stockItemId) ?? 0) + line.quantity; requested.set(menu.stockItemId, quantity); if (!stock || stock.quantity < quantity) fail(409, "Not enough stock"); return { id: randomUUID(), menuItemId: menu.id, name: menu.name, quantity: line.quantity, unitPrice: menu.price, modifiers: [] }; });
      const created: Order = { id: randomUUID(), eventId: s.event.id, operatingPeriodId: s.operatingPeriods.find(p => p.status === "open")?.id, storeId: input.storeId, tableId: input.tableId, customerName: input.customerName, origin: "cashier", status: s.stores.find(store => store.id === input.storeId)?.manualConfirmation ? "sent" : "confirmed", createdBy: i.user.name, createdAt: now(), updatedAt: now(), lines, totals: calculateOrderTotals(lines, s.chargeRules), auditTrail: [] };
      if (created.status === "confirmed") for (const [stockId, quantity] of requested) { const stock = s.inventory.find(v => v.id === stockId)!; stock.quantity -= quantity; s.stockMovements.push({ id: randomUUID(), stockItemId: stockId, orderId: created.id, type: "sale", quantityDelta: -quantity, note: "Confirmed sale", createdAt: now() }); }
      s.orders.unshift(created); s.tables = s.tables.map(t => t.id === input.tableId ? { ...t, status: "occupied" } : t); return created;
    }); res.status(201).json(i.access!.order(order));
  }));
  router.patch("/operations/:id/service/orders/:orderId/status", run(async (req, res, i) => {
    const input = z.object({ status: z.enum(["confirmed", "preparing", "ready", "served", "void", "rejected"]) }).parse(req.body);
    const updated = await mutate(i.tenant.id, String(req.params.id), s => {
      if (s.event.status === "closed") fail(409, "Service is closed");
      const order = s.orders.find(o => o.id === req.params.orderId); if (!order) fail(404, "Order not found");
      const allowed: Record<string, string[]> = { sent: ["confirmed", "rejected", "void"], confirmed: ["preparing"], preparing: ["ready"], ready: ["served"] };
      if (!allowed[order.status]?.includes(input.status)) fail(409, "This status transition is not available");
      if (order.status === "sent" && input.status === "confirmed") {
        const requested = new Map<string, number>();
        for (const line of order.lines) { const menu = s.menuItems.find(m => m.id === line.menuItemId); if (!menu || !menu.available) fail(409, "An ordered item is unavailable"); requested.set(menu.stockItemId, (requested.get(menu.stockItemId) ?? 0) + line.quantity); }
        for (const [stockId, quantity] of requested) { const stock = s.inventory.find(v => v.id === stockId); if (!stock || stock.quantity < quantity) fail(409, "Not enough stock to accept this order"); stock.quantity -= quantity; s.stockMovements.push({ id: randomUUID(), stockItemId: stockId, orderId: order.id, type: "sale", quantityDelta: -quantity, note: "Accepted order", createdAt: now() }); }
      }
      order.status = input.status; order.updatedAt = now(); order.auditTrail.push({ id: randomUUID(), actor: i.user.name, action: `Moved order to ${input.status}`, createdAt: now() }); return order;
    }); res.json(i.access!.order(updated));
  }));
  router.post("/operations/:id/service/payments", run(async (req, res, i) => {
    const input = z.object({ orderId: z.string(), amount: z.number().positive().max(1e12), method: z.enum(["cash", "pos", "bank-transfer"]) }).parse(req.body);
    const result = await mutate(i.tenant.id, String(req.params.id), s => {
      if (s.event.status === "closed") fail(409, "Service is closed"); const order = s.orders.find(o => o.id === input.orderId); if (!order || ["draft", "sent", "void", "rejected", "settled"].includes(order.status)) fail(409, "Choose an unpaid order");
      const paid = s.payments.filter(p => p.orderId === order.id && ["validated", "manually-confirmed"].includes(p.status)).reduce((sum, p) => sum + p.amount, 0); if (input.amount > order.totals.total - paid) fail(409, "Payment exceeds the remaining balance");
      const store = s.stores.find(v => v.id === order.storeId)!;
      const payment = { id: randomUUID(), eventId: order.eventId, operatingPeriodId: order.operatingPeriodId, storeId: order.storeId, vendorId: store.vendorId, orderId: order.id, amount: input.amount, method: input.method, status: input.method === "cash" ? "validated" as const : "manually-confirmed" as const, confirmedBy: i.user.name, createdAt: now() };
      s.payments.unshift(payment); s.ledgerEntries.unshift({ id: randomUUID(), accountId: s.vendorLedgerAccounts.find(a => a.vendorId === store.vendorId)!.id, eventId: order.eventId, operatingPeriodId: order.operatingPeriodId, vendorId: store.vendorId, orderId: order.id, paymentId: payment.id, type: "revenue", direction: "credit", amount: input.amount, memo: `Payment for ${order.id}`, createdAt: now() });
      if (paid + input.amount >= order.totals.total) { order.status = "settled"; order.updatedAt = now(); if (order.tableId && !s.orders.some(o => o.tableId === order.tableId && !["settled", "void", "rejected"].includes(o.status))) s.tables = s.tables.map(t => t.id === order.tableId ? { ...t, status: "settled" } : t); } return payment;
    }); res.status(201).json(result);
  }));
  return router;
}
