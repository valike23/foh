import { randomBytes, randomUUID, createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Router, type Request } from "express";
import { z } from "zod";
import { createGuestBranding } from "./guest-branding.js";
import { ensureMenuPreviews, readMenuPreview, menuPreviewSnapshot } from "./menu-preview.js";
import { createOperationStore, provisionOperation, openingBlockers, closeoutBlockers, transitionOperation, OperationError, type OperationRuntime } from "./operation-runtime.js";
import type { BusinessKind, BusinessEntity, ManagedEvent, ManagedVendor, ManagedStorefront, FloorPlace, ManagedVenue, ManagementUser, HubSnapshot, ScopeRef } from "@exa-foh/shared";

export class BusinessError extends Error { constructor(public status: number, message: string) { super(message); } }
const text = z.string().trim();
const scope = { scopeType: z.enum(["venue", "event"]), scopeId: text.min(1) };
const name = text.min(2).max(100);
const timezone = text.refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "Invalid timezone");
const schemas = {
  events: z.object({ name, venueId: text.min(1).nullable(), location: text.max(240), timezone,
    startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }), organizer: text.max(100), notes: text.max(2000) }).strict(),
  vendors: z.object({ name, kind: z.enum(["internal", "external"]), contactName: text.max(100), email: z.union([z.literal(""), text.email()]), phone: text.max(40), notes: text.max(2000) }).strict(),
  storefronts: z.object({ name, ...scope, vendorId: text.min(1), kind: z.enum(["bar", "kitchen", "bottle-service", "merch"]), prepStation: text.max(100), manualConfirmation: z.boolean(), fulfillment: z.enum(["pickup", "table", "seat"]), sectionIds: z.array(text.min(1)).max(100), commercialTerms: text.max(2000), notes: text.max(2000) }).strict(),
  floor: z.object({ name, ...scope, kind: z.enum(["section", "table", "seat"]), parentId: text.min(1).nullable(), storefrontId: text.min(1).nullable(), capacity: z.number().int().min(1).max(100000) }).strict()
};
const kinds: BusinessKind[] = ["events", "vendors", "storefronts", "floor"];
type Dependencies = {
  db: DatabaseSync; organizationId: string;
  session: (request: Request) => ManagementUser;
  findVenue: (id: string) => ManagedVenue;
  getSnapshot: () => HubSnapshot;
  saveLegacy?: () => void;
};

