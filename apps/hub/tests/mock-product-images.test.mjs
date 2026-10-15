import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { installMockProductImages } from "../dist/mock-product-images.js";

test("demo photos fill matching empty items once and preserve uploads and removals", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE hub_meta (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE menu_items (id TEXT PRIMARY KEY, data TEXT, updated_at TEXT)");
  const items = [
    { id: "item-moet", name: "Moet Brut" },
    { id: "item-heineken", name: "Heineken 33cl", imageId: "uploaded-photo" },
    { id: "item-water", name: "Custom water" },
    { id: "item-jollof", name: "Jollof Rice Plate" },
    { id: "item-suya", name: "Beef Suya" },
    { id: "custom", name: "Still Water" }
  ];
  for (const item of items) db.prepare("INSERT INTO menu_items (id, data) VALUES (?, ?)").run(item.id, JSON.stringify(item));
  const get = id => JSON.parse(db.prepare("SELECT data FROM menu_items WHERE id = ?").get(id).data);
  installMockProductImages(db);
  assert.equal(get("item-moet").imageId, "demo-moet-v1");
  assert.equal(get("item-heineken").imageId, "uploaded-photo");
  assert.equal(get("item-water").imageId, undefined);
  assert.equal(get("custom").imageId, undefined);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM menu_images").get().count, 3);
  const bytes = db.prepare("SELECT content FROM menu_images WHERE id = ?").get("demo-moet-v1").content;
  assert.equal(Buffer.from(bytes).subarray(8, 12).toString(), "WEBP");
  db.prepare("UPDATE menu_items SET data = ? WHERE id = ?").run(JSON.stringify(items[0]), "item-moet");
  installMockProductImages(db);
  assert.equal(get("item-moet").imageId, undefined, "removing a demo photo survives restart");
  db.close();
});
