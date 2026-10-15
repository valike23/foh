import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { defaultGuestBranding } from "../packages/shared/dist/index.js";

const db = new DatabaseSync(process.env.HUB_DB_PATH ?? "apps/hub/data/hub.sqlite");
const eventId = "event-club53";
const organizationId = process.env.EXA_ORGANIZATION_ID ?? "org-exa-demo";
try {
  if (!db.prepare("SELECT id FROM business_records WHERE id = ?").get(eventId)) {
    const now = new Date().toISOString();
    const base = (id, name, status = "draft") => ({ id, name, status, organizationId, version: 1, createdAt: now, updatedAt: now });
    const event = { ...base(eventId, "Club53 - The 53rd Card"), venueId: null, location: "Lagos Motor Boat Club, Lagos", timezone: "Africa/Lagos", startsAt: "2026-12-29T21:00:00+01:00", endsAt: "", organizer: "53 Group", notes: "Draft based on EXA/frontend/club53. Reference page lists 29 December 2026, 9PM till late, Lagos Motor Boat Club, 21+ and valid photo ID. These details require organizer confirmation; closing time is unset. Drinks and prices are sample content, not an official Club53 menu. Confirm stock, charges, staff and allocations before opening. No sponsors confirmed." };
    const vendor = { ...base("vendor-club53-demo", "Club53 demo bar", "active"), kind: "internal", contactName: "", email: "", phone: "", notes: "Placeholder allocation for draft preview only." };
    const store = { ...base("store-club53-bar", "Main Bar", "active"), scopeType: "event", scopeId: eventId, vendorId: vendor.id, kind: "bar", prepStation: "Main Bar", manualConfirmation: true, fulfillment: "pickup", sectionIds: [], commercialTerms: "", notes: "Sample menu; not confirmed for service.", qrToken: randomBytes(24).toString("hex") };
    const products = [["moet", "Moet Brut", 150000, "Bottle service"], ["heineken", "Heineken 33cl", 3500, "Beer"], ["water", "Still Water", 1500, "Water"]];
    const items = products.map(([slug, name, price, menuSection]) => ({ id: `item-club53-${slug}`, storeId: store.id, name, price, category: "Drinks", menuSection, description: "Sample menu item and price.", available: true, stockItemId: `stock-club53-${slug}`, imageId: `club53-${slug}-v1` }));
    const headerId = randomUUID();
    const logo = await sharp("/Users/samueladeyemi/Documents/GitHub/EXA/frontend/public/club53/wordmark.png").webp({ quality: 95 }).toBuffer();
    const branding = { ...defaultGuestBranding(), theme: "club53", backgroundColor: "#0b0b0c", surfaceColor: "#151517", accentColor: "#d3121c", headerImageId: headerId, socialUrl: "https://www.instagram.com/club53.ng/" };
    db.exec("BEGIN IMMEDIATE");
    try {
      const insert = db.prepare("INSERT INTO business_records VALUES (?, ?, ?, ?)");
      for (const [kind, record] of [["events", event], ["vendors", vendor], ["storefronts", store]]) insert.run(record.id, kind, organizationId, JSON.stringify(record));
      db.prepare("INSERT INTO guest_branding_assets VALUES (?, ?, ?, ?, ?, ?, ?)").run(headerId, organizationId, eventId, "image", "image/webp", "Club53 reference wordmark.webp", logo);
      db.prepare("INSERT INTO guest_branding VALUES (?, ?, ?, ?)").run(eventId, organizationId, 1, JSON.stringify(branding));
      for (const [slug] of products) {
        const image = db.prepare("SELECT content FROM menu_images WHERE id = ?").get(`demo-${slug}-v1`);
        if (!image) throw new Error(`Missing sample photo: ${slug}`);
        db.prepare("INSERT INTO menu_images VALUES (?, ?, ?)").run(`club53-${slug}-v1`, eventId, image.content);
      }
      db.prepare("INSERT INTO event_menu_previews VALUES (?, ?, ?, ?)").run(eventId, organizationId, randomBytes(24).toString("hex"), JSON.stringify(items));
      const activity = { id: randomUUID(), actor: "Local setup", action: "Created Club53 draft with reference branding and sample menu", createdAt: now };
      db.prepare("INSERT INTO business_activity VALUES (?, ?, ?, ?)").run(activity.id, eventId, "events", JSON.stringify(activity));
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  const { token } = db.prepare("SELECT token FROM event_menu_previews WHERE event_id = ?").get(eventId);
  console.log(`Club53 draft: http://localhost:5173/events/${eventId}\nPreview: http://localhost:5174/preview/${token}`);
} finally { db.close(); }