export function createBusinessManagement({ db, organizationId, session, findVenue, getSnapshot, saveLegacy = () => {} }: Dependencies) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS business_records (id TEXT NOT NULL, kind TEXT NOT NULL, organization_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(id, kind));
    CREATE TABLE IF NOT EXISTS business_activity (id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS business_requests (request_key TEXT NOT NULL, account_id TEXT NOT NULL, payload_hash TEXT NOT NULL, kind TEXT NOT NULL, entity_id TEXT NOT NULL, PRIMARY KEY(request_key, account_id));
  `);
  const router = Router();
  ensureMenuPreviews(db);
  const publicRouter = Router();
  const runtimes = createOperationStore(db, organizationId);
  const legacy: OperationRuntime = { id: getSnapshot().event.id, scope: { scopeType: "event", scopeId: getSnapshot().event.id }, revision: 1, snapshot: getSnapshot() };
  const runtimeFor = (id?: string) => {
    if (!id) return undefined;
    if (id === legacy.id) { legacy.snapshot = getSnapshot(); return legacy; }
    return runtimes.get(id);
  };
  function persistRuntime(runtime: OperationRuntime) {
    if (runtime.id === legacy.id) { saveLegacy(); runtime.revision++; }
    else runtimes.save(runtime);
  }
  const now = () => new Date().toISOString();
  const token = () => randomBytes(24).toString("hex");
  function transaction<T>(action: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try { const result = action(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  function all<T extends BusinessEntity>(kind: BusinessKind): T[] {
    return (db.prepare("SELECT data FROM business_records WHERE organization_id = ? AND kind = ?").all(organizationId, kind) as { data: string }[]).map(row => JSON.parse(row.data));
  }
  function get<T extends BusinessEntity>(kind: BusinessKind, id: string): T {
    const row = db.prepare("SELECT data FROM business_records WHERE organization_id = ? AND kind = ? AND id = ?").get(organizationId, kind, id) as { data: string } | undefined;
    if (!row) throw new BusinessError(404, "Record not found");
    return JSON.parse(row.data);
  }
  function save(kind: BusinessKind, record: BusinessEntity) {
    db.prepare("INSERT INTO business_records VALUES (?, ?, ?, ?) ON CONFLICT(id, kind) DO UPDATE SET data = excluded.data")
      .run(record.id, kind, organizationId, JSON.stringify(record));
  }
  function log(kind: BusinessKind, id: string, actor: string, action: string) {
    const entry = { id: randomUUID(), actor, action, createdAt: now() };
    db.prepare("INSERT INTO business_activity VALUES (?, ?, ?, ?)").run(entry.id, id, kind, JSON.stringify(entry));
  }
  const base = (id: string, name: string, status = "draft") => ({ id, name, status, organizationId, version: 1, createdAt: now(), updatedAt: now() });
  const sameScope = (a: ScopeRef, b: ScopeRef) => a.scopeType === b.scopeType && a.scopeId === b.scopeId;
  function owner(user: ManagementUser) { if (user.role !== "owner") throw new BusinessError(403, "Owner access is required"); }
  function scopeVenue(ref: ScopeRef): string | null { return ref.scopeType === "venue" ? ref.scopeId : get<ManagedEvent>("events", ref.scopeId).venueId; }
  function accessible(user: ManagementUser, kind: BusinessKind, record: BusinessEntity): boolean {
    if (user.role === "owner") return true;
    if (kind === "vendors") return all<ManagedStorefront>("storefronts").some(store => store.vendorId === record.id && accessible(user, "storefronts", store));
    const venueId = kind === "events" ? (record as ManagedEvent).venueId : scopeVenue(record as ScopeRef);
    return !!venueId && user.venueIds.includes(venueId);
  }
  function allow(user: ManagementUser, kind: BusinessKind, record: BusinessEntity, write = false) {
    if (!accessible(user, kind, record) || (write && (user.role === "viewer" || (kind === "vendors" && user.role !== "owner")))) throw new BusinessError(403, "You do not have access to this operation");
  }
  function legacyLinked(kind: BusinessKind, record: BusinessEntity) {
    if (kind === "events") return (record as ManagedEvent).legacyUnitId === getSnapshot().event.id;
    if (kind === "storefronts" || kind === "floor") {
      const ref = record as ScopeRef;
      return ref.scopeType === "event" && get<ManagedEvent>("events", ref.scopeId).legacyUnitId === getSnapshot().event.id;
    }
    return false;
  }
  function locked(kind: BusinessKind, record: BusinessEntity) {
    // The legacy runtime still owns its published configuration; do not silently diverge from it.
    return legacyLinked(kind, record) || !!runtimeFor(kind === "events" ? record.id : (record as ScopeRef).scopeId);
  }
  function checkScope(ref: ScopeRef) {
    if (runtimeFor(ref.scopeId)) throw new BusinessError(409, "Published operation configuration is locked");
    const parent = ref.scopeType === "venue" ? findVenue(ref.scopeId) : get<ManagedEvent>("events", ref.scopeId);
    if (["archived", "closed", "cancelled", "live", "closing"].includes(parent.status)) throw new BusinessError(409, "This operation is closed or its configuration is locked");
  }
  function invalidateReadiness(record: BusinessEntity, actor: string) {
    const ref = record as ScopeRef;
    if (ref.scopeType !== "event") return;
    const event = get<ManagedEvent>("events", ref.scopeId);
    if (event.status === "ready") {
      save("events", { ...event, status: "draft", version: event.version + 1, updatedAt: now() });
      log("events", event.id, actor, "Returned to draft after configuration changed");
    }
  }
  function validate(kind: BusinessKind, input: any, current?: BusinessEntity) {
    if (kind === "events") {
      if (Date.parse(input.endsAt) <= Date.parse(input.startsAt)) throw new BusinessError(422, "End time must be after start time");
      if (input.venueId) { if (findVenue(input.venueId).status === "archived") throw new BusinessError(409, "The host venue is archived"); }
      else if (!input.location) throw new BusinessError(422, "Choose a venue or enter a temporary location");
      if (current && input.venueId !== (current as ManagedEvent).venueId && [...all<ManagedStorefront>("storefronts"), ...all<FloorPlace>("floor")].some(s => s.scopeType === "event" && s.scopeId === current.id)) throw new BusinessError(409, "The host venue cannot change after storefront or floor allocation");
    }
    if (kind === "storefronts" || kind === "floor") {
      checkScope(input);
      if (current && !sameScope(current as ScopeRef, input)) throw new BusinessError(409, "An existing record cannot move to another operation");
      if (all(kind).some(item => item.id !== current?.id && item.status !== "archived" && sameScope(item as ScopeRef, input) && item.name.toLowerCase() === input.name.toLowerCase() && (kind !== "floor" || ((item as FloorPlace).kind === input.kind && (item as FloorPlace).parentId === input.parentId)))) throw new BusinessError(409, "That name is already in use in this operation");
    }
    if (kind === "storefronts") {
      if (get<ManagedVendor>("vendors", input.vendorId).status !== "active") throw new BusinessError(422, "Choose an active vendor");
      for (const id of input.sectionIds) { const section = get<FloorPlace>("floor", id); if (section.kind !== "section" || section.status !== "active" || !sameScope(section, input)) throw new BusinessError(422, "Service sections must belong to this operation"); }
    }
    if (kind === "floor") {
      if (input.kind === "seat" && input.capacity !== 1) throw new BusinessError(422, "An individual seat has a capacity of one");
      if (current && input.kind !== (current as FloorPlace).kind) throw new BusinessError(409, "A floor location cannot change its type");
      if (input.kind === "section" && (input.parentId || input.storefrontId)) throw new BusinessError(422, "Sections cannot have a parent or storefront");
      if (input.kind !== "section") {
        if (!input.parentId || !input.storefrontId) throw new BusinessError(422, "Choose a parent and storefront");
        const parent = get<FloorPlace>("floor", input.parentId);
        if (parent.id === current?.id || parent.status !== "active" || !sameScope(parent, input) || parent.kind !== (input.kind === "table" ? "section" : "table")) throw new BusinessError(422, "Invalid parent location");
        const store = get<ManagedStorefront>("storefronts", input.storefrontId);
        if (store.status === "archived" || !sameScope(store, input)) throw new BusinessError(422, "Choose a storefront in this operation");
        if (input.kind === "seat") {
          if (parent.storefrontId !== input.storefrontId) throw new BusinessError(422, "A seat must use its table's storefront");
          if (all<FloorPlace>("floor").filter(place => place.parentId === parent.id && place.status === "active" && place.id !== current?.id).length >= parent.capacity) throw new BusinessError(409, "The table has reached its seat capacity");
        }
        if (input.kind === "table") {
          const seats = all<FloorPlace>("floor").filter(place => place.parentId === current?.id && place.status === "active");
          if (seats.length > input.capacity || seats.some(seat => seat.storefrontId !== input.storefrontId)) throw new BusinessError(409, "Resolve existing seats before changing capacity or storefront");
        }
      }
    }
  }
  function readiness(event: ManagedEvent) {
    const stores = all<ManagedStorefront>("storefronts").filter(s => s.scopeType === "event" && s.scopeId === event.id && s.status !== "archived");
    return [
      { label: "Dates and location", complete: !!event.startsAt && !!event.endsAt && !!(event.venueId || event.location) },
      { label: "Organizer assigned", complete: !!event.organizer },
      { label: "Active storefront allocated", complete: stores.some(s => s.status === "active") },
      { label: "Preparation destinations assigned", complete: stores.length > 0 && stores.every(s => !!s.prepStation) }
    ];
  }
  function archiveBlockers(kind: BusinessKind, record: BusinessEntity) {
    const blocks: string[] = [];
    const stores = all<ManagedStorefront>("storefronts");
    const places = all<FloorPlace>("floor");
    if (kind === "vendors" && stores.some(s => s.vendorId === record.id && s.status !== "archived")) blocks.push("Archive or reassign the vendor's storefronts first");
    if (kind === "storefronts" && places.some(p => p.storefrontId === record.id && p.status !== "archived")) blocks.push("Archive or reassign the storefront's floor locations first");
    if (kind === "floor" && (places.some(p => p.parentId === record.id && p.status !== "archived") || stores.some(s => s.status !== "archived" && s.sectionIds.includes(record.id)))) blocks.push("Resolve child locations and service-section assignments first");
    if (kind === "events" && ["live", "closing"].includes(record.status)) blocks.push("Complete service close-out first");
    if (legacyLinked(kind, record)) blocks.push("Published configuration belongs to the connected service");
    return blocks;
  }
  function transitions(kind: BusinessKind, record: BusinessEntity): string[] {
    if (locked(kind, record)) return [];
    if (kind === "events") return ({ draft: ["ready", "cancelled"], ready: ["draft", "cancelled"], cancelled: ["archived"], closed: ["archived"], archived: ["draft"] } as Record<string, string[]>)[record.status] ?? [];
    return record.status === "archived" ? [kind === "storefronts" ? "draft" : "active"] : kind === "storefronts" ? (record.status === "active" ? ["paused", "archived"] : ["active", "archived"]) : ["archived"];
  }
  function mutate<T>(request: Request, user: ManagementUser, kind: BusinessKind, payload: unknown, action: () => T): T {
    const key = z.string().uuid().optional().parse(request.header("idempotency-key"));
    const hash = createHash("sha256").update(JSON.stringify({ path: request.path, payload })).digest("hex");
    return transaction(() => {
      if (key) {
        const prior = db.prepare("SELECT * FROM business_requests WHERE request_key = ? AND account_id = ?").get(key, user.id) as { payload_hash: string; kind: BusinessKind; entity_id: string } | undefined;
        if (prior) {
          if (prior.payload_hash !== hash) throw new BusinessError(409, "Request key has already been used");
          const record = get(prior.kind, prior.entity_id); allow(user, prior.kind, record);
          return record as T;
        }
      }
      const result = action();
      if (key) db.prepare("INSERT INTO business_requests VALUES (?, ?, ?, ?, ?)").run(key, user.id, hash, kind, (result as BusinessEntity).id);
      return result;
    });
  }

  if (!db.prepare("SELECT id FROM management_migrations WHERE id = 'business-registry-v1'").get()) transaction(() => {
    const snapshot = getSnapshot();
    const link = db.prepare("SELECT venue_id FROM venue_service_links WHERE unit_id = ?").get(snapshot.event.id) as { venue_id: string } | undefined;
    const event: ManagedEvent = { ...base(snapshot.event.id, snapshot.event.name, snapshot.event.status === "live" ? "live" : "draft"), venueId: link?.venue_id ?? null, location: snapshot.event.venue, timezone: "Africa/Lagos", startsAt: "", endsAt: "", organizer: "", notes: "", legacyUnitId: snapshot.event.id };
    save("events", event);
    log("events", event.id, "System", "Imported existing service; dates require review before cloning");
    snapshot.vendors.forEach(vendor => save("vendors", { ...base(vendor.id, vendor.name, "active"), kind: vendor.kind === "organizer" ? "internal" : "external", contactName: "", email: "", phone: "", notes: "" } as ManagedVendor));
    const ref: ScopeRef = { scopeType: "event", scopeId: event.id };
    snapshot.stores.forEach(store => save("storefronts", { ...base(store.id, store.name, "active"), ...ref, vendorId: store.vendorId, kind: store.kind, prepStation: store.name, manualConfirmation: store.manualConfirmation, fulfillment: "pickup", sectionIds: snapshot.sections.filter(s => s.storeIds.includes(store.id)).map(s => s.id), commercialTerms: "", notes: "", qrToken: token(), legacyStoreId: store.id } as ManagedStorefront));
    snapshot.sections.forEach(section => save("floor", { ...base(section.id, section.label, "active"), ...ref, kind: "section", parentId: null, storefrontId: null, capacity: 100, qrToken: null, legacyPlaceId: section.id } as FloorPlace));
    snapshot.tables.forEach(table => {
      const sectionId = snapshot.sections.find(s => s.zone === table.section)?.id ?? snapshot.sections[0]?.id;
      if (!sectionId) return;
      save("floor", { ...base(table.id, table.label, "active"), ...ref, kind: "table", parentId: sectionId, storefrontId: table.storeId, capacity: Math.max(4, snapshot.seats.filter(s => s.tableId === table.id).length), qrToken: token(), legacyPlaceId: table.id } as FloorPlace);
    });
    snapshot.seats.forEach(seat => {
      const table = snapshot.tables.find(t => t.id === seat.tableId);
      if (!table) return;
      save("floor", { ...base(seat.id, seat.label, "active"), ...ref, kind: "seat", parentId: table.id, storefrontId: table.storeId, capacity: 1, qrToken: token(), legacyPlaceId: seat.id } as FloorPlace);
    });
    db.prepare("INSERT INTO management_migrations VALUES ('business-registry-v1')").run();
  });

  const branding = createGuestBranding({ db, organizationId,
    authorize: (request, id, write) => { const user = session(request); const event = get<ManagedEvent>("events", id); allow(user, "events", event, write); return { user, event }; },
    log: (id, actor, action) => log("events", id, actor, action)
  });
  router.use(branding.router);
  router.get("/events/:id/menu-preview", (request, response) => {
    const event = get<ManagedEvent>("events", String(request.params.id));
    allow(session(request), "events", event);
    response.json({ token: readMenuPreview(db, organizationId, event.id)?.token ?? null });
  });
  router.get("/menu-preview/:token", (request, response) => {
    const token = String(request.params.token);
    if (!/^[a-f0-9]{48}$/.test(token)) throw new BusinessError(404, "Preview not found");
    const row = db.prepare("SELECT event_id FROM event_menu_previews WHERE token = ? AND organization_id = ?").get(token, organizationId) as { event_id: string } | undefined;
    if (!row) throw new BusinessError(404, "Preview not found");
    const event = get<ManagedEvent>("events", row.event_id);
    if (["archived", "cancelled", "closed"].includes(event.status)) throw new BusinessError(410, "This preview is no longer available");
    const stores = all<ManagedStorefront>("storefronts").filter(s => s.scopeType === "event" && s.scopeId === event.id && s.status === "active");
    const items = runtimeFor(event.id)?.snapshot.menuItems ?? readMenuPreview(db, organizationId, event.id)!.items;
    response.json({ preview: true, snapshot: menuPreviewSnapshot(event, stores, items, branding.getBranding(event.id)) });
  });

  router.get("/business/options", (request, response) => {
    const user = session(request);
    const venues = (db.prepare("SELECT data FROM managed_venues WHERE organization_id = ?").all(organizationId) as { data: string }[]).map(row => JSON.parse(row.data) as ManagedVenue).filter(v => user.role === "owner" || user.venueIds.includes(v.id));
    const option = (r: any) => ({ id: r.id, name: r.name, status: r.status, scopeType: r.scopeType, scopeId: r.scopeId, kind: r.kind, parentId: r.parentId });
    response.json({ venues: venues.map(option), ...Object.fromEntries(kinds.map(kind => [kind, all(kind).filter(record => accessible(user, kind, record)).map(option)])) });
  });
  function operationSource(user: ManagementUser, ref: ScopeRef, write = false) {
    if (ref.scopeType === "event") {
      const event = get<ManagedEvent>("events", ref.scopeId); allow(user, "events", event, write); return event;
    }
    const venue = findVenue(ref.scopeId);
    if ((user.role !== "owner" && !user.venueIds.includes(venue.id)) || (write && user.role === "viewer")) throw new BusinessError(403, "Operation access denied");
    return venue;
  }
  function authorizeRuntime(request: Request, id: string, write = false) {
    const user = session(request);
    const runtime = runtimeFor(id);
    if (!runtime) throw new BusinessError(404, "Publish this operation before starting service");
    operationSource(user, runtime.scope, write);
    return { user, runtime };
  }
  function summary(ref: ScopeRef, source: ManagedEvent | ManagedVenue) {
    const runtime = runtimeFor(source.id);
    return { ...ref, id: source.id, name: source.name, version: source.version, status: runtime?.snapshot.event.status ?? "unpublished", revision: runtime?.revision ?? 0,
      published: !!runtime, orders: runtime?.snapshot.orders.length ?? 0,
      openingBlockers: runtime ? openingBlockers(runtime.snapshot) : [], closeoutBlockers: runtime ? closeoutBlockers(runtime.snapshot) : [] };
  }
  router.get("/operations", (request, response) => {
    const user = session(request);
    const venues = (db.prepare("SELECT data FROM managed_venues WHERE organization_id = ?").all(organizationId) as { data: string }[]).map(r => JSON.parse(r.data) as ManagedVenue);
    response.json({ canManage: user.role !== "viewer", items: [
      ...all<ManagedEvent>("events").filter(e => accessible(user, "events", e) && e.status !== "archived").map(e => summary({ scopeType: "event", scopeId: e.id }, e)),
      ...venues.filter(v => v.status !== "archived" && (user.role === "owner" || user.venueIds.includes(v.id))).map(v => summary({ scopeType: "venue", scopeId: v.id }, v))
    ] });
  });
  router.post("/operations/:id/publish", (request, response) => {
    const user = session(request);
    const input = z.object({ scopeType: z.enum(["venue", "event"]), version: z.number().int().positive() }).strict().parse(request.body);
    const ref: ScopeRef = { scopeType: input.scopeType, scopeId: String(request.params.id) };
    const source = operationSource(user, ref, true);
    if (runtimeFor(source.id)) throw new BusinessError(409, "This operation is already published");
    if (source.version !== input.version) throw new BusinessError(409, "Configuration changed. Reload before publishing.");
    if (source.status !== (ref.scopeType === "event" ? "ready" : "active")) throw new BusinessError(409, "Mark the event ready or activate the venue before publishing");
    const stores = all<ManagedStorefront>("storefronts").filter(s => sameScope(s, ref) && s.status === "active");
    const floor = all<FloorPlace>("floor").filter(p => sameScope(p, ref) && p.status === "active");
    if (!stores.length) throw new BusinessError(409, "Allocate an active storefront first");
    for (const store of stores) { validate("storefronts", store, store); if (!store.prepStation) throw new BusinessError(409, "Assign preparation destinations"); }
    for (const place of floor) {
      validate("floor", place, place);
      if (place.storefrontId && !stores.some(s => s.id === place.storefrontId)) throw new BusinessError(409, "Every active floor location must use an active storefront");
    }
    const runtime = provisionOperation(ref, source, stores, all<ManagedVendor>("vendors"), floor);
    const preview = ref.scopeType === "event" ? readMenuPreview(db, organizationId, source.id) : undefined;
    if (preview) {
      runtime.snapshot.menuItems = preview.items.filter(item => stores.some(store => store.id === item.storeId));
      runtime.snapshot.inventory = runtime.snapshot.menuItems.map(item => ({ id: item.stockItemId, storeId: item.storeId, name: item.name, unit: "portion", quantity: 0, lowStockThreshold: 5 }));
    }
    runtimes.save(runtime);
    log(ref.scopeType === "event" ? "events" : "storefronts", source.id, user.name, "Published isolated operation configuration");
    response.status(201).json(summary(ref, source));
  });
  router.post("/operations/:id/lifecycle", (request, response) => {
    const { user, runtime } = authorizeRuntime(request, String(request.params.id), true);
    const input = z.object({ revision: z.number().int().positive(), action: z.enum(["open", "pause", "close"]), reason: text.min(3).max(300) }).strict().parse(request.body);
    if (runtime.revision !== input.revision) throw new BusinessError(409, "Operation changed. Reload before continuing.");
    const source = operationSource(user, runtime.scope, true);
    if (input.action === "open" && ["archived", "cancelled", ...(runtime.scope.scopeType === "venue" ? ["draft", "paused"] : [])].includes(source.status)) throw new BusinessError(409, "The management record is not active");
    transitionOperation(runtime, input.action, user.name, input.reason);
    persistRuntime(runtime);
    if (runtime.scope.scopeType === "event") {
      const event = source as ManagedEvent;
      save("events", { ...event, status: runtime.snapshot.event.status, version: event.version + 1, updatedAt: now() });
      log("events", event.id, user.name, `Service ${input.action}: ${input.reason}`);
    }
    response.json(summary(runtime.scope, source));
  });
  for (const kind of kinds) {
    router.get(`/${kind}`, (request, response) => {
      const user = session(request);
      const query = z.object({ q: text.max(100).default(""), status: text.max(30).default("all"), scopeType: z.enum(["venue", "event"]).optional(), scopeId: text.optional(), vendorId: text.optional(), page: z.coerce.number().int().min(1).default(1) }).parse(request.query);
      let rows = all(kind).filter(record => accessible(user, kind, record));
      if (query.scopeId) rows = rows.filter(record => kind === "events" ? (record as ManagedEvent).venueId === query.scopeId : (record as ScopeRef).scopeId === query.scopeId && (record as ScopeRef).scopeType === query.scopeType);
      if (query.vendorId && kind === "storefronts") rows = rows.filter(record => (record as ManagedStorefront).vendorId === query.vendorId);
      const counts = { total: rows.length, active: rows.filter(r => ["active", "live", "ready"].includes(r.status)).length, draft: rows.filter(r => r.status === "draft").length };
      rows = rows.filter(record => (query.status === "all" || record.status === query.status) && record.name.toLowerCase().includes(query.q.toLowerCase()));
      rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
      response.json({ items: rows.slice((query.page - 1) * 12, query.page * 12), total: rows.length, page: query.page, pageSize: 12, counts, canCreate: user.role !== "viewer" && (kind !== "vendors" || user.role === "owner") });
    });
    router.post(`/${kind}`, (request, response) => {
      const user = session(request);
      const input = schemas[kind].parse(request.body);
      const record = mutate(request, user, kind, input, () => {
        const record = { ...base(randomUUID(), input.name, kind === "vendors" || kind === "floor" ? "active" : "draft"), ...input, ...(["storefronts", "floor"].includes(kind) ? { qrToken: kind === "floor" && (input as FloorPlace).kind === "section" ? null : token() } : {}) } as BusinessEntity;
        if (kind === "vendors") owner(user); else allow(user, kind, record, true);
        validate(kind, input); save(kind, record); invalidateReadiness(record, user.name); log(kind, record.id, user.name, "Created record"); return record;
      });
      response.status(201).json(record);
    });
    router.get(`/${kind}/:id`, (request, response) => {
      const user = session(request); const record = get(kind, String(request.params.id)); allow(user, kind, record);
      const activity = (db.prepare("SELECT data FROM business_activity WHERE kind = ? AND subject_id = ? ORDER BY rowid DESC LIMIT 100").all(kind, record.id) as { data: string }[]).map(row => JSON.parse(row.data));
      response.json({ record, activity, canEdit: user.role !== "viewer" && (kind !== "vendors" || user.role === "owner") && !locked(kind, record), blockers: archiveBlockers(kind, record), readiness: kind === "events" ? readiness(record as ManagedEvent) : [], transitions: transitions(kind, record), linkedService: legacyLinked(kind, record) });
    });
    router.patch(`/${kind}/:id`, (request, response) => {
      const user = session(request); const { version, ...body } = request.body;
      z.number().int().positive().parse(version);
      const input = schemas[kind].parse(body);
      const result = transaction(() => {
        const current = get(kind, String(request.params.id)); allow(user, kind, current, true);
        if (current.version !== version) throw new BusinessError(409, "Changed elsewhere. Reload before saving.");
        if (["archived", "closed", "cancelled", "live", "closing"].includes(current.status) || locked(kind, current)) throw new BusinessError(409, "This configuration is locked");
        const updated = { ...current, ...input, version: current.version + 1, updatedAt: now() } as BusinessEntity;
        allow(user, kind, updated, true); validate(kind, input, current);
        if (kind === "events" && current.status === "ready") updated.status = "draft";
        save(kind, updated); invalidateReadiness(updated, user.name); log(kind, current.id, user.name, "Updated configuration"); return updated;
      });
      response.json(result);
    });
    router.post(`/${kind}/:id/status`, (request, response) => {
      const user = session(request);
      const input = z.object({ version: z.number().int().positive(), status: text, reason: text.min(3).max(300) }).parse(request.body);
      const record = transaction(() => {
        const current = get(kind, String(request.params.id)); allow(user, kind, current, true);
        if (current.version !== input.version) throw new BusinessError(409, "Changed elsewhere. Reload before saving.");
        if (!transitions(kind, current).includes(input.status)) throw new BusinessError(409, "This transition is not available. Service activation requires a connected runtime.");
        if (input.status === "archived" && archiveBlockers(kind, current).length) throw new BusinessError(409, archiveBlockers(kind, current).join(". "));
        if (kind === "events" && input.status === "ready" && readiness(current as ManagedEvent).some(check => !check.complete)) throw new BusinessError(422, "Complete all setup checks before marking ready");
        if (kind === "storefronts" && input.status === "active") { validate(kind, current, current); if (!(current as ManagedStorefront).prepStation) throw new BusinessError(422, "Assign a preparation destination first"); }
        if (kind === "floor" && input.status === "active") validate(kind, current, current);
        const updated = { ...current, status: input.status, version: current.version + 1, updatedAt: now() };
        save(kind, updated); invalidateReadiness(updated, user.name); log(kind, updated.id, user.name, `${current.status} -> ${input.status}: ${input.reason}`); return updated;
      });
      response.json(record);
    });
  }
  router.post("/events/:id/clone", (request, response) => {
    const user = session(request); const source = get<ManagedEvent>("events", String(request.params.id)); allow(user, "events", source, true);
    const input = z.object({ name, startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }) }).parse(request.body);
    const cloned = mutate(request, user, "events", input, () => {
      const { legacyUnitId: _legacy, ...configuration } = source;
      const event: ManagedEvent = { ...configuration, ...input, ...base(randomUUID(), input.name), organizer: source.organizer };
      validate("events", event); save("events", event);
      const stores = all<ManagedStorefront>("storefronts").filter(s => s.scopeType === "event" && s.scopeId === source.id && s.status !== "archived");
      const places = all<FloorPlace>("floor").filter(p => p.scopeType === "event" && p.scopeId === source.id && p.status !== "archived");
      const ids = new Map<string, string>([...stores, ...places].map(record => [record.id, randomUUID()]));
      stores.forEach(store => {
        const { legacyStoreId: _legacy, ...configuration } = store;
        save("storefronts", { ...configuration, ...base(ids.get(store.id)!, store.name), scopeId: event.id, commercialTerms: "", sectionIds: store.sectionIds.map(id => ids.get(id)).filter((id): id is string => !!id), qrToken: token() });
      });
      places.forEach(place => {
        const { legacyPlaceId: _legacy, ...configuration } = place;
        save("floor", { ...configuration, ...base(ids.get(place.id)!, place.name, "active"), scopeId: event.id, parentId: place.parentId ? ids.get(place.parentId) ?? null : null, storefrontId: place.storefrontId ? ids.get(place.storefrontId) ?? null : null, qrToken: place.kind === "section" ? null : token() });
      });
      log("events", event.id, user.name, `Cloned configuration from ${source.name}; commercial terms require review`); return event;
    });
    response.status(201).json(cloned);
  });
  for (const kind of ["storefronts", "floor"] as const) router.post(`/${kind}/:id/qr`, (request, response) => {
    const user = session(request);
    const input = z.object({ version: z.number().int().positive(), action: z.enum(["rotate", "disable"]) }).parse(request.body);
    const result = transaction(() => {
      const current = get<ManagedStorefront | FloorPlace>(kind, String(request.params.id)); allow(user, kind, current, true);
      if (current.version !== input.version) throw new BusinessError(409, "Changed elsewhere. Reload before continuing.");
      if (current.status === "archived" || (kind === "floor" && current.kind === "section")) throw new BusinessError(409, "QR is unavailable for this record");
      const updated = { ...current, version: current.version + 1, updatedAt: now(), qrToken: input.action === "rotate" ? token() : null };
      save(kind, updated); log(kind, updated.id, user.name, `QR ${input.action === "rotate" ? "rotated" : "disabled"}`); return updated;
    }); response.json(result);
  });
  function resolveEntry(qr: string) {
    if (!/^[a-f0-9]{48}$/.test(qr)) throw new BusinessError(404, "QR code not found");
    const store = all<ManagedStorefront>("storefronts").find(s => s.qrToken === qr);
    const place = store ? undefined : all<FloorPlace>("floor").find(p => p.qrToken === qr);
    const record = store ?? place;
    if (!record || record.status !== "active") throw new BusinessError(410, "This QR code is not active");
    const storefront = store ?? (place?.storefrontId ? get<ManagedStorefront>("storefronts", place.storefrontId) : null);
    const event = record.scopeType === "event" ? get<ManagedEvent>("events", record.scopeId) : null;
    const runtime = runtimeFor(record.scopeId);
    const live = !!runtime && runtime.snapshot.event.status === "live" && storefront?.status === "active" && runtime.snapshot.stores.some(s => s.id === (storefront.legacyStoreId ?? storefront.id));
    const table = place?.kind === "table" ? place : place?.kind === "seat" && place.parentId ? get<FloorPlace>("floor", place.parentId) : undefined;
    return { name: record.name, eventName: event?.name, guestBranding: branding.getBranding(record.scopeId), storefrontName: storefront?.name, open: live, ...(live ? { operationId: runtime!.id, storeId: storefront!.legacyStoreId ?? storefront!.id, tableId: table ? table.legacyPlaceId ?? table.id : undefined, seatId: place?.kind === "seat" ? place.legacyPlaceId ?? place.id : undefined } : {}) };
  }
  publicRouter.get("/:token", (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json(resolveEntry(String(request.params.token)));
  });
  return { router, publicRouter, resolveEntry, authorizeRuntime, runtimeFor, persistRuntime, getBranding: branding.getBranding, venueDependencies: (id: string) => [
    ...(runtimeFor(id) ? ["Published venue operation must be retained for service history"] : []),
    ...all<ManagedEvent>("events").filter(e => e.venueId === id && !["closed", "cancelled", "archived"].includes(e.status)).map(e => `Event ${e.name} is ${e.status}`),
    ...all<ManagedStorefront>("storefronts").filter(s => s.scopeType === "venue" && s.scopeId === id && s.status !== "archived").map(s => `Storefront ${s.name} is not archived`)
  ] };
}
