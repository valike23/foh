import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifyServicePages(page, artifacts) {
  const origin = new URL(page.url()).origin;
  const response = await page.request.get(`${origin}/api/manage/operations`);
  assert.equal(response.status(), 200);
  const operation = (await response.json()).items.find(item => item.published);
  assert.ok(operation, "fixture includes a published operation");
  const pages = [
    ["command", "Command", "Live order feed"],
    ["sessions", "Service Sessions", "Service Sessions"],
    ["setup", "Setup", "Setup console"],
    ["staff-order", "Staff order", "Waiter/cashier order"],
    ["prep", "Prep", "Kitchen/bar prep"],
    ["inventory", "Inventory", "Inventory control"],
    ["payments", "Payments", "Payment confirmation"],
    ["ledger", "Ledger", "Ledger and settlement"],
    ["cloud", "Cloud", "Cloud platform sync"],
    ["runner", "Runner", "Runner fulfillment"],
    ["advanced", "Advanced", "Advanced venue"],
    ["tables", "Tables", "Tables"],
    ["audit", "Audit", "Local audit log"]
  ];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/service?operation=${operation.id}`);
  await page.waitForURL(`**/service/command?operation=${operation.id}`);
  for (const [slug, label, heading] of pages) {
    await page.getByRole("navigation", { name: "Service navigation" }).getByRole("link", { name: label, exact: true }).click();
    await page.waitForURL(`**/service/${slug}?operation=${operation.id}`);
    await page.getByRole("heading", { level: 1, name: label, exact: true }).waitFor();
    await page.getByRole("heading", { level: 2, name: heading, exact: true }).waitFor();
    assert.equal(await page.locator('nav[aria-label="Service navigation"] [aria-current="page"]').count(), 1);
    if (slug !== "inventory") assert.equal(await page.getByRole("heading", { name: "Inventory control", exact: true }).count(), 0);
    if (slug !== "setup") assert.equal(await page.getByRole("heading", { name: "Setup console", exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${slug} desktop overflow`);
  }
  await page.goto(`${origin}/service/inventory?operation=${operation.id}`);
  await page.getByRole("heading", { level: 1, name: "Inventory", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("heading", { level: 2, name: "Inventory control" }).waitFor();
  await page.screenshot({ path: join(artifacts, "service-inventory-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const slug of ["inventory", "sessions", "staff-order", "payments"]) {
    await page.goto(`${origin}/service/${slug}?operation=${operation.id}`);
    await page.getByRole("navigation", { name: "Service navigation" }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${slug} mobile overflow`);
    await page.screenshot({ path: join(artifacts, `service-${slug}-mobile.png`), fullPage: true });
  }
  await page.getByRole("navigation", { name: "Service navigation" }).getByRole("link", { name: "Inventory", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: "Inventory", exact: true }).waitFor();
  await page.goBack();
  await page.getByRole("heading", { level: 1, name: "Payments", exact: true }).waitFor();
  const invalid = await page.goto(`${origin}/service/not-a-page?operation=${operation.id}`);
  assert.equal(invalid.status(), 404);
  await page.goto(`${origin}/service/inventory`);
  await page.waitForURL("**/operations");
  await page.setViewportSize({ width: 1440, height: 1000 });
}
