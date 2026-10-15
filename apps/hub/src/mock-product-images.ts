import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { MenuItem } from "@exa-foh/shared";

const products = [
  ["moet", "Moet Brut"],
  ["heineken", "Heineken 33cl"],
  ["water", "Still Water"],
  ["jollof", "Jollof Rice Plate"],
  ["suya", "Beef Suya"]
] as const;

// Apply once to the legacy demo catalog, never to customer-created menu items.
export function installMockProductImages(db: DatabaseSync) {
  const key = "mock_product_images_v1";
  db.exec("CREATE TABLE IF NOT EXISTS menu_images (id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, content BLOB NOT NULL)");
  if (db.prepare("SELECT value FROM hub_meta WHERE key = ?").get(key)) return;
  const assets = products.map(([slug, name]) => ({ slug, name, content: readFileSync(new URL(`../assets/mock-products/${slug}.webp`, import.meta.url)) }));
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const { slug, name, content } of assets) {
      const row = db.prepare("SELECT data FROM menu_items WHERE id = ?").get(`item-${slug}`) as { data: string } | undefined;
      if (!row) continue;
      const item = JSON.parse(row.data) as MenuItem;
      if (item.imageId || item.name !== name) continue;
      item.imageId = `demo-${slug}-v1`;
      db.prepare("INSERT OR IGNORE INTO menu_images VALUES (?, ?, ?)").run(item.imageId, "event-exa-launch-night", content);
      db.prepare("UPDATE menu_items SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(JSON.stringify(item), item.id);
    }
    db.prepare("INSERT INTO hub_meta (key, value) VALUES (?, ?)").run(key, "installed");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
