import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifyBusinessFlow(page, artifacts) {
  const origin = "http://localhost:5188";
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/events/new`);
  await page.getByLabel("Event name", { exact: true }).fill("Rooftop Sessions");
  await page.getByLabel("Host venue").selectOption({ label: "Victoria Island Rooftop" });
  await page.getByLabel("Organizer / responsible manager").fill("Ada Okafor");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Starts", { exact: true }).fill("2026-10-03T18:00");
  await page.getByLabel("Ends", { exact: true }).fill("2026-10-04T02:00");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  await page.getByRole("heading", { name: "Rooftop Sessions", exact: true }).waitFor();
  const eventUrl = page.url();
  const eventId = new URL(eventUrl).pathname.split("/").pop();
  await page.screenshot({ path: join(artifacts, "event-desktop.png"), fullPage: true });
  for (const name of ["Rooftop Drinks", "Grill Collective"]) {
    await page.goto(`${origin}/vendors/new`);
    await page.getByLabel("Vendor name", { exact: true }).fill(name);
    await page.getByLabel("Contact name", { exact: true }).fill("Vendor Manager");
    await page.getByLabel("Email", { exact: true }).fill("vendor@example.test");
    await page.getByRole("button", { name: "Create vendor", exact: true }).click();
    await page.getByRole("heading", { name, exact: true }).waitFor();
  }
  let storefrontUrl;
  for (const [name, vendor] of [["Rooftop Bar", "Rooftop Drinks"], ["Rooftop Grill", "Grill Collective"]]) {
    await page.goto(`${origin}/storefronts/new?scopeType=event&scopeId=${eventId}`);
    await page.getByLabel("Storefront name", { exact: true }).fill(name);
    await page.getByLabel("Vendor", { exact: true }).selectOption({ label: vendor });
    await page.getByLabel("Preparation destination", { exact: true }).fill(`${name} prep`);
    await page.getByLabel("Commercial terms / settlement agreement").fill("Agreed fixed fee for this event");
    await page.getByRole("button", { name: "Create storefront", exact: true }).click();
    await page.getByRole("heading", { name, exact: true }).waitFor();
    if (!storefrontUrl) storefrontUrl = page.url();
    await page.getByRole("button", { name: "Activate", exact: true }).click();
    await page.getByLabel("Reason", { exact: true }).fill("Storefront approved");
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
  }
  await page.goto(`${origin}/floor/new?scopeType=event&scopeId=${eventId}`);
  await page.getByLabel("Location label", { exact: true }).fill("Terrace");
  await page.getByRole("button", { name: "Create floor location", exact: true }).click();
  await page.getByRole("heading", { name: "Terrace", exact: true }).waitFor();
  await page.goto(`${origin}/floor/new?scopeType=event&scopeId=${eventId}`);
  await page.getByLabel("Location label", { exact: true }).fill("Table 01");
  await page.getByLabel("Location type", { exact: true }).selectOption("table");
  await page.getByLabel("Section", { exact: true }).selectOption({ label: "Terrace" });
  await page.getByLabel("Storefront", { exact: true }).selectOption({ label: "Rooftop Bar" });
  await page.getByRole("button", { name: "Create floor location", exact: true }).click();
  await page.getByRole("heading", { name: "Table 01", exact: true }).waitFor();
  const tableUrl = page.url();
  await page.getByRole("link", { name: "QR code", exact: true }).click();
  await page.getByRole("img", { name: "QR code for Table 01" }).waitFor();
  const png = page.getByRole("img", { name: "QR code for Table 01" });
  assert.ok(await png.evaluate(image => image.complete && image.naturalWidth > 0));
  await page.screenshot({ path: join(artifacts, "floor-qr-desktop.png"), fullPage: true });
  const guestUrl = await page.getByRole("link", { name: "Preview destination" }).getAttribute("href");
  const guest = await page.context().newPage();
  await guest.goto(guestUrl);
  await guest.getByText("Service is not open for this location.", { exact: true }).waitFor();
  await guest.close();
  await page.getByRole("button", { name: "Replace code", exact: true }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await page.waitForFunction(old => document.querySelector('a[target="_blank"]')?.getAttribute("href") !== old, guestUrl);
  const expired = await page.context().newPage(); await expired.goto(guestUrl);
  await expired.getByRole("heading", { name: "QR code unavailable" }).waitFor(); await expired.close();
  await page.goto(eventUrl);
  await page.getByRole("button", { name: "Mark ready", exact: true }).click();
  await page.getByLabel("Reason", { exact: true }).fill("Setup reviewed");
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await page.getByRole("button", { name: "Return to draft", exact: true }).waitFor();
  await page.getByRole("button", { name: "Clone event", exact: true }).click();
  await page.getByLabel("Event name", { exact: true }).fill("Rooftop Sessions Next");
  await page.getByLabel("Starts (Africa/Lagos)").fill("2026-10-10T18:00");
  await page.getByLabel("Ends (Africa/Lagos)").fill("2026-10-11T02:00");
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await page.getByRole("heading", { name: "Rooftop Sessions Next", exact: true }).waitFor();
  await page.goto(`${origin}/events`);
  await page.getByRole("link", { name: "Rooftop Sessions Next", exact: true }).waitFor();
  await page.screenshot({ path: join(artifacts, "events-directory-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [url, name] of [[eventUrl, "event"], [storefrontUrl, "storefront"], [`${tableUrl}?tab=qr`, "floor-qr"]]) {
    await page.goto(url);
    await page.locator("h1").waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} mobile overflow`);
    await page.screenshot({ path: join(artifacts, `${name}-mobile.png`), fullPage: true });
  }
  await page.goto(`${storefrontUrl}/edit`);
  await page.getByLabel("Storefront name", { exact: true }).waitFor();
  await page.getByLabel("Preparation destination", { exact: true }).fill("Terrace prep counter");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Terrace prep counter", { exact: true }).waitFor();
  console.log("PASS: event wizard, two vendor allocations, storefront activation/edit, floor, QR render/preview/rotation, clone and mobile layout");
}
