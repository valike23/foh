import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createOnlineApp } from "../dist/online-app.js";
import { fetchWithHost as fetch } from "./http-helper.mjs";

test("dedicated storefront persistence and scoped staff roles enforce read, write and account revocation", { skip: !process.env.DATABASE_URL }, async t => {
  const db = new PrismaClient(); const slug = `roles-${randomUUID()}`; const otherSlug = `other-${randomUUID()}`;
  const server = createOnlineApp(db, { baseDomain: "localhost", publicOrigin: "http://app.localhost:4200" }).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await db.tenant.deleteMany({ where: { slug: { in: [slug, otherSlug] } } }); await db.$disconnect(); });
  const host = `${slug}.localhost:4200`; const password = "staff-local-password-123";
  async function request(path, { method = "GET", body, cookie, hostname = host, status = 200 } = {}) {
    const r = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { host: hostname, origin: `http://${hostname}`, "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await r.json(); if (status !== null) assert.equal(r.status, status, `${method} ${path}: ${JSON.stringify(data)}`); return { status: r.status, data, cookie: r.headers.get("set-cookie")?.split(";")[0] };
  }
  for (const name of [slug, otherSlug]) await request("/api/auth/signup", { hostname: "app.localhost:4200", method: "POST", status: 201, body: { slug: name, organizationName: name, name: "Owner", email: "owner@test.example", password } });
  const owner = (await request("/api/auth/login", { method: "POST", body: { email: "owner@test.example", password } })).cookie;
  const post = async (path, body, status = 200, cookie = owner) => (await request(path, { method: "POST", body, status, cookie })).data;
  const v1 = await post("/api/venues", { name: "Lekki branch" }, 201); const v2 = await post("/api/venues", { name: "Ikeja branch" }, 201);
  const vendor = await post("/api/vendors", { name: "House vendor", kind: "internal", contactName: "", email: "", phone: "", notes: "" }, 201);
  await post(`/api/vendors/${vendor.id}/status`, { status: "active", version: 1, reason: "Ready" });
  const stores = [];
  for (const [name, venue] of [["Bar", v1], ["Kitchen", v1], ["Ikeja bar", v2]]) {
    const store = await post("/api/storefronts", { name, scopeType: "venue", scopeId: venue.id, vendorId: vendor.id, kind: "bar", prepStation: "", manualConfirmation: true, fulfillment: "pickup", sectionIds: [], commercialTerms: "", notes: "" }, 201);
    await post(`/api/storefronts/${store.id}/status`, { status: "active", version: 1, reason: "Ready" }); stores.push(store);
  }
  assert.equal(await db.workspaceRecord.count({ where: { kind: "storefronts", tenant: { slug } } }), 0);
  assert.equal(await db.storefront.count({ where: { tenant: { slug } } }), 3);
  await post(`/api/operations/${v1.id}/publish`, { scopeType: "venue", version: 1 });
  const menus = [];
  for (const store of stores.slice(0, 2)) menus.push(await post(`/api/operations/${v1.id}/service/menu-items`, { storeId: store.id, name: "Test item", category: "Food", price: 1000, quantity: 10, lowStockThreshold: 2, unit: "plates" }, 201));
  const ops = (await request("/api/operations", { cookie: owner })).data;
  await post(`/api/operations/${v1.id}/lifecycle`, { action: "open", reason: "Open service", revision: ops.items.find(v => v.id === v1.id).revision });
  const assign = (role, venueId = null, storefrontId = null) => ({ role, venueId, storefrontId });
  const accounts = {};
  for (const [name, assignments] of Object.entries({ manager: [assign("venue-manager", v1.id)], outlet: [assign("storefront-manager", null, stores[0].id)], cashier: [assign("cashier", null, stores[0].id)], prep: [assign("prep", null, stores[0].id)], waiter: [assign("waiter", null, stores[0].id)], viewer: [assign("viewer", null, stores[0].id)], mixed: [assign("cashier", null, stores[0].id), assign("prep", null, stores[1].id)] })) {
    const staff = await post("/api/staff", { name: `${name} staff`, email: `${name}@test.example`, password, assignments }, 201);
    accounts[name] = { ...staff, cookie: (await request("/api/auth/login", { method: "POST", body: { email: staff.email, password } })).cookie };
  }
  await post("/api/staff", { name: "Invalid role", email: "invalid@test.example", password, assignments: [assign("cashier", v1.id)] }, 422);
  const otherTenant = await db.tenant.findUnique({ where: { slug: otherSlug } });
  const foreign = await db.venue.create({ data: { tenantId: otherTenant.id, name: "Other business" } });
  await post("/api/staff", { name: "Foreign scope", email: "foreign@test.example", password, assignments: [assign("venue-manager", foreign.id)] }, 422);
  await assert.rejects(db.staffAssignment.create({ data: { tenantId: otherTenant.id, accountId: accounts.cashier.id, role: "venue-manager", venueId: foreign.id } }), /Foreign key/);
  for (const name of ["manager", "outlet", "cashier", "prep", "waiter", "viewer", "mixed"]) {
    const cookie = accounts[name].cookie;
    await request("/api/staff", { cookie, status: 403 });
    await request(`/api/venues/${v2.id}`, { cookie, status: 403 });
    await request(`/api/storefronts/${stores[2].id}`, { cookie, status: 403 });
    const visible = (await request("/api/storefronts", { cookie })).data;
    assert.equal(visible.total, ["manager", "mixed"].includes(name) ? 2 : 1);
    assert.equal(visible.counts.total, visible.total);
    const snapshot = (await request(`/api/operations/${v1.id}/service/snapshot`, { cookie })).data;
    assert.equal(snapshot.stores.length, visible.total);
    assert.equal(snapshot.auditLog.length, 0);
  }
  const order = await post(`/api/operations/${v1.id}/service/orders`, { storeId: stores[0].id, lines: [{ menuItemId: menus[0].id, quantity: 1 }] }, 201, accounts.waiter.cookie);
  assert.equal(order.totals.total, 0, "waiter response must not disclose financial totals");
  await post(`/api/operations/${v1.id}/service/orders`, { storeId: stores[1].id, lines: [{ menuItemId: menus[1].id, quantity: 1 }] }, 403, accounts.cashier.cookie);
  await post(`/api/operations/${v1.id}/service/orders`, { storeId: stores[0].id, lines: [{ menuItemId: menus[0].id, quantity: 1 }] }, 403, accounts.viewer.cookie);
  await request(`/api/operations/${v1.id}/service/orders/${order.id}/status`, { method: "PATCH", cookie: accounts.cashier.cookie, body: { status: "confirmed" }, status: 403 });
  await request(`/api/operations/${v1.id}/service/orders/${order.id}/status`, { method: "PATCH", cookie: accounts.prep.cookie, body: { status: "confirmed" } });
  await post(`/api/operations/${v1.id}/service/payments`, { orderId: order.id, amount: 1000, method: "cash" }, 403, accounts.prep.cookie);
  await post(`/api/operations/${v1.id}/service/payments`, { orderId: order.id, amount: 1000, method: "cash" }, 201, accounts.cashier.cookie);
  assert.equal((await request(`/api/operations/${v1.id}/service/snapshot`, { cookie: accounts.prep.cookie })).data.payments.length, 0);
  assert.equal((await request(`/api/operations/${v1.id}/service/snapshot`, { cookie: accounts.cashier.cookie })).data.payments.length, 1);
  await post(`/api/operations/${v1.id}/lifecycle`, { action: "pause", revision: 1, reason: "Pause service" }, 403, accounts.outlet.cookie);
  const latest = (await request("/api/operations", { cookie: accounts.manager.cookie })).data.items.find(v => v.id === v1.id);
  assert.equal(latest.canManage, true);
  const floorInput = { name: "Garden section", scopeType: "venue", scopeId: v1.id, kind: "section", parentId: null, storefrontId: null, capacity: 30 };
  const blockedFloor = await request("/api/floor", { method: "POST", cookie: accounts.manager.cookie, body: floorInput, status: 409 });
  assert.equal(blockedFloor.data.action.href, `/operations?operation=${v1.id}`);
  assert.match(blockedFloor.data.error, /Pause service/);
  await post(`/api/operations/${v1.id}/lifecycle`, { action: "pause", revision: latest.revision, reason: "Pause service" }, 200, accounts.manager.cookie);
  const floor = await post("/api/floor", floorInput, 201, accounts.manager.cookie);
  const table = await post("/api/floor", { name: "Garden table", scopeType: "venue", scopeId: v1.id, kind: "table", parentId: floor.id, storefrontId: stores[0].id, capacity: 4 }, 201, accounts.manager.cookie);
  const updatedService = (await request(`/api/operations/${v1.id}/service/snapshot`, { cookie: owner })).data;
  assert.equal(updatedService.sections.find(s => s.id === floor.id).label, "Garden section"); assert.ok(updatedService.tables.some(t => t.id === table.id));
  assert.equal(updatedService.orders.length, 1); assert.equal(updatedService.payments.length, 1); assert.equal(updatedService.inventory.find(s => s.id === menus[0].stockItemId).quantity, 9);
  const currentRevision = (await request("/api/operations", { cookie: accounts.manager.cookie })).data.items.find(v => v.id === v1.id).revision;
  const race = await Promise.all([
    request("/api/floor", { method: "POST", cookie: accounts.manager.cookie, body: { ...floorInput, name: "Race section" }, status: null }),
    request(`/api/operations/${v1.id}/lifecycle`, { method: "POST", cookie: accounts.manager.cookie, body: { action: "open", revision: currentRevision, reason: "Resume service" }, status: null })
  ]);
  assert.ok([201, 409].includes(race[0].status)); assert.ok([200, 409].includes(race[1].status));
  assert.notEqual(`${race[0].status}:${race[1].status}`, "201:200", "a stale lifecycle revision must not race successfully with a floor update");
  // Lifecycle/floor race is covered by the shared optimistic revision; regardless
  // of winner, no floor/configuration write may silently overwrite the other.
  const afterRace = (await request(`/api/operations/${v1.id}/service/snapshot`, { cookie: owner })).data;
  assert.equal(afterRace.orders.length, 1); assert.equal(afterRace.payments.length, 1);
  const venue = (await request(`/api/venues/${v1.id}`, { cookie: accounts.manager.cookie })).data;
  assert.equal(venue.canEdit, true);
  assert.equal((await request(`/api/storefronts/${stores[0].id}`, { cookie: accounts.outlet.cookie })).data.canEdit, true);
  await request(`/api/storefronts/${stores[1].id}`, { method: "PATCH", cookie: accounts.outlet.cookie, body: {}, status: 403 });
  await post("/api/staff", { name: "Duplicate scopes", email: "duplicate@test.example", password, assignments: [assign("cashier", null, stores[0].id), assign("cashier", null, stores[0].id)] }, 422);
  const event = await post("/api/events", { name: "Venue dinner", venueId: v1.id, location: "", timezone: "Africa/Lagos", startsAt: "2027-01-01T18:00:00Z", endsAt: "2027-01-01T23:00:00Z", organizer: "Owner", notes: "" }, 201, accounts.manager.cookie);
  const eventStore = await post("/api/storefronts", { name: "Dinner counter", scopeType: "event", scopeId: event.id, vendorId: vendor.id, kind: "kitchen", prepStation: "", manualConfirmation: true, fulfillment: "pickup", sectionIds: [], commercialTerms: "", notes: "" }, 201, accounts.manager.cookie);
  assert.ok(await db.storefront.findUnique({ where: { id: eventStore.id } }));
  await request(`/api/storefronts/${eventStore.id}`, { cookie: accounts.manager.cookie });
  await request(`/api/storefronts/${eventStore.id}`, { cookie: accounts.cashier.cookie, status: 403 });
  const cloned = await post(`/api/events/${event.id}/clone`, { name: "Next dinner", startsAt: "2027-01-02T18:00:00Z", endsAt: "2027-01-02T23:00:00Z" }, 201, accounts.manager.cookie);
  assert.equal(await db.storefront.count({ where: { eventId: cloned.id } }), 1, "event cloning must use the new storefront table");
  await request(`/api/staff/${accounts.cashier.id}`, { method: "PATCH", cookie: owner, body: { active: false, assignments: [assign("cashier", null, stores[0].id)] } });
  await request("/api/auth/session", { cookie: accounts.cashier.cookie, status: 401 });
  await request("/api/auth/login", { method: "POST", body: { email: accounts.cashier.email, password }, status: 401 });
  await post(`/api/staff/${accounts.prep.id}/password`, { password: "replacement-password-123" });
  await request("/api/auth/session", { cookie: accounts.prep.cookie, status: 401 });
});
