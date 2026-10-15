import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const db = new DatabaseSync(process.env.HUB_DB_PATH ?? "apps/hub/data/hub.sqlite", { readOnly: true });
const stores = db.prepare("SELECT data FROM business_records WHERE kind = 'storefronts'").all()
  .map(row => JSON.parse(row.data)).filter(store => ["store-main-bar", "store-grill"].includes(store.id));
db.close();
assert.equal(stores.length, 2);
const output = mkdtempSync(join(tmpdir(), "exa-mock-products-"));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
try {
  for (const store of stores) {
    const snapshot = await (await fetch(`http://127.0.0.1:4000/api/guest/snapshot?entryToken=${store.qrToken}`)).json();
    assert.ok(snapshot.menuItems?.length, "Demo storefront must be open");
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const errors = []; page.on("pageerror", error => errors.push(error.message));
      await page.goto(`http://localhost:5174/entry/${store.qrToken}`);
      await page.getByRole("heading", { name: "Available now", exact: true }).waitFor();
      for (const item of snapshot.menuItems.filter(item => item.available)) {
        assert.ok(item.imageId, `${item.name} needs an image`);
        const image = page.getByRole("img", { name: item.name, exact: true });
        await image.scrollIntoViewIfNeeded();
        await image.evaluate(img => img.decode());
        assert.ok(await image.evaluate(img => img.naturalWidth > 0));
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: join(output, `${store.id}-${viewport.width}.png`), fullPage: true });
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  console.log(`PASS: demo product photos render on desktop and mobile. Screenshots: ${output}`);
} finally { await browser.close(); }
