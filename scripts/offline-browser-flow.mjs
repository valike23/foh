import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { networkInterfaces } from "node:os";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import offline from "../apps/offline/dist/index.cjs";
import { provisionSnapshot } from "../apps/cloud/dist/workspace-runtime.js";
import { storefrontRecord } from "../apps/cloud/dist/storefront-repository.js";
config({ path: "apps/cloud/.env", quiet: true });
const db = new PrismaClient(), slug = `lan-${randomUUID().slice(0, 8)}`, password = "lan-browser-password-123", salt = randomBytes(16).toString("hex");
const file = resolve("test-results/offline-lan/hub.sqlite"), local = new offline.LocalStore(file);
function clearTestHub() { local.db.exec("BEGIN IMMEDIATE; DELETE FROM documents; DELETE FROM sessions; DELETE FROM outbox; DELETE FROM metadata WHERE key NOT IN ('setupKey','deviceId','deviceToken'); COMMIT;"); }
clearTestHub();
const tenant = await db.tenant.create({ data: { slug, name: "LAN restaurant", accounts: { create: ["owner", "cashier", "waiter", "prep"].map(role => ({ name: role, email: `${role}@example.test`, role: role === "owner" ? "owner" : "staff", salt, passwordHash: scryptSync(password, salt, 64).toString("hex") })) } } });
const browser = await chromium.launch({ headless: true });
const ownerContext = await browser.newContext(), tillContext = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 1000 } }), waiterContext = await browser.newContext({ viewport: { width: 820, height: 1180 } }), prepContext = await browser.newContext();
const origin = "http://127.0.0.1:5380";
const lan = Object.values(networkInterfaces()).flat().find(a => a && a.family === "IPv4" && !a.internal)?.address;
const deviceOrigin = lan ? `http://${lan}:5380` : origin;
try {
  await mkdir("test-results/offline-lan", { recursive: true });
  const venue = await db.venue.create({ data: { tenantId: tenant.id, name: "Local branch", status: "active" } });
  const storefront = await db.storefront.create({ data: { tenantId: tenant.id, venueId: venue.id, vendorId: "house", name: "Kitchen", kind: "kitchen", fulfillment: "pickup", sectionIds: [], status: "active", manualConfirmation: true } });
  for (const role of ["cashier", "waiter", "prep"]) { const account = await db.account.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email: `${role}@example.test` } } }); await db.staffAssignment.create({ data: { tenantId: tenant.id, accountId: account.id, role, storefrontId: storefront.id } }); }
  const s = provisionSnapshot(venue, "venue", [storefrontRecord(storefront)], [{ id: "house", name: "House", kind: "internal" }], []); s.event.status = "live";
  s.menuItems.push({ id: "rice", storeId: storefront.id, name: "Jollof rice", category: "Food", price: 2500, stockItemId: "stock", available: true, modifiers: [] }); s.inventory.push({ id: "stock", storeId: storefront.id, name: "Rice", quantity: 20, unit: "plates", lowStockThreshold: 2 });
  await db.workspaceRecord.create({ data: { tenantId: tenant.id, kind: "runtime", id: venue.id, data: s } });
  const owner = await ownerContext.newPage(); owner.setDefaultTimeout(30000);
  await owner.goto(origin + "/offline/setup");
  await owner.getByLabel(/^Hub setup key/).fill((await readFile(file + ".setup-key.txt", "utf8")).trim());
  await owner.getByLabel("Online business URL", { exact: true }).fill(`http://${slug}.localhost:5173`);
  await owner.getByLabel("Owner email", { exact: true }).fill("owner@example.test"); await owner.getByLabel("Owner password", { exact: true }).fill(password);
  const connectResponse = owner.waitForResponse(r => r.url().includes("/offline/connect")); await owner.getByRole("button", { name: "Connect online account", exact: true }).click(); const connected = await connectResponse; assert.equal(connected.status(), 200, (await connected.json()).error); await owner.getByLabel(/^Venue or event/).selectOption(venue.id);
  await owner.getByRole("button", { name: "Download and activate", exact: true }).click(); await expect(owner.getByRole("heading", { name: "Your local workspace is ready", exact: true })).toBeVisible();
  const connection = local.meta("connection"); assert.equal(connection.name, "Venue hub");
  local.setMeta("connection", { ...connection, cloudUrl: "http://127.0.0.1:1" }); // Cloud unavailable; LAN remains up.
  async function login(page, role, path = "/login", base = deviceOrigin) {
    page.setDefaultTimeout(30000); await page.goto(base + path); await page.getByLabel("Email", { exact: true }).fill(`${role}@example.test`); await page.getByLabel("Password", { exact: true }).fill(password); await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  const till = await tillContext.newPage(); await login(till, "cashier", "/pos"); await till.getByRole("button", { name: "Enter full-screen POS", exact: true }).click();
  await till.getByRole("button", { name: "Add Jollof rice", exact: true }).tap(); await till.getByRole("button", { name: "Save sale & checkout", exact: true }).click(); await till.getByLabel("Cash received", { exact: true }).fill("3000"); await till.getByRole("button", { name: /Record .* payment/ }).click(); await expect(till.getByText("Paid in full", { exact: true })).toBeVisible();
  const waiter = await waiterContext.newPage(); await login(waiter, "waiter"); await waiter.waitForURL("**/dashboard"); await waiter.goto(deviceOrigin + `/sales?operation=${venue.id}`); await expect(waiter.getByRole("button", { name: "New sale", exact: true })).toBeEnabled();
  const kitchen = await prepContext.newPage(); await login(kitchen, "prep"); await kitchen.waitForURL("**/dashboard"); await kitchen.goto(deviceOrigin + `/orders?operation=${venue.id}`); await expect(kitchen.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();
  await owner.goto(origin + "/login"); await owner.getByLabel("Email", { exact: true }).fill("owner@example.test"); await owner.getByLabel("Password", { exact: true }).fill(password); await owner.getByRole("button", { name: "Sign in", exact: true }).click(); await owner.waitForURL("**/dashboard"); await owner.goto(origin + "/sync");
  await owner.getByRole("button", { name: "Sync now / retry", exact: true }).click(); await expect(owner.getByText(/Local records|local records/)).toBeVisible();
  await owner.screenshot({ path: "test-results/offline-lan/waiting-sync.png", fullPage: true });
  local.setMeta("connection", connection); await owner.getByRole("button", { name: "Sync now / retry", exact: true }).click();
  await expect.poll(() => local.status().pending, { timeout: 30000 }).toBe(0);
  await expect(owner.getByText("Up to date", { exact: true })).toBeVisible();
  await owner.screenshot({ path: "test-results/offline-lan/synced.png", fullPage: true });
  const cloud = await db.workspaceRecord.findUnique({ where: { tenantId_kind_id: { tenantId: tenant.id, kind: "runtime", id: venue.id } } }); assert.equal(cloud.data.orders.length, 1); assert.equal(cloud.data.payments.length, 1); assert.equal(cloud.data.inventory[0].quantity, 19);
  console.log("Offline LAN browser flow passed: real activation, separate browser devices, local login and cash checkout with cloud unavailable, waiter/kitchen access, sync progress and cloud reconciliation.");
} finally { await Promise.all([ownerContext.close(), tillContext.close(), waiterContext.close(), prepContext.close()]); await browser.close(); clearTestHub(); local.close(); await db.tenant.delete({ where: { id: tenant.id } }); await db.$disconnect(); }
