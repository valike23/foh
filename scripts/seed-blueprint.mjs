import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { defaultGuestBranding } from "../packages/shared/dist/index.js";

const db = new DatabaseSync(process.env.HUB_DB_PATH ?? "apps/hub/data/hub.sqlite");
const eventId = "event-blueprint";
const organizationId = process.env.EXA_ORGANIZATION_ID ?? "org-exa-demo";
try {
  if (!db.prepare("SELECT id FROM business_records WHERE id = ?").get(eventId)) {
    const now = new Date().toISOString();
    const base = (id, name, status = "draft") => ({ id, name, status, organizationId, version: 1, createdAt: now, updatedAt: now });
    const event = { ...base(eventId, "The Blueprint Vol. 3"), venueId: null, location: "Lagos, Nigeria", timezone: "Africa/Lagos", startsAt: "", endsAt: "", organizer: "The Blueprint", notes: "Visual reference: EXA/frontend/theblueprintvol3. Date, venue and service hours remain unconfirmed. Sample drinks and prices are demo content, not an official Blueprint menu. Confirm menu, stock, taxes and vendor allocation before service. No sponsors confirmed." };
    const vendor = { ...base("vendor-blueprint-demo", "Blueprint demo bar", "active"), kind: "internal", contactName: "", email: "", phone: "", notes: "Placeholder allocation for draft preview only." };
    const store = { ...base("store-blueprint-bar", "Main Bar", "active"), scopeType: "event", scopeId: eventId, vendorId: vendor.id, kind: "bar", prepStation: "Main Bar", manualConfirmation: true, fulfillment: "pickup", sectionIds: [], commercialTerms: "", notes: "Sample menu; not confirmed for service.", qrToken: randomBytes(24).toString("hex") };
    const products = [["moet", "Moet Brut", 150000, "Bottle service"], ["heineken", "Heineken 33cl", 3500, "Beer"], ["water", "Still Water", 1500, "Water"]];
    const items = products.map(([slug, name, price, menuSection]) => ({ id: `item-blueprint-${slug}`, storeId: store.id, name, price, category: "Drinks", menuSection, description: "Sample menu item and price.", available: true, stockItemId: `stock-blueprint-${slug}`, imageId: `blueprint-${slug}-v1` }));
    const headerId = randomUUID();
    const logo = await sharp("/Users/samueladeyemi/Documents/GitHub/EXA/frontend/public/logos/blueprint.png").resize({ width: 800, withoutEnlargement: true }).webp().toBuffer();
    const branding = { ...defaultGuestBranding(), theme: "blueprint", backgroundColor: "#080808", surfaceColor: "#101010", accentColor: "#e7e1d6", headerImageId: headerId, socialUrl: "https://www.instagram.com/theblueprintpro/" };
    db.exec("BEGIN IMMEDIATE");
    try {
      const insert = db.prepare("INSERT INTO business_records VALUES (?, ?, ?, ?)");
      for (const [kind, record] of [["events", event], ["vendors", vendor], ["storefronts", store]]) insert.run(record.id, kind, organizationId, JSON.stringify(record));
      db.prepare("INSERT INTO guest_branding_assets VALUES (?, ?, ?, ?, ?, ?, ?)").run(headerId, organizationId, eventId, "image", "image/webp", "Blueprint reference logo.webp", logo);
      db.prepare("INSERT INTO guest_branding VALUES (?, ?, ?, ?)").run(eventId, organizationId, 1, JSON.stringify(branding));
      for (const [slug] of products) {
        const image = db.prepare("SELECT content FROM menu_images WHERE id = ?").get(`demo-${slug}-v1`);
        if (!image) throw new Error(`Missing sample photo: ${slug}`);
        db.prepare("INSERT INTO menu_images VALUES (?, ?, ?)").run(`blueprint-${slug}-v1`, eventId, image.content);
      }
      db.prepare("INSERT INTO event_menu_previews VALUES (?, ?, ?, ?)").run(eventId, organizationId, randomBytes(24).toString("hex"), JSON.stringify(items));
      const activity = { id: randomUUID(), actor: "Local setup", action: "Created Blueprint draft with reference branding and sample menu", createdAt: now };
      db.prepare("INSERT INTO business_activity VALUES (?, ?, ?, ?)").run(activity.id, eventId, "events", JSON.stringify(activity));
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  const { token } = db.prepare("SELECT token FROM event_menu_previews WHERE event_id = ?").get(eventId);
  console.log(`Blueprint draft: http://localhost:5173/events/${eventId}\nPreview: http://localhost:5174/preview/${token}`);
} finally { db.close(); }
