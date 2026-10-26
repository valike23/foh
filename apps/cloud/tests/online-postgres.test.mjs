import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createOnlineApp } from "../dist/online-app.js";
import { fetchWithHost as fetch } from "./http-helper.mjs";
import sharp from "sharp";

test("PostgreSQL onboarding persists records and isolates tenant sessions and venues", { skip: !process.env.DATABASE_URL && "Set DATABASE_URL and apply migrations to run PostgreSQL integration tests" }, async t => {
  const db = new PrismaClient();
  const slugs = [`test-a-${randomUUID()}`, `test-b-${randomUUID()}`];
  const app = createOnlineApp(db, { baseDomain: "localhost", publicOrigin: "http://app.localhost:4200" });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await db.tenant.deleteMany({ where: { slug: { in: slugs } } }); await db.$disconnect();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(host, path, { method = "GET", body, cookie, origin = `http://${host}`, extra = {} } = {}) {
    const response = await fetch(`${base}${path}`, { method, headers: { host, origin, "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0], cookieHeader: response.headers.get("set-cookie") };
  }
  const owner = { name: "Test Owner", email: "owner@example.test", password: "local-test-password-123" };
  const logo = await sharp({ create: { width: 400, height: 200, channels: 4, background: "#2563eb" } }).png().toBuffer();
  for (const slug of slugs) {
    const result = await request("app.localhost:4200", "/api/auth/signup", { method: "POST", body: { ...owner, organizationName: slug, slug, ...(slug === slugs[0] ? { brandColor: "#2563EB", brandLogo: `data:image/png;base64,${logo.toString("base64")}` } : {}) } });
    assert.equal(result.status, 201); assert.equal(result.body.workspaceUrl, `http://${slug}.localhost:4200`);
    assert.equal(result.cookie, undefined, "central signup must not issue a cross-tenant cookie");
  }
  assert.equal((await request("app.localhost:4200", "/api/auth/signup", { method: "POST", body: { ...owner, organizationName: "Duplicate", slug: slugs[0] } })).status, 409);
  const hosts = slugs.map(slug => `${slug}.localhost:4200`);
  const branded = await request(hosts[0], "/api/tenant");
  assert.equal(branded.body.tenant.brandColor, "#2563eb");
  assert.match(branded.body.tenant.brandLogo, /^data:image\/webp;base64,/);
  const normalized = await sharp(Buffer.from(branded.body.tenant.brandLogo.split(",")[1], "base64")).metadata();
  assert.equal(normalized.width, 256); assert.equal(normalized.height, 128);
  const defaultBranding = await request(hosts[1], "/api/tenant");
  assert.equal(defaultBranding.body.tenant.brandColor, null); assert.equal(defaultBranding.body.tenant.brandLogo, null);
  for (const invalid of [{ brandColor: "red" }, { brandColor: "#fff; background:url(evil)" }, { brandLogo: "data:image/svg+xml;base64,PHN2Zy8+" }, { brandLogo: "data:image/png;base64,bm90IGFuIGltYWdl" }]) {
    assert.equal((await request("app.localhost:4200", "/api/auth/signup", { method: "POST", body: { ...owner, organizationName: "Invalid branding", slug: slugs[0], ...invalid } })).status, 422);
  }
  assert.equal((await request(hosts[0], "/api/venues")).status, 401);
  const logins = [];
  for (const host of hosts) {
    const login = await request(host, "/api/auth/login", { method: "POST", body: { email: owner.email, password: owner.password } });
    assert.equal(login.status, 200); assert.match(login.cookieHeader, /HttpOnly/i); assert.match(login.cookieHeader, /SameSite=Strict/i); assert.doesNotMatch(login.cookieHeader, /Domain=/i);
    logins.push(login);
  }
  assert.equal((await request(hosts[1], "/api/auth/session", { cookie: logins[0].cookie })).status, 401);
  assert.equal((await request(hosts[0], "/api/venues", { method: "POST", cookie: logins[0].cookie, origin: `http://${hosts[1]}`, body: { name: "Forbidden venue" } })).status, 403);
  const created = await request(hosts[0], "/api/venues", { method: "POST", cookie: logins[0].cookie, body: { name: "Tenant A venue", address: "Lagos" } });
  assert.equal(created.status, 201);
  assert.equal((await request(hosts[1], `/api/venues/${created.body.id}`, { cookie: logins[1].cookie })).status, 404);
  async function post(path, body, status = 200) {
    const result = await request(hosts[0], path, { method: "POST", cookie: logins[0].cookie, body });
    assert.equal(result.status, status, `${path}: ${JSON.stringify(result.body)}`); return result.body;
  }
  const vendor = await post("/api/vendors", { name: "House vendor", kind: "internal", contactName: "", email: "", phone: "", notes: "" }, 201);
  await post(`/api/vendors/${vendor.id}/status`, { version: vendor.version, status: "active", reason: "Ready for service" });
  const storefront = await post("/api/storefronts", { name: "Main bar", scopeType: "venue", scopeId: created.body.id, vendorId: vendor.id, kind: "bar", prepStation: "Bar", manualConfirmation: true, fulfillment: "table", sectionIds: [], commercialTerms: "", notes: "" }, 201);
  await post(`/api/storefronts/${storefront.id}/status`, { version: storefront.version, status: "active", reason: "Ready for service" });
  const section = await post("/api/floor", { name: "Main room", scopeType: "venue", scopeId: created.body.id, kind: "section", parentId: null, storefrontId: null, capacity: 40 }, 201);
  const table = await post("/api/floor", { name: "Table 12", scopeType: "venue", scopeId: created.body.id, kind: "table", parentId: section.id, storefrontId: storefront.id, capacity: 4 }, 201);
  await post(`/api/operations/${created.body.id}/publish`, { scopeType: "venue", version: created.body.version });
  const service = `/api/operations/${created.body.id}/service`;
  assert.equal((await request(hosts[1], `${service}/snapshot`, { cookie: logins[1].cookie })).status, 404);
  const item = await post(`${service}/menu-items`, { storeId: storefront.id, name: "Chapman", category: "Drinks", price: 5000, quantity: 10, lowStockThreshold: 3, unit: "cups" }, 201);
  const operations = await request(hosts[0], "/api/operations", { cookie: logins[0].cookie });
  const operation = operations.body.items.find(o => o.id === created.body.id);
  assert.equal(operation.openingBlockers.length, 0);
  await post(`/api/operations/${created.body.id}/lifecycle`, { action: "open", revision: operation.revision, reason: "Start service" });
  const sale = await post(`${service}/orders`, { storeId: storefront.id, tableId: table.id, lines: [{ menuItemId: item.id, quantity: 2 }] }, 201);
  assert.equal(sale.status, "sent");
  await post(`${service}/payments`, { orderId: sale.id, amount: 10000, method: "cash" }, 409);
  assert.equal((await request(hosts[0], `${service}/orders/${sale.id}/status`, { method: "PATCH", cookie: logins[0].cookie, body: { status: "confirmed" } })).status, 200);
  await post(`${service}/payments`, { orderId: sale.id, amount: 10000, method: "cash" }, 201);
  await post(`${service}/payments`, { orderId: sale.id, amount: 10000, method: "cash" }, 409);
  const state = await request(hosts[0], `${service}/snapshot`, { cookie: logins[0].cookie });
  assert.equal(state.body.orders[0].status, "settled"); assert.equal(state.body.inventory[0].quantity, 8); assert.equal(state.body.payments.length, 1);
  const pending = await Promise.all([1, 2].map(() => post(`${service}/orders`, { storeId: storefront.id, lines: [{ menuItemId: item.id, quantity: 6 }] }, 201)));
  const competing = await Promise.all(pending.map(order => request(hosts[0], `${service}/orders/${order.id}/status`, { method: "PATCH", cookie: logins[0].cookie, body: { status: "confirmed" } })));
  assert.deepEqual(competing.map(r => r.status).sort(), [200, 409]);
  const afterRace = await request(hosts[0], `${service}/snapshot`, { cookie: logins[0].cookie });
  assert.equal(afterRace.body.inventory[0].quantity, 2);
  assert.equal((await request(hosts[1], "/api/venues", { cookie: logins[1].cookie, extra: { "x-tenant-id": created.body.organizationId, "x-forwarded-host": hosts[0] } })).body.items.length, 0);
  const restartedClient = new PrismaClient();
  try { assert.equal((await restartedClient.venue.findUnique({ where: { id: created.body.id } })).name, "Tenant A venue"); } finally { await restartedClient.$disconnect(); }
  await db.session.updateMany({ where: { tenantId: created.body.organizationId }, data: { expiresAt: new Date(0) } });
  assert.equal((await request(hosts[0], "/api/auth/session", { cookie: logins[0].cookie })).status, 401);
  await request(hosts[1], "/api/auth/logout", { method: "POST", body: {}, cookie: logins[1].cookie });
  assert.equal((await request(hosts[1], "/api/auth/session", { cookie: logins[1].cookie })).status, 401);
  assert.equal((await request("unknown.localhost:4200", "/api/tenant")).status, 404);
  assert.equal((await request("evil.example:4200", "/api/tenant")).status, 400);
});
