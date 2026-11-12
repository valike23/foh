import { config } from "dotenv";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import offline from "../dist/index.cjs";
import { createOnlineApp } from "../../cloud/dist/online-app.js";
import { provisionSnapshot } from "../../cloud/dist/workspace-runtime.js";
import { storefrontRecord } from "../../cloud/dist/storefront-repository.js";
import { fetchWithHost } from "../../cloud/tests/http-helper.mjs";
config({ path: "../cloud/.env", quiet: true });
const { LocalStore, createOfflineApp } = offline;

test("offline hub persists LAN sales, enforces roles, resumes sync without duplicates, and returns ownership safely", { skip: !process.env.DATABASE_URL }, async t => {
  const db = new PrismaClient(), slug = `offline-${randomUUID().slice(0, 8)}`, password = "offline-test-password", salt = randomBytes(16).toString("hex");
  const tenant = await db.tenant.create({ data: { slug, name: "Offline business", accounts: { create: ["owner", "cashier", "waiter", "prep", "viewer"].map(role => ({ name: role, email: `${role}@test.example`, role: role === "owner" ? "owner" : "staff", salt, passwordHash: scryptSync(password, salt, 64).toString("hex") })) } } });
  const dir = await mkdtemp(join(tmpdir(), "pricemate-offline-")), path = join(dir, "hub.sqlite");
  const cloud = createOnlineApp(db, { baseDomain: "localhost", publicOrigin: "http://app.localhost:4200" }).listen(0, "127.0.0.1"); await new Promise(r => cloud.once("listening", r));
  let localServer, store, hub, connected = true, loseAck = false, loseReleaseAck = false;
  const cloudHost = `${slug}.localhost:4200`;
  async function cloudRequest(path, body, cookie, extra = {}) {
    const response = await fetchWithHost(`http://127.0.0.1:${cloud.address().port}/api${path}`, { method: body ? "POST" : "GET", headers: { host: cloudHost, origin: `http://${cloudHost}`, "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  const call = async (connection, path, body, cookie) => {
    if (!connected) throw new Error("Internet disconnected");
    const result = await cloudRequest(path, body, cookie, cookie ? {} : { Authorization: `Bearer ${connection.deviceToken}`, "X-Exa-Device-Id": connection.deviceId });
    if (result.status >= 300) throw new Error(result.data.error);
    if (loseAck && path === "/offline/push") { loseAck = false; throw new Error("Connection lost after cloud commit"); }
    if (loseReleaseAck && path === "/offline/release") { loseReleaseAck = false; throw new Error("Connection lost after cloud release"); }
    return result;
  };
  async function start() {
    store = new LocalStore(path); hub = createOfflineApp(store, { call }); localServer = hub.app.listen(0, "127.0.0.1"); await new Promise(r => localServer.once("listening", r));
  }
  async function stop() { hub.worker.stop(); localServer.closeAllConnections(); await new Promise(r => localServer.close(r)); store.close(); }
  t.after(async () => { if (localServer?.listening) await stop(); cloud.closeAllConnections(); await new Promise(r => cloud.close(r)); await db.tenant.delete({ where: { id: tenant.id } }); await db.$disconnect(); await rm(dir, { recursive: true, force: true }); });
  const venue = await db.venue.create({ data: { tenantId: tenant.id, name: "Local branch", status: "active" } });
  const storefront = await db.storefront.create({ data: { tenantId: tenant.id, venueId: venue.id, vendorId: "house", name: "Counter", kind: "kitchen", fulfillment: "pickup", sectionIds: [], manualConfirmation: true, status: "active" } });
  for (const role of ["cashier", "waiter", "prep", "viewer"]) {
    const account = await db.account.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email: `${role}@test.example` } } });
    await db.staffAssignment.create({ data: { tenantId: tenant.id, accountId: account.id, storefrontId: storefront.id, role } });
  }
  const snapshot = provisionSnapshot(venue, "venue", [storefrontRecord(storefront)], [{ id: "house", name: "House", kind: "internal" }], []); snapshot.event.status = "live";
  snapshot.menuItems.push({ id: "rice", storeId: storefront.id, name: "Rice", category: "Food", price: 2500, stockItemId: "stock", available: true, modifiers: [] }); snapshot.inventory.push({ id: "stock", storeId: storefront.id, name: "Rice", quantity: 20, unit: "plates", lowStockThreshold: 2 });
  await db.workspaceRecord.create({ data: { tenantId: tenant.id, kind: "runtime", id: venue.id, data: snapshot } });
  await start();
  async function request(path, body, cookie, method = body ? "POST" : "GET", origin) {
    const response = await fetch(`http://127.0.0.1:${localServer.address().port}/api${path}`, { method, headers: { Origin: origin ?? `http://127.0.0.1:${localServer.address().port}`, "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  const setupKey = store.meta("setupKey");
  assert.equal((await request("/offline/connect", { setupKey: "bad", cloudUrl: "https://example.test", email: "owner@test.example", password })).status, 403);
  const connection = await request("/offline/connect", { setupKey, cloudUrl: `http://${cloudHost}`, email: "owner@test.example", password }); assert.equal(connection.status, 200, JSON.stringify(connection));
  assert.equal((await request("/offline/activate", { setupKey, ticket: connection.data.ticket, operationId: venue.id, name: "Test hub" })).status, 200);
  const ownerCloud = (await cloudRequest("/auth/login", { email: "owner@test.example", password })).cookie;
  assert.equal((await cloudRequest(`/operations/${venue.id}/service/orders`, { storeId: storefront.id, lines: [{ menuItemId: "rice", quantity: 1 }] }, ownerCloud)).status, 409, "cloud cannot sell stock owned by the hub");
  const credentials = role => ({ email: `${role}@test.example`, password });
  connected = false;
  const cashier = await request("/pos/auth/login", credentials("cashier")); assert.equal(cashier.status, 200);
  assert.ok(!JSON.stringify(cashier.data).includes("passwordHash"));
  const waiter = await request("/auth/login", credentials("waiter")), prep = await request("/auth/login", credentials("prep"));
  assert.equal(waiter.status, 200); assert.equal(prep.status, 200);
  const service = `/operations/${venue.id}/service`, saleInput = { requestId: randomUUID(), storeId: storefront.id, lines: [{ menuItemId: "rice", quantity: 2 }] };
  const sale = await request(`/pos${service}/orders`, saleInput, cashier.cookie); assert.equal(sale.status, 201, JSON.stringify(sale)); assert.equal(sale.data.status, "confirmed");
  const paymentInput = { requestId: randomUUID(), orderId: sale.data.id, amount: 5000, method: "cash" };
  assert.equal((await request(`/pos${service}/payments`, paymentInput, cashier.cookie)).status, 201);
  assert.equal((await request(`${service}/payments`, paymentInput, waiter.cookie)).status, 403);
  const waiterOrder = await request(`${service}/orders`, { storeId: storefront.id, lines: [{ menuItemId: "rice", quantity: 1 }] }, waiter.cookie); assert.equal(waiterOrder.data.status, "sent");
  assert.equal((await request(`${service}/orders/${waiterOrder.data.id}/status`, { status: "confirmed" }, prep.cookie, "PATCH")).status, 200);
  assert.equal((await request(`/pos${service}/payments`, {}, cashier.cookie, "POST", "https://evil.example")).status, 403);
  const queued = store.status().pending; assert.ok(queued >= 4);
  await hub.worker.run(); assert.equal(store.status().pending, queued); assert.match(store.status().lastError, /disconnected/);
  await stop(); await start();
  assert.equal(store.status().pending, queued, "outbox survives restart");
  const restartedCashier = await request("/pos/auth/login", credentials("cashier")); assert.equal(restartedCashier.status, 200);
  connected = true; loseAck = true;
  await hub.worker.run(); assert.ok(store.pending().length > 0); assert.match(store.status().lastError, /cloud commit/);
  await hub.worker.run(); assert.equal(store.pending().length, 0, store.status().lastError); assert.equal(store.status().lastError, null);
  const synced = await db.workspaceRecord.findUnique({ where: { tenantId_kind_id: { tenantId: tenant.id, kind: "runtime", id: venue.id } } });
  assert.equal(synced.data.orders.length, 2); assert.equal(synced.data.payments.length, 1); assert.equal(synced.data.inventory[0].quantity, 17);
  const cashierAccount = await db.account.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email: "cashier@test.example" } } });
  await db.account.update({ where: { id: cashierAccount.id }, data: { active: false } }); await hub.worker.run();
  assert.equal((await request("/pos/auth/session", undefined, restartedCashier.cookie)).status, 401, "cloud staff revocation invalidates the local session");
  assert.equal((await request("/pos/auth/login", credentials("cashier"))).status, 401);
  store.setMeta("staffValidUntil", new Date(Date.now() - 1000).toISOString());
  assert.equal((await request("/auth/login", credentials("owner"))).status, 403, "expired offline credentials cannot be used indefinitely");
  await hub.worker.run();
  assert.equal((await request("/auth/login", credentials("owner"))).status, 200, "a cloud refresh restores eligible staff access");
  loseReleaseAck = true;
  await assert.rejects(hub.worker.release(), /after cloud release/);
  assert.equal(store.meta("handover"), true);
  await hub.worker.release();
  assert.equal((await request(`${service}/orders`, { storeId: storefront.id, lines: [{ menuItemId: "rice", quantity: 1 }] }, waiter.cookie)).status, 409);
  assert.equal((await cloudRequest(`/operations/${venue.id}/service/orders`, { storeId: storefront.id, lines: [{ menuItemId: "rice", quantity: 1 }] }, ownerCloud)).status, 201);
});
