import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const db = new DatabaseSync(process.env.HUB_DB_PATH ?? "apps/hub/data/hub.sqlite", { readOnly: true });
const { token } = db.prepare("SELECT token FROM event_menu_previews WHERE event_id = 'event-dine-at-night'").get();
db.close();
const url = `http://localhost:5174/preview/${token}`;
const output = mkdtempSync(join(tmpdir(), "exa-dine-at-night-"));
const before = await (await fetch("http://127.0.0.1:4000/health")).json();
const data = await (await fetch(`http://127.0.0.1:4000/api/manage/menu-preview/${token}`)).json();
assert.equal(data.preview, true);
assert.equal(data.snapshot.menuItems.length, 8);
assert.equal(data.snapshot.orders.length, 0);
assert.equal(data.snapshot.inventory.length, 0);
assert.equal(data.snapshot.users.length, 0);
assert.equal(data.snapshot.event.guestBranding.theme, "night-market");
assert.equal(data.snapshot.event.dateLabel, "17 December 2026");
const attemptedOrder = await fetch("http://127.0.0.1:4000/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entryToken: token, storeId: data.snapshot.stores[0].id, origin: "guest-self-order", createdBy: "Preview test", lines: [{ menuItemId: data.snapshot.menuItems[0].id, quantity: 1 }] }) });
assert.equal(attemptedOrder.status, 410, "preview tokens cannot submit real orders");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport }); const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(url);
    await page.getByRole("heading", { name: "Dessert menu", exact: true }).waitFor();
    assert.equal(await page.locator("[data-menu-card]").count(), 6);
    await page.getByRole("button", { name: "Add one" }).first().click();
    assert.equal(await page.getByRole("button", { name: "Ordering not open" }).isDisabled(), true);
    assert.match(await page.getByText("Balance due", { exact: true }).locator("..").innerText(), /7,000/);
    for (const label of ["Consumption Tax", "Service Charge", "VAT"]) {
      assert.match(await page.getByText(label, { exact: true }).locator("..").innerText(), /0/);
    }
    assert.equal(await page.getByText("Active deposit", { exact: true }).count(), 0);
    await page.getByLabel("Search menu").fill("not-a-dessert");
    await page.getByText("No matching items.").waitFor();
    await page.getByLabel("Search menu").fill("");
    for (const image of await page.locator("img").all()) { await image.scrollIntoViewIfNeeded(); await image.evaluate(img => img.decode()); }
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(output, `desserts-${viewport.width}.png`), fullPage: true });
    await page.getByRole("link", { name: "Chu Chu Churro Bar", exact: true }).click();
    await page.getByText("Chu Chu XL", { exact: true }).waitFor();
    assert.equal(await page.locator("[data-menu-card]").count(), 2);
    assert.equal(await page.locator("output").first().innerText(), "0", "switching storefront resets selection");
    for (const image of await page.locator("img").all()) { await image.scrollIntoViewIfNeeded(); await image.evaluate(img => img.decode()); }
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(output, `churros-${viewport.width}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally { await browser.close(); }
assert.equal((await (await fetch("http://127.0.0.1:4000/health")).json()).orders, before.orders);
console.log(`PASS: event preview, images, menu switching, search, totals and blocked ordering. Screenshots: ${output}`);
