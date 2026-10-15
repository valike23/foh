import test from "node:test";
import sharp from "sharp";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, scryptSync } from "node:crypto";

test("published operations isolate service state, enforce sessions and gate guest ordering and close-out", async t => {
  const directory = mkdtempSync(join(tmpdir(), "exa-operations-"));
  const dbPath = join(directory, "hub.sqlite");
  let processHandle; let root; let token;
  async function start() {
    processHandle = spawn(process.execPath, [resolve("apps/hub/dist/server.js")], { env: { ...process.env, PORT: "0", HOST: "127.0.0.1", HUB_DB_PATH: dbPath, HUB_STATE_PATH: join(directory, "no-legacy.json"), CLOUD_SYNC_URL: "" }, stdio: ["ignore", "pipe", "pipe"] });
    root = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error(`Hub startup timeout: ${output}`)), 10000);
      processHandle.stdout.on("data", chunk => { output += chunk; const match = output.match(/running on (http:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
      processHandle.stderr.on("data", chunk => { output += chunk; });
      processHandle.once("exit", code => { clearTimeout(timer); reject(new Error(`Hub exited ${code}: ${output}`)); });
    });
  }
  async function stop() { if (processHandle && processHandle.exitCode === null) { const exited = new Promise(resolve => processHandle.once("exit", resolve)); processHandle.kill("SIGTERM"); await exited; } }
  t.after(async () => { await stop(); rmSync(directory, { recursive: true, force: true }); });
  await start();
  async function request(path, { method = "GET", body, auth = token, operation, headers = {} } = {}) {
    const response = await fetch(`${root}${path}`, { method, headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(operation ? { "X-Operation-Id": operation } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  async function ok(path, options, expected = 200) { const result = await request(path, options); assert.equal(result.status, expected, `${path}: ${JSON.stringify(result.body)}`); return result.body; }
  const post = (path, body, operation) => ok(path, { method: "POST", body, operation }, 201);
  const setup = await post("/api/manage/auth/setup", { name: "Runtime Owner", email: "owner@runtime.test", password: "test-runtime-password", setupKey: readFileSync(`${dbPath}.setup-key`, "utf8") });
  token = setup.token;
  const legacyId = (await ok("/health")).eventId;
  const before = await ok("/api/snapshot", { operation: legacyId });
  assert.equal((await request("/api/snapshot", { auth: null, headers: { "x-user-id": "user-admin" } })).status, 401);
  assert.equal((await request("/api/snapshot")).status, 400);
  assert.equal((await request("/api/auth/device-sessions", { method: "POST", body: { userId: "user-admin" }, operation: legacyId })).status, 409);
  const vendor = await post("/api/manage/vendors", { name: "Independent Vendor", kind: "internal", contactName: "", email: "", phone: "", notes: "" });
  const events = [];
  for (const name of ["Operation Alpha", "Operation Beta"]) {
    let event = await post("/api/manage/events", { name, venueId: null, location: "Temporary Lagos venue", timezone: "Africa/Lagos", startsAt: "2026-10-01T16:00:00Z", endsAt: "2026-10-02T02:00:00Z", organizer: "Owner", notes: "" });
    let store = await post("/api/manage/storefronts", { name: `${name} bar`, scopeType: "event", scopeId: event.id, vendorId: vendor.id, kind: "bar", prepStation: "Counter", manualConfirmation: false, fulfillment: "pickup", sectionIds: [], commercialTerms: "", notes: "" });
    store = await ok(`/api/manage/storefronts/${store.id}/status`, { method: "POST", body: { version: store.version, status: "active", reason: "Ready for service" } });
    event = await ok(`/api/manage/events/${event.id}/status`, { method: "POST", body: { version: event.version, status: "ready", reason: "Setup checked" } });
    const runtime = await post(`/api/manage/operations/${event.id}/publish`, { scopeType: "event", version: event.version });
    assert.equal(runtime.status, "setup");
    const state = await ok("/api/snapshot", { operation: event.id });
    for (const key of ["orders", "payments", "inventory", "menuItems", "stockMovements", "operatingPeriods", "staffAssignments", "deviceSessions"]) assert.equal(state[key].length, 0, key);
    assert.equal(state.stores[0].id, store.id);
    assert.equal(state.stores[0].prepStation, "Counter");
    assert.equal((await request(`/api/manage/operations/${event.id}/publish`, { method: "POST", body: { scopeType: "event", version: event.version } })).status, 409);
    assert.equal((await request(`/api/manage/operations/${event.id}/lifecycle`, { method: "POST", body: { revision: runtime.revision, action: "open", reason: "Open now" } })).status, 409);
    const item = await post("/api/menu-items", { storeId: store.id, name: `${name} water`, category: "Drinks", price: 1000, unit: "bottle", quantity: 10, lowStockThreshold: 1 }, event.id);
    events.push({ event, store, item: item.menuItem });
  }
  async function lifecycle(id, action, expected = 200, revision) {
    const operation = (await ok("/api/manage/operations")).items.find(o => o.id === id);
    return ok(`/api/manage/operations/${id}/lifecycle`, { method: "POST", body: { revision: revision ?? operation.revision, action, reason: "Test lifecycle change" } }, expected);
  }
  const [a, b] = events;
  const photoPath = `/api/menu-items/${a.item.id}/image`;
  const photoBody = { base64: (await sharp({ create: { width: 100, height: 100, channels: 3, background: "#e8eeee" } }).png().toBuffer()).toString("base64"), expectedImageId: null };
  assert.equal((await request(photoPath, { method: "PATCH", operation: a.event.id, auth: null, body: photoBody })).status, 401);
  assert.equal((await request(photoPath, { method: "PATCH", operation: b.event.id, body: photoBody })).status, 404);
  assert.equal((await request(photoPath, { method: "PATCH", operation: a.event.id, body: { ...photoBody, base64: "bm90LWFuLWltYWdl" } })).status, 400);
  const photoItem = await ok(photoPath, { method: "PATCH", operation: a.event.id, body: photoBody });
  assert.ok(photoItem.imageId);
  assert.equal((await request(photoPath, { method: "PATCH", operation: a.event.id, body: photoBody })).status, 409);
  const photo = await fetch(`${root}/api/menu-images/${photoItem.imageId}`);
  assert.equal(photo.headers.get("content-type"), "image/webp");
  assert.equal((await sharp(Buffer.from(await photo.arrayBuffer())).metadata()).width, 100);
  const otherPhotoPath = `/api/menu-items/${b.item.id}/image`;
  const firstPhoto = await ok(otherPhotoPath, { method: "PATCH", operation: b.event.id, body: photoBody });
  const replacement = await ok(otherPhotoPath, { method: "PATCH", operation: b.event.id, body: { ...photoBody, expectedImageId: firstPhoto.imageId } });
  assert.notEqual(firstPhoto.imageId, replacement.imageId);
  const removed = await ok(otherPhotoPath, { method: "PATCH", operation: b.event.id, body: { base64: null, expectedImageId: replacement.imageId } });
  assert.equal(removed.imageId, undefined);
  await lifecycle(a.event.id, "open"); await lifecycle(b.event.id, "open");
  const guest = await ok(`/api/guest/snapshot?entryToken=${a.store.qrToken}`, { auth: null });
  assert.equal(guest.stores.length, 1); assert.equal(guest.orders.length, 0); assert.equal(guest.users.length, 0); assert.equal(guest.inventory.length, 0);
  assert.equal(guest.menuItems[0].imageId, photoItem.imageId);
  assert.equal((await request("/api/guest/snapshot", { auth: null })).status, 401);
  const payload = { storeId: a.store.id, entryToken: a.store.qrToken, origin: "guest-self-order", createdBy: "Guest", lines: [{ menuItemId: a.item.id, quantity: 2 }] };
  assert.equal((await request("/api/orders", { auth: null, method: "POST", body: { ...payload, lines: [{ menuItemId: b.item.id, quantity: 1 }] } })).status, 400);
  assert.equal((await request("/api/orders", { auth: null, method: "POST", body: { ...payload, lines: [{ menuItemId: a.item.id, quantity: 6 }, { menuItemId: a.item.id, quantity: 6 }] } })).status, 400);
  const order = await post("/api/orders", payload);
  assert.equal(order.eventId, a.event.id);
  const [aState, bState] = await Promise.all([ok("/api/snapshot", { operation: a.event.id }), ok("/api/snapshot", { operation: b.event.id })]);
  assert.equal(aState.orders.length, 1); assert.equal(aState.inventory[0].quantity, 8);
  assert.equal(bState.orders.length, 0); assert.equal(bState.inventory[0].quantity, 10);
  assert.equal((await request(`/api/orders/${order.id}/status`, { operation: b.event.id, method: "PATCH", body: { status: "confirmed" } })).status, 404);
  await lifecycle(a.event.id, "pause");
  assert.equal((await request("/api/orders", { auth: null, method: "POST", body: payload })).status, 409);
  await lifecycle(a.event.id, "close", 409);
  await lifecycle(a.event.id, "open");
  await lifecycle(a.event.id, "pause", 409, 1);
  await post("/api/payments", { orderId: order.id, amount: order.totals.total, method: "cash" }, a.event.id);
  const paid = await ok("/api/snapshot", { operation: a.event.id });
  for (const register of paid.registerSessions) await ok(`/api/register-sessions/${register.id}/close`, { method: "PATCH", operation: a.event.id, body: { declaredCash: order.totals.total } });
  await lifecycle(a.event.id, "close");
  assert.equal((await request("/api/menu-items", { operation: a.event.id, method: "POST", body: {} })).status, 409);
  assert.equal((await ok(`/api/manage/entry/${a.store.qrToken}`, { auth: null })).open, false);
  const sql = new DatabaseSync(dbPath);
  const manager = { id: randomUUID(), name: "Unassigned manager", email: "manager@runtime.test", role: "manager", venueIds: [], organizationId: "org-exa-demo", salt: "salt", passwordHash: scryptSync("manager-password", "salt", 64).toString("hex"), active: true };
  sql.prepare("INSERT INTO management_accounts VALUES (?, ?, ?)").run(manager.id, manager.email, JSON.stringify(manager));
  const login = await ok("/api/manage/auth/login", { method: "POST", body: { email: manager.email, password: "manager-password" } });
  assert.equal((await request("/api/snapshot", { operation: a.event.id, auth: login.token, headers: { "x-user-id": "user-admin" } })).status, 403);
  assert.equal((await ok("/api/manage/operations", { auth: login.token })).items.length, 0);
  sql.close();
  await stop(); await start();
  assert.equal((await ok("/api/snapshot", { operation: a.event.id })).menuItems[0].imageId, photoItem.imageId);
  assert.equal((await fetch(`${root}/api/menu-images/${photoItem.imageId}`)).status, 200);
  assert.equal((await ok("/api/snapshot", { operation: a.event.id })).orders.length, 1);
  assert.equal((await ok("/api/snapshot", { operation: b.event.id })).orders.length, 0);
  const after = await ok("/api/snapshot", { operation: legacyId });
  assert.deepEqual(after.orders, before.orders); assert.deepEqual(after.inventory, before.inventory);
  await ok("/api/manage/auth/logout", { method: "POST", body: {} });
  assert.equal((await request("/api/snapshot", { operation: a.event.id })).status, 401);
});
