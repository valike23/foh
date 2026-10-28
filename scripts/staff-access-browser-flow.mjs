import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { chromium, expect } from "@playwright/test";
config({ path: "apps/cloud/.env", quiet: true });
const db = new PrismaClient(); const slug = `staff-ui-${randomUUID().slice(0, 8)}`;
const origin = process.env.BROWSER_APP_ORIGIN ?? "http://app.localhost:5173"; const tenant = origin.replace("app.localhost", `${slug}.localhost`);
const browser = await chromium.launch({ headless: true }); const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); const page = await context.newPage(); page.setDefaultTimeout(30000);
const errors = []; page.on("pageerror", e => errors.push(e.message)); mkdirSync("test-results/staff-access", { recursive: true });
const password = "browser-staff-password-123";
async function api(path, body, method = "POST") {
  const r = await page.evaluate(async ({ path, body, method }) => { const r = await fetch(`/api/manage${path}`, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, data: await r.json() }; }, { path, body, method }); assert.ok(r.status < 300, `${path}: ${JSON.stringify(r)}`); return r.data;
}
async function login(email) {
  await page.goto(`${tenant}/login`); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(password); await page.getByRole("button", { name: "Sign in", exact: true }).click(); await page.waitForURL("**/dashboard");
}
try {
  await page.goto(`${origin}/signup`);
  await api("/auth/signup", { slug, organizationName: "Staff role verification", name: "Owner", email: "owner@test.example", password });
  await login("owner@test.example");
  const venue = await api("/venues", { name: "Lekki restaurant" });
  const vendor = await api("/vendors", { name: "House vendor", kind: "internal", contactName: "", email: "", phone: "", notes: "" });
  await api(`/vendors/${vendor.id}/status`, { status: "active", version: 1, reason: "Ready" });
  const shops = [];
  for (const name of ["Main Bar", "Kitchen"]) { const s = await api("/storefronts", { name, scopeType: "venue", scopeId: venue.id, vendorId: vendor.id, kind: "bar", prepStation: "", manualConfirmation: false, fulfillment: "pickup", sectionIds: [], commercialTerms: "", notes: "" }); await api(`/storefronts/${s.id}/status`, { status: "active", version: 1, reason: "Ready" }); shops.push(s); }
  await api(`/operations/${venue.id}/publish`, { scopeType: "venue", version: 1 });
  for (const shop of shops) await api(`/service/${venue.id}/api/menu-items`, { storeId: shop.id, name: `${shop.name} item`, category: "Food", price: 1000, quantity: 10, lowStockThreshold: 2, unit: "plates" });
  const ops = await api("/operations", undefined, "GET"); await api(`/operations/${venue.id}/lifecycle`, { action: "open", revision: ops.items[0].revision, reason: "Open service" });
  const unavailable = { status: 503, contentType: "application/json", body: JSON.stringify({ error: "The online service is unavailable. Please retry." }) };
  let blockSession = true; let blockOperations = true;
  await page.route("**/api/manage/auth/session", route => blockSession ? route.fulfill(unavailable) : route.continue()); await page.route("**/api/manage/operations", route => blockOperations ? route.fulfill(unavailable) : route.continue());
  await page.goto(`${tenant}/operations`); await expect(page.getByRole("status")).toContainText("The online service is unavailable. Please retry."); blockSession = false;
  await expect(page.getByRole("heading", { name: "Service operations", exact: true })).toBeVisible(); await expect(page.getByText("The online service is unavailable. Please retry.", { exact: true })).toBeVisible(); blockOperations = false;
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible(); await expect(page.getByText("The online service is unavailable. Please retry.", { exact: true })).toHaveCount(0); await page.unroute("**/api/manage/auth/session"); await page.unroute("**/api/manage/operations");
  await page.goto(`${tenant}/settings/account`); await page.getByRole("button", { name: "Add staff member", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Ada Cashier"); await page.getByLabel("Email", { exact: true }).fill("ada@test.example"); await page.getByLabel("Initial password", { exact: true }).fill(password);
  await page.getByLabel("Role 1", { exact: true }).selectOption("cashier"); await page.getByLabel("Assignment 1", { exact: true }).selectOption(`store:${shops[0].id}`);
  await page.getByRole("button", { name: "Save access", exact: true }).click(); await page.getByRole("heading", { name: "Ada Cashier", exact: true }).waitFor();
  await page.screenshot({ path: "test-results/staff-access/owner-team.png", fullPage: true });
  await api("/staff", { name: "Read Only", email: "viewer@test.example", password, assignments: [{ role: "viewer", venueId: null, storefrontId: shops[0].id }] });
  await api("/staff", { name: "Venue Manager", email: "manager@test.example", password, assignments: [{ role: "venue-manager", venueId: venue.id, storefrontId: null }] });
  await api("/auth/logout", {}); await login("ada@test.example");
  const cashierNav = page.getByRole("navigation", { name: "Main navigation" }); await expect(cashierNav.getByRole("link")).toHaveText(["Dashboard", "My account", "Sales", "Payments", "Orders"]);
  await page.goto(`${tenant}/storefronts`); await expect(page.getByRole("link", { name: "Main Bar", exact: true })).toBeVisible(); await expect(page.getByRole("link", { name: "Kitchen", exact: true })).toHaveCount(0);
  await page.goto(`${tenant}/sales?operation=${venue.id}`); await page.getByRole("button", { name: "New sale", exact: true }).click(); await expect(page.getByLabel("Storefront", { exact: true }).locator("option")).toHaveCount(1);
  await page.getByLabel("Main Bar item quantity", { exact: true }).fill("1"); await page.getByRole("button", { name: "Create sale", exact: true }).click();
  await expect(page.getByRole("button", { name: "Record payment", exact: true })).toHaveCount(0); await page.getByRole("link", { name: "Go to payments", exact: true }).click(); await page.waitForURL("**/payments?**"); await page.getByRole("button", { name: "Record payment", exact: true }).click(); await page.getByRole("button", { name: "Confirm payment", exact: true }).click(); await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();
  await page.goto(`${tenant}/settings/account`); await expect(page.getByRole("heading", { name: "Your assignments", exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Add staff member", exact: true })).toHaveCount(0);
  await api("/auth/logout", {}); await login("viewer@test.example");
  await page.goto(`${tenant}/sales?operation=${venue.id}`); await expect(page.getByRole("button", { name: "New sale", exact: true })).toBeDisabled(); await expect(page.getByRole("button", { name: "Record payment", exact: true })).toHaveCount(0); await expect(page.getByText("Restricted", { exact: true }).first()).toBeVisible();
  await page.goto(`${tenant}/stock?operation=${venue.id}`); await expect(page.getByRole("button", { name: "Add menu item", exact: true })).toBeDisabled();
  await api("/auth/logout", {}); await login("manager@test.example"); await page.goto(`${tenant}/operations`); await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.goto(`${tenant}/floor/new?scopeType=venue&scopeId=${venue.id}`); await page.getByLabel("Location label", { exact: true }).fill("Garden seating"); await page.getByRole("button", { name: "Create floor location", exact: true }).click();
  const fixLink = page.getByRole("link", { name: "Manage this operation", exact: true }); await expect(fixLink).toBeVisible(); await expect(fixLink).toHaveAttribute("href", `/operations?operation=${venue.id}`);
  const [operationTab] = await Promise.all([page.waitForEvent("popup"), fixLink.click()]); operationTab.on("pageerror", e => errors.push(e.message)); await operationTab.waitForLoadState(); await operationTab.getByRole("button", { name: "Pause", exact: true }).click();
  const pauseDialog = operationTab.getByRole("dialog"); await pauseDialog.getByLabel("Reason", { exact: true }).fill("Update floor layout"); await pauseDialog.getByRole("button", { name: "Pause orders", exact: true }).click(); await expect(operationTab.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  await expect(page.getByLabel("Location label", { exact: true })).toHaveValue("Garden seating"); await page.getByRole("button", { name: "Create floor location", exact: true }).click(); await page.waitForURL("**/floor/*"); await expect(page.getByRole("heading", { name: "Garden seating", exact: true })).toBeVisible();
  await operationTab.reload(); await operationTab.getByRole("button", { name: "Resume", exact: true }).click(); const resumeDialog = operationTab.getByRole("dialog"); await resumeDialog.getByLabel("Reason", { exact: true }).fill("Floor layout ready"); await resumeDialog.getByRole("button", { name: "Open service", exact: true }).click(); await expect(operationTab.getByRole("button", { name: "Pause", exact: true })).toBeVisible(); await operationTab.close();
  const refreshedFloor = await api(`/service/${venue.id}/api/snapshot`, undefined, "GET"); assert.ok(refreshedFloor.sections.some(s => s.label === "Garden seating")); assert.equal(refreshedFloor.orders.length, 1); assert.equal(refreshedFloor.payments.length, 1);
  await page.goto(`${tenant}/storefronts`); await expect(page.getByRole("link", { name: "Kitchen", exact: true })).toBeVisible();
  await api("/auth/logout", {}); await login("owner@test.example"); await page.goto(`${tenant}/settings/account`);
  const ada = page.locator("article").filter({ has: page.getByRole("heading", { name: "Ada Cashier", exact: true }) });
  await ada.getByRole("button", { name: "Edit access", exact: true }).click(); await page.getByRole("button", { name: "Add another assignment", exact: true }).click(); await page.getByLabel("Role 2", { exact: true }).selectOption("prep"); await page.getByLabel("Assignment 2", { exact: true }).selectOption(`store:${shops[1].id}`); await page.getByRole("button", { name: "Save access", exact: true }).click(); await expect(ada.getByText("Kitchen / prep · Kitchen", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 }); await expect.poll(() => page.locator("aside").evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(0); await page.getByRole("button", { name: "Open navigation", exact: true }).click(); await expect(page.getByRole("button", { name: "Close navigation", exact: true }).last()).toBeVisible(); await page.getByRole("button", { name: "Close navigation", exact: true }).last().click(); await expect.poll(() => page.locator("aside").evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(0); await page.screenshot({ path: "test-results/staff-access/team-mobile.png", fullPage: true, animations: "disabled" }); assert.deepEqual(await page.locator("main section").evaluateAll(els => els.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => ({ width: el.clientWidth, scroll: el.scrollWidth }))), [], "Staff content must wrap on mobile"); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Staff page should not overflow mobile viewport");
  assert.deepEqual(errors, []); console.log("Staff browser checks passed: owner creates and edits assignments, cashier sells and records payment, viewer controls are restricted, venue manager controls are available, mobile layout fits.");
} finally { await browser.close(); await db.tenant.deleteMany({ where: { slug } }); await db.$disconnect(); }
