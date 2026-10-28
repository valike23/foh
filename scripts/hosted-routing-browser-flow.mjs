import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { chromium, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
config({ path: "apps/cloud/.env", quiet: true });
const db = new PrismaClient(); const slug = `single-${randomUUID().slice(0, 8)}`; const origin = process.env.BROWSER_APP_ORIGIN ?? "http://localhost:5175";
const browser = await chromium.launch({ headless: true }); const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); const page = await context.newPage(); page.setDefaultTimeout(30000);
const password = "hosted-browser-password-123"; const errors = []; page.on("pageerror", e => errors.push(e.message));
async function api(path, body, method = "POST") {
  const result = await page.evaluate(async ({ path, body, method }) => { const r = await fetch(`/api/manage${path}`, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, data: await r.json() }; }, { path, body, method });
  assert.ok(result.status < 300, `${path}: ${JSON.stringify(result)}`); return result.data;
}
try {
  await page.goto(`${origin}/signup`); await page.getByLabel("Organization name", { exact: true }).fill("Hosted workspace"); await page.locator('input[name="slug"]').fill(slug); await page.getByLabel("Full name", { exact: true }).fill("Hosted Owner"); await page.getByLabel("Email", { exact: true }).fill("owner@hosted.example"); await page.getByLabel("Password", { exact: true }).fill(password); await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open workspace", exact: true })).toHaveAttribute("href", `${origin}/login?workspace=${slug}`); await page.getByRole("link", { name: "Open workspace", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill("owner@hosted.example"); await page.getByLabel("Password", { exact: true }).fill(password); await page.getByRole("button", { name: "Sign in", exact: true }).click(); await page.waitForURL("**/dashboard"); await expect(page.getByRole("heading", { name: "Your next great service starts here.", exact: true })).toBeVisible();
  const cookies = await context.cookies(); assert.ok(cookies.some(c => c.name === "exa-online-session" && c.httpOnly)); assert.ok(cookies.some(c => c.name === "exa-workspace" && c.value === slug && c.httpOnly));
  const venue = await api("/venues", { name: "Hosted venue" }); const vendor = await api("/vendors", { name: "House vendor", kind: "internal", contactName: "", email: "", phone: "", notes: "" }); await api(`/vendors/${vendor.id}/status`, { status: "active", version: 1, reason: "Ready" });
  const store = await api("/storefronts", { name: "Hosted kitchen", scopeType: "venue", scopeId: venue.id, vendorId: vendor.id, kind: "kitchen", prepStation: "Kitchen", manualConfirmation: true, fulfillment: "pickup", sectionIds: [], commercialTerms: "", notes: "" }); await api(`/storefronts/${store.id}/status`, { status: "active", version: 1, reason: "Ready" }); await api(`/operations/${venue.id}/publish`, { scopeType: "venue", version: 1 }); await api(`/service/${venue.id}/api/menu-items`, { storeId: store.id, name: "Hosted meal", category: "Food", price: 2000, quantity: 10, lowStockThreshold: 2, unit: "plates" });
  const operations = await api("/operations", undefined, "GET"); await api(`/operations/${venue.id}/lifecycle`, { action: "open", revision: operations.items[0].revision, reason: "Open" });
  await page.goto(`${origin}/storefronts/${store.id}`); await expect(page.getByRole("link", { name: "Guest menu", exact: true })).toHaveAttribute("href", `/order/${store.id}?workspace=${slug}`);
  const guestContext = await browser.newContext(); const guest = await guestContext.newPage(); guest.setDefaultTimeout(30000); guest.on("pageerror", e => errors.push(e.message)); await guest.goto(`${origin}/order/${store.id}?workspace=${slug}`); await guest.getByRole("button", { name: "Add Hosted meal", exact: true }).click(); await guest.getByRole("button", { name: "Review order", exact: true }).click(); await guest.getByRole("dialog").getByRole("button", { name: /Place order/ }).click(); await expect(guest.getByRole("heading", { name: "You're on the list.", exact: true })).toBeVisible();
  assert.equal((await api(`/service/${venue.id}/api/snapshot`, undefined, "GET")).orders.length, 1);
  await page.goto(`${origin}/login?central=1`); await expect(page.getByRole("heading", { name: "Find your workspace", exact: true })).toBeVisible(); await page.getByLabel("Workspace name", { exact: true }).fill(slug); await page.getByRole("button", { name: "Continue", exact: true }).click(); await page.waitForURL(`**/login?workspace=${slug}`); await expect(page.getByRole("heading", { name: "Welcome back", exact: true })).toBeVisible();
  await page.goto(`${origin}/signup`); await expect(page.getByRole("heading", { name: "Create your workspace", exact: true })).toBeVisible();
  assert.deepEqual(errors, []); console.log("Hosted browser routing passed: signup, workspace login, proxy cookies, private operations, public guest ordering, workspace finder, and signup with an existing session.");
} finally { await browser.close(); await db.tenant.deleteMany({ where: { slug } }); await db.$disconnect(); }
